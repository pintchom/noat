#!/usr/bin/env node
/** End-to-end smoke test: drive dist/mcp-server.js over stdio JSON-RPC. */
import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const noatHome = fs.mkdtempSync(path.join(os.tmpdir(), 'noat-mcp-smoke-'));
const directJson =
  process.env.NOAT_MCP_DIRECT_JSON === '1' || process.env.NOAT_MCP_DIRECT_JSON === 'true';
const child = spawn('node', ['dist/mcp-server.js'], {
  env: { ...process.env, NOAT_HOME: noatHome },
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
    setTimeout(() => reject(new Error(`timeout: ${method}`)), 15000);
  });
}

function notify(method, params) {
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`);
}

const toolText = (response) => JSON.parse(response.result.content[0].text);

try {
  const init = await request('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'smoke', version: '0' },
  });
  console.log(
    'initialized:',
    init.result.serverInfo.name,
    '| instructions:',
    init.result.instructions.length,
    'chars'
  );
  notify('notifications/initialized', {});

  const tools = await request('tools/list', {});
  console.log('tools:', tools.result.tools.map((t) => t.name).join(', '));

  const created = await request('tools/call', {
    name: 'create_note',
    arguments: directJson
      ? {
          scope: 'global',
          title: 'Smoke Test',
          blocks: [
            {
              type: 'heading',
              props: { level: 1, textColor: 'default', backgroundColor: 'default', textAlignment: 'left' },
              content: [{ type: 'text', text: 'Hello', styles: {} }],
              children: [],
            },
            {
              type: 'paragraph',
              props: { textColor: 'default', backgroundColor: 'default', textAlignment: 'left' },
              content: [
                { type: 'text', text: 'Some ', styles: {} },
                { type: 'text', text: 'bold', styles: { bold: true } },
                { type: 'text', text: ' text.', styles: {} },
              ],
              children: [],
            },
          ],
        }
      : {
          scope: 'global',
          title: 'Smoke Test',
          markdown: '# Hello\n\nSome **bold** text.\n\n- [ ] a task\n\n```ts\nconst x = 1;\n```',
        },
  });
  const notePath = toolText(created).created;
  console.log('created:', notePath);

  await request('tools/call', {
    name: 'append_to_note',
    arguments: directJson
      ? {
          notePath,
          blocks: [
            {
              type: 'heading',
              props: { level: 2, textColor: 'default', backgroundColor: 'default', textAlignment: 'left' },
              content: [{ type: 'text', text: 'Appended', styles: {} }],
              children: [],
            },
            {
              type: 'paragraph',
              props: { textColor: 'default', backgroundColor: 'default', textAlignment: 'left' },
              content: [{ type: 'text', text: 'More content here.', styles: { textColor: 'green' } }],
              children: [],
            },
          ],
        }
      : { notePath, markdown: '## Appended\n\nMore content here.' },
  });

  const read = await request('tools/call', {
    name: 'read_note',
    arguments: directJson ? { notePath } : { notePath, includeBlocks: true },
  });
  const note = toolText(read);
  if (directJson) {
    console.log('read blocks:', note.blocks.length);
    console.log(
      'blocks:',
      note.blocks.length,
      '| all have ids:',
      note.blocks.every((b) => typeof b.id === 'string')
    );
  } else {
    console.log('read markdown:\n---\n' + note.markdown + '\n---');
    console.log(
      'blocks:',
      note.blocks.length,
      '| all have ids:',
      note.blocks.every((b) => typeof b.id === 'string')
    );
  }

  const search = await request('tools/call', {
    name: 'search_notes',
    arguments: { query: 'appended' },
  });
  console.log('search hits:', JSON.stringify(toolText(search)));

  const outline = await request('tools/call', {
    name: 'get_note_outline',
    arguments: { notePath },
  });
  const sections = toolText(outline).sections;
  console.log('outline sections:', sections.map((s) => s.heading).join(' / '));

  const sectionRead = await request('tools/call', {
    name: 'read_note',
    arguments: { notePath, section: 'Appended' },
  });
  const sliced = toolText(sectionRead);
  if (directJson) {
    const text = JSON.stringify(sliced.blocks);
    if (!text.includes('More content') || text.includes('bold')) {
      throw new Error(`section read returned the wrong slice: ${text}`);
    }
  } else if (!sliced.markdown.includes('More content') || sliced.markdown.includes('bold')) {
    throw new Error(`section read returned the wrong slice: ${sliced.markdown}`);
  }
  console.log('section read: ok');

  // Notes written after the keyword index was built must still be findable.
  const late = await request('tools/call', {
    name: 'create_note',
    arguments: directJson
      ? {
          scope: 'global',
          title: 'Late Note',
          blocks: [
            {
              type: 'paragraph',
              props: { textColor: 'default', backgroundColor: 'default', textAlignment: 'left' },
              content: [{ type: 'text', text: 'About xylophone upkeep.', styles: {} }],
              children: [],
            },
          ],
        }
      : { scope: 'global', title: 'Late Note', markdown: 'About xylophone upkeep.' },
  });
  const lateSearch = await request('tools/call', {
    name: 'search_notes',
    arguments: { query: 'xylophone', mode: 'keyword' },
  });
  const lateHits = toolText(lateSearch).results;
  if (!lateHits.some((hit) => hit.notePath === toolText(late).created)) {
    throw new Error('keyword search missed a note created after the index was built');
  }
  console.log('late-write keyword search: ok');

  const scope = await request('tools/call', {
    name: 'get_current_repo_scope',
    arguments: { cwd: process.cwd() },
  });
  console.log('repo scope:', JSON.stringify(toolText(scope).repoKey));

  console.log('mode:', directJson ? 'direct-json' : 'markdown');
  console.log('SMOKE OK');
} catch (error) {
  console.error('SMOKE FAILED', error);
  process.exitCode = 1;
} finally {
  child.kill();
  fs.rmSync(noatHome, { recursive: true, force: true });
}
