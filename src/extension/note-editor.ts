import { randomBytes } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';
import type {
  HostToWebviewMessage,
  NoteLinkResult,
  WebviewToHostMessage,
} from '../core/editor-messages';
import { rankNoteLinks } from '../core/note-link-search';
import { type NoteListing, listAllNotes, resolveNotePath } from '../core/note-listing';
import { getNoatHome } from '../core/paths';
import { repoKeyToLabel } from '../core/repo-key';
import { WorkspaceFileSearch, pickFileViewColumn, resolveWorkspacePath } from './workspace-files';

const AUTO_SAVE_MS = 400;
const MAX_NOTE_RESULTS = 30;

async function openWorkspaceFile(relativePath: string): Promise<void> {
  const uri = resolveWorkspacePath(relativePath);
  if (!uri) {
    vscode.window.showWarningMessage('NOAT: open a workspace folder to follow file links.');
    return;
  }
  try {
    await vscode.window.showTextDocument(uri, {
      viewColumn: pickFileViewColumn(uri),
      preserveFocus: false,
    });
  } catch {
    vscode.window.showWarningMessage(`NOAT: file not found in this workspace: ${relativePath}`);
  }
}

function toNoteLinkResult(listing: NoteListing): NoteLinkResult {
  return {
    // Chips are stored in git-synced note files, so normalize the store's
    // platform separators to "/" — links must survive machine moves.
    notePath: listing.notePath.split(path.sep).join('/'),
    title: listing.title,
    ...(listing.icon && { icon: listing.icon }),
    scopeLabel: listing.scope === 'global' ? 'Global' : repoKeyToLabel(listing.scope),
  };
}

/** Search the note store for the /page picker. */
async function searchLinkableNotes(noatHome: string, query: string): Promise<NoteLinkResult[]> {
  const listings = await listAllNotes(noatHome);
  return rankNoteLinks(listings, query, MAX_NOTE_RESULTS).map(toNoteLinkResult);
}

/** Follow a noteLink chip: open the linked note beside this one. */
async function openLinkedNote(noatHome: string, notePath: string): Promise<void> {
  const absPath = (() => {
    try {
      return resolveNotePath(noatHome, notePath);
    } catch {
      return undefined;
    }
  })();
  if (
    !absPath ||
    !(await fs.access(absPath).then(
      () => true,
      () => false
    ))
  ) {
    vscode.window.showWarningMessage(
      `NOAT: linked note not found (was it deleted or moved?): ${notePath}`
    );
    return;
  }
  await vscode.commands.executeCommand('noat.openNote', absPath);
}

/**
 * Custom editor for .noat.json files. The webview runs BlockNote; this side
 * keeps the TextDocument in sync so VS Code's dirty state, save, revert, and
 * undo all work natively.
 */
export class NoteEditorProvider implements vscode.CustomTextEditorProvider {
  static readonly viewType = 'noat.noteEditor';

  static register(context: vscode.ExtensionContext): vscode.Disposable {
    return vscode.window.registerCustomEditorProvider(
      NoteEditorProvider.viewType,
      new NoteEditorProvider(context),
      {
        webviewOptions: { retainContextWhenHidden: true },
        supportsMultipleEditorsPerDocument: false,
      }
    );
  }

  constructor(private readonly context: vscode.ExtensionContext) {}

  async resolveCustomTextEditor(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken
  ): Promise<void> {
    const webview = webviewPanel.webview;
    webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'dist')],
    };
    webview.html = this.buildHtml(webview);

    // Text we last applied on behalf of the webview — used to break echo loops.
    let lastWebviewText: string | undefined;
    let saveTimer: NodeJS.Timeout | undefined;

    const post = (message: HostToWebviewMessage): void => {
      void webview.postMessage(message);
    };

    const scheduleAutoSave = (): void => {
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        if (document.isDirty) void document.save();
      }, AUTO_SAVE_MS);
    };

    const applyWebviewEdit = async (text: string): Promise<void> => {
      if (text === document.getText()) return;
      lastWebviewText = text;
      const edit = new vscode.WorkspaceEdit();
      const fullRange = new vscode.Range(0, 0, document.lineCount, 0);
      edit.replace(document.uri, fullRange, text);
      await vscode.workspace.applyEdit(edit);
      scheduleAutoSave();
    };

    const changeSubscription = vscode.workspace.onDidChangeTextDocument((event) => {
      if (event.document.uri.toString() !== document.uri.toString()) return;
      if (event.contentChanges.length === 0) return;
      const text = document.getText();
      // Skip the echo of an edit the webview itself just made.
      if (text === lastWebviewText) return;
      post({ type: 'update', text });
    });

    const fileSearch = new WorkspaceFileSearch();
    const noatHome = getNoatHome();

    webview.onDidReceiveMessage((message: WebviewToHostMessage) => {
      switch (message.type) {
        case 'ready':
          post({ type: 'init', text: document.getText() });
          break;
        case 'edit':
          void applyWebviewEdit(message.text);
          break;
        case 'searchFiles':
          void fileSearch.search(message.query).then((files) => {
            post({ type: 'fileResults', requestId: message.requestId, files });
          });
          break;
        case 'openFile':
          void openWorkspaceFile(message.path);
          break;
        case 'searchNotes':
          void searchLinkableNotes(noatHome, message.query).then((notes) => {
            post({ type: 'noteResults', requestId: message.requestId, notes });
          });
          break;
        case 'openNote':
          void openLinkedNote(noatHome, message.notePath);
          break;
      }
    });

    webviewPanel.onDidDispose(() => {
      changeSubscription.dispose();
      if (saveTimer) clearTimeout(saveTimer);
    });
  }

  private buildHtml(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview.js')
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview.css')
    );
    const nonce = randomBytes(16).toString('base64');

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; font-src ${webview.cspSource} data:; img-src ${webview.cspSource} data:; script-src 'nonce-${nonce}';">
  <link href="${styleUri}" rel="stylesheet">
  <title>NOAT Note</title>
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}
