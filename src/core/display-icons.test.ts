import { describe, expect, it } from 'vitest';
import {
  NOTE_ICON,
  normalizeNoteIcon,
  noteIconForStorage,
  resolveNoteIcon,
} from './display-icons';

describe('note icons', () => {
  it('accepts a single emoji grapheme', () => {
    expect(normalizeNoteIcon(' 🔥 ')).toBe('🔥');
    expect(normalizeNoteIcon('👨‍💻')).toBe('👨‍💻');
    expect(normalizeNoteIcon('🇺🇸')).toBe('🇺🇸');
  });

  it('rejects text and multiple emoji', () => {
    expect(normalizeNoteIcon('hello')).toBeUndefined();
    expect(normalizeNoteIcon('🔥🚀')).toBeUndefined();
  });

  it('uses the note emoji as the default', () => {
    expect(resolveNoteIcon(undefined)).toBe(NOTE_ICON);
    expect(resolveNoteIcon('not an emoji')).toBe(NOTE_ICON);
  });

  it('omits the default icon from storage', () => {
    expect(noteIconForStorage(NOTE_ICON)).toBeUndefined();
    expect(noteIconForStorage('🚀')).toBe('🚀');
  });
});
