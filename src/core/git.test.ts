import { execFile } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  commitAll,
  ensureGitRepo,
  getWorkspaceGitSnapshot,
  parseGitStatusPaths,
} from './git';

const execFileAsync = promisify(execFile);

let tempDir: string;

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'noat-git-test-'));
});

afterEach(async () => {
  await fs.rm(tempDir, { recursive: true, force: true });
});

describe('parseGitStatusPaths', () => {
  it('parses ordinary, untracked, renamed, copied, and deleted entries', () => {
    const output = [
      'M  src/modified.ts',
      '?? src/new.ts',
      'R  src/renamed.ts',
      'src/original.ts',
      'C  src/copied.ts',
      'src/copy-source.ts',
      ' D src/deleted.ts',
      '',
    ].join('\0');

    expect(parseGitStatusPaths(output)).toEqual({
      changed: ['src/modified.ts', 'src/new.ts', 'src/renamed.ts', 'src/copied.ts'],
      removed: ['src/original.ts', 'src/deleted.ts'],
    });
  });
});

describe('getWorkspaceGitSnapshot', () => {
  it('lists tracked and untracked files while excluding ignored and removed paths', async () => {
    await ensureGitRepo(tempDir);
    await fs.mkdir(path.join(tempDir, 'src'));
    await fs.writeFile(path.join(tempDir, '.gitignore'), 'build/\n*.generated.ts\n');
    await fs.writeFile(path.join(tempDir, 'src', 'modified.ts'), 'before\n');
    await fs.writeFile(path.join(tempDir, 'src', 'original.ts'), 'rename me\n');
    await fs.writeFile(path.join(tempDir, 'src', 'deleted.ts'), 'delete me\n');
    await commitAll(tempDir, 'initial');

    await fs.writeFile(path.join(tempDir, 'src', 'modified.ts'), 'after\n');
    await fs.rename(
      path.join(tempDir, 'src', 'original.ts'),
      path.join(tempDir, 'src', 'renamed.ts')
    );
    await fs.rm(path.join(tempDir, 'src', 'deleted.ts'));
    await execFileAsync('git', ['add', '-A'], { cwd: tempDir });
    await fs.writeFile(path.join(tempDir, 'src', 'new.ts'), 'new\n');
    await fs.mkdir(path.join(tempDir, 'build'));
    await fs.writeFile(path.join(tempDir, 'build', 'bundle.js'), 'ignored\n');
    await fs.writeFile(path.join(tempDir, 'src', 'types.generated.ts'), 'ignored\n');

    const snapshot = await getWorkspaceGitSnapshot(tempDir);

    expect(snapshot?.files).toEqual([
      '.gitignore',
      'src/modified.ts',
      'src/new.ts',
      'src/renamed.ts',
    ]);
    expect(snapshot?.changedFiles).toEqual([
      'src/modified.ts',
      'src/new.ts',
      'src/renamed.ts',
    ]);
  });

  it('returns undefined outside a git repository', async () => {
    await expect(getWorkspaceGitSnapshot(tempDir)).resolves.toBeUndefined();
  });
});
