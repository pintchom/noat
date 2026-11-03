import { describe, expect, it } from 'vitest';
import { blockLinkLabel, findBlock } from './block-links';
import type { NoteFile } from './note';

type Blocks = NoteFile['blocks'];

const text = (value: string) => [{ type: 'text', text: value, styles: {} }];

const blocks = [
  { id: 'a', type: 'heading', content: text('Deploy steps') },
  {
    id: 'b',
    type: 'bulletListItem',
    content: text('Parent item'),
    children: [{ id: 'c', type: 'paragraph', content: text('Nested child') }],
  },
  { id: 'd', type: 'paragraph', content: [] },
  { id: 'e', type: 'image', props: { url: 'assets/x.png' } },
] as unknown as Blocks;

describe('findBlock', () => {
  it('finds top-level and nested blocks by id', () => {
    expect(findBlock(blocks, 'a')?.type).toBe('heading');
    expect(findBlock(blocks, 'c')?.type).toBe('paragraph');
  });

  it('returns undefined for unknown ids', () => {
    expect(findBlock(blocks, 'nope')).toBeUndefined();
  });
});

describe('blockLinkLabel', () => {
  it("uses the block's own text, not its children", () => {
    const parent = findBlock(blocks, 'b');
    expect(parent && blockLinkLabel(parent)).toBe('Parent item');
  });

  it('falls back for blocks without text', () => {
    const empty = findBlock(blocks, 'd');
    const image = findBlock(blocks, 'e');
    expect(empty && blockLinkLabel(empty)).toBe('Empty line');
    expect(image && blockLinkLabel(image)).toBe('image');
  });

  it('truncates long lines', () => {
    const long = { id: 'l', type: 'paragraph', content: text('x'.repeat(100)) } as Blocks[number];
    const label = blockLinkLabel(long);
    expect(label.length).toBe(48);
    expect(label.endsWith('…')).toBe(true);
  });
});
