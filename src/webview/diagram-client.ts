import type { HostToWebviewMessage } from '../core/editor-messages';
import { vscodeApi } from './vscode-api';

// A local model on a cold cache can take a while to answer; give up long
// after it would have, so a stuck server doesn't leave a block spinning.
const TIMEOUT_MS = 300_000;

let nextRequestId = 1;
const pending = new Map<number, (result: DiagramResult) => void>();

export interface DiagramResult {
  code?: string;
  error?: string;
}

window.addEventListener('message', (event: MessageEvent<HostToWebviewMessage>) => {
  const message = event.data;
  if (message.type !== 'diagramGenerated') return;
  const resolve = pending.get(message.requestId);
  if (resolve) {
    pending.delete(message.requestId);
    resolve({ code: message.code, error: message.error });
  }
});

/**
 * Ask the extension host to turn a description into Mermaid source. Pass
 * `repair` to have the model fix a script Mermaid rejected.
 */
export function generateDiagram(
  prompt: string,
  repair?: { code: string; error: string }
): Promise<DiagramResult> {
  const requestId = nextRequestId++;
  return new Promise((resolve) => {
    pending.set(requestId, resolve);
    vscodeApi.postMessage({
      type: 'generateDiagram',
      requestId,
      prompt,
      ...(repair && { repair }),
    });
    setTimeout(() => {
      if (pending.delete(requestId)) resolve({ error: 'the model did not answer in time' });
    }, TIMEOUT_MS);
  });
}
