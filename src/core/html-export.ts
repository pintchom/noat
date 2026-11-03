import katex from 'katex';
import { normalizeNoteIcon } from './display-icons';
import type { NoteFile } from './note';
import { blocksToPlainText } from './note-text';

type Block = NoteFile['blocks'][number];

export interface HtmlLinkResolver {
  /** Public href for a linked note, or undefined when it isn't published. */
  noteHref(notePath: string): string | undefined;
  /** Public href for a store asset URL ("assets/<file>"), or undefined if unavailable. */
  assetHref(url: string): string | undefined;
}

const COLOR_NAMES = new Set([
  'gray',
  'brown',
  'red',
  'orange',
  'yellow',
  'green',
  'blue',
  'purple',
  'pink',
]);

const DESCRIPTION_MAX_CHARS = 160;

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Only hrefs that can't run script: web, mail, and in-page anchors. */
function safeHref(href: string | undefined): string | undefined {
  const trimmed = href?.trim() ?? '';
  return /^(https?:|mailto:|#)/i.test(trimmed) ? trimmed : undefined;
}

/** Media sources: web URLs, inline images, or resolved store assets. */
function mediaSrc(url: string, links: HtmlLinkResolver): string | undefined {
  if (/^https?:/i.test(url) || /^data:(image|video|audio)\//i.test(url)) return url;
  return links.assetHref(url);
}

/**
 * KaTeX under the default `trust: false` emits no raw HTML from the LaTeX
 * (`\href` and friends become error text), so its output is safe to inline.
 */
function renderMath(latex: string, displayMode: boolean): string {
  return katex.renderToString(latex, { throwOnError: false, displayMode });
}

function colorClasses(textColor: unknown, backgroundColor: unknown): string[] {
  return [
    typeof textColor === 'string' && COLOR_NAMES.has(textColor) ? `c-${textColor}` : '',
    typeof backgroundColor === 'string' && COLOR_NAMES.has(backgroundColor)
      ? `bg-${backgroundColor}`
      : '',
  ].filter((name) => name.length > 0);
}

function renderText(text: string, styles: Record<string, unknown>): string {
  const body = escapeHtml(text).replace(/\n/g, '<br>');
  const wrapped = (
    [
      ['code', 'code'],
      ['bold', 'strong'],
      ['italic', 'em'],
      ['underline', 'u'],
      ['strike', 's'],
      ['superscript', 'sup'],
      ['subscript', 'sub'],
    ] as const
  ).reduce(
    (html, [style, tag]) => (styles[style] === true ? `<${tag}>${html}</${tag}>` : html),
    body
  );
  const classes = colorClasses(styles.textColor, styles.backgroundColor);
  return classes.length > 0 ? `<span class="${classes.join(' ')}">${wrapped}</span>` : wrapped;
}

export function renderInline(content: unknown, links: HtmlLinkResolver): string {
  if (!Array.isArray(content)) return '';
  return content
    .map((item) => {
      if (typeof item !== 'object' || item === null) return '';
      const inline = item as {
        type?: string;
        text?: string;
        href?: string;
        content?: unknown;
        styles?: Record<string, unknown>;
        props?: Record<string, string | undefined>;
      };
      const props = inline.props ?? {};
      switch (inline.type) {
        case 'link': {
          const href = safeHref(inline.href);
          const inner = renderInline(inline.content, links);
          return href ? `<a href="${escapeHtml(href)}">${inner}</a>` : inner;
        }
        case 'fileLink':
          return `<code class="chip">${escapeHtml(props.path ?? '')}</code>`;
        case 'noteLink': {
          const href = links.noteHref(props.notePath ?? '');
          const icon = normalizeNoteIcon(props.icon);
          const label = `${icon ? `${icon} ` : ''}${escapeHtml(props.title || 'Untitled')}`;
          return href
            ? `<a class="chip" href="${escapeHtml(href)}">${label}</a>`
            : `<span class="chip">${label}</span>`;
        }
        case 'blockLink':
          return `<a class="chip" href="#${escapeHtml(props.blockId ?? '')}">↳ ${escapeHtml(props.label ?? '')}</a>`;
        case 'math':
          return renderMath(props.latex ?? '', false);
        default:
          return typeof inline.text === 'string'
            ? renderText(inline.text, inline.styles ?? {})
            : '';
      }
    })
    .join('');
}

type BlockProps = Record<string, unknown> & {
  level?: number;
  checked?: boolean;
  isToggleable?: boolean;
  language?: string;
  textAlignment?: string;
  textColor?: string;
  backgroundColor?: string;
  url?: string;
  name?: string;
  caption?: string;
  previewWidth?: number;
  latex?: string;
  start?: number;
};

function propsOf(block: Block): BlockProps {
  const props = (block as { props?: unknown }).props;
  return typeof props === 'object' && props !== null ? (props as BlockProps) : {};
}

function childrenOf(block: Block): Block[] {
  const children = (block as { children?: Block[] }).children;
  return Array.isArray(children) ? children : [];
}

/** `id`, color classes and alignment shared by every rendered block. */
function blockAttrs(block: Block, extraClass?: string): string {
  const props = propsOf(block);
  const classes = [
    extraClass ?? '',
    ...colorClasses(props.textColor, props.backgroundColor),
  ].filter((name) => name.length > 0);
  const align =
    props.textAlignment && props.textAlignment !== 'left' && /^[a-z]+$/.test(props.textAlignment)
      ? ` style="text-align:${props.textAlignment}"`
      : '';
  const classAttr = classes.length > 0 ? ` class="${classes.join(' ')}"` : '';
  return ` id="${escapeHtml(block.id)}"${classAttr}${align}`;
}

function plainCode(content: unknown): string {
  if (!Array.isArray(content)) return '';
  return content
    .map((item) =>
      typeof (item as { text?: unknown }).text === 'string' ? (item as { text: string }).text : ''
    )
    .join('');
}

function renderTable(content: unknown, links: HtmlLinkResolver): string {
  const table = content as { rows?: Array<{ cells?: unknown[] }>; headerRows?: number };
  const headerRows = table.headerRows ?? 0;
  const rows = (table.rows ?? []).map((row, rowIndex) => {
    const tag = rowIndex < headerRows ? 'th' : 'td';
    const cells = (row.cells ?? []).map((cell) => {
      const inner = Array.isArray(cell)
        ? renderInline(cell, links)
        : renderInline((cell as { content?: unknown } | null)?.content, links);
      return `<${tag}>${inner}</${tag}>`;
    });
    return `<tr>${cells.join('')}</tr>`;
  });
  return `<div class="table-wrap"><table>${rows.join('')}</table></div>`;
}

function renderMedia(block: Block, links: HtmlLinkResolver): string {
  const props = propsOf(block);
  const src = mediaSrc(props.url ?? '', links);
  const caption = props.caption ? `<figcaption>${escapeHtml(props.caption)}</figcaption>` : '';
  const width =
    typeof props.previewWidth === 'number' && props.previewWidth > 0
      ? ` style="width:${Math.round(props.previewWidth)}px"`
      : '';
  const label = escapeHtml(props.name || props.caption || block.type);
  const media = (() => {
    if (!src) return `<span class="missing">[${escapeHtml(block.type)}: ${label}]</span>`;
    const attr = escapeHtml(src);
    if (block.type === 'image') return `<img src="${attr}" alt="${label}"${width} loading="lazy">`;
    if (block.type === 'video') return `<video src="${attr}" controls${width}></video>`;
    if (block.type === 'audio') return `<audio src="${attr}" controls></audio>`;
    return `<a class="file" href="${attr}">📎 ${label}</a>`;
  })();
  return `<figure${blockAttrs(block)}>${media}${caption}</figure>`;
}

const LIST_TAGS: Record<string, 'ul' | 'ol'> = {
  bulletListItem: 'ul',
  numberedListItem: 'ol',
  checkListItem: 'ul',
};

function renderListItem(block: Block, links: HtmlLinkResolver): string {
  const props = propsOf(block);
  const inner = renderInline((block as { content?: unknown }).content, links);
  const nested = renderBlocks(childrenOf(block), links);
  if (block.type === 'checkListItem') {
    const checked = props.checked === true;
    return `<li${blockAttrs(block, checked ? 'checked' : undefined)}><input type="checkbox" disabled${
      checked ? ' checked' : ''
    }><span>${inner}</span>${nested}</li>`;
  }
  return `<li${blockAttrs(block)}>${inner}${nested}</li>`;
}

function renderBlock(block: Block, links: HtmlLinkResolver): string {
  const props = propsOf(block);
  const content = (block as { content?: unknown }).content;
  const inner = renderInline(content, links);
  const children = childrenOf(block);
  const nested =
    children.length > 0 ? `<div class="children">${renderBlocks(children, links)}</div>` : '';

  switch (block.type) {
    case 'heading': {
      const level = Math.min(Math.max(Number(props.level) || 1, 1), 6);
      // The page title is the h1, so note headings start at h2.
      const tag = `h${Math.min(level + 1, 6)}`;
      const heading = `<${tag}${blockAttrs(block)}>${inner}</${tag}>`;
      return props.isToggleable
        ? `<details class="toggle" open><summary>${heading}</summary>${nested}</details>`
        : `${heading}${nested}`;
    }
    case 'toggleListItem':
      return `<details${blockAttrs(block, 'toggle')}><summary>${inner}</summary>${nested}</details>`;
    case 'quote':
      return `<blockquote${blockAttrs(block)}>${inner}</blockquote>${nested}`;
    case 'codeBlock': {
      const language = /^[\w+-]+$/.test(props.language ?? '') ? props.language : '';
      return `<pre${blockAttrs(block)}><code${
        language ? ` class="language-${language}"` : ''
      }>${escapeHtml(plainCode(content))}</code></pre>${nested}`;
    }
    case 'equation':
      return `<div${blockAttrs(block, 'equation')}>${renderMath(props.latex ?? '', true)}</div>${nested}`;
    case 'table':
      return renderTable(content, links);
    case 'image':
    case 'video':
    case 'audio':
    case 'file':
      return renderMedia(block, links) + nested;
    case 'divider':
      return `<hr${blockAttrs(block)}>`;
    case 'pageBreak':
      return '';
    default:
      return `<p${blockAttrs(block, inner.length === 0 ? 'empty' : undefined)}>${inner}</p>${nested}`;
  }
}

/** Render sibling blocks, grouping consecutive list items into one list. */
export function renderBlocks(blocks: Block[], links: HtmlLinkResolver): string {
  const out: string[] = [];
  let index = 0;
  while (index < blocks.length) {
    const block = blocks[index] as Block;
    const tag = LIST_TAGS[block.type];
    if (!tag) {
      out.push(renderBlock(block, links));
      index += 1;
      continue;
    }
    const items: Block[] = [];
    while (index < blocks.length && (blocks[index] as Block).type === block.type) {
      items.push(blocks[index] as Block);
      index += 1;
    }
    const start = Number(propsOf(block).start);
    const startAttr =
      tag === 'ol' && Number.isInteger(start) && start > 1 ? ` start="${start}"` : '';
    const listClass = block.type === 'checkListItem' ? ' class="checklist"' : '';
    out.push(
      `<${tag}${listClass}${startAttr}>${items.map((item) => renderListItem(item, links)).join('')}</${tag}>`
    );
  }
  return out.join('\n');
}

function hasMath(blocks: Block[]): boolean {
  return JSON.stringify(blocks).match(/"type":"(math|equation)"/) !== null;
}

/** A note as a complete, standalone web page. */
export function noteToHtml(
  note: Pick<NoteFile, 'title' | 'icon' | 'updatedAt' | 'blocks'>,
  links: HtmlLinkResolver
): string {
  const title = note.title.trim() || 'Untitled';
  const icon = normalizeNoteIcon(note.icon);
  const plain = blocksToPlainText(note.blocks).replace(/\s+/g, ' ').trim();
  const description =
    plain.length > DESCRIPTION_MAX_CHARS
      ? `${plain.slice(0, DESCRIPTION_MAX_CHARS - 1).trimEnd()}…`
      : plain;
  const katexCss = hasMath(note.blocks)
    ? `\n  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@${katex.version}/dist/katex.min.css" crossorigin="anonymous">`
    : '';
  const body =
    note.blocks.length > 0
      ? renderBlocks(note.blocks, links)
      : '<p class="empty-note">This page is empty.</p>';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="${escapeHtml(description)}">
  <meta property="og:title" content="${escapeHtml(title)}">
  <meta property="og:description" content="${escapeHtml(description)}">
  <meta property="og:type" content="article">
  <meta name="generator" content="NOAT">${
    icon
      ? `\n  <link rel="icon" href="data:image/svg+xml,${encodeURIComponent(
          `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90">${icon}</text></svg>`
        )}">`
      : ''
  }${katexCss}
  <style>${PAGE_CSS}</style>
</head>
<body>
  <main>
    <header>
      ${icon ? `<div class="icon">${icon}</div>` : ''}
      <h1>${escapeHtml(title)}</h1>
    </header>
    <article>
${body}
    </article>
    <footer>Published with NOAT · Updated ${escapeHtml(note.updatedAt.slice(0, 10))}</footer>
  </main>
</body>
</html>
`;
}

const PAGE_CSS = `
:root {
  color-scheme: light dark;
  --fg: #37352f; --muted: #787774; --bg: #ffffff; --soft: #f7f6f3; --line: #e9e9e7; --link: #0b6e99;
  --flash: rgba(255, 212, 0, 0.35);
  --c-gray: #9b9a97; --c-brown: #64473a; --c-red: #e03e3e; --c-orange: #d9730d; --c-yellow: #dfab01;
  --c-green: #4d6461; --c-blue: #0b6e99; --c-purple: #6940a5; --c-pink: #ad1a72;
  --bg-gray: #ebeced; --bg-brown: #e9e5e3; --bg-red: #fbe4e4; --bg-orange: #f6e9d9; --bg-yellow: #fbf3db;
  --bg-green: #ddedea; --bg-blue: #ddebf1; --bg-purple: #eae4f2; --bg-pink: #f4dfeb;
}
@media (prefers-color-scheme: dark) {
  :root {
    --fg: #e6e6e4; --muted: #9b9b98; --bg: #191919; --soft: #252525; --line: #333333; --link: #529cca;
    --flash: rgba(255, 212, 0, 0.2);
    --c-gray: #9b9b9b; --c-brown: #ba856f; --c-red: #ff7369; --c-orange: #ffa344; --c-yellow: #ffdc49;
    --c-green: #4dab9a; --c-blue: #529cca; --c-purple: #9a6dd7; --c-pink: #e255a1;
    --bg-gray: #454b4e; --bg-brown: #434040; --bg-red: #594141; --bg-orange: #594a3a; --bg-yellow: #59563b;
    --bg-green: #354c4b; --bg-blue: #364954; --bg-purple: #443f57; --bg-pink: #533b4c;
  }
}
* { box-sizing: border-box; }
html { scroll-behavior: smooth; }
body {
  margin: 0; background: var(--bg); color: var(--fg);
  font: 16px/1.6 ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
  -webkit-font-smoothing: antialiased;
}
main { max-width: 760px; margin: 0 auto; padding: 72px 24px 96px; }
header .icon { font-size: 64px; line-height: 1; margin-bottom: 12px; }
h1 { font-size: 2.5em; line-height: 1.2; margin: 0 0 24px; font-weight: 700; }
h2, h3, h4, h5, h6 { line-height: 1.3; margin: 1.6em 0 0.4em; font-weight: 600; }
h2 { font-size: 1.875em; } h3 { font-size: 1.5em; } h4 { font-size: 1.25em; } h5, h6 { font-size: 1.1em; }
p { margin: 0.2em 0; min-height: 1.6em; }
a { color: var(--link); text-decoration: underline; text-underline-offset: 2px; }
code {
  font: 0.875em ui-monospace, "SF Mono", Menlo, Consolas, monospace;
  background: var(--soft); border-radius: 4px; padding: 0.15em 0.35em; color: var(--c-red);
}
pre { background: var(--soft); border-radius: 8px; padding: 18px 20px; overflow-x: auto; margin: 0.8em 0; }
pre code { background: none; padding: 0; color: inherit; font-size: 0.85em; line-height: 1.6; }
.chip {
  display: inline-block; padding: 0 6px; border-radius: 4px; background: var(--soft);
  color: var(--link); text-decoration: none; font-size: 0.92em;
}
a.chip:hover { text-decoration: underline; }
code.chip { color: var(--link); }
blockquote { margin: 0.6em 0; padding: 0 0 0 14px; border-left: 3px solid currentColor; }
ul, ol { margin: 0.2em 0; padding-left: 1.6em; }
li { margin: 0.15em 0; }
.checklist { list-style: none; padding-left: 0.2em; }
.checklist li { display: flex; flex-wrap: wrap; gap: 8px; align-items: baseline; }
.checklist li > .children, .checklist li > ul, .checklist li > ol { flex-basis: 100%; padding-left: 1.6em; }
.checklist li.checked > span { color: var(--muted); text-decoration: line-through; }
.checklist input { margin: 0; transform: translateY(1px); }
details.toggle > summary { cursor: pointer; }
details.toggle > summary > :is(h2, h3, h4, h5, h6) { display: inline; }
details.toggle > :not(summary) { padding-left: 1.4em; }
.children { padding-left: 1.6em; }
.equation { margin: 0.8em 0; overflow-x: auto; text-align: center; }
figure { margin: 1em 0; }
figure img, figure video { max-width: 100%; height: auto; border-radius: 4px; display: block; }
figcaption { color: var(--muted); font-size: 0.875em; margin-top: 6px; }
.missing { color: var(--muted); font-style: italic; }
.table-wrap { overflow-x: auto; margin: 0.8em 0; }
table { border-collapse: collapse; }
th, td { border: 1px solid var(--line); padding: 6px 10px; text-align: left; vertical-align: top; }
th { background: var(--soft); font-weight: 600; }
hr { border: none; border-top: 1px solid var(--line); margin: 1.2em 0; }
:target { background: var(--flash); border-radius: 4px; transition: background 1.5s; }
footer { margin-top: 64px; padding-top: 16px; border-top: 1px solid var(--line); color: var(--muted); font-size: 0.8em; }
.empty-note { color: var(--muted); }
${[...COLOR_NAMES].map((name) => `.c-${name} { color: var(--c-${name}); } .bg-${name} { background: var(--bg-${name}); }`).join('\n')}
`;
