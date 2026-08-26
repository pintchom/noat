/**
 * Store assets: files embedded in notes (images pasted or picked in the
 * editor). They live flat under <noatHome>/assets and notes reference them
 * with store-relative, "/"-separated URLs like "assets/<file>" so links
 * survive machine moves. Node-free — this module is shared with the webview.
 */

export const ASSET_URL_PREFIX = 'assets/';

/**
 * The bare file name of a store-asset URL, or undefined when the URL is not
 * one of ours. Rejects separators and ".." — asset URLs come from note JSON,
 * which agents also write, and get joined onto the assets dir.
 */
export function assetFileFromUrl(url: string): string | undefined {
  if (!url.startsWith(ASSET_URL_PREFIX)) return undefined;
  const file = url.slice(ASSET_URL_PREFIX.length);
  if (!file || file.includes('/') || file.includes('\\') || file.includes('..')) return undefined;
  return file;
}

/**
 * File name for a newly saved asset: the original base name reduced to
 * filesystem/URL-safe characters plus a unique suffix, so repeated uploads
 * of "Screenshot.png" never overwrite each other.
 */
export function assetFileName(originalName: string, uniqueSuffix: string): string {
  const name = originalName.split(/[\\/]/).pop() ?? '';
  const dot = name.lastIndexOf('.');
  const base = (dot > 0 ? name.slice(0, dot) : name)
    .replace(/[^\w-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  const ext = (dot > 0 ? name.slice(dot + 1) : '').replace(/[^A-Za-z0-9]/g, '').toLowerCase();
  return `${base || 'asset'}-${uniqueSuffix}${ext ? `.${ext}` : ''}`;
}
