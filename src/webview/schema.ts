import { codeBlockOptions } from '@blocknote/code-block';
import {
  type BlockNoteEditor,
  BlockNoteSchema,
  createCodeBlockSpec,
  createStyleSpec,
  defaultBlockSpecs,
  defaultInlineContentSpecs,
  defaultStyleSpecs,
} from '@blocknote/core';
import { createParser } from 'prosemirror-highlight/shiki';
import { createEquationBlockSpec } from './Equation';
import { FileLink } from './FileLink';
import { InlineMath } from './Math';
import { NoteLink } from './NoteLink';

/**
 * The editor schema, shared by NoteEditor and the editor tests. Deliberately
 * free of CSS imports so tests can build a real editor without pulling in
 * BlockNote's or KaTeX's stylesheets.
 */

/**
 * Code block spec with Shiki syntax highlighting. The default spec ships
 * without a highlighter (BlockNote keeps it out to save bundle size), so
 * code blocks would render as plain text.
 *
 * BlockNote's highlight plugin reuses a parser cached under the well-known
 * `Symbol.for('blocknote.shikiParser')` before building its own single-theme
 * one. Registering a dual-theme parser before the highlighter promise
 * resolves makes every token carry both palettes (GitHub Light inline,
 * GitHub Dark via the `--shiki-dark` custom property), so styles.css can
 * follow IDE theme changes live without re-highlighting.
 */
const codeBlock = createCodeBlockSpec({
  ...codeBlockOptions,
  createHighlighter: async () => {
    const highlighter = await codeBlockOptions.createHighlighter();
    const parser = createParser(highlighter, {
      themes: { light: 'github-light', dark: 'github-dark' },
      defaultColor: 'light',
    });
    (globalThis as Record<symbol, unknown>)[Symbol.for('blocknote.shikiParser')] = parser;
    return highlighter;
  },
});

/**
 * Superscript and subscript, for exponents and chemistry. BlockNote ships
 * neither, so they are custom boolean styles rendering plain `<sup>`/`<sub>`.
 * The tags carry the meaning, so `toExternalHTML` is left to default and the
 * markdown bridge in src/mcp/markdown.ts recognises them by tag name.
 */
const verticalStyle = (tag: 'sup' | 'sub', type: 'superscript' | 'subscript') =>
  createStyleSpec(
    { type, propSchema: 'boolean' },
    {
      render: () => {
        const dom = document.createElement(tag);
        return { dom, contentDOM: dom };
      },
      parse: (element) => (element.tagName.toLowerCase() === tag ? true : undefined),
    }
  );

const superscript = verticalStyle('sup', 'superscript');
const subscript = verticalStyle('sub', 'subscript');

export const schema = BlockNoteSchema.create({
  blockSpecs: {
    ...defaultBlockSpecs,
    codeBlock,
    equation: createEquationBlockSpec(),
  },
  inlineContentSpecs: {
    ...defaultInlineContentSpecs,
    fileLink: FileLink,
    noteLink: NoteLink,
    math: InlineMath,
  },
  styleSpecs: {
    ...defaultStyleSpecs,
    superscript,
    subscript,
  },
});

/** A BlockNoteEditor typed against the schema above, for tests and helpers. */
export type NoatEditor = BlockNoteEditor<
  (typeof schema)['blockSchema'],
  (typeof schema)['inlineContentSchema'],
  (typeof schema)['styleSchema']
>;
