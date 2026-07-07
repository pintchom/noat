import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { getRemoteOriginUrl, getRepoRoot } from '../core/git';
import { type NoteFile, parseNote, serializeNote, titleToFileName } from '../core/note';
import { NOTE_EXTENSION } from '../core/note';
import { getNotesRoot } from '../core/paths';
import { pathToRepoKey, remoteUrlToRepoKey } from '../core/repo-key';

export interface NoteListing {
  /** Store-relative path, e.g. "global/Ideas.noat.json" — the id used by all tools. */
  notePath: string;
  title: string;
  scope: string;
  updatedAt: string;
}

type Block = NoteFile['blocks'][number];

/** Resolve a store-relative note path safely (no escaping the store). */
export function resolveNotePath(noatHome: string, notePath: string): string {
  const notesRoot = getNotesRoot(noatHome);
  const resolved = path.resolve(notesRoot, notePath);
  if (!resolved.startsWith(notesRoot + path.sep)) {
    throw new Error(`Invalid note path: ${notePath}`);
  }
  return resolved;
}

function scopeOf(relPath: string): string {
  const segments = relPath.split(path.sep);
  if (segments[0] === 'global') return 'global';
  if (segments[0] === 'repos' && segments[1]) return segments[1];
  return segments[0] ?? '';
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
        const scope = scopeOf(relPath);
        if (
          scopeFilter &&
          scope !== scopeFilter &&
          !(scopeFilter === 'global' && scope === 'global')
        ) {
          continue;
        }
        try {
          const note = parseNote(await fs.readFile(absPath, 'utf8'));
          results.push({ notePath: relPath, title: note.title, scope, updatedAt: note.updatedAt });
        } catch {
          // Unreadable note files are skipped rather than failing the listing.
        }
      }
    }
  }

  await walk(notesRoot);
  return results.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function readNoteFile(noatHome: string, notePath: string): Promise<NoteFile> {
  return parseNote(await fs.readFile(resolveNotePath(noatHome, notePath), 'utf8'));
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
  const dirAbs = resolveNotePath(noatHome, path.join(dirRel, 'placeholder')).replace(
    `${path.sep}placeholder`,
    ''
  );
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

/** Extract the plain text of a block tree (for search + snippets). */
export function blocksToPlainText(blocks: Block[]): string {
  const parts: string[] = [];

  function inlineText(content: unknown): string {
    if (!Array.isArray(content)) return '';
    return content
      .map((item) => {
        if (typeof item !== 'object' || item === null) return '';
        const inline = item as {
          type?: string;
          text?: string;
          content?: unknown;
          props?: { path?: string };
        };
        if (typeof inline.text === 'string') return inline.text;
        if (inline.type === 'fileLink') return inline.props?.path ?? '';
        if (inline.content) return inlineText(inline.content);
        return '';
      })
      .join('');
  }

  function visit(block: Block): void {
    const content = (block as { content?: unknown }).content;
    if (Array.isArray(content)) {
      parts.push(inlineText(content));
    } else if (
      typeof content === 'object' &&
      content !== null &&
      (content as { type?: string }).type === 'tableContent'
    ) {
      const rows = (content as { rows?: Array<{ cells?: unknown[] }> }).rows ?? [];
      for (const row of rows) {
        parts.push(
          (row.cells ?? [])
            .map((cell) => {
              if (Array.isArray(cell)) return inlineText(cell);
              if (typeof cell === 'object' && cell !== null) {
                return inlineText((cell as { content?: unknown }).content);
              }
              return '';
            })
            .join(' | ')
        );
      }
    }
    const children = (block as { children?: Block[] }).children;
    if (Array.isArray(children)) for (const child of children) visit(child);
  }

  for (const block of blocks) visit(block);
  return parts.filter((part) => part.length > 0).join('\n');
}

export interface SearchHit {
  notePath: string;
  title: string;
  scope: string;
  snippets: string[];
}

export async function searchNotes(
  noatHome: string,
  query: string,
  scopeFilter?: string
): Promise<SearchHit[]> {
  const q = query.toLowerCase();
  const listings = await listAllNotes(noatHome, scopeFilter);
  const hits: SearchHit[] = [];

  for (const listing of listings) {
    const note = await (async () => {
      try {
        return await readNoteFile(noatHome, listing.notePath);
      } catch {
        return undefined;
      }
    })();
    if (!note) continue;

    const titleMatch = note.title.toLowerCase().includes(q);
    const lines = blocksToPlainText(note.blocks).split('\n');
    const snippets = lines.filter((line) => line.toLowerCase().includes(q)).slice(0, 3);
    if (titleMatch || snippets.length > 0) {
      hits.push({ notePath: listing.notePath, title: note.title, scope: listing.scope, snippets });
    }
  }

  return hits;
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
