# Contributing to NOAT

## Setup

```bash
git clone https://github.com/pintchom/noat && cd noat
npm install
npm run build
```

Press F5 in Cursor / VS Code to launch an Extension Development Host with NOAT loaded. Run `npm run watch` in a terminal and reload the dev host window (`Cmd+R`) to pick up changes.

## Project layout

```
src/
  core/        # Pure Node: note model, store I/O, repo scoping, search engine.
               # No vscode imports — shared by the extension and the MCP server.
    search/    # Keyword index (MiniSearch), vector index (local embeddings), hybrid merge
  extension/   # Extension host: activation, tree view, custom editor provider,
               # commands, git sync, search palette, MCP registration
  webview/     # React + BlockNote editor app (runs inside the custom editor tab)
  mcp/         # stdio MCP server: tools, markdown<->blocks conversion
  shims/       # build-time stubs (e.g. sharp)
scripts/       # seed-mock-notes.mjs (demo data), smoke-mcp.mjs (e2e MCP test)
```

Three build targets (see `esbuild.mjs`): `dist/extension.js` (node/cjs), `dist/webview.js` (browser/iife), `dist/mcp-server.js` (node/cjs, standalone). Each has its own tsconfig for typechecking.

## Commands

```bash
npm run build          # bundle all targets (dev: sourcemaps, no minify)
npm run watch          # rebuild on change
npm test               # vitest unit tests (src/core)
npm run typecheck      # tsc for extension + webview + mcp targets
npm run lint           # biome
npm run lint:fix
npm run seed           # populate ~/.noat with rich demo notes
node scripts/smoke-mcp.mjs   # end-to-end MCP server test (build first)
npm run package        # production build + .vsix
npm run install-local  # package + install into Cursor
```

## Conventions

- TypeScript strict; avoid `any` (cast through `unknown` when interfacing with BlockNote's structural types)
- Biome for formatting and linting — run `npm run lint:fix` before committing
- Functional style: prefer pure functions, IIFEs over let-reassignment, no barrel files
- `src/core` must stay free of `vscode` imports — it runs in the MCP server too
- Note files are validated with zod at the boundary (`src/core/note.ts`); trust internal code past that

## Testing expectations

- Core logic (store, repo keys, search) gets unit tests in `*.test.ts` next to the source
- The MCP server has an end-to-end smoke test (`scripts/smoke-mcp.mjs`) that drives the real bundled binary over stdio against a throwaway store — run it after touching `src/mcp`
- Editor/webview changes are verified manually in the dev host (F5)

## Releases

`npm run package` produces a `.vsix` with minified bundles and the host platform's ONNX runtime in `bin/`. Marketplace publishing (per-platform targets) is tracked on the roadmap.
