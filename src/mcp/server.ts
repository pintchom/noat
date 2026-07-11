import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { listAllNotes, readNoteByPath } from '../core/note-listing';
import { blocksToSections, sliceSection } from '../core/note-text';
import { getNoatHome } from '../core/paths';
import { SearchEngine } from '../core/search/engine';
import { initStore } from '../core/store';
import { blocksToMarkdown, markdownToBlocks } from './markdown';
import { createNoteFile, repoScopeForCwd, writeNoteFile } from './notes';

const INSTRUCTIONS = `NOAT is the user's personal note system, stored on their machine and edited
inside their IDE with a Notion-style editor. You can read, search, create, and
update these notes — treat them as the user's living working memory.

## How notes are organized

- Every note has a "notePath" like "global/Ideas.noat.json" — this is the id
  you pass to tools.
- Scopes: "global/..." notes apply everywhere; "repos/<repo-key>/..." notes
  belong to one repository (repo-key looks like "github.com--owner--name").
  Call get_current_repo_scope with your working directory to find the scope
  for the repo you're working in. Check BOTH that scope and global notes.
- Notes may be nested in folders within a scope.

## Note content

Notes are BlockNote documents (JSON block trees). read_note returns both the
raw blocks and a lossy markdown rendering — prefer markdown for reading;
request blocks when you need exact structure. Writes (create_note,
append_to_note, replace_note_content) accept markdown, which is converted to
blocks server-side. Markdown supports headings, lists, checkboxes (- [ ]),
code fences, tables, quotes, bold/italic/links.

For large notes, call get_note_outline first (headings + section sizes), then
read_note with section to fetch only the part you need.

One custom inline element exists: "fileLink" (a clickable chip pointing to a
workspace-relative file path). In markdown renderings it appears as inline
code containing the path.

## Conventions

- The store is git-versioned; the user's IDE commits it automatically
  alongside their code commits. Never run git commands against the store.
- When the user asks you to remember something, prefer appending to an
  existing relevant note over creating near-duplicates. Search first.
- Keep titles short and descriptive; they double as filenames.`;

