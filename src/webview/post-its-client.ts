import { useSyncExternalStore } from 'react';
import type { HostToWebviewMessage, PostItSummary } from '../core/editor-messages';
import { vscodeApi } from './vscode-api';

// Module-level so the list sent right after init isn't missed while the
// editor is still mounting.
let current: PostItSummary[] = [];
const listeners = new Set<() => void>();

window.addEventListener('message', (event: MessageEvent<HostToWebviewMessage>) => {
  if (event.data.type !== 'postIts') return;
  current = event.data.postIts;
  for (const listener of listeners) listener();
});

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The post-its this note owns, kept current by the host. */
export function usePostIts(): PostItSummary[] {
  return useSyncExternalStore(subscribe, () => current);
}

export function openPostIt(id: string): void {
  vscodeApi.postMessage({ type: 'openPostIt', id });
}

export function deletePostIt(id: string): void {
  vscodeApi.postMessage({ type: 'deletePostIt', id });
}
