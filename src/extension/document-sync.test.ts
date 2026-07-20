import { describe, expect, it } from 'vitest';
import { type DocumentSync, createDocumentSync } from './document-sync';

/**
 * Simulates the extension-host side of a TextDocument: applies resolve
 * asynchronously, and the change event fires (with the text already updated)
 * before the apply promise resolves, matching VS Code's behavior.
 */
function createHarness(initialText: string) {
  const state = {
    text: initialText,
    applied: [] as string[],
    externalUpdates: [] as string[],
    autoSaves: 0,
    rejectNextApply: false,
  };

  const fireChangeEvent = (): void => {
    if (sync.consumeEcho(state.text)) return;
    state.externalUpdates.push(state.text);
  };

  const sync: DocumentSync = createDocumentSync({
    getText: () => state.text,
    applyText: async (text) => {
      await Promise.resolve(); // the round trip to the editor
      if (state.rejectNextApply) {
        state.rejectNextApply = false;
        return false;
      }
      state.text = text;
      state.applied.push(text);
      fireChangeEvent();
      await Promise.resolve(); // applyEdit resolves after the change event
      return true;
    },
    onDidApply: () => {
      state.autoSaves += 1;
    },
  });

  const changeExternally = (text: string): void => {
    state.text = text;
    fireChangeEvent();
  };

  const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

  return { state, sync, changeExternally, settle };
}

describe('createDocumentSync', () => {
  it('applies a queued edit and consumes its echo', async () => {
    const { state, sync, settle } = createHarness('v0');
    sync.queueEdit('v1');
    await settle();
    expect(state.text).toBe('v1');
    expect(state.applied).toEqual(['v1']);
    expect(state.externalUpdates).toEqual([]);
    expect(state.autoSaves).toBe(1);
  });

  it('does not mistake overlapping typing bursts for external changes', async () => {
    const { state, sync, settle } = createHarness('v0');
    // The second keystroke arrives before the first apply's round trip
    // completes. Tracking only the most recent text would misread v1's echo
    // as an external change and remount the editor mid-typing.
    sync.queueEdit('v1');
    sync.queueEdit('v2');
    await settle();
    expect(state.text).toBe('v2');
    expect(state.externalUpdates).toEqual([]);
  });

  it('coalesces bursts down to the newest text', async () => {
    const { state, sync, settle } = createHarness('v0');
    sync.queueEdit('v1');
    sync.queueEdit('v2');
    sync.queueEdit('v3');
    await settle();
    expect(state.applied).toEqual(['v1', 'v3']);
    expect(state.text).toBe('v3');
    expect(state.externalUpdates).toEqual([]);
  });

  it('skips applies when the document already matches', async () => {
    const { state, sync, settle } = createHarness('v0');
    sync.queueEdit('v0');
    await settle();
    expect(state.applied).toEqual([]);
    expect(state.autoSaves).toBe(0);
  });

  it('still reports genuinely external changes', async () => {
    const { state, sync, changeExternally, settle } = createHarness('v0');
    sync.queueEdit('v1');
    await settle();
    changeExternally('external');
    expect(state.externalUpdates).toEqual(['external']);
  });

  it('drops the echo record when an apply is rejected', async () => {
    const { state, sync, changeExternally, settle } = createHarness('v0');
    state.rejectNextApply = true;
    sync.queueEdit('v1');
    await settle();
    expect(state.text).toBe('v0');
    // A later external change to the same text must not be swallowed.
    changeExternally('v1');
    expect(state.externalUpdates).toEqual(['v1']);
  });

  it('keeps accepting edits after a rejected apply', async () => {
    const { state, sync, settle } = createHarness('v0');
    state.rejectNextApply = true;
    sync.queueEdit('v1');
    await settle();
    sync.queueEdit('v2');
    await settle();
    expect(state.text).toBe('v2');
    expect(state.externalUpdates).toEqual([]);
  });
});
