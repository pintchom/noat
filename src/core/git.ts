import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const MAX_GIT_OUTPUT_BYTES = 64 * 1024 * 1024;

async function gitOutput(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, {
    cwd,
    maxBuffer: MAX_GIT_OUTPUT_BYTES,
  });
  return stdout;
}

async function git(cwd: string, args: string[]): Promise<string> {
  return (await gitOutput(cwd, args)).trim();
}

function nullSeparatedPaths(output: string): string[] {
  return output.split('\0').filter((file) => file.length > 0);
}

interface GitStatusPaths {
  changed: string[];
  removed: string[];
}

/**
 * Parse `git status --porcelain=v1 -z`. In `-z` mode, rename destinations
 * precede their original paths and neither path is quoted.
 */
export function parseGitStatusPaths(output: string): GitStatusPaths {
  const entries = output.split('\0');
  const changed = new Set<string>();
  const removed = new Set<string>();

  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    if (!entry) continue;

    const status = entry.slice(0, 2);
    const file = entry.slice(3);
    const renamed = status.includes('R');
    const copied = status.includes('C');

    if (status.includes('D')) {
      removed.add(file);
    } else {
      changed.add(file);
    }

    if (renamed || copied) {
      const original = entries[index + 1];
      if (renamed && original) removed.add(original);
      index += 1;
    }
  }

  return {
    changed: [...changed],
    removed: [...removed],
  };
}

export interface WorkspaceGitSnapshot {
  files: string[];
  changedFiles: string[];
}

/**
 * List the files available to an @-mention in a git workspace.
 *
 * `git ls-files` avoids walking ignored directories and has no arbitrary
 * result cap. The status result both identifies files to prioritize and
 * removes deleted paths (including the old side of a rename).
 */
export async function getWorkspaceGitSnapshot(
  workspaceDir: string
): Promise<WorkspaceGitSnapshot | undefined> {
  try {
    const [filesOutput, statusOutput] = await Promise.all([
      gitOutput(workspaceDir, [
        'ls-files',
        '--cached',
        '--others',
        '--exclude-standard',
        '-z',
        '--',
        '.',
      ]),
      gitOutput(workspaceDir, [
        'status',
        '--porcelain=v1',
        '-z',
        '--untracked-files=all',
        '--',
        '.',
      ]),
    ]);
    const status = parseGitStatusPaths(statusOutput);
    const removed = new Set(status.removed);
    const files = new Set([
      ...nullSeparatedPaths(filesOutput).filter((file) => !removed.has(file)),
      ...status.changed,
    ]);

    return {
      files: [...files].sort((a, b) => a.localeCompare(b)),
      changedFiles: [...status.changed].sort((a, b) => a.localeCompare(b)),
    };
  } catch {
    return undefined;
  }
}

export async function isGitRepo(dir: string): Promise<boolean> {
  try {
    const out = await git(dir, ['rev-parse', '--is-inside-work-tree']);
    return out === 'true';
  } catch {
    return false;
  }
}

/** Initialize the note store repo if it isn't one already. */
export async function ensureGitRepo(dir: string): Promise<void> {
  if (await isGitRepo(dir)) return;
  await git(dir, ['init', '-b', 'main']);
}

export async function hasChanges(dir: string): Promise<boolean> {
  const out = await git(dir, ['status', '--porcelain']);
  return out.length > 0;
}

/** Stage everything and commit. No-op when the tree is clean. */
export async function commitAll(dir: string, message: string): Promise<void> {
  if (!(await hasChanges(dir))) return;
  await git(dir, ['add', '-A']);
  await git(dir, [
    // Notes commits should work even without a global git identity.
    '-c',
    'user.name=NOAT',
    '-c',
    'user.email=noat@localhost',
    'commit',
    '-m',
    message,
  ]);
}

export async function getRemoteOriginUrl(repoDir: string): Promise<string | undefined> {
  try {
    return await git(repoDir, ['remote', 'get-url', 'origin']);
  } catch {
    return undefined;
  }
}

export async function getLastCommitSubject(repoDir: string): Promise<string | undefined> {
  try {
    return await git(repoDir, ['log', '-1', '--format=%s']);
  } catch {
    return undefined;
  }
}

export async function getRepoRoot(dir: string): Promise<string | undefined> {
  try {
    return await git(dir, ['rev-parse', '--show-toplevel']);
  } catch {
    return undefined;
  }
}
