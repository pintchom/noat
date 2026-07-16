import { describe, expect, it } from 'vitest';
import type { NoteFile } from './note';
import { blocksToPlainText, blocksToSections, sliceSection } from './note-text';

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
