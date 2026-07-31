import { ASSET_PATH_PREFIX, type HostToWebviewMessage } from '../core/editor-messages';
import { compressImageForStorage } from './image-compress';
import { vscodeApi } from './vscode-api';

const REQUEST_TIMEOUT_MS = 10000;

let nextRequestId = 1;
const pendingSaves = new Map<number, (path: string) => void>();
const pendingReads = new Map<number, (dataUri: string) => void>();
// Data URIs already resolved for this editor, so re-renders skip the bridge.
const resolvedAssets = new Map<string, Promise<string>>();

window.addEventListener('message', (event: MessageEvent<HostToWebviewMessage>) => {
  const message = event.data;
  if (message.type === 'assetSaved') {
    const resolve = pendingSaves.get(message.requestId);
    if (resolve) {
      pendingSaves.delete(message.requestId);
      resolve(message.path);
    }
  }
  if (message.type === 'assetData') {
    const resolve = pendingReads.get(message.requestId);
    if (resolve) {
      pendingReads.delete(message.requestId);
      resolve(message.dataUri);
    }
  }
});

function readBlobAsBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUri = reader.result as string;
      resolve(dataUri.slice(dataUri.indexOf(',') + 1));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/**
 * Persist a pasted/dropped file into the store's assets directory, shrinking
 * raster images first where that pays off. Resolves with the store-relative
 * path the image block records as its url.
 */
export async function saveAssetToStore(file: File): Promise<string> {
  const blob = await compressImageForStorage(file);
  const base64 = await readBlobAsBase64(blob);
  const requestId = nextRequestId++;
  return new Promise((resolve, reject) => {
    pendingSaves.set(requestId, (path) => {
      if (path) resolve(path);
      else reject(new Error('NOAT: failed to save the pasted file'));
    });
    vscodeApi.postMessage({ type: 'saveAsset', requestId, mime: blob.type, base64 });
    setTimeout(() => {
      if (pendingSaves.delete(requestId))
        reject(new Error('NOAT: saving the pasted file timed out'));
    }, REQUEST_TIMEOUT_MS);
  });
}

function requestAssetData(assetPath: string): Promise<string> {
  const requestId = nextRequestId++;
  return new Promise((resolve) => {
    pendingReads.set(requestId, resolve);
    vscodeApi.postMessage({ type: 'readAsset', requestId, path: assetPath });
    setTimeout(() => {
      if (pendingReads.delete(requestId)) resolve('');
    }, REQUEST_TIMEOUT_MS);
  });
}

/**
 * Resolve a block url for rendering. Store asset paths become data URIs (the
 * only image source the webview CSP allows); anything else passes through.
 */
export function resolveStoreUrl(url: string): Promise<string> {
  if (!url.startsWith(ASSET_PATH_PREFIX)) return Promise.resolve(url);
  const cached = resolvedAssets.get(url);
  if (cached) return cached;
  const promise = requestAssetData(url).then((dataUri) => {
    // Don't cache failures — the asset may appear after a git pull.
    if (!dataUri) {
      resolvedAssets.delete(url);
      return url;
    }
    return dataUri;
  });
  resolvedAssets.set(url, promise);
  return promise;
}
