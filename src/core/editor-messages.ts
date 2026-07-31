/**
 * Message protocol between the extension host and the note editor webview.
 * `text` is always the full serialized note envelope (the .noat.json content).
 * File paths are workspace-relative (prefixed with the folder name in
 * multi-root workspaces) so links survive machine moves.
 * Note paths are store-relative (e.g. "global/Ideas.noat.json") — the
 * canonical note id, stable across machines.
 * Asset paths are store-relative (`assets/<hash>.<ext>`); asset bytes cross
 * the bridge base64-encoded, and an empty `path`/`dataUri` reply signals
 * failure so the webview never hangs on a request.
 */

/** A note offered by the /page picker. */
export interface NoteLinkResult {
  notePath: string;
  title: string;
  icon?: string;
  /** Human-readable scope, e.g. "Global" or "owner/repo". */
  scopeLabel: string;
}

/**
 * Store-relative prefix of asset paths as recorded in note blocks (e.g. an
 * image block's url). Unlike notePaths, asset paths are relative to the store
 * root, not the notes/ root. Lives here so the webview bundle can use it —
 * the asset I/O module pulls in node builtins the browser can't load.
 */
export const ASSET_PATH_PREFIX = 'assets/';

export type HostToWebviewMessage =
  | { type: 'init'; text: string }
  | { type: 'update'; text: string }
  | { type: 'fileResults'; requestId: number; files: string[] }
  | { type: 'noteResults'; requestId: number; notes: NoteLinkResult[] }
  | { type: 'assetSaved'; requestId: number; path: string }
  | { type: 'assetData'; requestId: number; dataUri: string };

export type WebviewToHostMessage =
  | { type: 'ready' }
  | { type: 'edit'; text: string }
  | { type: 'searchFiles'; requestId: number; query: string }
  | { type: 'openFile'; path: string }
  | { type: 'searchNotes'; requestId: number; query: string }
  | { type: 'openNote'; notePath: string }
  | { type: 'saveAsset'; requestId: number; mime: string; base64: string }
  | { type: 'readAsset'; requestId: number; path: string };
