import * as path from 'node:path';
import * as vscode from 'vscode';
import { writeConfig } from '../core/config';
import { getNoatHome } from '../core/paths';
import { getNotesRoot } from '../core/paths';
import { SearchEngine } from '../core/search/engine';
import {
  type NoteScope,
  createFolder,
  createNote,
  deleteEntry,
  initStore,
  moveToScope,
  renameFolder,
  renameNote,
  scopeDir,
} from '../core/store';
import { GitSync } from './git-sync';
import { logError } from './log';
import { registerMcpServer } from './mcp-registration';
import { NoteEditorProvider } from './note-editor';
import { type NoatNode, NotesTreeProvider } from './notes-tree';
import { showSearchPalette } from './search-palette';
import { detectWorkspaceRepo } from './workspace-scope';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const noatHome = getNoatHome();
  await initStore(noatHome);

  const workspaceRepo = await detectWorkspaceRepo();
  const tree = new NotesTreeProvider(noatHome, workspaceRepo);

  // Note edits save to disk immediately; the store is only committed when the
  // user commits in a workspace repo (see GitSync).
  const gitSync = new GitSync(noatHome);
  void gitSync.start();

  registerMcpServer(context, noatHome);

  // Mirror IDE settings into the store's config.json so the standalone MCP
  // server honors them in any host (Cursor, VS Code, or manual mcp.json).
  const syncConfig = (): void => {
    const useDirectJson = vscode.workspace
      .getConfiguration('noat')
      .get<boolean>('mcp.useDirectJson', false);
    try {
      writeConfig(noatHome, { mcp: { useDirectJson } });
    } catch (error) {
      logError('failed to sync NOAT config', error);
    }
  };
  syncConfig();

  context.subscriptions.push(
    vscode.window.createTreeView('noatNotes', { treeDataProvider: tree }),
    NoteEditorProvider.register(context),
    gitSync,
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('noat.mcp.useDirectJson')) syncConfig();
    })
  );

  /** Directory a create action should target, based on where it was invoked. */
  const targetDirOf = (node: NoatNode | undefined): string => {
    if (node?.type === 'scope') return node.dirAbsPath;
    if (node?.type === 'entry') {
      return node.entry.kind === 'folder' ? node.entry.absPath : path.dirname(node.entry.absPath);
    }
    const repo = tree.getWorkspaceRepo();
    return scopeDir(noatHome, repo ? repo.scope : { type: 'global' });
  };

  const register = (command: string, handler: (node?: NoatNode) => Promise<void>): void => {
    context.subscriptions.push(
      vscode.commands.registerCommand(command, async (node?: NoatNode) => {
        try {
          await handler(node);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          vscode.window.showErrorMessage(`NOAT: ${message}`);
        }
      })
    );
  };

  // Notes open to the side by default so the note sits next to your code.
  context.subscriptions.push(
    vscode.commands.registerCommand('noat.openNote', async (absPath: string) => {
      await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(absPath), {
        viewColumn: vscode.ViewColumn.Beside,
      });
    })
  );

  // Hybrid search: keyword index warms immediately; the vector index (local
  // embedding model, ~25 MB one-time download) builds in the background.
  const searchEngine = new SearchEngine(noatHome);
  void searchEngine.ensureKeywordIndex();
  setTimeout(() => {
    void vscode.window.withProgress(
      { location: vscode.ProgressLocation.Window, title: 'NOAT: indexing notes for search' },
      () =>
        searchEngine.ensureVectorIndex().catch((error) => {
          logError('background vector indexing failed', error);
        })
    );
  }, 3000);

  context.subscriptions.push(
    vscode.commands.registerCommand('noat.searchNotes', () =>
      showSearchPalette(noatHome, searchEngine)
    ),
    vscode.commands.registerCommand('noat.rebuildSearchIndex', () =>
      vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: 'NOAT: rebuilding search index' },
        (progress) =>
          searchEngine.rebuild((done, total) => {
            progress.report({ message: `${done}/${total} sections embedded` });
          })
      )
    ),
    // Keep search indexes fresh as notes are saved (editor or agent writes).
    vscode.workspace.onDidSaveTextDocument((document) => {
      const notesRoot = getNotesRoot(noatHome);
      const filePath = document.uri.fsPath;
      if (!filePath.startsWith(notesRoot + path.sep) || !filePath.endsWith('.noat.json')) return;
      tree.refresh();
      void searchEngine.updateNote(path.relative(notesRoot, filePath));
    })
  );

  register('noat.newNote', async (node) => {
    const title = await vscode.window.showInputBox({
      prompt: 'Note title',
      placeHolder: 'My new note',
    });
    if (!title) return;
    const notePath = await createNote(targetDirOf(node), title);
    tree.refresh();
    await vscode.commands.executeCommand('noat.openNote', notePath);
  });

  register('noat.newFolder', async (node) => {
    const name = await vscode.window.showInputBox({
      prompt: 'Folder name',
      placeHolder: 'New folder',
    });
    if (!name) return;
    await createFolder(targetDirOf(node), name);
    tree.refresh();
  });

  register('noat.refresh', async () => {
    tree.setWorkspaceRepo(await detectWorkspaceRepo());
  });

  register('noat.rename', async (node) => {
    if (node?.type !== 'entry') return;
    const { entry } = node;
    const newName = await vscode.window.showInputBox({
      prompt: entry.kind === 'note' ? 'New note title' : 'New folder name',
      value: entry.name,
    });
    if (!newName || newName === entry.name) return;
    if (entry.kind === 'note') {
      await renameNote(entry.absPath, newName);
    } else {
      await renameFolder(entry.absPath, newName);
    }
    tree.refresh();
  });

  register('noat.delete', async (node) => {
    if (node?.type !== 'entry') return;
    const { entry } = node;
    const what = entry.kind === 'note' ? 'note' : 'folder (and everything in it)';
    const confirmed = await vscode.window.showWarningMessage(
      `Delete ${what} "${entry.name}"?`,
      { modal: true, detail: 'It stays recoverable from the note store git history.' },
      'Delete'
    );
    if (confirmed !== 'Delete') return;
    await deleteEntry(entry.absPath);
    tree.refresh();
  });

  const moveTo = async (node: NoatNode | undefined, targetScope: NoteScope): Promise<void> => {
    if (node?.type !== 'entry') return;
    await moveToScope(node.entry.absPath, noatHome, targetScope);
    tree.refresh();
  };

  register('noat.moveToGlobal', (node) => moveTo(node, { type: 'global' }));

  register('noat.moveToRepo', async (node) => {
    const repo = tree.getWorkspaceRepo();
    if (!repo) {
      vscode.window.showWarningMessage('NOAT: no git repo detected in this workspace.');
      return;
    }
    await moveTo(node, repo.scope);
  });

  register('noat.openNotesRepo', async () => {
    const terminal = vscode.window.createTerminal({ name: 'NOAT store', cwd: noatHome });
    terminal.show();
  });

  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(async () => {
      tree.setWorkspaceRepo(await detectWorkspaceRepo());
    })
  );
}

export function deactivate(): void {}
