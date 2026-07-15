# Changelog

## 0.1.6 — 2026-07-15

- Drag notes and folders onto folders (or scopes) in the NOAT sidebar to reorganize them
- Toggle in the sidebar title bar to show all repository note scopes, not just the current workspace
- Fix `@` file references to exclude ignored build output, find files in large repositories, and prioritize working-tree changes

## 0.1.5 — 2026-07-08

- Transparent icon background

## 0.1.3 — 2026-07-08

- Add marketplace icon

## 0.1.2 — 2026-07-07

Initial working release.

- Notion-style block editor for notes as native editor tabs (BlockNote): slash menu, drag handles, checklists, tables, syntax-highlighted code blocks
- Notes sidebar with repository-scoped and global notes, folders, and move-between-scopes
- `@`-mention file links with live workspace search; click to open beside the note
- Hybrid search (`Cmd+Shift+S`): fuzzy keyword (MiniSearch) + local semantic embeddings (all-MiniLM-L6-v2), merged with reciprocal rank fusion — fully offline
- Bundled MCP server (8 tools) so agents can list, read, search, create, and update notes; auto-registers in Cursor
- Local git-versioned store at `~/.noat`; note changes snapshot automatically whenever you commit in a workspace repository
- Seed script for demo data (`npm run seed`)
