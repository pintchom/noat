import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd });
  return stdout.trim();
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
