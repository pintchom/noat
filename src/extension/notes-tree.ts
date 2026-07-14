import * as vscode from 'vscode';
import { FOLDER_ICON, NOTE_ICON } from '../core/display-icons';
import { type NoteScope, type StoreEntry, listEntries, scopeDir } from '../core/store';
import type { WorkspaceRepo } from './workspace-scope';

export type NoatNode =
  | { type: 'scope'; scope: NoteScope; label: string; dirAbsPath: string }
  | { type: 'entry'; entry: StoreEntry };

export class NotesTreeProvider implements vscode.TreeDataProvider<NoatNode> {
  private readonly onDidChangeEmitter = new vscode.EventEmitter<NoatNode | undefined>();
  readonly onDidChangeTreeData = this.onDidChangeEmitter.event;

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

  getTreeItem(node: NoatNode): vscode.TreeItem {
    if (node.type === 'scope') {
      const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.Expanded);
      item.contextValue = node.scope.type === 'repo' ? 'scope-repo' : 'scope-global';
      item.iconPath = new vscode.ThemeIcon(node.scope.type === 'repo' ? 'repo' : 'globe');
      return item;
    }

    const { entry } = node;
    const scopeSuffix = entry.scope.type === 'repo' ? 'repo' : 'global';

    if (entry.kind === 'folder') {
      const item = new vscode.TreeItem(
        `${FOLDER_ICON} ${entry.name}`,
        vscode.TreeItemCollapsibleState.Collapsed
      );
      item.contextValue = `folder-${scopeSuffix}`;
      return item;
    }

    const item = new vscode.TreeItem(
      `${NOTE_ICON} ${entry.name}`,
      vscode.TreeItemCollapsibleState.None
    );
    item.contextValue = `note-${scopeSuffix}`;
    item.command = {
      command: 'noat.openNote',
      title: 'Open Note',
      arguments: [entry.absPath],
    };
    return item;
  }

  async getChildren(node?: NoatNode): Promise<NoatNode[]> {
    if (!node) {
      const roots: NoatNode[] = [];
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
      return roots;
    }

    const { dirAbsPath, scope } = (() => {
      if (node.type === 'scope') return { dirAbsPath: node.dirAbsPath, scope: node.scope };
      return { dirAbsPath: node.entry.absPath, scope: node.entry.scope };
    })();

    const entries = await listEntries(dirAbsPath, scope);
    return entries.map((entry) => ({ type: 'entry', entry }));
  }
}
