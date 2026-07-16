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
});
