import { createExtension } from '@blocknote/core';
import { Extension, InputRule } from '@tiptap/core';

/**
 * `$...$` at the cursor, with two guards that both earn their keep:
 *
 * - `(?<!\$)` / `(?!\$)` keep the inner `$x$` of a `$$x$$` display equation
 *   from matching and leaving a stray dollar on either side.
 * - the formula may not begin or end with whitespace, which is what stops
 *   "it costs $5 or $6" from rendering "5 or " as a formula. This is Pandoc's
 *   rule, and the markdown bridge in src/mcp/markdown.ts uses the same shape.
 */
export const INLINE_MATH_PATTERN = /(?<!\$)\$(?!\$)([^$\n\s]|[^$\n\s][^$\n]*[^$\n\s])\$$/;

/**
 * Turns `$...$` into an inline math node as you type. Unlike smart-arrows this
 * deliberately has no code-block escape hatch -- TipTap skips input rules
 * inside code blocks and code-marked text, which is exactly what keeps `$5` in
 * a code span a literal dollar amount.
 */
const mathInputRules = Extension.create({
  name: 'noatMath',
  addInputRules() {
    // Custom inline content registers a ProseMirror node under its type name.
    const type = this.editor.schema.nodes.math;
    if (!type) return [];
    return [
      // Not TipTap's nodeInputRule: that one keeps the text around the capture
      // group and re-inserts the last typed character, which would leave the
      // `$` delimiters sitting on either side of the formula.
      new InputRule({
        find: INLINE_MATH_PATTERN,
        handler: ({ state, range, match }) => {
          state.tr.replaceWith(range.from, range.to, type.create({ latex: match[1] ?? '' }));
        },
      }),
    ];
  },
});

export const mathInput = createExtension({
  key: 'mathInput',
  tiptapExtensions: [mathInputRules],
});
