import { describe, expect, it } from 'vitest';
import { createEmptyNote, serializeNote } from './note';
import { WebviewEchoes } from './webview-echoes';

const noteWithTitle = (title: string): string =>
  serializeNote({ ...createEmptyNote('Note'), title });

describe('WebviewEchoes', () => {
  const original = noteWithTitle('');
  const typedA = noteWithTitle('a');
  const typedAB = noteWithTitle('ab');

  it('keeps the echo of an older keystroke out while a newer one is in flight', () => {
    const echoes = new WebviewEchoes();
    echoes.writing(typedA);
    echoes.writing(typedAB);
    expect(echoes.isOwnChange(typedA)).toBe(true);
    echoes.settled(typedA);
    expect(echoes.isOwnChange(typedAB)).toBe(true);
    echoes.settled(typedAB);
  });

  it('ignores the echo of the latest write after it settles', () => {
    const echoes = new WebviewEchoes();
    echoes.writing(typedA);
    echoes.settled(typedA);
    expect(echoes.isOwnChange(typedA)).toBe(true);
  });

  it('ignores a formatting-only rewrite of the latest write', () => {
    const echoes = new WebviewEchoes();
    echoes.writing(typedA);
    echoes.settled(typedA);
    expect(echoes.isOwnChange(typedA.trimEnd())).toBe(true);
  });

  it('passes through a genuine outside change once writes have settled', () => {
    const echoes = new WebviewEchoes();
    echoes.writing(typedA);
    echoes.settled(typedA);
    expect(echoes.isOwnChange(original)).toBe(false);
  });

  it('passes through outside changes before the webview has written anything', () => {
    expect(new WebviewEchoes().isOwnChange(original)).toBe(false);
  });

  it('settles older writes along with the one that resolved', () => {
    const echoes = new WebviewEchoes();
    echoes.writing(typedA);
    echoes.writing(typedAB);
    echoes.settled(typedAB);
    expect(echoes.isOwnChange(original)).toBe(false);
  });

  it('measures no-op writes against the newest in-flight text, not the stale document', () => {
    const echoes = new WebviewEchoes();
    expect(echoes.expectedText(original)).toBe(original);
    echoes.writing(typedA);
    expect(echoes.expectedText(original)).toBe(typedA);
  });
});
