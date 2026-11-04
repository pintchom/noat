import type { HostToWebviewMessage } from '../core/editor-messages';
import { vscodeApi } from './vscode-api';

let nextRequestId = 1;
const pending = new Map<number, (files: string[]) => void>();
const pendingPreviews = new Map<number, (preview: string | undefined) => void>();

window.addEventListener('message', (event: MessageEvent<HostToWebviewMessage>) => {
  const message = event.data;
  if (message.type === 'fileResults') {
    const resolve = pending.get(message.requestId);
    if (resolve) {
      pending.delete(message.requestId);
      resolve(message.files);
    }
  } else if (message.type === 'filePreview') {
    const resolve = pendingPreviews.get(message.requestId);
    if (resolve) {
      pendingPreviews.delete(message.requestId);
      resolve(message.preview);
    }
  }
});

/** Ask the extension host to search workspace files for the @-mention menu. */
export function searchWorkspaceFiles(query: string): Promise<string[]> {
  const requestId = nextRequestId++;
  return new Promise((resolve) => {
    pending.set(requestId, resolve);
    vscodeApi.postMessage({ type: 'searchFiles', requestId, query });
    // Don't hang the suggestion menu if the host never answers.
    setTimeout(() => {
      if (pending.delete(requestId)) resolve([]);
    }, 3000);
  });
}

/** Ask the host for a short text preview of a file (undefined if none/binary). */
export function readFilePreview(path: string): Promise<string | undefined> {
  const requestId = nextRequestId++;
  return new Promise((resolve) => {
    pendingPreviews.set(requestId, resolve);
    vscodeApi.postMessage({ type: 'previewFile', requestId, path });
    setTimeout(() => {
      if (pendingPreviews.delete(requestId)) resolve(undefined);
    }, 3000);
  });
}
