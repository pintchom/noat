import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { getGlobalNotesDir, getReposNotesDir } from '../core/paths';
import { isNoteFile, noteNameFromFile } from '../core/store';

export interface SearchableNote {
  title: string;
  absPath: string;
  /** e.g. "Global", "pintchom/noat" */
  scopeLabel: string;
  /** Folder path within the scope, '' at scope root. */
  folder: string;
}

function repoKeyToLabel(repoKey: string): string {
  const parts = repoKey.split('--');
  return parts.length > 1 ? parts.slice(1).join('/') : repoKey;
}

async function walk(
  dir: string,
  scopeLabel: string,
  scopeRoot: string,
  results: SearchableNote[]
): Promise<void> {
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
      await walk(absPath, scopeLabel, scopeRoot, results);
    } else if (dirent.isFile() && isNoteFile(dirent.name)) {
      results.push({
        title: noteNameFromFile(dirent.name),
        absPath,
        scopeLabel,
        folder: path.relative(scopeRoot, dir),
      });
    }
  }
}

/** Collect every note across all scopes for quick-pick search. */
export async function collectAllNotes(noatHome: string): Promise<SearchableNote[]> {
  const results: SearchableNote[] = [];

  const globalDir = getGlobalNotesDir(noatHome);
  await walk(globalDir, 'Global', globalDir, results);

  const reposDir = getReposNotesDir(noatHome);
  const repoDirs = await (async () => {
    try {
      return await fs.readdir(reposDir, { withFileTypes: true });
    } catch {
      return [];
    }
  })();
  for (const dirent of repoDirs) {
    if (!dirent.isDirectory() || dirent.name.startsWith('.')) continue;
    const repoRoot = path.join(reposDir, dirent.name);
    await walk(repoRoot, repoKeyToLabel(dirent.name), repoRoot, results);
  }

  return results.sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }));
}
