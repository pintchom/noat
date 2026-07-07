/**
 * Message protocol between the extension host and the note editor webview.
 * `text` is always the full serialized note envelope (the .noat.json content).
 * File paths are workspace-relative (prefixed with the folder name in
 * multi-root workspaces) so links survive machine moves.
 */
/**
 * The active IDE color theme, resolved from its JSON contribution so the
 * webview can drive shiki with the user's real token colors.
 */
export interface IdeThemeJson {
  name: string;
  type: 'light' | 'dark';
  fg: string;
  bg: string;
  colors: Record<string, string>;
  settings: Array<{
    name?: string;
    scope?: string | string[];
    settings: { foreground?: string; background?: string; fontStyle?: string };
  }>;
}

export type HostToWebviewMessage =
  | { type: 'init'; text: string }
  | { type: 'update'; text: string }
  | { type: 'fileResults'; requestId: number; files: string[] }
  | { type: 'ideTheme'; theme: IdeThemeJson | undefined };

export type WebviewToHostMessage =
  | { type: 'ready' }
  | { type: 'edit'; text: string }
  | { type: 'searchFiles'; requestId: number; query: string }
  | { type: 'openFile'; path: string };
