import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  assetFileName,
  extensionForMime,
  mimeForAssetPath,
  readAssetDataUri,
  saveAsset,
} from './assets';
import { getAssetsDir } from './paths';

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

let noatHome: string;

beforeEach(async () => {
  noatHome = await fs.mkdtemp(path.join(os.tmpdir(), 'noat-assets-test-'));
});

afterEach(async () => {
  await fs.rm(noatHome, { recursive: true, force: true });
});

describe('extensionForMime', () => {
  it('maps known image types', () => {
    expect(extensionForMime('image/png')).toBe('png');
    expect(extensionForMime('image/jpeg')).toBe('jpg');
    expect(extensionForMime('image/svg+xml')).toBe('svg');
  });

  it('ignores parameters and case', () => {
    expect(extensionForMime('IMAGE/PNG; charset=binary')).toBe('png');
  });

  it('falls back to bin for unknown types', () => {
    expect(extensionForMime('application/pdf')).toBe('bin');
  });
});

describe('mimeForAssetPath', () => {
  it('recovers the mime type from the extension', () => {
    expect(mimeForAssetPath('assets/abc.png')).toBe('image/png');
    expect(mimeForAssetPath('assets/abc.jpg')).toBe('image/jpeg');
  });

  it('falls back to octet-stream for unknown extensions', () => {
    expect(mimeForAssetPath('assets/abc.bin')).toBe('application/octet-stream');
  });
});

describe('assetFileName', () => {
  it('is the sha256 of the bytes plus the mime extension', () => {
    const hash = createHash('sha256').update(PNG_BYTES).digest('hex');
    expect(assetFileName(PNG_BYTES, 'image/png')).toBe(`${hash}.png`);
  });
});

describe('saveAsset / readAssetDataUri', () => {
  it('writes a content-addressed file and returns its store-relative path', async () => {
    const assetPath = await saveAsset(noatHome, 'image/png', PNG_BYTES);
    expect(assetPath).toBe(`assets/${assetFileName(PNG_BYTES, 'image/png')}`);
    const onDisk = await fs.readFile(path.join(noatHome, assetPath));
    expect(new Uint8Array(onDisk)).toEqual(PNG_BYTES);
  });

  it('deduplicates identical bytes', async () => {
    const first = await saveAsset(noatHome, 'image/png', PNG_BYTES);
    const second = await saveAsset(noatHome, 'image/png', PNG_BYTES);
    expect(second).toBe(first);
    expect(await fs.readdir(getAssetsDir(noatHome))).toHaveLength(1);
  });

  it('round-trips bytes as a data URI', async () => {
    const assetPath = await saveAsset(noatHome, 'image/png', PNG_BYTES);
    const dataUri = await readAssetDataUri(noatHome, assetPath);
    expect(dataUri).toBe(`data:image/png;base64,${Buffer.from(PNG_BYTES).toString('base64')}`);
  });

  it('rejects paths that escape the assets directory', async () => {
    await saveAsset(noatHome, 'image/png', PNG_BYTES);
    await expect(readAssetDataUri(noatHome, '../outside.png')).rejects.toThrow();
    await expect(readAssetDataUri(noatHome, 'assets/../notes/x.png')).rejects.toThrow();
    await expect(readAssetDataUri(noatHome, '/etc/passwd')).rejects.toThrow();
  });

  it('rejects reads of missing assets', async () => {
    await expect(readAssetDataUri(noatHome, 'assets/missing.png')).rejects.toThrow();
  });
});
