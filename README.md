# NOAT

<img width="1509" height="898" alt="noat_viz" src="https://github.com/user-attachments/assets/3b158153-6f75-44b2-9c51-7f950b3ac8b0" />


**Notion-style notes that live in your IDE.** Local-first, git-versioned, searchable, and readable/writable by your AI agents over MCP.

Stop taking notes in stray `.md` files or a separate app. NOAT gives you a real block editor inside Cursor / VS Code, keeps every note on your machine with its own git history, and hands your agents a full set of tools to read, search, and write your notes.

## Features

### A real editor, not a text file

Notes open as normal editor tabs with a Notion-style block editor: type `/` for headings, checklists, tables, quotes, and code blocks (with syntax highlighting that uses your editor font). Format code the way you would in Slack: `Cmd+Shift+C` wraps the selection in inline code, `Cmd+Shift+Alt+C` turns the selected blocks into a code block. Native dirty-state and undo, plus auto-save moments after you stop typing.

### LaTeX math

Write `$E = mc^2$` inline or `$$` for a display equation and it renders with KaTeX, locally, with no network. Click a formula to edit its LaTeX. Both are also in the `/` menu under "Math". Pasted LaTeX doesn't need retyping: select it and hit `Cmd+Shift+M`, or the ∑ button in the formatting toolbar (`Ctrl` on Windows/Linux). Formulas round-trip through markdown, so agents can write them over MCP, and PDF export typesets them rather than printing the source.

### Link to code with `@`

Type `@` in a note to fuzzy-search tracked and non-ignored files in your workspace and insert a link chip. Files changed in your working tree appear first. Click a chip and the file opens in the column beside your note. Paths are stored repo-relative, so links keep working across machines.

### Point to another line with `/point`

Type `/point`, then click any line in the note. A chip linking to that line lands where you typed `/point`; clicking it scrolls to the line and briefly highlights it. The chip shows the line's current text, and turns gray and struck through if that line is deleted. `Esc` cancels.

### Repo-scoped or global

Notes are either **global** (visible everywhere) or **scoped to a repository** (keyed by its `origin` remote, so clones on other machines see the same notes). Organize freely with folders — drag notes into folders in the sidebar, or move notes between scopes from the context menu. Use the layers icon in the sidebar to show every repository's notes at once, not just the current workspace.

### Search that works like a personal Google

`Cmd+Shift+S` opens a search palette combining two engines:

- **Keyword** — fuzzy, prefix-matching, BM25-ranked full-text search (instant)
- **Semantic** — a local embedding model (`all-MiniLM-L6-v2`, ~25 MB one-time download) finds notes by *meaning*: "stop charging customers twice" finds your double-charge incident postmortem

Results merge via reciprocal rank fusion. Everything runs locally — no API key, nothing leaves your machine.

### Diagrams from a description

Type `/diagram a sequence of the login flow` (or pick **Diagram** from the `/` or `+` menu) and a local model writes the Mermaid script for it, using the note itself as context. The script — not a picture — is what gets stored in the note, so diagrams stay diffable in git, re-render in your IDE's light or dark theme, and can be edited by hand or regenerated from the description. Drag a diagram's bottom-right corner to resize it in the note (the size is stored with it), or click it to open it full size, where you can zoom in (the toolbar buttons or ctrl+scroll) and scroll around a big one.

