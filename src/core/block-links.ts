import type { NoteFile } from './note';
import { blocksToPlainText } from './note-text';

type Block = NoteFile['blocks'][number];

const LABEL_MAX_CHARS = 48;

/** Depth-first search for the block with `id`, children included. */
export function findBlock(blocks: Block[], id: string): Block | undefined {
  for (const block of blocks) {
    if (block.id === id) return block;
    const children = (block as { children?: Block[] }).children;
    const found = Array.isArray(children) ? findBlock(children, id) : undefined;
    if (found) return found;
  }
  return undefined;
}

/**
 * Short display text for a /point chip: the block's own first line (children
 * excluded), whitespace-collapsed and truncated. Falls back to the block type
 * for blocks with no text, like images or empty paragraphs.
 */
export function blockLinkLabel(block: Block): string {
  const own = { ...block, children: [] } as Block;
  const firstLine = (blocksToPlainText([own]).split('\n')[0] ?? '').replace(/\s+/g, ' ').trim();
  if (firstLine.length === 0) return block.type === 'paragraph' ? 'Empty line' : block.type;
  return firstLine.length > LABEL_MAX_CHARS
    ? `${firstLine.slice(0, LABEL_MAX_CHARS - 1).trimEnd()}…`
    : firstLine;
}
