import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { ASSET_PATH_PREFIX } from './editor-messages';
import { getAssetsDir } from './paths';

const MIME_EXTENSIONS = new Map<string, string>([
  ['image/png', 'png'],
  ['image/jpeg', 'jpg'],
  ['image/gif', 'gif'],
  ['image/webp', 'webp'],
  ['image/svg+xml', 'svg'],
  ['image/bmp', 'bmp'],
  ['image/avif', 'avif'],
]);

const EXTENSION_MIMES = new Map<string, string>(
  Array.from(MIME_EXTENSIONS, ([mime, extension]) => [extension, mime])
);

/** Map a MIME type to a file extension; unknown types fall back to `bin`. */
export function extensionForMime(mime: string): string {
  const essence = (mime.split(';')[0] ?? '').trim().toLowerCase();
  return MIME_EXTENSIONS.get(essence) ?? 'bin';
}

/** Recover the MIME type from an asset path's extension for data-URI rendering. */
export function mimeForAssetPath(assetPath: string): string {
  const extension = path.extname(assetPath).slice(1).toLowerCase();
  return EXTENSION_MIMES.get(extension) ?? 'application/octet-stream';
}

/** Content-addressed filename: identical bytes always map to the same file. */
export function assetFileName(bytes: Uint8Array, mime: string): string {
  const hash = createHash('sha256').update(bytes).digest('hex');
  return `${hash}.${extensionForMime(mime)}`;
}

/**
 * Resolve a store-relative asset path to an absolute one, refusing anything
 * that escapes the assets directory (webview messages are untrusted input).
 */
function resolveAssetPath(noatHome: string, assetPath: string): string {
  const assetsDir = getAssetsDir(noatHome);
  const resolved = path.resolve(noatHome, assetPath);
  if (!resolved.startsWith(assetsDir + path.sep)) {
    throw new Error(`Asset path escapes the assets directory: ${assetPath}`);
  }
  return resolved;
}

/** Write bytes into the assets directory. Returns the store-relative path. */
export async function saveAsset(
  noatHome: string,
  mime: string,
  bytes: Uint8Array
): Promise<string> {
  const fileName = assetFileName(bytes, mime);
  await fs.mkdir(getAssetsDir(noatHome), { recursive: true });
  try {
    await fs.writeFile(path.join(getAssetsDir(noatHome), fileName), bytes, { flag: 'wx' });
  } catch (error) {
    // Content-addressed: an existing file already holds these exact bytes.
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  }
  return `${ASSET_PATH_PREFIX}${fileName}`;
}

/** Read an asset back as a data URI the webview can render under its CSP. */
export async function readAssetDataUri(noatHome: string, assetPath: string): Promise<string> {
  const bytes = await fs.readFile(resolveAssetPath(noatHome, assetPath));
  return `data:${mimeForAssetPath(assetPath)};base64,${bytes.toString('base64')}`;
}
