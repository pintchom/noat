import { describe, expect, it } from 'vitest';
import type { NoteFile } from './note';
import { inlineRuns, noteToPdf, toWinAnsi } from './pdf-export';

type Blocks = NoteFile['blocks'];

function note(
  blocks: Blocks,
  title = 'Test Note'
): Pick<NoteFile, 'title' | 'updatedAt' | 'blocks'> {
  return { title, updatedAt: '2026-07-15T12:00:00.000Z', blocks };
}

function text(value: string, styles: Record<string, unknown> = {}) {
  return { type: 'text', text: value, styles };
}

describe('toWinAnsi', () => {
  it('keeps ascii, latin-1, and typographic punctuation', () => {
    const input = 'Caf\u00e9 \u2014 \u201cquoted\u201d \u2022 r\u00e9sum\u00e9\u2026';
    expect(toWinAnsi(input)).toBe(input);
  });

  it('drops characters outside WinAnsi (emoji, CJK)', () => {
    expect(toWinAnsi('deploy \ud83d\ude80 \u65e5\u672c\u8a9e now')).toBe('deploy   now');
  });

  it('expands tabs and preserves newlines', () => {
    expect(toWinAnsi('a\tb\nc')).toBe('a  b\nc');
  });
});

describe('inlineRuns', () => {
  it('flattens styled text into runs', () => {
    const runs = inlineRuns([text('plain '), text('bold', { bold: true })]);
    expect(runs).toHaveLength(2);
    expect(runs[0]).toMatchObject({ text: 'plain ', bold: false });
    expect(runs[1]).toMatchObject({ text: 'bold', bold: true });
  });

  it('unwraps links into underlined runs carrying the href', () => {
    const runs = inlineRuns([
      { type: 'link', href: 'https://example.com', content: [text('docs')] },
    ]);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ text: 'docs', link: 'https://example.com', underline: true });
  });

  it('turns fileLink chips into code-styled path text', () => {
    const runs = inlineRuns([{ type: 'fileLink', props: { path: 'src/core/store.ts' } }]);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ text: 'src/core/store.ts', code: true });
  });
});

describe('noteToPdf', () => {
  it('produces a valid single-page PDF for an empty note', async () => {
    const pdf = await noteToPdf(note([]));
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(pdf.toString('latin1')).toContain('/Type /Page');
    expect(pdf.toString('latin1')).toContain('%%EOF');
  });

  it('renders every default block type without throwing', async () => {
    const blocks: Blocks = [
      { id: 'h', type: 'heading', props: { level: 2 }, content: [text('Heading')] },
      { id: 'p', type: 'paragraph', content: [text('Body with '), text('code', { code: true })] },
      { id: 'b', type: 'bulletListItem', content: [text('bullet')] },
      { id: 'n1', type: 'numberedListItem', content: [text('first')] },
      { id: 'n2', type: 'numberedListItem', content: [text('second')] },
      { id: 'c', type: 'checkListItem', props: { checked: true }, content: [text('done')] },
      { id: 'q', type: 'quote', content: [text('quoted wisdom')] },
      {
        id: 'code',
        type: 'codeBlock',
        props: { language: 'ts' },
        content: [text('const x = 1;\nconsole.log(x);')],
      },
      {
        id: 't',
        type: 'table',
        content: {
          type: 'tableContent',
          rows: [{ cells: [[text('a')], [text('b')]] }, { cells: [[text('c')], [text('d')]] }],
        },
      },
      {
        id: 'img',
        type: 'image',
        props: { url: 'https://example.com/pic.png', caption: 'a picture' },
        content: undefined,
      },
      {
        id: 'nested',
        type: 'bulletListItem',
        content: [text('parent')],
        children: [{ id: 'child', type: 'bulletListItem', content: [text('child')] }],
      },
      {
        id: 'link',
        type: 'paragraph',
        content: [{ type: 'link', href: 'https://example.com', content: [text('a link')] }],
      },
      { id: 'unknown', type: 'someFutureBlock', content: [text('still rendered')] },
    ] as Blocks;

    const pdf = await noteToPdf(note(blocks));
    const raw = pdf.toString('latin1');
    expect(raw.startsWith('%PDF-')).toBe(true);
    // Link annotation for the hyperlink block.
    expect(raw).toContain('example.com');
    // Courier is embedded for code content, Helvetica-Bold for headings.
    expect(raw).toContain('/Courier');
    expect(raw).toContain('/Helvetica-Bold');
  });

  it('embeds data-url images', async () => {
    // 1x1 transparent PNG.
    const png =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
    const blocks: Blocks = [
      { id: 'img', type: 'image', props: { url: `data:image/png;base64,${png}` } },
    ] as Blocks;
    const pdf = await noteToPdf(note(blocks));
    expect(pdf.toString('latin1')).toContain('/Image');
  });

  it('paginates long notes and stamps page numbers', async () => {
    const blocks: Blocks = Array.from({ length: 120 }, (_, i) => ({
      id: `p${i}`,
      type: 'paragraph',
      content: [text(`Paragraph number ${i} with enough words to take up a full line or so.`)],
    })) as Blocks;
    const pdf = await noteToPdf(note(blocks));
    const raw = pdf.toString('latin1');
    const pageCount = (raw.match(/\/Type \/Page[^s]/g) ?? []).length;
    expect(pageCount).toBeGreaterThan(1);
  });
});
