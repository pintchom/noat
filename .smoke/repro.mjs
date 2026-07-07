import * as fs from 'node:fs';
import { blocksToMarkdown } from '../src/mcp/markdown';
const raw = JSON.parse(fs.readFileSync(process.env.HOME + '/.noat/notes/global/reference/Snippets.noat.json', 'utf8'));
try {
  const md = await blocksToMarkdown(raw.blocks);
  console.log('OK', md.slice(0, 80));
} catch (e) {
  console.error('ERROR:', e.message);
  console.error(e.stack?.split('\n').slice(0, 5).join('\n'));
}
