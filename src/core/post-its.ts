import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { z } from 'zod';
import { getPostItsDir } from './paths';

/**
 * Post-its are short notes pinned to a range of code and owned by one NOAT.
 * They live beside the notes rather than inside them — one file per note at
 * postits/<noteId>.json — so the note editor, which rewrites the whole note
 * on every keystroke, can never clobber them.
 *
 * Positions are 0-based, like VS Code's. Files inside a git repo are stored
 * as repo-relative "/" paths plus the repo key, so post-its follow the repo
 * across clones and machines; files outside any repo keep an absolute path.
 */

const positionSchema = z.object({
  line: z.number().int().nonnegative(),
  character: z.number().int().nonnegative(),
});

const rangeSchema = z.object({ start: positionSchema, end: positionSchema });

export const postItSchema = z
  .object({
    id: z.string(),
    noteId: z.string(),
    repoKey: z.string().optional(),
    file: z.string(),
    range: rangeSchema,
    /** The highlighted code when the post-it was last saved; used to re-find it after edits. */
    snippet: z.string(),
    text: z.string(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .passthrough();

const postItFileSchema = z
  .object({
    version: z.literal(1),
    noteId: z.string(),
    postIts: z.array(postItSchema),
  })
  .passthrough();

export type PostItPosition = z.infer<typeof positionSchema>;
export type PostItRange = z.infer<typeof rangeSchema>;
export type PostIt = z.infer<typeof postItSchema>;

export interface NotePostItsFile {
  noteId: string;
  /** File contents as read, so callers can recognize their own writes. */
  raw: string;
  postIts: PostIt[];
}

const NOTE_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

export function postItFilePath(noatHome: string, noteId: string): string {
  if (!NOTE_ID_PATTERN.test(noteId)) throw new Error(`Invalid note id: ${noteId}`);
  return path.join(getPostItsDir(noatHome), `${noteId}.json`);
}

function comparePositions(a: PostItPosition, b: PostItPosition): number {
  return a.line - b.line || a.character - b.character;
}

export function sameRange(a: PostItRange, b: PostItRange): boolean {
  return comparePositions(a.start, b.start) === 0 && comparePositions(a.end, b.end) === 0;
}

/** File, then position — the order a reader walks the code in. */
export function sortPostIts(postIts: readonly PostIt[]): PostIt[] {
  return [...postIts].sort(
    (a, b) => a.file.localeCompare(b.file) || comparePositions(a.range.start, b.range.start)
  );
}

export function serializeNotePostIts(noteId: string, postIts: readonly PostIt[]): string {
  return `${JSON.stringify({ version: 1, noteId, postIts: sortPostIts(postIts) }, null, 2)}\n`;
}

export function parseNotePostIts(raw: string): { noteId: string; postIts: PostIt[] } {
  const parsed = postItFileSchema.parse(JSON.parse(raw));
  return {
    noteId: parsed.noteId,
    postIts: parsed.postIts.map((postIt) => ({ ...postIt, noteId: parsed.noteId })),
  };
}

/** Every readable post-it file in the store; corrupt files are skipped. */
export async function readPostItFiles(noatHome: string): Promise<NotePostItsFile[]> {
  const dir = getPostItsDir(noatHome);
  const names = await fs.readdir(dir).catch((): string[] => []);
  const files = await Promise.all(
    names
      .filter((name) => name.endsWith('.json') && !name.startsWith('.'))
      .map(async (name): Promise<NotePostItsFile | undefined> => {
        try {
          const raw = await fs.readFile(path.join(dir, name), 'utf8');
          return { raw, ...parseNotePostIts(raw) };
        } catch {
          return undefined;
        }
      })
  );
  return files.filter((file): file is NotePostItsFile => file !== undefined);
}

/**
 * Write a note's post-its, removing its file once the last one is gone.
 * Returns the contents written ("" when the file was removed).
 */
export async function writeNotePostIts(
  noatHome: string,
  noteId: string,
  postIts: readonly PostIt[]
): Promise<string> {
  const filePath = postItFilePath(noatHome, noteId);
  if (postIts.length === 0) {
    await fs.rm(filePath, { force: true });
    return '';
  }
  const raw = serializeNotePostIts(noteId, postIts);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, raw);
  return raw;
}

function lineStartsOf(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) starts.push(i + 1);
  }
  return starts;
}

function offsetAt(text: string, starts: number[], position: PostItPosition): number {
  const line = Math.min(position.line, starts.length - 1);
  const lineStart = starts[line] ?? 0;
  const nextStart = starts[line + 1];
  let lineEnd = nextStart === undefined ? text.length : nextStart - 1;
  if (lineEnd > lineStart && text[lineEnd - 1] === '\r') lineEnd--;
  return Math.min(lineStart + position.character, lineEnd);
}

