import * as fs from 'node:fs';
import esbuild from 'esbuild';

const watch = process.argv.includes('--watch');
const production = process.argv.includes('--production');

/** @type {import('esbuild').BuildOptions} */
const shared = {
  bundle: true,
  minify: production,
  sourcemap: !production,
  logLevel: 'info',
};

const extensionCtx = await esbuild.context({
  ...shared,
  entryPoints: ['src/extension/extension.ts'],
  outfile: 'dist/extension.js',
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  external: ['vscode'],
  // Prefer ESM package entries: jsonc-parser's UMD/CJS build uses dynamic
  // requires that esbuild can't inline, breaking the bundle at runtime.
  mainFields: ['module', 'main'],
});

const mcpCtx = await esbuild.context({
  ...shared,
  entryPoints: ['src/mcp/server.ts'],
  outfile: 'dist/mcp-server.js',
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  mainFields: ['module', 'main'],
});

// jsdom (pulled in by @blocknote/server-util) requires this worker file by
// path at runtime; it must sit next to the bundle.
fs.mkdirSync('dist', { recursive: true });
fs.copyFileSync(
  'node_modules/jsdom/lib/jsdom/living/xhr/xhr-sync-worker.js',
  'dist/xhr-sync-worker.js'
);

const webviewCtx = await esbuild.context({
  ...shared,
  entryPoints: ['src/webview/main.tsx'],
  outfile: 'dist/webview.js',
  platform: 'browser',
  format: 'iife',
  target: 'es2022',
  jsx: 'automatic',
  // BlockNote packages expose their CSS through the "style" export condition.
  conditions: ['style'],
  // Inline fonts/images referenced by BlockNote CSS so the webview stays two files.
  loader: {
    '.woff': 'dataurl',
    '.woff2': 'dataurl',
    '.ttf': 'dataurl',
    '.svg': 'dataurl',
    '.png': 'dataurl',
  },
});

const contexts = [extensionCtx, mcpCtx, webviewCtx];

if (watch) {
  await Promise.all(contexts.map((ctx) => ctx.watch()));
} else {
  await Promise.all(contexts.map((ctx) => ctx.rebuild()));
  await Promise.all(contexts.map((ctx) => ctx.dispose()));
}
