# NOAT

<img width="1509" height="898" alt="noat_viz" src="https://github.com/user-attachments/assets/3b158153-6f75-44b2-9c51-7f950b3ac8b0" />


**Notion-style notes that live in your IDE.** Local-first, git-versioned, searchable, and readable/writable by your AI agents over MCP.

Stop taking notes in stray `.md` files or a separate app. NOAT gives you a real block editor inside Cursor / VS Code, keeps every note on your machine with its own git history, and hands your agents a full set of tools to read, search, and write your notes.

## Features

### A real editor, not a text file

Notes open as normal editor tabs with a Notion-style block editor: type `/` for headings, checklists, tables, quotes, and code blocks (with syntax highlighting that uses your editor font). Native dirty-state and undo, plus auto-save moments after you stop typing.

### Link to code with `@`

Type `@` in a note to fuzzy-search tracked and non-ignored files in your workspace and insert a link chip. Files changed in your working tree appear first. Click a chip and the file opens in the column beside your note. Paths are stored repo-relative, so links keep working across machines.

### Repo-scoped or global

Notes are either **global** (visible everywhere) or **scoped to a repository** (keyed by its `origin` remote, so clones on other machines see the same notes). Organize freely with folders; move notes between scopes from the sidebar.

### Search that works like a personal Google

`Cmd+Shift+S` opens a search palette combining two engines:

- **Keyword** — fuzzy, prefix-matching, BM25-ranked full-text search (instant)
- **Semantic** — a local embedding model (`all-MiniLM-L6-v2`, ~25 MB one-time download) finds notes by *meaning*: "stop charging customers twice" finds your double-charge incident postmortem

Results merge via reciprocal rank fusion. Everything runs locally — no API key, nothing leaves your machine.

### Agent access via MCP

A bundled MCP server exposes your notes to AI agents:

| Tool | What it does |
| --- | --- |
| `list_notes` | List all notes, filterable by scope |
| `read_note` | Read a note as markdown (raw blocks optional) |
| `get_note_outline` | Cheap preview of a large note |
| `search_notes` | Keyword / semantic / hybrid search |
| `create_note` | Create a note from markdown |
| `append_to_note` | Append markdown to an existing note |
| `replace_note_content` | Rewrite a note's content |
| `get_current_repo_scope` | Map a working directory to its note scope |

Agents write plain markdown; NOAT converts it to real editor blocks. In Cursor the server registers itself automatically — no configuration.

### Git-versioned, synced to your commits

`~/.noat` is its own git repository. Note edits save to disk immediately, and whenever you commit in any workspace repo, NOAT snapshots your pending note changes with a message linking the two histories:

```
sync(my-repo): 3942d13 Fix webhook ordering [2026-07-07 16:35]
```

No hooks are installed in your repositories — NOAT watches for commits through the editor's git integration.

## Install

From source (marketplace release coming):

```bash
git clone https://github.com/pintchom/noat && cd noat
npm install
npm run install-local   # builds, packages, and installs into Cursor
```

Reload your editor window. You'll find the NOAT book icon in the activity bar.

> **Note:** the packaged extension currently bundles native binaries for the platform you build on (e.g. Apple Silicon). Per-platform marketplace builds are on the roadmap.

## Quick start

1. Click the NOAT icon in the activity bar → **New Note** (scoped to your repo or global).
2. Write. Type `/` for blocks, `@` to link a file. It auto-saves.
3. `Cmd+Shift+S` to search everything.
4. Commit code like you always do — your notes snapshot themselves alongside.
5. Ask your agent things like *"search my notes for the ledger migration plan"* or *"save what we just learned to a note in this repo's scope."*

## Keybindings & commands

| Binding | Action |
| --- | --- |
| `Cmd+Shift+S` (`Ctrl+Shift+S`) | Search notes (hybrid) |
| `Cmd+Alt+P` (`Ctrl+Alt+P`) | Search notes (alternate binding) |
| `Cmd+P` while the NOAT sidebar is focused | Search notes |

Use the keyboard icon in the NOAT sidebar or run `NOAT: Edit Keyboard Shortcuts` to open the native Keyboard Shortcuts editor filtered to NOAT commands. Changes are saved in your editor's user keybindings and work with Settings Sync.

Command palette: `NOAT: New Note`, `NOAT: New Folder`, `NOAT: Search Notes`, `NOAT: Edit Keyboard Shortcuts`, `NOAT: Rebuild Search Index`, `NOAT: Open Notes Store in Terminal`, `NOAT: Refresh Notes`.

## MCP setup outside Cursor

Cursor registers the MCP server automatically. For other MCP clients, point at the bundled server:

```json
{
  "mcpServers": {
    "noat": {
      "command": "node",
      "args": ["/path/to/extension/dist/mcp-server.js"]
    }
  }
}
```

The server works standalone — it reads `~/.noat` directly and doesn't need the editor running. Set `NOAT_HOME` to use a different store location.

Enable **NOAT: MCP Use Direct Json** in your editor's settings to let agents read and write BlockNote JSON (preserving colors and rich formatting) instead of markdown. The extension persists this to `config.json` in the store, so the MCP server honors it in any host — Cursor, VS Code, or another MCP client. For setups where the extension isn't running, set `NOAT_MCP_DIRECT_JSON=1` in the server's environment to override.

## Storage

Everything lives in `~/.noat` (override with `NOAT_HOME`):

```
~/.noat/
  .git/                  # your notes' own git history
  .cache/                # embedding model cache (gitignored)
  .index/                # search indexes — derived, rebuildable (gitignored)
  notes/
    global/              # universal notes, nested folders allowed
    repos/<repo-key>/    # notes scoped to one repository
```

Notes are `.noat.json` files: a small envelope (`id`, `title`, timestamps) around a [BlockNote](https://www.blocknotejs.org/) block array. Plain files — grep them, script against them, take them with you.

## Architecture

```
┌─────────────────────────────┐
│ Cursor / VS Code            │
│  ┌──────────┐ ┌───────────┐ │      ┌──────────────┐
│  │ Webview  │ │ Extension │ │      │  MCP server  │◄── agents
│  │ editor   │◄┤ host      │ │      │  (stdio)     │
│  └──────────┘ └─────┬─────┘ │      └──────┬───────┘
└─────────────────────┼───────┘             │
                      ▼                     ▼
                ┌─────────────────────────────┐
                │  ~/.noat  (git repository)  │
                └─────────────────────────────┘
```

- **Extension host** — sidebar tree, commands, git sync, search engine, file-open actions
- **Webview** — React + BlockNote custom editor for `*.noat.json`
- **MCP server** — standalone stdio binary sharing the same core code and store
- **Core** (`src/core/`) — note model, store I/O, repo scoping, search; no VS Code dependency

## Development

```bash
npm install
npm run watch        # rebuild on change; F5 to launch a dev host
npm test             # core unit tests
npm run typecheck    # all three targets
npm run lint
npm run seed         # fill your store with rich demo notes + backdated history
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for project layout and conventions.

## Roadmap

- Note history viewer (versions live in git already; UI pending)
- Line-number file links (`file.ts:42`)
- Title edits renaming the underlying file
- Per-platform marketplace builds (OpenVSX + VS Code Marketplace)

## License

MIT
