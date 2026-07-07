# NOAT

Notion-style notes inside Cursor / VS Code. Local-first, git-versioned, agent-accessible.

## What it does

- **Friendly note-taking in your IDE** — a block-based editor (slash menu, drag handles, checkboxes, code blocks) that opens notes as regular editor tabs.
- **File links** — link to files in your codebase from a note and click to open them side-by-side.
- **MCP-accessible** — a bundled MCP server lets your agents read, search, and write your notes.
- **Local + versioned** — notes live in `~/.noat` with their own git history, auto-committed as you work and snapshotted alongside your code commits.
- **Scoped or universal** — notes can be global or scoped to the repo you have open, organized in folders.

## Storage

Everything lives in `~/.noat` (override with the `NOAT_HOME` env var):

```
~/.noat/
  .git/                      # independent git history for your notes
  notes/
    global/                  # universal notes
    repos/<repo-key>/        # notes scoped to a specific repository
```

Notes are `.noat.json` files: a small JSON envelope (`id`, `title`, timestamps) around a
[BlockNote](https://www.blocknotejs.org/) block array.

## Development

```bash
npm install
npm run build       # bundle extension + MCP server into dist/
npm run watch       # rebuild on change
npm test            # core unit tests (vitest)
npm run typecheck
npm run lint
```

Press F5 in VS Code / Cursor to launch an Extension Development Host with NOAT loaded.

## Status

Early development. Current stage: note store, sidebar tree, and git auto-commit.
Coming next: BlockNote editor, file links, MCP server, semantic search, code-commit sync.

## License

MIT
