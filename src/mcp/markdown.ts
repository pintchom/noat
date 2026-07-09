import { defaultBlockSpecs } from '@blocknote/core';
import { ServerBlockNoteEditor } from '@blocknote/server-util';
import type { NoteFile } from '../core/note';

type Block = NoteFile['blocks'][number];

// type -> prop keys its schema actually allows. Converters throw on unknown
// props, and note files in the wild may carry extras.
const allowedProps = new Map<string, Set<string>>(
  Object.entries(defaultBlockSpecs).map(([type, spec]) => [
    type,
    new Set(Object.keys(spec.config.propSchema)),
  ])
);

function sanitizeProps(type: string, props: unknown): unknown {
  const allowed = allowedProps.get(type);
  if (!allowed || typeof props !== 'object' || props === null) return props;
  return Object.fromEntries(Object.entries(props).filter(([key]) => allowed.has(key)));
}

let editor: ServerBlockNoteEditor | undefined;

function getEditor(): ServerBlockNoteEditor {
  if (!editor) editor = ServerBlockNoteEditor.create();
  return editor;
}

/**
 * Replace NOAT-specific inline content (fileLink chips) with plain code-styled
 * text so the default BlockNote schema can convert blocks to markdown.
 */
function sanitizeInline(content: unknown): unknown {
  if (!Array.isArray(content)) return content;
  return content.map((item) => {
    if (typeof item !== 'object' || item === null) return item;
    const inline = item as { type?: string; props?: { path?: string }; content?: unknown };
    if (inline.type === 'fileLink') {
      return { type: 'text', text: inline.props?.path ?? '', styles: { code: true } };
    }
    if (inline.type === 'link') {
      return { ...inline, content: sanitizeInline(inline.content) };
    }
    return item;
  });
}

function sanitizeBlocks(blocks: Block[]): Block[] {
  return blocks.map((block) => {
    const content = (() => {
      const raw = (block as { content?: unknown }).content;
      if (Array.isArray(raw)) return sanitizeInline(raw);
      if (
        typeof raw === 'object' &&
        raw !== null &&
        (raw as { type?: string }).type === 'tableContent'
      ) {
        const table = raw as { rows?: Array<{ cells?: unknown[] }> };
        return {
          ...table,
          rows: (table.rows ?? []).map((row) => ({
            ...row,
            cells: (row.cells ?? []).map((cell) => {
              if (Array.isArray(cell)) return sanitizeInline(cell);
              if (typeof cell === 'object' && cell !== null) {
                const cellObject = cell as { content?: unknown };
                return { ...cellObject, content: sanitizeInline(cellObject.content) };
              }
              return cell;
            }),
          })),
        };
      }
      return raw;
    })();

    const children = (block as { children?: Block[] }).children;
    const props = (block as { props?: unknown }).props;
    return {
      ...block,
      ...(props !== undefined && { props: sanitizeProps(block.type, props) }),
      ...(content !== undefined && { content }),
      ...(Array.isArray(children) && { children: sanitizeBlocks(children) }),
    } as Block;
  });
}

/** Ensure every block (and child) has the id our note schema requires. */
export function prepareBlocks(blocks: Block[]): Block[] {
  return ensureIds(blocks);
}

function ensureIds(blocks: Block[]): Block[] {
  return blocks.map((block) => {
    const children = (block as { children?: unknown }).children;
    return {
      ...block,
      id: typeof block.id === 'string' && block.id.length > 0 ? block.id : crypto.randomUUID(),
      ...(Array.isArray(children) && { children: ensureIds(children as Block[]) }),
    };
  });
}

export async function blocksToMarkdown(blocks: NoteFile['blocks']): Promise<string> {
  // biome-ignore lint/suspicious/noExplicitAny: server-util types expect its own Block shape
  return getEditor().blocksToMarkdownLossy(sanitizeBlocks(blocks) as any);
}

export async function markdownToBlocks(markdown: string): Promise<NoteFile['blocks']> {
  const blocks = await getEditor().tryParseMarkdownToBlocks(markdown);
  return ensureIds(blocks as unknown as Block[]);
}
