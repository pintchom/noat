import * as vscode from 'vscode';

const MAX_FILES = 50000;
const CACHE_TTL_MS = 15000;
const MAX_RESULTS = 12;

/**
 * Searches workspace files for the @-mention menu. Keeps a cached full file
 * list (all workspace roots) and filters it per query, so the menu sees the
 * entire workspace instead of a truncated snapshot.
 */
export class WorkspaceFileSearch {
  private cache: string[] = [];
  private cachedAt = 0;
  private refreshing: Promise<void> | undefined;

  private async refresh(): Promise<void> {
    const multiRoot = (vscode.workspace.workspaceFolders?.length ?? 0) > 1;
    const uris = await vscode.workspace.findFiles(
      '**/*',
      '{**/node_modules/**,**/.git/**,**/dist/**,**/build/**,**/out/**,**/.next/**,**/target/**}',
      MAX_FILES
    );
    this.cache = uris
      .map((uri) => vscode.workspace.asRelativePath(uri, multiRoot))
      .sort((a, b) => a.localeCompare(b));
    this.cachedAt = Date.now();
  }

  private ensureFresh(): Promise<void> {
    if (!this.refreshing && Date.now() - this.cachedAt > CACHE_TTL_MS) {
      this.refreshing = this.refresh().finally(() => {
        this.refreshing = undefined;
      });
    }
    // First call blocks on the refresh; later calls reuse the cache while a
    // background refresh may be in flight.
    return this.cache.length === 0 && this.refreshing ? this.refreshing : Promise.resolve();
  }

  async search(query: string): Promise<string[]> {
    await this.ensureFresh();
    const q = query.toLowerCase();
    if (q.length === 0) return this.cache.slice(0, MAX_RESULTS);

    const scored = this.cache.flatMap((file) => {
      const lower = file.toLowerCase();
      const name = lower.split('/').pop() ?? lower;
      if (name.startsWith(q)) return [{ file, score: 0 }];
      if (name.includes(q)) return [{ file, score: 1 }];
      if (lower.includes(q)) return [{ file, score: 2 }];
      return [];
    });

    return scored
      .sort((a, b) => a.score - b.score || a.file.length - b.file.length)
      .slice(0, MAX_RESULTS)
      .map((entry) => entry.file);
  }
}

/**
 * Pick where to open a followed file link: a group already showing the file
 * wins (focus, don't duplicate), then the most recently used text editor's
 * group, then any group other than the note's, then a fresh split beside.
 */
export function pickFileViewColumn(uri: vscode.Uri): vscode.ViewColumn {
  const target = uri.toString();
  const hasFile = (tab: vscode.Tab): boolean =>
    tab.input instanceof vscode.TabInputText && tab.input.uri.toString() === target;

  const groupsWithFile = vscode.window.tabGroups.all.filter((group) => group.tabs.some(hasFile));
  const existing =
    groupsWithFile.find((group) => group.tabs.some((tab) => tab.isActive && hasFile(tab))) ??
    groupsWithFile[0];
  if (existing) return existing.viewColumn;

  // The chip click comes from the focused note webview, so activeTextEditor
  // (MRU) and any non-active group both point away from the note.
  const mruColumn = vscode.window.activeTextEditor?.viewColumn;
  if (mruColumn !== undefined) return mruColumn;

  const otherGroup = vscode.window.tabGroups.all.find(
    (group) => group !== vscode.window.tabGroups.activeTabGroup
  );
  return otherGroup?.viewColumn ?? vscode.ViewColumn.Beside;
}

/** Resolve a stored @-mention path back to a Uri, handling multi-root prefixes. */
export function resolveWorkspacePath(relativePath: string): vscode.Uri | undefined {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) return undefined;

  if (folders.length > 1) {
    const [prefix, ...rest] = relativePath.split('/');
    const folder = folders.find((f) => f.name === prefix);
    if (folder && rest.length > 0) return vscode.Uri.joinPath(folder.uri, rest.join('/'));
  }
  return vscode.Uri.joinPath(folders[0]!.uri, relativePath);
}
