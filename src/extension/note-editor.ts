import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';
import type { HostToWebviewMessage, WebviewToHostMessage } from '../core/editor-messages';

const AUTO_SAVE_MS = 1500;
const MAX_WORKSPACE_FILES = 5000;

/** Workspace-relative paths of files the user can @-mention in a note. */
async function listWorkspaceFiles(): Promise<string[]> {
  const uris = await vscode.workspace.findFiles(
    '**/*',
    '{**/node_modules/**,**/.git/**,**/dist/**,**/build/**,**/out/**}',
    MAX_WORKSPACE_FILES
  );
  return uris
    .map((uri) => vscode.workspace.asRelativePath(uri, false))
    .sort((a, b) => a.localeCompare(b));
}

async function openWorkspaceFile(relativePath: string): Promise<void> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    vscode.window.showWarningMessage('NOAT: open a workspace folder to follow file links.');
    return;
  }
  const uri = vscode.Uri.joinPath(folder.uri, relativePath);
  try {
    await vscode.window.showTextDocument(uri, {
      viewColumn: vscode.ViewColumn.Beside,
      preserveFocus: false,
    });
  } catch {
    vscode.window.showWarningMessage(`NOAT: file not found in this workspace: ${relativePath}`);
  }
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

    webview.onDidReceiveMessage((message: WebviewToHostMessage) => {
      switch (message.type) {
        case 'ready':
          void listWorkspaceFiles().then((workspaceFiles) => {
            post({ type: 'init', text: document.getText(), workspaceFiles });
          });
          break;
        case 'edit':
          void applyWebviewEdit(message.text);
          break;
        case 'requestWorkspaceFiles':
          void listWorkspaceFiles().then((files) => post({ type: 'workspaceFiles', files }));
          break;
        case 'openFile':
          void openWorkspaceFile(message.path);
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
