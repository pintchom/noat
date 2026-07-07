import type { NoteFile } from './note';

type Block = NoteFile['blocks'][number];

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

function blockText(block: Block): string[] {
  const parts: string[] = [];
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
  if (Array.isArray(children)) {
    for (const child of children) parts.push(...blockText(child));
  }
  return parts;
}

/** Extract the plain text of a block tree (for search + snippets). */
export function blocksToPlainText(blocks: NoteFile['blocks']): string {
  return blocks
    .flatMap((block) => blockText(block))
    .filter((part) => part.length > 0)
    .join('\n');
}

export interface NoteSection {
  /** Heading text this section falls under ('' before any heading). */
  heading: string;
  text: string;
}

/** Split a note into heading-delimited sections for embedding. */
export function blocksToSections(blocks: NoteFile['blocks']): NoteSection[] {
  const sections: NoteSection[] = [];
  let heading = '';
  let buffer: string[] = [];

  const flush = () => {
    const text = buffer.join('\n').trim();
    if (text.length > 0 || heading.length > 0) {
      sections.push({ heading, text });
    }
    buffer = [];
  };

  for (const block of blocks) {
    if (block.type === 'heading') {
      flush();
      heading = blockText(block).join(' ').trim();
    } else {
      buffer.push(...blockText(block));
    }
  }
  flush();

  return sections.filter((section) => section.text.length > 0 || section.heading.length > 0);
}
