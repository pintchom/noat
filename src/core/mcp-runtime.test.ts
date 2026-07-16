import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getMcpServerPath, syncMcpRuntime } from './mcp-runtime';

const BINDING_REL = 'bin/napi-v6/test-os/test-arch/binding.node';

let extensionDir: string;
let noatHome: string;

async function writeExtensionFixture(bundleContent: string): Promise<void> {
  await fs.mkdir(path.join(extensionDir, 'dist'), { recursive: true });
  await fs.mkdir(path.dirname(path.join(extensionDir, BINDING_REL)), { recursive: true });
  await fs.writeFile(path.join(extensionDir, 'dist', 'mcp-server.js'), bundleContent);
  await fs.writeFile(path.join(extensionDir, 'dist', 'xhr-sync-worker.js'), '// worker');
  await fs.writeFile(path.join(extensionDir, BINDING_REL), 'native');
}

async function readRuntimeBundle(): Promise<string> {
  return fs.readFile(getMcpServerPath(noatHome), 'utf8');
}

beforeEach(async () => {
  extensionDir = await fs.mkdtemp(path.join(os.tmpdir(), 'noat-ext-'));
  noatHome = await fs.mkdtemp(path.join(os.tmpdir(), 'noat-home-'));
  await writeExtensionFixture('// server v1');
});

afterEach(async () => {
  await fs.rm(extensionDir, { recursive: true, force: true });
  await fs.rm(noatHome, { recursive: true, force: true });
});

describe('syncMcpRuntime', () => {
  it('copies the runtime and returns the stable server path', async () => {
    const serverPath = await syncMcpRuntime(extensionDir, '0.1.7', noatHome);
    expect(serverPath).toBe(getMcpServerPath(noatHome));
    expect(await readRuntimeBundle()).toBe('// server v1');
    await expect(
      fs.access(path.join(noatHome, 'mcp', 'dist', 'xhr-sync-worker.js'))
    ).resolves.toBeUndefined();
    await expect(fs.access(path.join(noatHome, 'mcp', BINDING_REL))).resolves.toBeUndefined();
  });

  it('no-ops when the synced version matches', async () => {
    await syncMcpRuntime(extensionDir, '0.1.7', noatHome);
    await writeExtensionFixture('// server v1 rebuilt');
    await syncMcpRuntime(extensionDir, '0.1.7', noatHome);
    expect(await readRuntimeBundle()).toBe('// server v1');
  });

  it('re-syncs when the extension version changes', async () => {
    await syncMcpRuntime(extensionDir, '0.1.7', noatHome);
    await writeExtensionFixture('// server v2');
    await syncMcpRuntime(extensionDir, '0.1.8', noatHome);
    expect(await readRuntimeBundle()).toBe('// server v2');
    expect(await fs.readFile(path.join(noatHome, 'mcp', '.version'), 'utf8')).toBe('0.1.8\n');
  });

  it('repairs a runtime whose server bundle is missing', async () => {
    await syncMcpRuntime(extensionDir, '0.1.7', noatHome);
    await fs.rm(getMcpServerPath(noatHome));
    await syncMcpRuntime(extensionDir, '0.1.7', noatHome);
    expect(await readRuntimeBundle()).toBe('// server v1');
  });

  it('keeps the existing runtime and leaves no temp dirs when a copy fails', async () => {
    await syncMcpRuntime(extensionDir, '0.1.7', noatHome);
    await fs.rm(path.join(extensionDir, 'dist', 'xhr-sync-worker.js'));
    await expect(syncMcpRuntime(extensionDir, '0.1.8', noatHome)).rejects.toThrow();
    expect(await readRuntimeBundle()).toBe('// server v1');
    const leftovers = (await fs.readdir(noatHome)).filter((entry) => entry.startsWith('mcp.tmp-'));
    expect(leftovers).toEqual([]);
  });
});
