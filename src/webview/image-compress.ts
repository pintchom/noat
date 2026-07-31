/**
 * Raster formats safe to re-encode as webp. GIF is excluded (re-encoding
 * keeps only the first frame) and SVG stays vector, so both pass through.
 */
const COMPRESSIBLE_MIMES = new Set([
  'image/png',
  'image/jpeg',
  'image/bmp',
  'image/webp',
  'image/avif',
]);

const WEBP_QUALITY = 0.85;

/**
 * Best-effort storage encoding: re-encode compressible rasters and keep the
 * result only when it is actually smaller. Any encoder failure falls back to
 * the original bytes — compression must never make a paste fail.
 */
export async function pickStorageBlob(
  original: Blob,
  encode: (blob: Blob) => Promise<Blob>
): Promise<Blob> {
  if (!COMPRESSIBLE_MIMES.has(original.type)) return original;
  try {
    const encoded = await encode(original);
    return encoded.size < original.size ? encoded : original;
  } catch {
    return original;
  }
}

/** Decode and redraw at original pixel size, re-encoded as lossy webp. */
async function encodeToWebp(blob: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('2d canvas context unavailable');
    context.drawImage(bitmap, 0, 0);
    return await canvas.convertToBlob({ type: 'image/webp', quality: WEBP_QUALITY });
  } finally {
    bitmap.close();
  }
}

/** Shrink a pasted/dropped image for storage when possible; never fails. */
export function compressImageForStorage(file: File): Promise<Blob> {
  return pickStorageBlob(file, encodeToWebp);
}
