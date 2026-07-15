import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { ensureGitRepo } from './git';
import {
  NOTE_EXTENSION,
  type NoteFile,
  createEmptyNote,
  parseNote,
  serializeNote,
  titleToFileName,
} from './note';
import { getGlobalNotesDir, getRepoNotesDir, getReposNotesDir } from './paths';

export type NoteScope = { type: 'global' } | { type: 'repo'; repoKey: string };

export interface StoreEntry {
  kind: 'note' | 'folder';
  /** Display name: note title (from filename) or folder name. */
  name: string;
  absPath: string;
  scope: NoteScope;
  icon?: string;
}

export function scopeDir(noatHome: string, scope: NoteScope): string {
  return scope.type === 'global'
    ? getGlobalNotesDir(noatHome)
    : getRepoNotesDir(noatHome, scope.repoKey);
}

/** Create the on-disk layout and git-init the store. Idempotent. */
export async function initStore(noatHome: string): Promise<void> {
  await fs.mkdir(getGlobalNotesDir(noatHome), { recursive: true });
  await fs.mkdir(getReposNotesDir(noatHome), { recursive: true });
  const gitignorePath = path.join(noatHome, '.gitignore');
  try {
    await fs.access(gitignorePath);
  } catch {
    await fs.writeFile(gitignorePath, '.cache/\n.index/\n.DS_Store\n');
  }
  await ensureGitRepo(noatHome);
}

export function isNoteFile(fileName: string): boolean {
  return fileName.endsWith(NOTE_EXTENSION);
}

export function noteNameFromFile(fileName: string): string {
  return path.basename(fileName, NOTE_EXTENSION);
}

/** List folders and notes directly inside `dirAbsPath` (folders first, alphabetical). */
export async function listEntries(dirAbsPath: string, scope: NoteScope): Promise<StoreEntry[]> {
  const dirents = await (async () => {
    try {
      return await fs.readdir(dirAbsPath, { withFileTypes: true });
    } catch {
      return [];
    }
  })();

  const entries = (
    await Promise.all(
      dirents.map(async (dirent): Promise<StoreEntry | undefined> => {
        if (dirent.name.startsWith('.')) return undefined;
        const absPath = path.join(dirAbsPath, dirent.name);
        if (dirent.isDirectory()) {
          return { kind: 'folder', name: dirent.name, absPath, scope };
        }
        if (dirent.isFile() && isNoteFile(dirent.name)) {
          const icon = await (async () => {
            try {
              return (await readNote(absPath)).icon;
            } catch {
              return undefined;
            }
          })();
          return {
            kind: 'note',
            name: noteNameFromFile(dirent.name),
            absPath,
            scope,
            ...(icon && { icon }),
          };
        }
        return undefined;
      })
    )
  ).filter((entry): entry is StoreEntry => entry !== undefined);

  return entries.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  });
}

/** Find a filename that doesn't collide, appending " 2", " 3", ... as needed. */
async function availablePath(dir: string, baseName: string, suffix: string): Promise<string> {
  const candidates = [baseName, ...Array.from({ length: 98 }, (_, i) => `${baseName} ${i + 2}`)];
  for (const candidate of candidates) {
    const candidatePath = path.join(dir, `${candidate}${suffix}`);
    try {
      await fs.access(candidatePath);
    } catch {
      return candidatePath;
    }
  }
  throw new Error(`Too many entries named "${baseName}" in ${dir}`);
}

export async function createNote(dirAbsPath: string, title: string): Promise<string> {
  await fs.mkdir(dirAbsPath, { recursive: true });
  const filePath = await availablePath(dirAbsPath, titleToFileName(title), NOTE_EXTENSION);
  const note = createEmptyNote(noteNameFromFile(path.basename(filePath)));
  await fs.writeFile(filePath, serializeNote(note), { flag: 'wx' });
  return filePath;
}

export async function createFolder(dirAbsPath: string, name: string): Promise<string> {
  const folderPath = await availablePath(dirAbsPath, titleToFileName(name), '');
  await fs.mkdir(folderPath, { recursive: true });
  return folderPath;
}

export async function readNote(noteAbsPath: string): Promise<NoteFile> {
  return parseNote(await fs.readFile(noteAbsPath, 'utf8'));
}

export async function writeNote(noteAbsPath: string, note: NoteFile): Promise<void> {
  await fs.writeFile(noteAbsPath, serializeNote({ ...note, updatedAt: new Date().toISOString() }));
}

/** Rename a note file and keep its embedded title in sync. */
export async function renameNote(noteAbsPath: string, newTitle: string): Promise<string> {
  const dir = path.dirname(noteAbsPath);
  const newPath = await availablePath(dir, titleToFileName(newTitle), NOTE_EXTENSION);
  const note = await readNote(noteAbsPath);
  await fs.rename(noteAbsPath, newPath);
  await writeNote(newPath, { ...note, title: noteNameFromFile(path.basename(newPath)) });
  return newPath;
}

export async function renameFolder(folderAbsPath: string, newName: string): Promise<string> {
  const dir = path.dirname(folderAbsPath);
  const newPath = await availablePath(dir, titleToFileName(newName), '');
  await fs.rename(folderAbsPath, newPath);
  return newPath;
}

export async function deleteEntry(absPath: string): Promise<void> {
  await fs.rm(absPath, { recursive: true, force: true });
}

/** Move a note or folder into the root of another scope. Returns the new path. */
export async function moveToScope(
  entryAbsPath: string,
  noatHome: string,
  targetScope: NoteScope
): Promise<string> {
  const targetDir = scopeDir(noatHome, targetScope);
  await fs.mkdir(targetDir, { recursive: true });
  const baseName = path.basename(entryAbsPath);
  const isNote = isNoteFile(baseName);
  const newPath = await availablePath(
    targetDir,
    isNote ? noteNameFromFile(baseName) : baseName,
    isNote ? NOTE_EXTENSION : ''
  );
  await fs.rename(entryAbsPath, newPath);
  return newPath;
}
