export const NOTE_ICON = '📝';
export const FOLDER_ICON = '📁';
export const FILE_ICON = '📄';

const iconSegmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
const emojiPattern = /\p{Emoji}/u;

export function normalizeNoteIcon(icon: string | undefined): string | undefined {
  const trimmed = icon?.trim();
  if (!trimmed) return undefined;
  const graphemes = Array.from(iconSegmenter.segment(trimmed), ({ segment }) => segment);
  if (graphemes.length !== 1 || !emojiPattern.test(graphemes[0] ?? '')) return undefined;
  return graphemes[0];
}

export function resolveNoteIcon(icon: string | undefined): string {
  return normalizeNoteIcon(icon) ?? NOTE_ICON;
}

export function noteIconForStorage(icon: string | undefined): string | undefined {
  const normalized = normalizeNoteIcon(icon);
  return normalized === NOTE_ICON ? undefined : normalized;
}
