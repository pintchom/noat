import type { WebviewToHostMessage } from '../core/editor-messages';

interface VsCodeApi {
  postMessage: (message: WebviewToHostMessage) => void;
}

declare global {
  interface Window {
    acquireVsCodeApi: () => VsCodeApi;
  }
}

// acquireVsCodeApi may only be called once per webview — module singleton.
export const vscodeApi: VsCodeApi = window.acquireVsCodeApi();
