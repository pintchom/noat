import { randomBytes } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { ASSET_URL_PREFIX, assetFileName } from '../core/assets';
import { type DiagramLlmConfig, type DiagramRepair, generateMermaid } from '../core/diagram';
import type {
  HostToWebviewMessage,
  NoteLinkResult,
  WebviewToHostMessage,
} from '../core/editor-messages';
import { filePreviewFromBytes } from '../core/file-preview';
import { parseNote } from '../core/note';
import { rankNoteLinks } from '../core/note-link-search';
import { type NoteListing, listAllNotes, resolveNotePath } from '../core/note-listing';
import { blocksToPlainText } from '../core/note-text';
import { getAssetsDir, getNoatHome } from '../core/paths';
import { repoKeyToLabel } from '../core/repo-key';
import { WebviewEchoes } from '../core/webview-echoes';
import { WorkspaceFileSearch, pickFileViewColumn, resolveWorkspacePath } from './workspace-files';

const AUTO_SAVE_MS = 400;
const MAX_NOTE_RESULTS = 30;

async function openWorkspaceFile(relativePath: string): Promise<void> {
  if (!vscode.workspace.workspaceFolders?.length) {
    vscode.window.showWarningMessage('NOAT: open a workspace folder to follow file links.');
    return;
  }
  const uri = resolveWorkspacePath(relativePath);
  if (!uri) {
    vscode.window.showWarningMessage(
      `NOAT: not following a file link that points outside the workspace: ${relativePath}`
    );
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

const PREVIEW_MAX_BYTES = 64 * 1024;

/** Read the leading bytes of a workspace file for the @-mention hover preview. */
async function readFilePreview(relativePath: string): Promise<string | undefined> {
  const uri = resolveWorkspacePath(relativePath);
  if (!uri) return undefined;
  try {
    const bytes = await vscode.workspace.fs.readFile(uri);
    return filePreviewFromBytes(bytes.subarray(0, PREVIEW_MAX_BYTES));
  } catch {
    return undefined;
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

/** Write an uploaded file into the store's assets dir; returns its asset URL. */
async function saveAsset(
  assetsDir: string,
  name: string,
  dataBase64: string
): Promise<string | undefined> {
  try {
    const fileName = assetFileName(name, randomBytes(4).toString('hex'));
    await fs.mkdir(assetsDir, { recursive: true });
    await fs.writeFile(path.join(assetsDir, fileName), Buffer.from(dataBase64, 'base64'));
    return `${ASSET_URL_PREFIX}${fileName}`;
  } catch (error) {
    vscode.window.showErrorMessage(
      `NOAT: could not save the file: ${error instanceof Error ? error.message : String(error)}`
    );
    return undefined;
  }
}

/**
 * Generate a Mermaid diagram for the /diagram slash item. The model runs
 * wherever `noat.diagram.baseUrl` points — a local OpenAI-compatible server by
 * default, so notes never leave the machine and generation costs nothing.
 * The note's own text goes along as context, so "the retry path" means what it
 * means in this note.
 */
async function generateDiagram(
  document: vscode.TextDocument,
  prompt: string,
  repair?: DiagramRepair
): Promise<string> {
  const settings = vscode.workspace.getConfiguration('noat');
  const config: DiagramLlmConfig = {
    baseUrl: settings.get<string>('diagram.baseUrl', 'http://127.0.0.1:8000/v1'),
    model: settings.get<string>('diagram.model', ''),
    apiKey: settings.get<string>('diagram.apiKey', ''),
  };
  const context = (() => {
    try {
      const note = parseNote(document.getText());
      return `${note.title}\n${blocksToPlainText(note.blocks)}`;
    } catch {
      // An unparseable note still deserves a diagram; just skip the context.
      return '';
    }
  })();
  return generateMermaid(config, prompt, context, repair);
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
    const noatHome = getNoatHome();
    const assetsDir = getAssetsDir(noatHome);
    const webview = webviewPanel.webview;
    webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.context.extensionUri, 'dist'),
        vscode.Uri.file(assetsDir),
      ],
    };
    webview.html = this.buildHtml(webview);

    const echoes = new WebviewEchoes();
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

    const applyWebviewEdit = async (rawText: string): Promise<void> => {
      // Match the document's trailing-newline convention. Serialized notes end
      // with "\n", but save participants (files.trimFinalNewlines etc.) may
      // strip it on every autosave — and each strip is its own undo step, so
      // undoing one visible change took two cmd+z presses (#40).
      const docText = document.getText();
      const text =
        !docText.endsWith('\n') && docText.length > 0 && rawText.endsWith('\n')
          ? rawText.slice(0, -1)
          : rawText;
      if (text === echoes.expectedText(docText)) return;
      echoes.writing(text);
      const edit = new vscode.WorkspaceEdit();
      const fullRange = new vscode.Range(0, 0, document.lineCount, 0);
      edit.replace(document.uri, fullRange, text);
      try {
        await vscode.workspace.applyEdit(edit);
      } finally {
        echoes.settled(text);
      }
      scheduleAutoSave();
    };

    const changeSubscription = vscode.workspace.onDidChangeTextDocument((event) => {
      if (event.document.uri.toString() !== document.uri.toString()) return;
      if (event.contentChanges.length === 0) return;
      const text = document.getText();
      if (echoes.isOwnChange(text)) return;
      post({ type: 'update', text });
    });

    const fileSearch = new WorkspaceFileSearch();
    // Base URI the webview prepends to asset file names; images can only load
    // through asWebviewUri (the CSP allows cspSource, not file:).
    const assetsBaseUri = webview.asWebviewUri(vscode.Uri.file(assetsDir)).toString();

    webview.onDidReceiveMessage((message: WebviewToHostMessage) => {
      switch (message.type) {
        case 'ready':
          post({ type: 'init', text: document.getText(), assetsBaseUri });
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
        case 'previewFile':
          void readFilePreview(message.path).then((preview) => {
            post({ type: 'filePreview', requestId: message.requestId, preview });
          });
          break;
        case 'searchNotes':
          void searchLinkableNotes(noatHome, message.query).then((notes) => {
            post({ type: 'noteResults', requestId: message.requestId, notes });
          });
          break;
        case 'openNote':
          void openLinkedNote(noatHome, message.notePath);
          break;
        case 'saveAsset':
          void saveAsset(assetsDir, message.name, message.dataBase64).then((url) => {
            post({ type: 'assetSaved', requestId: message.requestId, url });
          });
          break;
        case 'generateDiagram':
          void generateDiagram(document, message.prompt, message.repair).then(
            (code) => post({ type: 'diagramGenerated', requestId: message.requestId, code }),
            (error: unknown) =>
              post({
                type: 'diagramGenerated',
                requestId: message.requestId,
                error: error instanceof Error ? error.message : String(error),
              })
          );
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
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; font-src ${webview.cspSource} data:; img-src ${webview.cspSource} https: data:; script-src 'nonce-${nonce}';">
  <link href="${styleUri}" rel="stylesheet">
  <title>NOAT Note</title>
</head>
<body>
  <!-- Replaced when React mounts; visible if the bundle never runs. -->
  <div id="root">Starting NOAT…</div>
  <script nonce="${nonce}">
    // A webview that fails before React mounts is just a blank tab, and its
    // console lives behind "Developer: Open Webview Developer Tools". Put the
    // reason on the page instead. Capture phase, so a bundle that fails to
    // load at all — an error that doesn't bubble — is caught too.
    window.addEventListener('error', (event) => {
      const root = document.getElementById('root');
      if (!root || root.childElementCount > 0) return;
      const target = event.target;
      root.textContent = target && target.src
        ? 'NOAT: could not load the editor bundle (' + target.src + ')'
        : 'NOAT: the editor failed to start \u2014 ' + (event.message || 'unknown error');
    }, true);
  </script>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}
