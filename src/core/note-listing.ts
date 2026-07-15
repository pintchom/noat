import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { NOTE_EXTENSION, type NoteFile, parseNote } from './note';
import { getNotesRoot } from './paths';

export interface NoteListing {
  /** Store-relative path, e.g. "global/Ideas.noat.json" — the canonical note id. */
  notePath: string;
  title: string;
  icon?: string;
  scope: string;
  updatedAt: string;
}

export function scopeOfNotePath(relPath: string): string {
  const segments = relPath.split(path.sep);
  if (segments[0] === 'global') return 'global';
  if (segments[0] === 'repos' && segments[1]) return segments[1];
  return segments[0] ?? '';
}

/** Resolve a store-relative note path safely (no escaping the store). */
export function resolveNotePath(noatHome: string, notePath: string): string {
  const notesRoot = getNotesRoot(noatHome);
  const resolved = path.resolve(notesRoot, notePath);
  if (!resolved.startsWith(notesRoot + path.sep)) {
    throw new Error(`Invalid note path: ${notePath}`);
  }
  return resolved;
}

export async function readNoteByPath(noatHome: string, notePath: string): Promise<NoteFile> {
  return parseNote(await fs.readFile(resolveNotePath(noatHome, notePath), 'utf8'));
}

export interface NoteStat {
  notePath: string;
  mtimeMs: number;
  size: number;
}

/** Stat every note file without reading contents (for cheap staleness checks). */
export async function statAllNotes(noatHome: string): Promise<NoteStat[]> {
  const notesRoot = getNotesRoot(noatHome);
  const results: NoteStat[] = [];

  async function walk(dir: string): Promise<void> {
    const dirents = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const dirent of dirents) {
      if (dirent.name.startsWith('.')) continue;
      const absPath = path.join(dir, dirent.name);
      if (dirent.isDirectory()) {
        await walk(absPath);
      } else if (dirent.isFile() && dirent.name.endsWith(NOTE_EXTENSION)) {
        try {
          const stat = await fs.stat(absPath);
          results.push({
            notePath: path.relative(notesRoot, absPath),
            mtimeMs: stat.mtimeMs,
            size: stat.size,
          });
        } catch {
          // Files deleted mid-walk are simply not listed.
        }
      }
    }
  }

  await walk(notesRoot);
  return results;
}

export async function listAllNotes(noatHome: string, scopeFilter?: string): Promise<NoteListing[]> {
  const notesRoot = getNotesRoot(noatHome);
  const results: NoteListing[] = [];

  async function walk(dir: string): Promise<void> {
    const dirents = await (async () => {
      try {
        return await fs.readdir(dir, { withFileTypes: true });
      } catch {
        return [];
      }
    })();
    for (const dirent of dirents) {
      if (dirent.name.startsWith('.')) continue;
      const absPath = path.join(dir, dirent.name);
      if (dirent.isDirectory()) {
        await walk(absPath);
      } else if (dirent.isFile() && dirent.name.endsWith(NOTE_EXTENSION)) {
        const relPath = path.relative(notesRoot, absPath);
        const scope = scopeOfNotePath(relPath);
        if (scopeFilter && scope !== scopeFilter) continue;
        try {
          const note = parseNote(await fs.readFile(absPath, 'utf8'));
          results.push({
            notePath: relPath,
            title: note.title,
            ...(note.icon && { icon: note.icon }),
            scope,
            updatedAt: note.updatedAt,
          });
        } catch {
          // Unreadable note files are skipped rather than failing the listing.
        }
      }
    }
  }

  await walk(notesRoot);
  return results.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
