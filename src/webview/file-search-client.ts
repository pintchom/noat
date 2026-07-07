import type { HostToWebviewMessage } from '../core/editor-messages';
import { vscodeApi } from './vscode-api';

let nextRequestId = 1;
const pending = new Map<number, (files: string[]) => void>();

window.addEventListener('message', (event: MessageEvent<HostToWebviewMessage>) => {
  const message = event.data;
  if (message.type !== 'fileResults') return;
  const resolve = pending.get(message.requestId);
  if (resolve) {
    pending.delete(message.requestId);
    resolve(message.files);
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
