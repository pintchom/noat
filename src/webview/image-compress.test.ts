import { describe, expect, it, vi } from 'vitest';
import { pickStorageBlob } from './image-compress';

const blobOf = (size: number, type: string): Blob => new Blob(['x'.repeat(size)], { type });

describe('pickStorageBlob', () => {
  it('returns the encoded blob when it is smaller', async () => {
    const original = blobOf(1000, 'image/png');
    const encoded = blobOf(100, 'image/webp');
    await expect(pickStorageBlob(original, async () => encoded)).resolves.toBe(encoded);
  });

  it('keeps the original when the encoded blob is not smaller', async () => {
    const original = blobOf(100, 'image/png');
    await expect(pickStorageBlob(original, async () => blobOf(100, 'image/webp'))).resolves.toBe(
      original
    );
    await expect(pickStorageBlob(original, async () => blobOf(500, 'image/webp'))).resolves.toBe(
      original
    );
  });

  it('never re-encodes gifs or svgs', async () => {
    const encode = vi.fn(async () => blobOf(1, 'image/webp'));
    const gif = blobOf(1000, 'image/gif');
    const svg = blobOf(1000, 'image/svg+xml');
    await expect(pickStorageBlob(gif, encode)).resolves.toBe(gif);
    await expect(pickStorageBlob(svg, encode)).resolves.toBe(svg);
    expect(encode).not.toHaveBeenCalled();
  });

  it('falls back to the original bytes when encoding fails', async () => {
    const original = blobOf(1000, 'image/jpeg');
    await expect(
      pickStorageBlob(original, () => Promise.reject(new Error('decode failed')))
    ).resolves.toBe(original);
  });
});
