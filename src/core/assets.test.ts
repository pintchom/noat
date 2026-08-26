import { describe, expect, it } from 'vitest';
import { assetFileFromUrl, assetFileName } from './assets';

describe('assetFileName', () => {
  it('sanitizes the base name and keeps the extension', () => {
    expect(assetFileName('Screen Shot 2026-08-20 at 09.15.png', 'ab12')).toBe(
      'Screen-Shot-2026-08-20-at-09-15-ab12.png'
    );
  });

  it('survives hostile or empty names', () => {
    expect(assetFileName('../../etc/passwd', 'ab12')).toBe('passwd-ab12');
    expect(assetFileName('...', 'ab12')).toBe('asset-ab12');
    expect(assetFileName('.png', 'ab12')).toBe('png-ab12');
  });
});

describe('assetFileFromUrl', () => {
  it('extracts the file name from asset URLs only', () => {
    expect(assetFileFromUrl('assets/cat-ab12.png')).toBe('cat-ab12.png');
    expect(assetFileFromUrl('https://example.com/cat.png')).toBeUndefined();
    expect(assetFileFromUrl('data:image/png;base64,xyz')).toBeUndefined();
  });

  it('rejects traversal and nested paths', () => {
    expect(assetFileFromUrl('assets/../notes/global/x.noat.json')).toBeUndefined();
    expect(assetFileFromUrl('assets/sub/cat.png')).toBeUndefined();
    expect(assetFileFromUrl('assets/..\\x')).toBeUndefined();
    expect(assetFileFromUrl('assets/')).toBeUndefined();
  });
});
