import type { HostToWebviewMessage, NoteLinkResult } from '../core/editor-messages';
import { vscodeApi } from './vscode-api';

let nextRequestId = 1;
const pending = new Map<number, (notes: NoteLinkResult[]) => void>();

window.addEventListener('message', (event: MessageEvent<HostToWebviewMessage>) => {
  const message = event.data;
  if (message.type !== 'noteResults') return;
  const resolve = pending.get(message.requestId);
  if (resolve) {
    pending.delete(message.requestId);
    resolve(message.notes);
  }
});

/** Ask the extension host to search notes for the /page picker. */
export function searchNotes(query: string): Promise<NoteLinkResult[]> {
  const requestId = nextRequestId++;
  return new Promise((resolve) => {
    pending.set(requestId, resolve);
    vscodeApi.postMessage({ type: 'searchNotes', requestId, query });
    // Don't hang the suggestion menu if the host never answers.
    setTimeout(() => {
      if (pending.delete(requestId)) resolve([]);
    }, 3000);
  });
}
