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
        props?: { path?: string; title?: string; latex?: string };
      };
      if (typeof inline.text === 'string') return inline.text;
      if (inline.type === 'fileLink') return inline.props?.path ?? '';
      if (inline.type === 'noteLink') return inline.props?.title ?? '';
      if (inline.type === 'math') return inline.props?.latex ?? '';
      if (inline.content) return inlineText(inline.content);
      return '';
    })
    .join('');
}

function blockText(block: Block): string[] {
  const parts: string[] = [];
  const content = (block as { content?: unknown }).content;
  // Equation blocks hold no content -- their LaTeX lives in props, and without
  // this the formula would be invisible to search and to snippets.
  if (block.type === 'equation') {
    parts.push((block as { props?: { latex?: string } }).props?.latex ?? '');
  }
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

export type SectionSlice =
  | {
      kind: 'match';
      heading: string;
      blocks: NoteFile['blocks'];
      /** Top-level block range of the section: [start, end). */
      start: number;
      end: number;
    }
  | { kind: 'ambiguous'; candidates: string[] }
  | { kind: 'not-found'; headings: string[] };

/**
 * Slice out the blocks of one section: from the heading matching `section`
 * (case-insensitive exact match, else unique prefix — so "2.1" finds
 * "2.1 Deploy steps") through everything before the next heading of the
 * same or higher level, sub-sections included.
 */
export function sliceSection(blocks: NoteFile['blocks'], section: string): SectionSlice {
  const query = section.trim().toLowerCase();
  const headings = blocks
    .map((block, index) => ({ block, index }))
    .filter((entry) => entry.block.type === 'heading')
    .map((entry) => ({
      index: entry.index,
      level: (entry.block as { props?: { level?: number } }).props?.level ?? 1,
      text: blockText(entry.block).join(' ').trim(),
    }));

  const exact = headings.filter((heading) => heading.text.toLowerCase() === query);
  const matches =
    exact.length > 0
      ? exact
      : headings.filter((heading) => heading.text.toLowerCase().startsWith(query));
  if (matches.length === 0) {
    return { kind: 'not-found', headings: headings.map((heading) => heading.text) };
  }
  const start = matches[0];
  if (matches.length > 1 || !start) {
    return { kind: 'ambiguous', candidates: matches.map((match) => match.text) };
  }
  const end = headings.find(
    (heading) => heading.index > start.index && heading.level <= start.level
  );
  const endIndex = end?.index ?? blocks.length;
  return {
    kind: 'match',
    heading: start.text,
    blocks: blocks.slice(start.index, endIndex),
    start: start.index,
    end: endIndex,
  };
}

/**
 * Swap one section (heading included, sub-sections included — the same range
 * `sliceSection` returns) for `replacement`, leaving every other block untouched.
 */
export function replaceSection(
  blocks: NoteFile['blocks'],
  section: string,
  replacement: NoteFile['blocks']
):
  | { kind: 'match'; heading: string; removed: number; blocks: NoteFile['blocks'] }
  | Exclude<SectionSlice, { kind: 'match' }> {
  const slice = sliceSection(blocks, section);
  if (slice.kind !== 'match') return slice;
  return {
    kind: 'match',
    heading: slice.heading,
    removed: slice.end - slice.start,
    blocks: [...blocks.slice(0, slice.start), ...replacement, ...blocks.slice(slice.end)],
  };
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
