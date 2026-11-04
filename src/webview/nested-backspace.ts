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
 * the same depth instead; Shift-Tab is the way out. Enter inside a collapsed
 * toggle's title keeps the hidden content with that toggle.
 *
 * Priority 200 runs these before BlockNote's block shortcuts (101 and up, e.g.
 * the toggle item's own Enter) and its core handlers (50). Every handler
 * bails out on anything but its narrow case, so list, code and table keys
 * still reach their own handlers. The slash and @ menus catch Enter in a DOM
 * capture listener, which runs before any keymap.
 */
const nestedBackspaceKeymap = Extension.create({
  name: 'noatNestedBackspace',
  priority: 200,
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
    // BlockNote's split hands a block's children to the second half. A
    // collapsed toggle hides them, so Enter at the end of its title moved its
    // content into the new empty toggle below. Keep them with the first half.
    // At the very start of the title the default is right: the title moves
    // down and its content follows it.
    const splitKeepingHiddenChildren = (): boolean => {
      const { $from, empty } = this.editor.state.selection;
      if (!empty || $from.parentOffset === 0) return false;
      const container = $from.node(-1);
      const children = container?.lastChild;
      if (container?.type.name !== 'blockContainer' || container.childCount < 2 || !children)
        return false;
      const content = this.editor.view.nodeDOM($from.before());
      const wrapper = content instanceof HTMLElement && content.querySelector('.bn-toggle-wrapper');
      if (!wrapper || wrapper.getAttribute('data-show-children') !== 'false') return false;
      // List items keep their type when split; toggle headings continue as a paragraph.
      const secondType =
        $from.parent.type.name === 'toggleListItem'
          ? $from.parent.type
          : this.editor.schema.nodes.paragraph;
      if (!secondType) return false;
      return this.editor.commands.command(({ tr }) => {
        tr.delete($from.end(-1) - children.nodeSize, $from.end(-1));
        tr.split($from.pos, 2, [{ type: container.type }, { type: secondType }]);
        // $from.pos + 1 is just inside the first half's blockContainer, after its content.
        tr.insert($from.pos + 1, children);
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
      Enter: () => splitInsteadOfLift() || splitKeepingHiddenChildren(),
    };
  },
});

export const nestedBackspace = createExtension({
  key: 'nestedBackspace',
  tiptapExtensions: [nestedBackspaceKeymap],
});
