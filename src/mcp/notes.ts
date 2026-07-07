import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { getRemoteOriginUrl, getRepoRoot } from '../core/git';
import { NOTE_EXTENSION, type NoteFile, serializeNote, titleToFileName } from '../core/note';
import { readNoteByPath, resolveNotePath } from '../core/note-listing';
import { pathToRepoKey, remoteUrlToRepoKey } from '../core/repo-key';

export async function readNoteFile(noatHome: string, notePath: string): Promise<NoteFile> {
  return readNoteByPath(noatHome, notePath);
}

export async function writeNoteFile(
  noatHome: string,
  notePath: string,
  note: NoteFile
): Promise<void> {
  await fs.writeFile(
    resolveNotePath(noatHome, notePath),
    serializeNote({ ...note, updatedAt: new Date().toISOString() })
  );
}

export async function createNoteFile(
  noatHome: string,
  scope: string,
  folder: string | undefined,
  title: string,
  blocks: NoteFile['blocks']
): Promise<string> {
  const scopeDir = scope === 'global' ? 'global' : path.join('repos', scope);
  const dirRel = folder ? path.join(scopeDir, folder) : scopeDir;
  const dirAbs = path.dirname(resolveNotePath(noatHome, path.join(dirRel, 'placeholder')));
  await fs.mkdir(dirAbs, { recursive: true });

  const base = titleToFileName(title);
  const candidates = [base, ...Array.from({ length: 98 }, (_, i) => `${base} ${i + 2}`)];
  for (const candidate of candidates) {
    const relPath = path.join(dirRel, `${candidate}${NOTE_EXTENSION}`);
    const absPath = resolveNotePath(noatHome, relPath);
    const now = new Date().toISOString();
    const note: NoteFile = {
      version: 1,
      id: crypto.randomUUID(),
      title: candidate,
      createdAt: now,
      updatedAt: now,
      blocks,
    };
    try {
      await fs.writeFile(absPath, serializeNote(note), { flag: 'wx' });
      return relPath;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
  }
  throw new Error(`Too many notes named "${base}"`);
}

/** Map a working directory to its NOAT repo scope key. */
export async function repoScopeForCwd(
  cwd: string
): Promise<{ repoKey: string; repoRoot: string } | undefined> {
  const repoRoot = await getRepoRoot(cwd);
  if (!repoRoot) return undefined;
  const remoteUrl = await getRemoteOriginUrl(repoRoot);
  const repoKey = remoteUrl ? remoteUrlToRepoKey(remoteUrl) : pathToRepoKey(repoRoot);
  return { repoKey, repoRoot };
}
