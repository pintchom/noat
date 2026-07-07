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
  // *.node keeps native bindings as runtime requires instead of bundling.
  external: ['vscode', '*.node'],
  // onnxruntime-node's JS wrapper is bundled; its native binding loads via a
  // dynamic require of ../bin/napi-v6/<platform>/<arch>, which resolves next
  // to dist/ — we copy those binaries into bin/ below. sharp is a
  // transformers.js dep used only for image pipelines; stub it out.
  alias: { sharp: './src/shims/sharp-stub.ts' },
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
  external: ['*.node'],
  alias: { sharp: './src/shims/sharp-stub.ts' },
  mainFields: ['module', 'main'],
});

// jsdom (pulled in by @blocknote/server-util) requires this worker file by
// path at runtime; it must sit next to the bundle.
fs.mkdirSync('dist', { recursive: true });
fs.copyFileSync(
  'node_modules/jsdom/lib/jsdom/living/xhr/xhr-sync-worker.js',
  'dist/xhr-sync-worker.js'
);

// onnxruntime's native binding is require()d at runtime as
// ../bin/napi-v6/<platform>/<arch>/ relative to the bundle in dist/, i.e.
// <root>/bin. Copy the host platform's binaries so the packaged extension is
// self-contained. (Marketplace builds will do this per-target.)
const onnxBinSrc = `node_modules/onnxruntime-node/bin/napi-v6/${process.platform}/${process.arch}`;
const onnxBinDest = `bin/napi-v6/${process.platform}/${process.arch}`;
fs.mkdirSync(onnxBinDest, { recursive: true });
for (const file of fs.readdirSync(onnxBinSrc)) {
  fs.copyFileSync(`${onnxBinSrc}/${file}`, `${onnxBinDest}/${file}`);
}

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
