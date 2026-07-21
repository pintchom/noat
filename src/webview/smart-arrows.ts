import { createExtension } from '@blocknote/core';
import { Extension, textInputRule } from '@tiptap/core';
import { Plugin } from 'prosemirror-state';

/**
 * TipTap's input-rule runner skips code blocks and code-marked text, so the
 * `textInputRule` below never fires there. This plugin covers exactly those
 * contexts: typing `>` right after `--` inside a code block or inline code
 * replaces all three characters with the arrow, matching prose behavior.
 */
const arrowsInCode = new Plugin({
  props: {
    handleTextInput(view, from, to, text) {
      if (text !== '>') return false;
      const { state } = view;
      const $from = state.doc.resolve(from);
      const inCode =
        $from.parent.type.spec.code ||
        $from.nodeBefore?.marks.some((mark) => mark.type.spec.code) === true;
      if (!inCode) return false;
      // The block separator keeps a trailing `--` in the previous block from
      // matching when the cursor sits at the start of a new one.
      const before = state.doc.textBetween(Math.max(0, from - 2), from, '\n', '\ufffc');
      if (before !== '--') return false;
      view.dispatch(state.tr.insertText('→', from - 2, to));
      return true;
    },
  },
});

/**
 * Replaces `-->` with a real arrow (→) as you type — in prose via a TipTap
 * input rule, and in code blocks / inline code via the plugin above.
 */
const arrowInputRules = Extension.create({
  name: 'noatSmartArrows',
  addInputRules() {
    return [textInputRule({ find: /-->$/, replace: '→' })];
  },
  addProseMirrorPlugins() {
    return [arrowsInCode];
  },
});

export const smartArrows = createExtension({
  key: 'smartArrows',
  tiptapExtensions: [arrowInputRules],
});
