#!/usr/bin/env node
/** Create a richly formatted note via the MCP server (direct JSON mode). */
import { spawn } from 'node:child_process';
import * as os from 'node:os';
import * as path from 'node:path';

const noatHome = process.env.NOAT_HOME || path.join(os.homedir(), '.noat');
const base = { textColor: 'default', backgroundColor: 'default', textAlignment: 'left' };
const t = (text, styles = {}) => ({ type: 'text', text, styles });
const link = (href, text) => ({ type: 'link', href, content: [t(text)] });
const inline = (content) =>
  typeof content === 'string' ? [t(content)] : Array.isArray(content) ? content : [content];

const block = (type, props, content, children = []) => ({
  type,
  props: { ...base, ...props },
  content,
  children,
});
const bare = (type, props, content, children = []) => ({ type, props, content, children });
const p = (content, children) => block('paragraph', {}, inline(content), children);
const h = (level, content, align = 'left') =>
  block('heading', { level, textAlignment: align }, inline(content));
const bullet = (content, children) => block('bulletListItem', {}, inline(content), children);
const num = (content, children) => block('numberedListItem', {}, inline(content), children);
const check = (checked, content, children) =>
  block('checkListItem', { checked }, inline(content), children);
const quote = (content) =>
  bare('quote', { textColor: 'default', backgroundColor: 'default' }, inline(content));
const code = (language, text) =>
  bare('codeBlock', { language }, [{ type: 'text', text, styles: {} }]);
const table = (rows) =>
  bare('table', { textColor: 'default' }, {
    type: 'tableContent',
    rows: rows.map((cells) => ({ cells: cells.map((cell) => inline(cell)) })),
  });

const blocks = [
  h(1, 'MCP Formatting Showcase'),
  p([
    t('Created by an agent through the '),
    t('NOAT MCP server', { bold: true }),
    t(' in '),
    t('direct JSON mode', { code: true }),
    t(' — every style below is native BlockNote, not lossy markdown.'),
  ]),

  h(2, 'Inline text styles'),
  p([
    t('bold', { bold: true }),
    t(' · '),
    t('italic', { italic: true }),
    t(' · '),
    t('underline', { underline: true }),
    t(' · '),
    t('strikethrough', { strike: true }),
    t(' · '),
    t('inline code', { code: true }),
    t(' · '),
    link('https://blocknotejs.org', 'hyperlink'),
  ]),

  h(2, 'Text colors'),
  p([
    t('red ', { textColor: 'red' }),
    t('orange ', { textColor: 'orange' }),
    t('yellow ', { textColor: 'yellow' }),
    t('green ', { textColor: 'green' }),
    t('blue ', { textColor: 'blue' }),
    t('purple ', { textColor: 'purple' }),
    t('pink ', { textColor: 'pink' }),
    t('gray', { textColor: 'gray' }),
  ]),

  h(2, 'Background highlights'),
  p([
    t('red highlight', { backgroundColor: 'red' }),
    t('  '),
    t('yellow highlight', { backgroundColor: 'yellow' }),
    t('  '),
    t('green highlight', { backgroundColor: 'green' }),
    t('  '),
    t('blue highlight', { backgroundColor: 'blue' }),
    t('  '),
    t('purple highlight', { backgroundColor: 'purple' }),
  ]),

  h(2, 'Combined flair'),
  p([
    t('SEV-1', { textColor: 'red', bold: true, backgroundColor: 'yellow' }),
    t('  '),
    t('shipped', { textColor: 'green', bold: true }),
    t('  '),
    t('deprecated', { strike: true, textColor: 'gray' }),
    t('  '),
    t('WIP', { italic: true, textColor: 'orange', underline: true }),
  ]),

  h(2, 'Alignment'),
  block('paragraph', { textAlignment: 'left' }, inline('Left-aligned paragraph')),
  block('paragraph', { textAlignment: 'center' }, inline('Centered paragraph')),
  block('paragraph', { textAlignment: 'right' }, inline('Right-aligned paragraph')),

  h(2, 'Lists'),
  bullet('Top-level bullet'),
  bullet('Nested bullets', [bullet('Child item A'), bullet('Child item B')]),
  num('First numbered item'),
  num('Second with nested bullets', [bullet('Sub-point one'), bullet('Sub-point two')]),
  check(false, 'Unchecked task'),
  check(true, 'Completed task', [check(false, 'Sub-task still open')]),

  h(2, 'Quote'),
  quote('BlockNote quotes preserve their own block styling — great for callouts and pull quotes.'),

  h(2, 'Code blocks'),
  code('typescript', `type InlineStyle = {
  bold?: boolean;
  italic?: boolean;
  textColor?: string;
  backgroundColor?: string;
};`),
  code('bash', 'NOAT_MCP_DIRECT_JSON=1 node dist/mcp-server.js'),

  h(2, 'Table'),
  table([
    ['Feature', 'Markdown MCP', 'JSON MCP'],
    ['Text colors', 'lost', 'preserved'],
    ['Background highlights', 'lost', 'preserved'],
    ['fileLink chips', 'flattened to code', 'native'],
    ['Nested children', 'partial', 'full tree'],
  ]),

  h(2, 'NOAT file link'),
  p([
    t('Jump to the MCP server source: '),
    { type: 'fileLink', props: { path: 'src/mcp/server.ts' } },
    t(' '),
    t('and the markdown adapter: '),
    { type: 'fileLink', props: { path: 'src/mcp/markdown.ts' } },
  ]),

  h(2, 'Heading levels', { textAlignment: 'left' }),
  h(3, 'Level 3 heading'),
  p([t('This note exercises every major block type the NOAT editor supports. Open it in the NOAT sidebar to see the colors and formatting render live.')]),
];

const child = spawn('node', ['dist/mcp-server.js'], {
  env: { ...process.env, NOAT_HOME: noatHome, NOAT_MCP_DIRECT_JSON: '1' },
  stdio: ['pipe', 'pipe', 'inherit'],
});

let buffer = '';
const pending = new Map();
let nextId = 1;

child.stdout.on('data', (chunk) => {
  buffer += chunk.toString();
  const lines = buffer.split('\n');
  buffer = lines.pop() ?? '';
  for (const line of lines) {
    if (!line.trim()) continue;
    const message = JSON.parse(line);
    if (message.id && pending.has(message.id)) {
      pending.get(message.id)(message);
      pending.delete(message.id);
    }
  }
});

function request(method, params) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, resolve);
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    setTimeout(() => reject(new Error(`timeout: ${method}`)), 30000);
  });
}

function notify(method, params) {
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`);
}

try {
  await request('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'formatting-showcase', version: '0' },
  });
  notify('notifications/initialized', {});

  const scope = await request('tools/call', {
    name: 'get_current_repo_scope',
    arguments: { cwd: process.cwd() },
  });
  const scopeData = JSON.parse(scope.result.content[0].text);
  const useScope = scopeData.repoKey ?? 'global';

  const created = await request('tools/call', {
    name: 'create_note',
    arguments: {
      scope: useScope,
      title: 'MCP Formatting Showcase',
      blocks,
    },
  });
  const result = JSON.parse(created.result.content[0].text);
  console.log('Created:', result.created);
  console.log('Scope:', useScope);
  console.log('Blocks:', blocks.length);
} finally {
  child.kill();
}
