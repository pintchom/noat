import { createExtension } from '@blocknote/core';
import { Extension, textInputRule } from '@tiptap/core';

/**
 * Replaces `-->` with a real arrow (→) as you type. TipTap's input-rule
 * runner already skips code blocks and inline code, so raw `-->` survives
 * where it's likely intentional.
 */
const arrowInputRules = Extension.create({
  name: 'noatSmartArrows',
  addInputRules() {
    return [textInputRule({ find: /-->$/, replace: '→' })];
  },
});

export const smartArrows = createExtension({
  key: 'smartArrows',
  tiptapExtensions: [arrowInputRules],
});