function positionAt(starts: number[], offset: number): PostItPosition {
  let low = 0;
  let high = starts.length - 1;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if ((starts[mid] ?? 0) <= offset) low = mid;
    else high = mid - 1;
  }
  return { line: low, character: offset - (starts[low] ?? 0) };
}

/**
 * Where a post-it's code is in `text` now. The stored range wins while it
 * still holds the snippet; otherwise the snippet occurrence nearest the old
 * spot does (code moved by edits made outside the editor — git pulls,
 * branch switches, other tools). With no occurrence left, the old range is
 * kept, clamped to the document.
 */
export function reanchorRange(text: string, range: PostItRange, snippet: string): PostItRange {
  const starts = lineStartsOf(text);
  const start = offsetAt(text, starts, range.start);
  const end = Math.max(start, offsetAt(text, starts, range.end));
  const clamped = { start: positionAt(starts, start), end: positionAt(starts, end) };
  if (snippet.length === 0 || text.slice(start, end) === snippet) return clamped;

  let best: number | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let at = text.indexOf(snippet); at !== -1; at = text.indexOf(snippet, at + 1)) {
    const distance = Math.abs(at - start);
    if (distance < bestDistance) {
      best = at;
      bestDistance = distance;
    } else if (at > start) {
      break;
    }
  }
  if (best === undefined) return clamped;
  return { start: positionAt(starts, best), end: positionAt(starts, best + snippet.length) };
}

export interface TextChange {
  /** Replaced range, in the document as it was before the change. */
  range: PostItRange;
  text: string;
}

/**
 * Move a range through one edit, the way a decoration would move: typing
 * right before a post-it pushes it along, typing right after it doesn't grow
 * it, and deleting part of it shrinks it.
 */
export function shiftRange(range: PostItRange, change: TextChange): PostItRange {
  const { start: changeStart, end: changeEnd } = change.range;
  const insertedLines = change.text.split(/\r\n|\r|\n/);
  const lastInserted = insertedLines[insertedLines.length - 1] ?? '';
  const insertedEnd: PostItPosition =
    insertedLines.length === 1
      ? { line: changeStart.line, character: changeStart.character + change.text.length }
      : { line: changeStart.line + insertedLines.length - 1, character: lastInserted.length };

  const afterChange = (position: PostItPosition): PostItPosition =>
    position.line === changeEnd.line
      ? {
          line: insertedEnd.line,
          character: insertedEnd.character + position.character - changeEnd.character,
        }
      : { line: position.line + insertedEnd.line - changeEnd.line, character: position.character };

  const move = (position: PostItPosition, isStart: boolean): PostItPosition => {
    const vsStart = comparePositions(position, changeStart);
    const pureInsert = comparePositions(changeStart, changeEnd) === 0;
    if (vsStart < 0 || (vsStart === 0 && !(isStart && pureInsert))) return position;
    if (comparePositions(position, changeEnd) >= 0) return afterChange(position);
    // Inside the replaced text: the start keeps its place, the end follows the insertion.
    return isStart ? changeStart : insertedEnd;
  };

  const start = move(range.start, true);
  const end = move(range.end, false);
  return { start, end: comparePositions(end, start) < 0 ? start : end };
}

/**
 * Move a range through one document change event. When an edit swallows the
 * range's start, the range is re-found by its snippet instead: reloading a
 * file changed on disk (git checkout, pull) arrives as one edit replacing the
 * whole changed region, which would otherwise collapse every post-it in it.
 */
export function trackRange(
  range: PostItRange,
  changes: readonly TextChange[],
  snippet: string,
  textAfter: () => string
): PostItRange {
  let swallowed = false;
  let current = range;
  for (const change of changes) {
    if (
      comparePositions(change.range.start, current.start) <= 0 &&
      comparePositions(change.range.end, current.start) > 0
    ) {
      swallowed = true;
    }
    current = shiftRange(current, change);
  }
  return swallowed ? reanchorRange(textAfter(), current, snippet) : current;
}

/** A post-it's snippet trimmed for display: dedented, at most `maxLines` lines. */
export function previewSnippet(snippet: string, maxLines = 6): string {
  const lines = snippet.replace(/\r\n?/g, '\n').split('\n');
  while (lines.length > 0 && lines[lines.length - 1]?.trim() === '') lines.pop();
  while (lines.length > 0 && lines[0]?.trim() === '') lines.shift();
  // The first line usually starts mid-line (the selection's start), so it
  // doesn't count toward the shared indent.
  const indents = lines
    .slice(1)
    .filter((line) => line.trim() !== '')
    .map((line) => line.length - line.trimStart().length);
  const indent = indents.length > 0 ? Math.min(...indents) : 0;
  const dedented = lines.map((line, index) =>
    index === 0
      ? line.trimStart()
      : line.slice(Math.min(indent, line.length - line.trimStart().length))
  );
  if (dedented.length <= maxLines) return dedented.join('\n');
  return `${dedented.slice(0, maxLines).join('\n')}\n…`;
}