Generation talks to any OpenAI-compatible endpoint; it defaults to `http://127.0.0.1:8000/v1`, so with a local server ([oMLX](https://omlx.app), LM Studio, Ollama, llama.cpp) nothing leaves your machine and nothing costs tokens:

| Setting | Default | |
| --- | --- | --- |
| `noat.diagram.baseUrl` | `http://127.0.0.1:8000/v1` | OpenAI-compatible chat endpoint |
| `noat.diagram.model` | *(empty)* | Empty means the first model the server lists |
| `noat.diagram.apiKey` | *(empty)* | Bearer token, if the server wants one |

### Share notes as PDF

Run `NOAT: Export Note as PDF` from the command palette (or right-click a note in the sidebar, or use the PDF icon on an open note tab) to save any note as a polished PDF — headings, lists, checklists, tables, code blocks, quotes, links, and typeset math included. Everything renders locally; nothing leaves your machine.

### Publish notes as web pages

Run `NOAT: Publish Note to Web` (globe icon on an open note, or right-click a note in the sidebar) to turn a note into a public web page, like Notion's "Publish to web". The link is copied to your clipboard.

The first time, NOAT opens your browser to connect a (free) Netlify account. Approve it once and you're done. Each published note gets its own Netlify site, named after the note, with the note at the root: `https://<title>-<id>.netlify.app/`. The address stays the same if you rename the note. There's no repository to set up. `NOAT: Sign Out of Netlify` disconnects the account; your pages stay up.

Netlify teams created since July 2026 make new sites private by default, so only you can see them while logged in. To make every new NOAT page public automatically, set Netlify → Team settings → General → Visitor access → Default project visibility → **Public for new projects**. Otherwise, click **Make public** on each new page's site.

A published note re-publishes itself about 20 seconds after you stop editing (turn this off with `noat.publish.autoUpdate`). Links to other published notes become real links; links to unpublished notes show their title as plain text with no link, so publishing one note never exposes another note's content. `NOAT: Unpublish Note` deletes the note's Netlify site, so its link and every past version stop working.

**Prefer git?** Set `noat.publish.provider` to `git` and NOAT pushes pages to a repository you own instead, for GitHub Pages, Cloudflare Pages, or any static host watching the repo. Publish once and paste the repo URL when asked; for GitHub Pages, then set Settings → Pages to "Deploy from a branch", `main`, `/ (root)` (NOAT offers a button for that). Pushing uses your normal git credentials. Unpublished pages stay in the repo's git history.

Publish settings are only read from your user settings, never from a repo's `.vscode/settings.json`, so a repo you open can't redirect your notes elsewhere.

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
| `Cmd+Shift+C` (`Ctrl+Shift+C`) inside a note | Format selection as inline code (Slack-style) |
| `Cmd+Shift+.` (`Ctrl+Shift+.`) inside a note | Superscript the selection |
| `Cmd+Shift+,` (`Ctrl+Shift+,`) inside a note | Subscript the selection |
| `Cmd+Enter` (`Ctrl+Enter`) on a toggle | Open or close the toggle |
| `Cmd+Shift+Alt+C` (`Ctrl+Shift+Alt+C`) inside a note | Turn the selected blocks into a code block |

Use the keyboard icon in the NOAT sidebar or run `NOAT: Edit Keyboard Shortcuts` to open the native Keyboard Shortcuts editor filtered to NOAT commands. Changes are saved in your editor's user keybindings and work with Settings Sync.

Command palette: `NOAT: New Note`, `NOAT: New Folder`, `NOAT: Search Notes`, `NOAT: Export Note as PDF`, `NOAT: Publish Note to Web`, `NOAT: Unpublish Note`, `NOAT: Sign Out of Netlify`, `NOAT: Edit Keyboard Shortcuts`, `NOAT: Rebuild Search Index`, `NOAT: Open Notes Store in Terminal`, `NOAT: Refresh Notes`, `NOAT: Show All Repositories`, `NOAT: Show Current Repository Only`.

## MCP setup outside Cursor

Cursor registers the MCP server automatically. For other MCP clients, the extension keeps a copy of the server at a stable path inside the store and refreshes it on every update:

```json
{
  "mcpServers": {
    "noat": {
      "command": "node",
      "args": ["/Users/you/.noat/mcp/dist/mcp-server.js"]
    }
  }
}
```

With Claude Code:

```sh
claude mcp add noat --scope user -- node ~/.noat/mcp/dist/mcp-server.js
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
  mcp/                   # stable copy of the MCP server (gitignored)
  site-netlify/          # built pages for Netlify publishing (gitignored)
  site/                  # clone of your publish repo, if you publish with git (gitignored)
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
