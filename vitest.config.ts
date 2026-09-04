import { defineConfig } from 'vitest/config';

// The webview builds with esbuild's automatic JSX runtime (see esbuild.mjs) and
// tsconfig.webview.json's `jsx: react-jsx`. Vitest resolves the root tsconfig
// instead, which covers the non-JSX sources, so the JSX runtime is set here.
export default defineConfig({
  esbuild: { jsx: 'automatic' },
});
