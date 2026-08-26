import { createExtension } from '@blocknote/core';
import { Extension } from '@tiptap/core';

/**
 * BlockNote's Backspace at the start of a nested paragraph lifts (outdents)
 * it. ProseMirror can only lift a middle child by splitting the parent group,
 * so every sibling below gets dragged out along with it — backspace-deleting
 * the middle item of a checklist inside a toggle outdents the rest of the
 * list. When the block still has siblings after it, merge into the previous
 * block (Notion's behavior) instead of lifting; for the last child the
 * default clean outdent is kept. Priority 100 (default) runs this before
 * BlockNote's own Backspace handler at priority 50.
 */
const nestedBackspaceKeymap = Extension.create({
  name: 'noatNestedBackspace',
  addKeyboardShortcuts() {
    const joinInsteadOfLift = (): boolean => {
      const { $from, empty } = this.editor.state.selection;
      if (!empty || $from.parentOffset !== 0) return false;
      // Only paragraphs reach BlockNote's lift step; other block types
      // un-format to a paragraph in place first, which never moves siblings.
      if ($from.parent.type.name !== 'paragraph') return false;
      if ($from.node(-1)?.type.name !== 'blockContainer') return false;
      const group = $from.node(-2);
      // Nested means the block group hangs off another block, not the doc.
      if (group?.type.name !== 'blockGroup' || $from.node(-3)?.type.name !== 'blockContainer')
        return false;
      const hasFollowingSibling = $from.index(-2) < group.childCount - 1;
      if (!hasFollowingSibling) return false;
      return this.editor.commands.joinTextblockBackward();
    };
    // Word (Alt) and line (Mod) deletes hit the same boundary at the start
    // of a block, so all three need the guard.
    return {
      Backspace: joinInsteadOfLift,
      'Alt-Backspace': joinInsteadOfLift,
      'Mod-Backspace': joinInsteadOfLift,
    };
  },
});

export const nestedBackspace = createExtension({
  key: 'nestedBackspace',
  tiptapExtensions: [nestedBackspaceKeymap],
});
