/**
 * Message protocol between the extension host and the note editor webview.
 * `text` is always the full serialized note envelope (the .noat.json content).
 * File paths are workspace-relative (prefixed with the folder name in
 * multi-root workspaces) so links survive machine moves.
 */
export type HostToWebviewMessage =
  | { type: 'init'; text: string }
  | { type: 'update'; text: string }
  | { type: 'fileResults'; requestId: number; files: string[] };

export type WebviewToHostMessage =
  | { type: 'ready' }
  | { type: 'edit'; text: string }
  | { type: 'searchFiles'; requestId: number; query: string }
  | { type: 'openFile'; path: string };
