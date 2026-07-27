import { describe, expect, it } from 'vitest';
import { createEmptyNote, parseNote, serializeNote } from './note';

describe('parseNote', () => {
  it('preserves unknown top-level fields across a round-trip', () => {
    const raw = JSON.stringify({ ...createEmptyNote('Note'), futureField: 'kept' });
    const note = parseNote(raw);
    expect(serializeNote(note)).toContain('"futureField": "kept"');
  });

  it('rejects a corrupted envelope', () => {
    expect(() => parseNote('{"version":1}')).toThrow();
  });

  it('keeps inline comments across a round-trip', () => {
    const raw = JSON.stringify({
      ...createEmptyNote('Note'),
      comments: [{ id: 'c1', text: 'tighten this', createdAt: '2026-07-23T00:00:00.000Z' }],
    });
    const note = parseNote(raw);
    expect(note.comments?.[0]?.text).toBe('tighten this');
    expect(serializeNote(note)).toContain('"tighten this"');
  });
});
