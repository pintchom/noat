import type { PartialBlock } from '@blocknote/core';
import { useBlockNoteEditor, useComponentsContext } from '@blocknote/react';

// Quotes exist to pinpoint the target, not to duplicate it — keep them short.
const QUOTE_MAX_CHARS = 120;

/**
 * Formatting-toolbar button that turns the current selection into a review
 * comment. The comment block lands after the block containing the selection
 * (after the whole table when the selection is inside a cell — cells cannot
 * hold blocks), quoting the selected text so the target stays explicit even
 * when the anchor block is large.
 */
export function CommentToolbarButton() {
  const editor = useBlockNoteEditor();
  const Components = useComponentsContext();
  if (!Components) return null;

  const addComment = () => {
    const selected = editor.getSelectedText().replace(/\s+/g, ' ').trim();
    const blocks = editor.getSelection()?.blocks ?? [editor.getTextCursorPosition().block];
    const reference = blocks[blocks.length - 1];
    if (!reference) return;
    const quote = selected.slice(0, QUOTE_MAX_CHARS);
    // The hook types the editor against the default schema, which doesn't
    // know the custom comment block — go through unknown, as elsewhere.
    const commentBlock = {
      type: 'comment',
      content:
        quote.length > 0 ? [{ type: 'text', text: `“${quote}” `, styles: { italic: true } }] : [],
    } as unknown as PartialBlock;
    const inserted = editor.insertBlocks([commentBlock], reference, 'after');
    const comment = inserted[0];
    if (comment) editor.setTextCursorPosition(comment, 'end');
  };

  return (
    <Components.FormattingToolbar.Button
      label="Comment"
      mainTooltip="Comment on this text"
      onClick={addComment}
    >
      💬
    </Components.FormattingToolbar.Button>
  );
}
