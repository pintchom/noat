import { describe, expect, it } from 'vitest';
import type { NoteFile } from './note';
import { blocksToPlainText, blocksToSections, extractComments, sliceSection } from './note-text';

type Blocks = NoteFile['blocks'];

function heading(id: string, level: number, text: string): Blocks[number] {
  return { id, type: 'heading', props: { level }, content: [{ type: 'text', text, styles: {} }] };
}

function paragraph(id: string, text: string): Blocks[number] {
  return { id, type: 'paragraph', content: [{ type: 'text', text, styles: {} }] };
}

const blocks: Blocks = [
  paragraph('p0', 'intro text'),
  heading('h1', 2, '1. Setup'),
  paragraph('p1', 'setup body'),
  heading('h1a', 3, '1.1 Env vars'),
  paragraph('p1a', 'env body'),
  heading('h2', 2, '2. Payments'),
  paragraph('p2', 'payments body'),
  heading('h2a', 3, '2.1 Stripe'),
  paragraph('p2a', 'stripe body'),
];

describe('sliceSection', () => {
  it('slices a section including its sub-sections', () => {
    const slice = sliceSection(blocks, '1. Setup');
    expect(slice.kind).toBe('match');
    if (slice.kind !== 'match') return;
    expect(slice.heading).toBe('1. Setup');
    expect(slice.blocks.map((b) => b.id)).toEqual(['h1', 'p1', 'h1a', 'p1a']);
  });

  it('slices a sub-section up to the next heading of any higher level', () => {
    const slice = sliceSection(blocks, '1.1 Env vars');
    expect(slice.kind).toBe('match');
    if (slice.kind !== 'match') return;
    expect(slice.blocks.map((b) => b.id)).toEqual(['h1a', 'p1a']);
  });

  it('runs the last section to the end of the note', () => {
    const slice = sliceSection(blocks, '2.1 Stripe');
    expect(slice.kind).toBe('match');
    if (slice.kind !== 'match') return;
    expect(slice.blocks.map((b) => b.id)).toEqual(['h2a', 'p2a']);
  });

  it('matches case-insensitively and by unique prefix', () => {
    const slice = sliceSection(blocks, '2. payments');
    expect(slice.kind).toBe('match');
    const prefix = sliceSection(blocks, '2.1');
    expect(prefix.kind).toBe('match');
    if (prefix.kind !== 'match') return;
    expect(prefix.heading).toBe('2.1 Stripe');
  });

  it('prefers an exact match over prefix matches', () => {
    const withOverlap: Blocks = [
      heading('a', 2, '1'),
      paragraph('pa', 'x'),
      heading('b', 2, '1. More'),
    ];
    const slice = sliceSection(withOverlap, '1');
    expect(slice.kind).toBe('match');
    if (slice.kind !== 'match') return;
    expect(slice.heading).toBe('1');
  });

  it('reports ambiguous prefixes with the candidates', () => {
    const slice = sliceSection(blocks, '1');
    expect(slice.kind).toBe('ambiguous');
    if (slice.kind !== 'ambiguous') return;
    expect(slice.candidates).toEqual(['1. Setup', '1.1 Env vars']);
  });

  it('reports a miss with the available headings', () => {
    const slice = sliceSection(blocks, 'refunds');
    expect(slice.kind).toBe('not-found');
    if (slice.kind !== 'not-found') return;
    expect(slice.headings).toContain('2. Payments');
  });

  it('handles notes without headings', () => {
    const slice = sliceSection([paragraph('p', 'just text')], 'anything');
    expect(slice.kind).toBe('not-found');
    if (slice.kind !== 'not-found') return;
    expect(slice.headings).toEqual([]);
  });
});

describe('sliceSection block range', () => {
  it('exposes the top-level range a match covers', () => {
    const slice = sliceSection(blocks, '1. Setup');
    expect(slice.kind).toBe('match');
    if (slice.kind !== 'match') return;
    expect(slice.start).toBe(1);
    expect(slice.end).toBe(5);
    expect(blocks.slice(slice.start, slice.end)).toEqual(slice.blocks);
  });

  it('runs the last section range to the end of the note', () => {
    const slice = sliceSection(blocks, '2.1 Stripe');
    expect(slice.kind).toBe('match');
    if (slice.kind !== 'match') return;
    expect(slice.end).toBe(blocks.length);
  });
});

describe('extractComments', () => {
  function comment(id: string, text: string): Blocks[number] {
    return { id, type: 'comment', props: {}, content: [{ type: 'text', text, styles: {} }] };
  }

  it('reports each comment with its section and anchor text', () => {
    const withComments: Blocks = [
      heading('h1', 2, '1. Setup'),
      paragraph('p1', 'setup body'),
      comment('c1', 'this is too vague'),
      heading('h2', 2, '2. Payments'),
      comment('c2', 'why Stripe over Adyen?'),
    ];
    expect(extractComments(withComments)).toEqual([
      { section: '1. Setup', after: 'setup body', text: 'this is too vague' },
      { section: '2. Payments', after: '2. Payments', text: 'why Stripe over Adyen?' },
    ]);
  });

  it('uses an empty section for comments before any heading', () => {
    const withComments: Blocks = [
      paragraph('p0', 'intro'),
      comment('c1', 'add context here'),
      heading('h1', 2, '1. Setup'),
    ];
    expect(extractComments(withComments)).toEqual([
      { section: '', after: 'intro', text: 'add context here' },
    ]);
  });

  it('finds comments nested under other blocks', () => {
    const withComments: Blocks = [
      heading('h1', 2, '1. Setup'),
      {
        ...paragraph('p1', 'parent item'),
        children: [comment('c1', 'nested feedback')],
      },
    ];
    expect(extractComments(withComments)).toEqual([
      { section: '1. Setup', after: 'parent item', text: 'nested feedback' },
    ]);
  });

  it('caps anchor snippets', () => {
    const long = 'x'.repeat(500);
    const withComments: Blocks = [paragraph('p1', long), comment('c1', 'trim')];
    const [entry] = extractComments(withComments);
    expect(entry?.after.length).toBeLessThanOrEqual(160);
  });

  it('returns an empty list for a note without comments', () => {
    expect(extractComments(blocks)).toEqual([]);
  });
});

describe('blocksToSections', () => {
  it('splits on headings and keeps the pre-heading text', () => {
    const sections = blocksToSections(blocks);
    expect(sections.map((s) => s.heading)).toEqual([
      '',
      '1. Setup',
      '1.1 Env vars',
      '2. Payments',
      '2.1 Stripe',
    ]);
    expect(sections[0]?.text).toBe('intro text');
  });
});

describe('blocksToPlainText', () => {
  it('extracts fileLink paths and noteLink titles', () => {
    const withChips: Blocks = [
      {
        id: 'p',
        type: 'paragraph',
        content: [
          { type: 'text', text: 'See ', styles: {} },
          {
            type: 'noteLink',
            props: { notePath: 'global/Ideas.noat.json', title: 'Ideas', icon: '' },
          },
          { type: 'text', text: ' and ', styles: {} },
          { type: 'fileLink', props: { path: 'src/core/note.ts' } },
        ],
      },
    ];
    expect(blocksToPlainText(withChips)).toBe('See Ideas and src/core/note.ts');
  });
});
