import { assetFileFromUrl } from '../core/assets';
import type { HostToWebviewMessage } from '../core/editor-messages';
import { vscodeApi } from './vscode-api';

// Files travel to the host as base64 inside postMessage JSON; cap what we
// try to serialize. ponytail: 50 MB in-memory round-trip, stream via a
// temp-file handshake if huge videos ever matter.
const MAX_ASSET_BYTES = 50 * 1024 * 1024;

let assetsBaseUri = '';
let nextRequestId = 1;
const pending = new Map<number, (url: string | undefined) => void>();

window.addEventListener('message', (event: MessageEvent<HostToWebviewMessage>) => {
  const message = event.data;
  if (message.type === 'init') assetsBaseUri = message.assetsBaseUri;
  if (message.type !== 'assetSaved') return;
  const resolve = pending.get(message.requestId);
  if (resolve) {
    pending.delete(message.requestId);
    resolve(message.url);
  }
});

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',', 2)[1] ?? '');
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

/**
 * BlockNote uploadFile handler: ship the picked/pasted/dropped file to the
 * extension host, which stores it in the note store's assets dir. Resolves
 * to the store-relative URL that gets saved in the note.
 */
export async function saveAsset(file: File): Promise<string> {
  if (file.size > MAX_ASSET_BYTES) {
    throw new Error('NOAT: files over 50 MB cannot be embedded in a note');
  }
  const dataBase64 = await fileToBase64(file);
  const requestId = nextRequestId++;
  const url = await new Promise<string | undefined>((resolve) => {
    pending.set(requestId, resolve);
    vscodeApi.postMessage({ type: 'saveAsset', requestId, name: file.name, dataBase64 });
    // Don't leave the editor stuck on "uploading" if the host never answers.
    setTimeout(() => {
      if (pending.delete(requestId)) resolve(undefined);
    }, 30000);
  });
  if (!url) throw new Error('NOAT: saving the file to the note store failed');
  return url;
}

/** BlockNote resolveFileUrl handler: map "assets/<file>" to a loadable webview URI. */
export function resolveAssetUrl(url: string): string {
  const file = assetFileFromUrl(url);
  return file && assetsBaseUri ? `${assetsBaseUri}/${encodeURIComponent(file)}` : url;
}
