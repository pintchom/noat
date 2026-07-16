/**
 * Message protocol between the extension host and the note editor webview.
 * `text` is always the full serialized note envelope (the .noat.json content).
 * File paths are workspace-relative (prefixed with the folder name in
 * multi-root workspaces) so links survive machine moves.
 * Note paths are store-relative (e.g. "global/Ideas.noat.json") — the
 * canonical note id, stable across machines.
 */

/** A note offered by the /page picker. */
export interface NoteLinkResult {
  notePath: string;
  title: string;
  icon?: string;
  /** Human-readable scope, e.g. "Global" or "owner/repo". */
  scopeLabel: string;
}

export type HostToWebviewMessage =
  | { type: 'init'; text: string }
  | { type: 'update'; text: string }
  | { type: 'fileResults'; requestId: number; files: string[] }
  | { type: 'noteResults'; requestId: number; notes: NoteLinkResult[] };

export type WebviewToHostMessage =
  | { type: 'ready' }
  | { type: 'edit'; text: string }
  | { type: 'searchFiles'; requestId: number; query: string }
  | { type: 'openFile'; path: string }
  | { type: 'searchNotes'; requestId: number; query: string }
  | { type: 'openNote'; notePath: string };
