import { describe, expect, it } from 'vitest';
import { filePreviewFromBytes } from './file-preview';

const bytes = (s: string) => new TextEncoder().encode(s);

describe('filePreviewFromBytes', () => {
  it('returns the leading text, trimmed of trailing blank lines', () => {
    expect(filePreviewFromBytes(bytes('hello\nworld\n\n'))).toBe('hello\nworld');
  });

  it('caps the preview at 30 lines', () => {
    const text = Array.from({ length: 100 }, (_, i) => `line ${i}`).join('\n');
    expect(filePreviewFromBytes(bytes(text))?.split('\n')).toHaveLength(30);
  });

  it('returns undefined for binary content with a NUL byte', () => {
    expect(filePreviewFromBytes(new Uint8Array([0x89, 0x50, 0x00, 0x4e]))).toBeUndefined();
  });

  it('returns undefined for an empty or whitespace-only file', () => {
    expect(filePreviewFromBytes(bytes('   \n\n'))).toBeUndefined();
    expect(filePreviewFromBytes(new Uint8Array())).toBeUndefined();
  });
});
