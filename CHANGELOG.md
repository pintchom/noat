# Changelog

## Unreleased

- The `-->` → `→` smart arrow now also works inside inline code (`Cmd+Shift+S`) and code blocks (`Cmd+Shift+Alt+S`), which TipTap's input rules skip

- Code blocks and inline code no longer fall back to serif'd Courier/Times when the IDE's editor font can't be resolved inside the webview — they now use the same modern monospace fallback stack as file link chips

## 0.1.9 — 2026-07-16

- Code blocks get real syntax highlighting (GitHub Light/Dark via Shiki) that follows the IDE's light or dark theme live, larger readable text sized to the note instead of the editor font setting, and a language picker in the top-right corner that appears instantly on hover.
- Slack-style code formatting shortcuts in the note editor: `Cmd+Shift+S` toggles inline code on the selection, `Cmd+Shift+Alt+S` turns the selected blocks into a code block (`Ctrl` on Windows/Linux).
- Typing `-->` becomes a real arrow (→); code blocks and inline code are left untouched
- File link chips use a modern monospace font stack instead of falling back to Courier
- The MCP server is copied to a stable path in the store (`~/.noat/mcp/dist/mcp-server.js`) and refreshed on every update, so non-Cursor MCP clients like Claude Code can point at it; unknown note fields are preserved across versions

## 0.1.8 — 2026-07-15

- `NOAT: Export Note as PDF` — save any note as a shareable PDF from the command palette, the sidebar context menu, or the PDF button on an open note tab. Renders headings, lists, checklists, tables, code blocks, quotes, links, and file chips entirely locally.

## 0.1.7 — 2026-07-15

- Customizable emoji icons for notes and files
- Drag notes into folders; sidebar shows all repository scopes
- MCP write tools now refresh search indexes immediately, so new and edited notes are searchable right away
- `get_note_outline` returns every heading with section sizes; `read_note` accepts an optional `section` for scoped reads
- File paths written by agents in markdown are promoted to clickable file-link chips (with optional `:line`)
- Clicking a file chip focuses an already-open editor instead of always splitting beside the note

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
