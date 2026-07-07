/**
 * Message protocol between the extension host and the note editor webview.
 * `text` is always the full serialized note envelope (the .noat.json content).
 * File paths are workspace-relative so links survive machine moves.
 */
export type HostToWebviewMessage =
  | { type: 'init'; text: string; workspaceFiles: string[] }
  | { type: 'update'; text: string }
  | { type: 'workspaceFiles'; files: string[] };

export type WebviewToHostMessage =
  | { type: 'ready' }
  | { type: 'edit'; text: string }
  | { type: 'requestWorkspaceFiles' }
  | { type: 'openFile'; path: string };
