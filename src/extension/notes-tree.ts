import * as path from 'node:path';
import * as vscode from 'vscode';
import {
  type NoteScope,
  type StoreEntry,
  listEntries,
  listRepoScopes,
  moveEntry,
  scopeDir,
} from '../core/store';
import type { WorkspaceRepo } from './workspace-scope';

export type NoatNode =
  | { type: 'scope'; scope: NoteScope; label: string; dirAbsPath: string }
  | { type: 'entry'; entry: StoreEntry };

const TREE_MIME = 'application/vnd.code.tree.noatNotes';

export class NotesTreeProvider implements vscode.TreeDataProvider<NoatNode> {
  private readonly onDidChangeEmitter = new vscode.EventEmitter<NoatNode | undefined>();
  readonly onDidChangeTreeData = this.onDidChangeEmitter.event;

  private showAllRepos = false;

  constructor(
    private readonly noatHome: string,
    private workspaceRepo: WorkspaceRepo | undefined
  ) {}

  refresh(): void {
    this.onDidChangeEmitter.fire(undefined);
  }

  setWorkspaceRepo(repo: WorkspaceRepo | undefined): void {
    this.workspaceRepo = repo;
    this.refresh();
  }

  getWorkspaceRepo(): WorkspaceRepo | undefined {
    return this.workspaceRepo;
  }

  getShowAllRepos(): boolean {
    return this.showAllRepos;
  }

  setShowAllRepos(showAll: boolean): void {
    if (this.showAllRepos === showAll) return;
    this.showAllRepos = showAll;
    this.refresh();
  }

  getTreeItem(node: NoatNode): vscode.TreeItem {
    if (node.type === 'scope') {
      const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.Expanded);
      item.id = node.dirAbsPath;
      item.contextValue = node.scope.type === 'repo' ? 'scope-repo' : 'scope-global';
      item.iconPath = new vscode.ThemeIcon(node.scope.type === 'repo' ? 'repo' : 'globe');
      return item;
    }

    const { entry } = node;
    const scopeSuffix = entry.scope.type === 'repo' ? 'repo' : 'global';

    if (entry.kind === 'folder') {
      const item = new vscode.TreeItem(entry.name, vscode.TreeItemCollapsibleState.Collapsed);
      item.id = entry.absPath;
      item.contextValue = `folder-${scopeSuffix}`;
      item.iconPath = vscode.ThemeIcon.Folder;
      return item;
    }

    const item = new vscode.TreeItem(entry.name, vscode.TreeItemCollapsibleState.None);
    item.id = entry.absPath;
    item.contextValue = `note-${scopeSuffix}`;
    item.iconPath = new vscode.ThemeIcon('note');
    item.command = {
      command: 'noat.openNote',
      title: 'Open Note',
      arguments: [entry.absPath],
    };
    return item;
  }

  async getChildren(node?: NoatNode): Promise<NoatNode[]> {
    if (!node) {
      return this.rootScopes();
    }

    const { dirAbsPath, scope } = (() => {
      if (node.type === 'scope') return { dirAbsPath: node.dirAbsPath, scope: node.scope };
      return { dirAbsPath: node.entry.absPath, scope: node.entry.scope };
    })();

    const entries = await listEntries(dirAbsPath, scope);
    return entries.map((entry) => ({ type: 'entry', entry }));
  }

  private async rootScopes(): Promise<NoatNode[]> {
    const roots: NoatNode[] = [];
    const workspaceKey =
      this.workspaceRepo?.scope.type === 'repo' ? this.workspaceRepo.scope.repoKey : undefined;

    if (this.workspaceRepo) {
      roots.push({
        type: 'scope',
        scope: this.workspaceRepo.scope,
        label: this.workspaceRepo.label,
        dirAbsPath: scopeDir(this.noatHome, this.workspaceRepo.scope),
      });
    }

    roots.push({
      type: 'scope',
      scope: { type: 'global' },
      label: 'Global',
      dirAbsPath: scopeDir(this.noatHome, { type: 'global' }),
    });

    if (!this.showAllRepos) return roots;

    const repos = await listRepoScopes(this.noatHome);
    for (const repo of repos) {
      if (repo.repoKey === workspaceKey) continue;
      const scope: NoteScope = { type: 'repo', repoKey: repo.repoKey };
      roots.push({
        type: 'scope',
        scope,
        label: repo.label,
        dirAbsPath: scopeDir(this.noatHome, scope),
      });
    }
    return roots;
  }
}

/** Drag notes/folders onto scopes or folders in the NOAT sidebar. */
export class NotesDragAndDropController implements vscode.TreeDragAndDropController<NoatNode> {
  readonly dragMimeTypes = [TREE_MIME];
  readonly dropMimeTypes = [TREE_MIME];

  constructor(private readonly tree: NotesTreeProvider) {}

  handleDrag(
    source: readonly NoatNode[],
    dataTransfer: vscode.DataTransfer,
    _token: vscode.CancellationToken
  ): void {
    const entries = source.filter((node): node is Extract<NoatNode, { type: 'entry' }> => {
      return node.type === 'entry';
    });
    if (entries.length === 0) return;
    dataTransfer.set(TREE_MIME, new vscode.DataTransferItem(entries));
  }

  async handleDrop(
    target: NoatNode | undefined,
    dataTransfer: vscode.DataTransfer,
    _token: vscode.CancellationToken
  ): Promise<void> {
    const transferItem = dataTransfer.get(TREE_MIME);
    if (!transferItem || !target) return;

    const sources = transferItem.value as NoatNode[];
    const targetDir = targetDirOfDrop(target);
    if (!targetDir) return;

    try {
      for (const source of sources) {
        if (source.type !== 'entry') continue;
        await moveEntry(source.entry.absPath, targetDir);
      }
      this.tree.refresh();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      vscode.window.showErrorMessage(`NOAT: ${message}`);
    }
  }
}

/** Directory a drop should land in: scope root, folder, or a note's parent. */
function targetDirOfDrop(target: NoatNode): string | undefined {
  if (target.type === 'scope') return target.dirAbsPath;
  if (target.entry.kind === 'folder') return target.entry.absPath;
  return path.dirname(target.entry.absPath);
}
