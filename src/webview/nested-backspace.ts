import { createExtension } from '@blocknote/core';
import { Extension } from '@tiptap/core';
import type { ResolvedPos } from '@tiptap/pm/model';

/** True when `$from` sits in a paragraph whose block hangs off another block, not the doc. */
const inNestedParagraph = ($from: ResolvedPos): boolean =>
  $from.parent.type.name === 'paragraph' &&
  $from.node(-1)?.type.name === 'blockContainer' &&
  $from.node(-2)?.type.name === 'blockGroup' &&
  $from.node(-3)?.type.name === 'blockContainer';

/**
 * Keeps nested blocks nested where BlockNote would outdent them.
 *
 * Backspace: BlockNote's Backspace at the start of a nested paragraph lifts
 * (outdents) it. ProseMirror can only lift a middle child by splitting the
 * parent group, so every sibling below gets dragged out along with it —
 * backspace-deleting the middle item of a checklist inside a toggle outdents
 * the rest of the list. When the block still has siblings after it, merge
 * into the previous block (Notion's behavior) instead of lifting; for the
 * last child the default clean outdent is kept.
 *
 * Enter: BlockNote's Enter on an empty nested paragraph lifts it too, so blank
 * lines can't be stacked inside a toggle. Split off a new empty paragraph at
 * the same depth instead; Shift-Tab is the way out.
 *
 * Priority 100 (default) runs these before BlockNote's own handlers at
 * priority 50.
 */
const nestedBackspaceKeymap = Extension.create({
  name: 'noatNestedBackspace',
  addKeyboardShortcuts() {
    const joinInsteadOfLift = (): boolean => {
      const { $from, empty } = this.editor.state.selection;
      if (!empty || $from.parentOffset !== 0) return false;
      // Only paragraphs reach BlockNote's lift step; other block types
      // un-format to a paragraph in place first, which never moves siblings.
      if (!inNestedParagraph($from)) return false;
      const hasFollowingSibling = $from.index(-2) < $from.node(-2).childCount - 1;
      if (!hasFollowingSibling) return false;
      return this.editor.commands.joinTextblockBackward();
    };
    const splitInsteadOfLift = (): boolean => {
      const { $from, empty } = this.editor.state.selection;
      if (!empty || $from.parent.childCount !== 0 || !inNestedParagraph($from)) return false;
      return this.editor.commands.command(({ tr }) => {
        // Fresh blockContainer attrs so the new block gets its own id; any
        // children move to the new block, matching BlockNote's top-level Enter.
        tr.split($from.pos, 2, [{ type: $from.node(-1).type }, { type: $from.parent.type }]);
        tr.scrollIntoView();
        return true;
      });
    };
    // Word (Alt) and line (Mod) deletes hit the same boundary at the start
    // of a block, so all three need the guard.
    return {
      Backspace: joinInsteadOfLift,
      'Alt-Backspace': joinInsteadOfLift,
      'Mod-Backspace': joinInsteadOfLift,
      Enter: splitInsteadOfLift,
    };
  },
});

export const nestedBackspace = createExtension({
  key: 'nestedBackspace',
  tiptapExtensions: [nestedBackspaceKeymap],
});
