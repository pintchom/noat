import { useBlockNoteEditor, useComponentsContext } from '@blocknote/react';

/**
 * Formatting-toolbar button that starts an inline comment on the selection:
 * applies a commentRef highlight with a fresh id and hands the id to the
 * editor shell, which opens the comment popover for typing. Works anywhere
 * text can be selected, table cells included.
 */
export function CommentToolbarButton({ onAddComment }: { onAddComment: (id: string) => void }) {
  const editor = useBlockNoteEditor();
  const Components = useComponentsContext();
  if (!Components) return null;

  const addComment = () => {
    const id = crypto.randomUUID();
    // The hook types the editor against the default schema, which doesn't
    // know the custom commentRef style — go through unknown.
    editor.addStyles({ commentRef: id } as unknown as Parameters<typeof editor.addStyles>[0]);
    onAddComment(id);
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
