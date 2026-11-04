const MAX_LINES = 30;

/**
 * A short text preview of a file's leading bytes, for the @-mention hover card.
 * Returns undefined for binary content (detected by a NUL byte) or when the
 * sample decodes to nothing but whitespace — nothing worth showing.
 */
export function filePreviewFromBytes(bytes: Uint8Array): string | undefined {
  if (bytes.includes(0)) return undefined;
  const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  const preview = text.split('\n').slice(0, MAX_LINES).join('\n').trimEnd();
  return preview || undefined;
}
