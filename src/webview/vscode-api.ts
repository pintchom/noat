import type { WebviewToHostMessage } from '../core/editor-messages';

interface VsCodeApi {
  postMessage: (message: WebviewToHostMessage) => void;
}

declare global {
  interface Window {
    acquireVsCodeApi: () => VsCodeApi;
  }
}

// acquireVsCodeApi may only be called once per webview, so the handle is a
// singleton. Acquiring it lazily rather than at import time keeps this module
// importable outside a webview — the editor tests build a real editor from the
// same schema, and the chips reach this module through it.
let handle: VsCodeApi | undefined;

export const vscodeApi: VsCodeApi = {
  postMessage: (message) => {
    handle ??= window.acquireVsCodeApi();
    handle.postMessage(message);
  },
};
