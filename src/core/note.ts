import { z } from 'zod';

/**
 * BlockNote blocks are stored opaquely — the editor owns their shape.
 * We validate just enough structure to catch corrupted files.
 */
export const blockSchema = z
  .object({
    id: z.string(),
    type: z.string(),
  })
  .passthrough();

/**
 * An inline review comment. Its anchor is every text run whose commentRef
 * style carries the same id; when that text is rewritten the anchor is lost
 * and the entry survives as unanchored feedback until resolved.
 */
export const inlineCommentSchema = z
  .object({
    id: z.string(),
    text: z.string(),
    createdAt: z.string(),
  })
  .passthrough();

export type InlineComment = z.infer<typeof inlineCommentSchema>;

export const noteFileSchema = z
  .object({
    version: z.literal(1),
    id: z.string(),
    title: z.string(),
    icon: z.string().optional(),
    createdAt: z.string(),
    updatedAt: z.string(),
    blocks: z.array(blockSchema),
    comments: z.array(inlineCommentSchema).optional(),
  })
  .passthrough();

export type NoteFile = z.infer<typeof noteFileSchema>;

export const NOTE_EXTENSION = '.noat.json';

export function createEmptyNote(title: string): NoteFile {
  const now = new Date().toISOString();
  return {
    version: 1,
    // Global crypto: works in Node 20+ and browsers, keeping this module isomorphic.
    id: crypto.randomUUID(),
    title,
    createdAt: now,
    updatedAt: now,
    blocks: [],
  };
}

export function serializeNote(note: NoteFile): string {
  return `${JSON.stringify(note, null, 2)}\n`;
}

export function parseNote(raw: string): NoteFile {
  return noteFileSchema.parse(JSON.parse(raw));
}

/** Turn a note title into a safe filename (without extension). */
export function titleToFileName(title: string): string {
  const cleaned = title
    .trim()
    .replace(/[/\\:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .slice(0, 80)
    .trim();
  return cleaned.length > 0 ? cleaned : 'Untitled';
}
