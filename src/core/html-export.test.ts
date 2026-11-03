import { describe, expect, it } from 'vitest';
import {
  type HtmlLinkResolver,
  escapeHtml,
  noteToHtml,
  renderBlocks,
  renderInline,
} from './html-export';
import type { NoteFile } from './note';

type Blocks = NoteFile['blocks'];

const text = (value: string, styles: Record<string, unknown> = {}) => ({
  type: 'text',
  text: value,
  styles,
});

const links: HtmlLinkResolver = {
  noteHref: (notePath) =>
    notePath === 'global/Published.noat.json' ? '../published-1/' : undefined,
  assetHref: (url) => (url === 'assets/shot.png' ? '../assets/shot.png' : undefined),
};

describe('escapeHtml', () => {
  it('escapes markup and quotes', () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe(
      '&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;'
    );
  });
});

describe('renderInline', () => {
  it('wraps styles and escapes text', () => {
    expect(renderInline([text('<b>', { bold: true, code: true })], links)).toBe(
      '<strong><code>&lt;b&gt;</code></strong>'
    );
  });

  it('maps named colors to classes and ignores arbitrary values', () => {
    expect(renderInline([text('hi', { textColor: 'red', backgroundColor: 'url(x)' })], links)).toBe(
      '<span class="c-red">hi</span>'
    );
  });

  it('drops unsafe link hrefs but keeps the text', () => {
    const html = renderInline(
      [
        { type: 'link', href: 'javascript:alert(1)', content: [text('bad')] },
        { type: 'link', href: 'https://example.com', content: [text('good')] },
      ],
      links
    );
    expect(html).toBe('bad<a href="https://example.com">good</a>');
  });

  it('links published notes and shows unpublished ones as unlinked chips', () => {
    const html = renderInline(
      [
        { type: 'noteLink', props: { notePath: 'global/Published.noat.json', title: 'Pub' } },
        { type: 'noteLink', props: { notePath: 'global/Private.noat.json', title: 'Priv' } },
      ],
      links
    );
    expect(html).toContain('<a class="chip" href="../published-1/">Pub</a>');
    expect(html).toContain('<span class="chip">Priv</span>');
  });

  it('renders file links as code and math with KaTeX', () => {
    const html = renderInline(
      [
        { type: 'fileLink', props: { path: 'src/a.ts' } },
        { type: 'math', props: { latex: 'x^2' } },
      ],
      links
    );
    expect(html).toContain('<code class="chip">src/a.ts</code>');
    expect(html).toContain('class="katex"');
  });
});

describe('renderBlocks', () => {
  it('groups consecutive list items into one list', () => {
    const html = renderBlocks(
      [
        { id: 'a', type: 'bulletListItem', content: [text('one')] },
        { id: 'b', type: 'bulletListItem', content: [text('two')] },
        { id: 'c', type: 'numberedListItem', content: [text('first')] },
      ] as unknown as Blocks,
      links
    );
    expect(html).toBe(
      '<ul><li id="a">one</li><li id="b">two</li></ul>\n<ol><li id="c">first</li></ol>'
    );
  });

  it('gives every block its id as an anchor', () => {
    const html = renderBlocks(
      [
        { id: 'h1', type: 'heading', props: { level: 1 }, content: [text('Title')] },
      ] as unknown as Blocks,
      links
    );
    expect(html).toBe('<h2 id="h1">Title</h2>');
  });

  it('renders checklists, toggles, code, and tables', () => {
    const html = renderBlocks(
      [
        { id: 'k', type: 'checkListItem', props: { checked: true }, content: [text('done')] },
        {
          id: 't',
          type: 'toggleListItem',
          content: [text('More')],
          children: [{ id: 'tc', type: 'paragraph', content: [text('hidden')] }],
        },
        { id: 'code', type: 'codeBlock', props: { language: 'ts' }, content: [text('a < b')] },
        {
          id: 'tbl',
          type: 'table',
          content: {
            type: 'tableContent',
            headerRows: 1,
            rows: [{ cells: [[text('H')]] }, { cells: [[text('v')]] }],
          },
        },
      ] as unknown as Blocks,
      links
    );
    expect(html).toContain('<input type="checkbox" disabled checked>');
    expect(html).toContain('<details id="t" class="toggle"><summary>More</summary>');
    expect(html).toContain('<pre id="code"><code class="language-ts">a &lt; b</code></pre>');
    expect(html).toContain('<tr><th>H</th></tr><tr><td>v</td></tr>');
  });

  it('resolves store assets and marks missing media', () => {
    const html = renderBlocks(
      [
        { id: 'i', type: 'image', props: { url: 'assets/shot.png', caption: 'Shot' } },
        { id: 'j', type: 'image', props: { url: 'assets/gone.png', name: 'gone.png' } },
      ] as unknown as Blocks,
      links
    );
    expect(html).toContain('<img src="../assets/shot.png" alt="Shot" loading="lazy">');
    expect(html).toContain('<figcaption>Shot</figcaption>');
    expect(html).toContain('[image: gone.png]');
  });
});

describe('noteToHtml', () => {
  it('builds a full page with title, description and only-when-needed KaTeX css', () => {
    const page = noteToHtml(
      {
        title: 'Deploy <notes>',
        icon: '🚀',
        updatedAt: '2026-11-03T12:00:00.000Z',
        blocks: [{ id: 'p', type: 'paragraph', content: [text('Ship it.')] }] as unknown as Blocks,
      },
      links
    );
    expect(page).toContain('<title>Deploy &lt;notes&gt;</title>');
    expect(page).toContain('<meta name="description" content="Ship it.">');
    expect(page).toContain('<div class="icon">🚀</div>');
    expect(page).toContain('Updated 2026-11-03');
    expect(page).not.toContain('katex.min.css');
  });
});
