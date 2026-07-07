/**
 * Message protocol between the extension host and the note editor webview.
 * `text` is always the full serialized note envelope (the .noat.json content).
 */
export type HostToWebviewMessage =
  | { type: 'init'; text: string }
  | { type: 'update'; text: string };

export type WebviewToHostMessage = { type: 'ready' } | { type: 'edit'; text: string };
