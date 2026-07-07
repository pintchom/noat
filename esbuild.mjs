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
});

const mcpCtx = await esbuild.context({
  ...shared,
  entryPoints: ['src/mcp/server.ts'],
  outfile: 'dist/mcp-server.js',
  platform: 'node',
  format: 'cjs',
  target: 'node20',
});

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
