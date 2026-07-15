import * as vscode from 'vscode';
import { getWorkspaceGitSnapshot } from '../core/git';
import { rankWorkspaceFiles } from '../core/workspace-file-search';

const MAX_FILES = 50000;
const CACHE_TTL_MS = 15000;
const MAX_RESULTS = 100;
const FALLBACK_EXCLUDE =
  '{**/node_modules/**,**/.git/**,**/dist/**,**/build/**,**/out/**,**/.next/**,**/target/**}';

interface FolderFiles {
  files: string[];
  changedFiles: string[];
}

function withFolderPrefix(
  folder: vscode.WorkspaceFolder,
  file: string,
  multiRoot: boolean
): string {
  return multiRoot ? `${folder.name}/${file}` : file;
}

/**
 * Searches workspace files for the @-mention menu. Git workspaces are listed
 * through git so ignore rules are honored and large repositories are not
 * truncated by the legacy VS Code file-search API.
 */
export class WorkspaceFileSearch {
  private cache: string[] = [];
  private changedFiles = new Set<string>();
  private cachedAt = 0;
  private refreshing: Promise<void> | undefined;

  private async getFolderFiles(
    folder: vscode.WorkspaceFolder,
    multiRoot: boolean
  ): Promise<FolderFiles> {
    const gitSnapshot = await getWorkspaceGitSnapshot(folder.uri.fsPath);
    if (gitSnapshot) {
      return {
        files: gitSnapshot.files.map((file) => withFolderPrefix(folder, file, multiRoot)),
        changedFiles: gitSnapshot.changedFiles.map((file) =>
          withFolderPrefix(folder, file, multiRoot)
        ),
      };
    }

    const uris = await vscode.workspace.findFiles(
      new vscode.RelativePattern(folder, '**/*'),
      FALLBACK_EXCLUDE,
      MAX_FILES
    );
    return {
      files: uris.map((uri) => vscode.workspace.asRelativePath(uri, multiRoot)),
      changedFiles: [],
    };
  }

  private async refresh(): Promise<void> {
    const folders = vscode.workspace.workspaceFolders ?? [];
    const multiRoot = folders.length > 1;
    const folderFiles = await Promise.all(
      folders.map((folder) => this.getFolderFiles(folder, multiRoot))
    );
    this.cache = [...new Set(folderFiles.flatMap(({ files }) => files))].sort((a, b) =>
      a.localeCompare(b)
    );
    this.changedFiles = new Set(folderFiles.flatMap(({ changedFiles }) => changedFiles));
    this.cachedAt = Date.now();
  }

  private ensureFresh(): Promise<void> {
    if (!this.refreshing && Date.now() - this.cachedAt > CACHE_TTL_MS) {
      this.refreshing = this.refresh().finally(() => {
        this.refreshing = undefined;
      });
    }
    return this.refreshing ?? Promise.resolve();
  }

  async search(query: string): Promise<string[]> {
    await this.ensureFresh();
    return rankWorkspaceFiles(this.cache, this.changedFiles, query, MAX_RESULTS);
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