async function main(): Promise<void> {
  const noatHome = getNoatHome();
  await initStore(noatHome);

  const server = new McpServer({ name: 'noat', version: '0.1.0' }, { instructions: INSTRUCTIONS });

  const json = (value: unknown) => ({
    content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }],
  });

  server.registerTool(
    'list_notes',
    {
      description:
        'List all notes (most recently updated first). Optionally filter by scope: "global" or a repo key like "github.com--owner--name".',
      inputSchema: { scope: z.string().optional() },
    },
    async ({ scope }) => json(await listAllNotes(noatHome, scope))
  );

  server.registerTool(
    'read_note',
    {
      description:
        'Read a note by notePath. Returns metadata, a markdown rendering, and optionally the raw BlockNote blocks. For large notes, pass section (a heading from get_note_outline, or a unique prefix like "3.2") to read only that part.',
      inputSchema: {
        notePath: z.string(),
        section: z
          .string()
          .optional()
          .describe('Heading text (or unique prefix) — return only that section'),
        includeBlocks: z
          .boolean()
          .optional()
          .describe('Include raw BlockNote block JSON (default false)'),
      },
    },
    async ({ notePath, section, includeBlocks }) => {
      const note = await readNoteByPath(noatHome, notePath);
      let blocks = note.blocks;
      let matchedHeading: string | undefined;
      if (section) {
        const slice = sliceSection(note.blocks, section);
        if (slice.kind === 'not-found') {
          return json({ error: `No heading matches "${section}"`, headings: slice.headings });
        }
        if (slice.kind === 'ambiguous') {
          return json({ error: `"${section}" is ambiguous`, candidates: slice.candidates });
        }
        blocks = slice.blocks;
        matchedHeading = slice.heading;
      }
      const markdown = await blocksToMarkdown(blocks);
      return json({
        notePath,
        title: note.title,
        createdAt: note.createdAt,
        updatedAt: note.updatedAt,
        ...(matchedHeading && { section: matchedHeading }),
        markdown,
        ...(includeBlocks && { blocks }),
      });
    }
  );

  const engine = new SearchEngine(noatHome);

  server.registerTool(
    'search_notes',
    {
      description:
        'Search across all notes. mode "keyword" = exact/fuzzy term matching (grep-like), "semantic" = conceptual similarity via local embeddings, "hybrid" (default) = both merged. Returns ranked notes with snippets. Optionally filter by scope.',
      inputSchema: {
        query: z.string(),
        scope: z.string().optional(),
        mode: z.enum(['keyword', 'semantic', 'hybrid']).optional(),
      },
    },
    async ({ query, scope, mode }) => {
      const requested = mode ?? 'hybrid';
      const { results, effectiveMode, warning } = await (async () => {
        try {
          return { results: await engine.search(query, requested), effectiveMode: requested };
        } catch (error) {
          // Semantic path can fail offline (model download); degrade to keyword.
          if (requested === 'keyword') throw error;
          return {
            results: await engine.search(query, 'keyword'),
            effectiveMode: 'keyword' as const,
            warning: `semantic search unavailable (${error instanceof Error ? error.message : String(error)})`,
          };
        }
      })();
      const filtered = scope ? results.filter((result) => result.scope === scope) : results;
      return json({ mode: effectiveMode, ...(warning && { warning }), results: filtered });
    }
  );

  server.registerTool(
    'create_note',
    {
      description:
        'Create a new note from markdown. scope is "global" or a repo key. folder is an optional folder path within the scope.',
      inputSchema: {
        scope: z.string(),
        title: z.string(),
        markdown: z.string(),
        folder: z.string().optional(),
      },
    },
    async ({ scope, title, markdown, folder }) => {
      const blocks = await markdownToBlocks(markdown);
      const notePath = await createNoteFile(noatHome, scope, folder, title, blocks);
      await engine.updateNote(notePath);
      return json({ created: notePath });
    }
  );

  server.registerTool(
    'append_to_note',
    {
      description: 'Append markdown content to the end of an existing note.',
      inputSchema: { notePath: z.string(), markdown: z.string() },
    },
    async ({ notePath, markdown }) => {
      const note = await readNoteByPath(noatHome, notePath);
      const newBlocks = await markdownToBlocks(markdown);
      await writeNoteFile(noatHome, notePath, {
        ...note,
        blocks: [...note.blocks, ...newBlocks],
      });
      await engine.updateNote(notePath);
      return json({ appended: notePath, addedBlocks: newBlocks.length });
    }
  );

  server.registerTool(
    'replace_note_content',
    {
      description:
        "Replace a note's entire content with new markdown (title and metadata are preserved). Use append_to_note when adding; use this only for rewrites.",
      inputSchema: { notePath: z.string(), markdown: z.string() },
    },
    async ({ notePath, markdown }) => {
      const note = await readNoteByPath(noatHome, notePath);
      const blocks = await markdownToBlocks(markdown);
      await writeNoteFile(noatHome, notePath, { ...note, blocks });
      await engine.updateNote(notePath);
      return json({ replaced: notePath, blocks: blocks.length });
    }
  );

  server.registerTool(
    'get_current_repo_scope',
    {
      description:
        'Given a working directory, return the NOAT repo scope key for that repository (for list_notes/search_notes filtering and create_note scoping), plus its notes if any.',
      inputSchema: { cwd: z.string() },
    },
    async ({ cwd }) => {
      const repo = await repoScopeForCwd(cwd);
      if (!repo)
        return json({ repoKey: null, note: 'Not inside a git repository — use scope "global".' });
      const notes = await listAllNotes(noatHome, repo.repoKey);
      return json({ repoKey: repo.repoKey, repoRoot: repo.repoRoot, notes });
    }
  );

  server.registerTool(
    'get_note_outline',
    {
      description:
        'Cheap structural view of a note: every heading with the size of its section text. Use to decide which part of a large note is worth reading.',
      inputSchema: { notePath: z.string() },
    },
    async ({ notePath }) => {
      const note = await readNoteByPath(noatHome, notePath);
      const sections = blocksToSections(note.blocks).map((section) => ({
        heading: section.heading,
        chars: section.text.length,
      }));
      return json({ notePath, title: note.title, updatedAt: note.updatedAt, sections });
    }
  );

  await server.connect(new StdioServerTransport());
}

main().catch((error) => {
  console.error('NOAT MCP server failed to start:', error);
  process.exit(1);
});
