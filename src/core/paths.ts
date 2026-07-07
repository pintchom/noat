import * as os from 'node:os';
import * as path from 'node:path';

/**
 * Root of the NOAT store. Overridable via NOAT_HOME (used by tests and the
 * MCP server registration so all processes agree on one location).
 */
export function getNoatHome(): string {
  const fromEnv = process.env.NOAT_HOME;
  return fromEnv && fromEnv.length > 0 ? fromEnv : path.join(os.homedir(), '.noat');
}

export function getNotesRoot(noatHome: string): string {
  return path.join(noatHome, 'notes');
}

export function getGlobalNotesDir(noatHome: string): string {
  return path.join(getNotesRoot(noatHome), 'global');
}

export function getReposNotesDir(noatHome: string): string {
  return path.join(getNotesRoot(noatHome), 'repos');
}

export function getRepoNotesDir(noatHome: string, repoKey: string): string {
  return path.join(getReposNotesDir(noatHome), repoKey);
}
