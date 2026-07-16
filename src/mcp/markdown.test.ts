import { describe, expect, it } from 'vitest';
import type { NoteFile } from '../core/note';
import { blocksToMarkdown, markdownToBlocks } from './markdown';

type Block = NoteFile['blocks'][number];

interface InlineItem {
  type?: string;
  text?: string;
  styles?: { code?: boolean };
  props?: { path?: string };
}

/** Flatten every inline item in a block tree (rich text and table cells). */
function allInline(blocks: Block[]): InlineItem[] {
  return blocks.flatMap((block) => {
    const raw = (block as { content?: unknown }).content;
    const own = (() => {
      if (Array.isArray(raw)) return raw as InlineItem[];
      if (
        typeof raw === 'object' &&
        raw !== null &&
        (raw as { type?: string }).type === 'tableContent'
      ) {
        const table = raw as { rows?: Array<{ cells?: unknown[] }> };
        return (table.rows ?? []).flatMap((row) =>
          (row.cells ?? []).flatMap((cell) => {
            if (Array.isArray(cell)) return cell as InlineItem[];
            const content = (cell as { content?: unknown })?.content;
            return Array.isArray(content) ? (content as InlineItem[]) : [];
          })
        );
      }
      return [];
    })();
    const children = (block as { children?: Block[] }).children;
    return [...own, ...(Array.isArray(children) ? allInline(children) : [])];
  });
}

const chips = (blocks: Block[]) => allInline(blocks).filter((item) => item.type === 'fileLink');

describe('markdownToBlocks fileLink promotion', () => {
  it('promotes path-shaped inline code to a fileLink chip', async () => {
    const blocks = await markdownToBlocks('See `src/core/store.ts` for details.');
    expect(chips(blocks).map((chip) => chip.props?.path)).toEqual(['src/core/store.ts']);
  });

  it('splits a line anchor into chip + code text', async () => {
    const blocks = await markdownToBlocks('Fix `src/core/store.ts:42` first.');
    const inline = allInline(blocks);
    const chipIndex = inline.findIndex((item) => item.type === 'fileLink');
    expect(inline[chipIndex]?.props?.path).toBe('src/core/store.ts');
    expect(inline[chipIndex + 1]).toMatchObject({
      type: 'text',
      text: ':42',
      styles: { code: true },
    });
  });

  it('handles line:column anchors', async () => {
    const blocks = await markdownToBlocks('At `src/mcp/server.ts:42:7`.');
    const inline = allInline(blocks);
    expect(chips(blocks)[0]?.props?.path).toBe('src/mcp/server.ts');
    expect(inline.some((item) => item.text === ':42:7' && item.styles?.code)).toBe(true);
  });

  it('promotes inside list items and nested children', async () => {
    const blocks = await markdownToBlocks(
      '- update `src/mcp/server.ts`\n  - and `src/core/note.ts`'
    );
    expect(chips(blocks).map((chip) => chip.props?.path)).toEqual([
      'src/mcp/server.ts',
      'src/core/note.ts',
    ]);
  });

  it('promotes inside table cells', async () => {
    const blocks = await markdownToBlocks('| file |\n| --- |\n| `src/core/git.ts` |');
    expect(chips(blocks).map((chip) => chip.props?.path)).toEqual(['src/core/git.ts']);
  });

  it.each([
    ['MIME type', '`application/json`'],
    ['no extension', '`foo/bar`'],
    ['no slash', '`package.json`'],
    ['URL', '`https://x.com/a.ts`'],
    ['code expression', '`const x = 1`'],
  ])('leaves %s as plain inline code', async (_label, markdown) => {
    const blocks = await markdownToBlocks(`Some ${markdown} here.`);
    expect(chips(blocks)).toEqual([]);
  });

  it('leaves fenced code blocks untouched', async () => {
    const blocks = await markdownToBlocks('```ts\nimport "src/core/store.ts";\n```');
    expect(chips(blocks)).toEqual([]);
    expect(blocks[0]?.type).toBe('codeBlock');
  });

  it('leaves paths in plain (non-code) prose untouched', async () => {
    const blocks = await markdownToBlocks('The file src/core/store.ts is central.');
    expect(chips(blocks)).toEqual([]);
  });

  it('keeps valid ids on every block', async () => {
    const blocks = await markdownToBlocks('# Plan\n\n- [ ] edit `src/mcp/markdown.ts:10`');
    const collectIds = (tree: Block[]): string[] =>
      tree.flatMap((block) => [
        block.id,
        ...collectIds(((block as { children?: Block[] }).children ?? []) as Block[]),
      ]);
    for (const id of collectIds(blocks)) {
      expect(typeof id).toBe('string');
      expect(id.length).toBeGreaterThan(0);
    }
  });

  it('round-trips chips through markdown losslessly', async () => {
    const original = await markdownToBlocks(
      'Start at `src/core/store.ts:42` and `src/mcp/server.ts`.'
    );
    const markdown = await blocksToMarkdown(original);
    expect(markdown).toContain('`src/core/store.ts:42`');
    expect(markdown).toContain('`src/mcp/server.ts`');
    const reparsed = await markdownToBlocks(markdown);
    expect(chips(reparsed).map((chip) => chip.props?.path)).toEqual(
      chips(original).map((chip) => chip.props?.path)
    );
  });
});

describe('blocksToMarkdown noteLink chips', () => {
  it('renders a noteLink chip as its title text', async () => {
    const blocks = [
      {
        id: 'b1',
        type: 'paragraph',
        content: [
          { type: 'text', text: 'See ', styles: {} },
          {
            type: 'noteLink',
            props: { notePath: 'global/Ideas.noat.json', title: 'Ideas', icon: '' },
          },
          { type: 'text', text: ' for context.', styles: {} },
        ],
      },
    ] as unknown as NoteFile['blocks'];
    const markdown = await blocksToMarkdown(blocks);
    expect(markdown).toContain('See Ideas for context.');
  });
});
