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

const ANCHOR_PATTERN = /^:\d+(?::\d+)?$/;

/**
 * Replace NOAT-specific inline content (fileLink chips) with plain code-styled
 * text so the default BlockNote schema can convert blocks to markdown. A line
 * anchor right after a chip merges into the chip's path text — two adjacent
 * code spans would render as ambiguous markdown.
 */
function sanitizeInline(content: unknown): unknown {
  if (!Array.isArray(content)) return content;
  return content.reduce<unknown[]>((acc, item, index) => {
    if (typeof item !== 'object' || item === null) {
      acc.push(item);
      return acc;
    }
    const inline = item as {
      type?: string;
      text?: string;
      styles?: { code?: boolean };
      props?: { path?: string };
      content?: unknown;
    };
    if (inline.type === 'fileLink') {
      acc.push({ type: 'text', text: inline.props?.path ?? '', styles: { code: true } });
      return acc;
    }
    if (inline.type === 'link') {
      acc.push({ ...inline, content: sanitizeInline(inline.content) });
      return acc;
    }
    const previous = content[index - 1] as { type?: string } | undefined;
    if (
      previous?.type === 'fileLink' &&
      inline.type === 'text' &&
      inline.styles?.code === true &&
      typeof inline.text === 'string' &&
      ANCHOR_PATTERN.test(inline.text)
    ) {
      const chipText = acc[acc.length - 1] as { text: string };
      acc[acc.length - 1] = { ...chipText, text: chipText.text + inline.text };
      return acc;
    }
    acc.push(item);
    return acc;
  }, []);
}

// A workspace-relative path: at least one slash, an extension, and optionally
// a ":line" or ":line:col" anchor. The slash + extension requirement keeps
// prose like `application/json` or `foo/bar` as plain code.
const PATH_CODE_PATTERN = /^(?<path>[\w@.-]+(?:\/[\w@.-]+)+\.\w{1,10})(?<anchor>:\d+(?::\d+)?)?$/;

/**
 * Promote path-shaped inline code into fileLink chips — the inverse of
 * sanitizeInline, so chips survive a markdown round-trip. A line anchor
 * stays behind as code text; chips store only the file path.
 */
function promoteInline(content: unknown): unknown {
  if (!Array.isArray(content)) return content;
  return content.flatMap((item) => {
    if (typeof item !== 'object' || item === null) return [item];
    const inline = item as { type?: string; text?: string; styles?: { code?: boolean } };
    if (inline.type !== 'text' || inline.styles?.code !== true) return [item];
    const groups = inline.text?.match(PATH_CODE_PATTERN)?.groups;
    if (!groups?.path) return [item];
    const chip = { type: 'fileLink', props: { path: groups.path } };
    return groups.anchor
      ? [chip, { type: 'text', text: groups.anchor, styles: { code: true } }]
      : [chip];
  });
}

/**
 * Walk a block tree, applying `mapInline` to every inline-content array
 * (rich text and table cells) and `mapBlock` to each rebuilt block.
 */
function mapBlockTree(
  blocks: Block[],
  mapInline: (content: unknown) => unknown,
  mapBlock: (block: Block) => Block = (block) => block
): Block[] {
  return blocks.map((block) => {
    const content = (() => {
      const raw = (block as { content?: unknown }).content;
      if (Array.isArray(raw)) return mapInline(raw);
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
              if (Array.isArray(cell)) return mapInline(cell);
              if (typeof cell === 'object' && cell !== null) {
                const cellObject = cell as { content?: unknown };
                return { ...cellObject, content: mapInline(cellObject.content) };
              }
              return cell;
            }),
          })),
        };
      }
      return raw;
    })();

    const children = (block as { children?: Block[] }).children;
    return mapBlock({
      ...block,
      ...(content !== undefined && { content }),
      ...(Array.isArray(children) && { children: mapBlockTree(children, mapInline, mapBlock) }),
    } as Block);
  });
}

function sanitizeBlocks(blocks: Block[]): Block[] {
  return mapBlockTree(blocks, sanitizeInline, (block) => {
    const props = (block as { props?: unknown }).props;
    return {
      ...block,
      ...(props !== undefined && { props: sanitizeProps(block.type, props) }),
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
  return ensureIds(mapBlockTree(blocks as unknown as Block[], promoteInline));
}
