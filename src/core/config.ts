import * as fs from 'node:fs';
import * as path from 'node:path';
import { getConfigPath } from './paths';

/**
 * Persisted NOAT settings, shared between the extension host (any IDE) and the
 * standalone MCP server. Kept intentionally small and dependency-free so both
 * the Node MCP process and the extension can read/write it.
 */
export interface NoatConfig {
  mcp?: {
    /** Read/write notes as BlockNote JSON instead of lossy markdown. */
    useDirectJson?: boolean;
  };
}

export function readConfig(noatHome: string): NoatConfig {
  try {
    const raw = fs.readFileSync(getConfigPath(noatHome), 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as NoatConfig) : {};
  } catch {
    // Missing or malformed config just means "use defaults".
    return {};
  }
}

/** Merge-write config, preserving any keys the caller didn't touch. */
export function writeConfig(noatHome: string, patch: NoatConfig): void {
  const current = readConfig(noatHome);
  const next: NoatConfig = {
    ...current,
    ...patch,
    mcp: { ...current.mcp, ...patch.mcp },
  };
  const configPath = getConfigPath(noatHome);
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, `${JSON.stringify(next, null, 2)}\n`);
  ensureGitignored(noatHome);
}

/**
 * Keep config.json out of the git-versioned note store — it's a per-machine
 * IDE preference, not note content, and the extension auto-commits the store.
 */
function ensureGitignored(noatHome: string): void {
  const gitignorePath = path.join(noatHome, '.gitignore');
  let contents = '';
  try {
    contents = fs.readFileSync(gitignorePath, 'utf8');
  } catch {
    // No .gitignore yet — we'll create one below.
  }
  const lines = contents.split('\n').map((line) => line.trim());
  if (lines.includes('config.json')) return;
  const prefix = contents.length > 0 && !contents.endsWith('\n') ? '\n' : '';
  try {
    fs.appendFileSync(gitignorePath, `${prefix}config.json\n`);
  } catch {
    // Best-effort; a committed config.json is harmless if this fails.
  }
}
