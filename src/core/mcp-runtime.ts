import * as crypto from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

const RUNTIME_ARTIFACTS = ['dist/mcp-server.js', 'dist/xhr-sync-worker.js', 'bin'];
const VERSION_STAMP = '.version';

export function getMcpRuntimeDir(noatHome: string): string {
  return path.join(noatHome, 'mcp');
}

/** Stable server entry point for hosts that register the server by path. */
export function getMcpServerPath(noatHome: string): string {
  return path.join(getMcpRuntimeDir(noatHome), 'dist', 'mcp-server.js');
}

async function readStamp(runtimeDir: string): Promise<string | undefined> {
  try {
    return (await fs.readFile(path.join(runtimeDir, VERSION_STAMP), 'utf8')).trim();
  } catch {
    return undefined;
  }
}

async function exists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

/**
 * Copy the MCP server runtime to a stable path inside the store, so hosts
 * registered by absolute path survive extension updates.
 */
export async function syncMcpRuntime(
  extensionDir: string,
  extensionVersion: string,
  noatHome: string
): Promise<string> {
  const runtimeDir = getMcpRuntimeDir(noatHome);
  const serverPath = getMcpServerPath(noatHome);
  if ((await readStamp(runtimeDir)) === extensionVersion && (await exists(serverPath))) {
    return serverPath;
  }

  const stagingDir = `${runtimeDir}.tmp-${crypto.randomUUID()}`;
  try {
    for (const artifact of RUNTIME_ARTIFACTS) {
      const target = path.join(stagingDir, artifact);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.cp(path.join(extensionDir, artifact), target, { recursive: true });
    }
    await fs.rm(runtimeDir, { recursive: true, force: true });
    await fs.rename(stagingDir, runtimeDir);
    // so an interrupted sync retries on the next activation
    await fs.writeFile(path.join(runtimeDir, VERSION_STAMP), `${extensionVersion}\n`);
  } finally {
    await fs.rm(stagingDir, { recursive: true, force: true });
  }
  return serverPath;
}
