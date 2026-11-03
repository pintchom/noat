import type { BlockNoteEditor } from '@blocknote/core';
import { TextSelection } from 'prosemirror-state';
import { blockLinkLabel } from '../core/block-links';
import type { NoteFile } from '../core/note';

// biome-ignore lint/suspicious/noExplicitAny: works with any schema that has blockLink
type AnyEditor = BlockNoteEditor<any, any, any>;

/**
 * Put the caret back at `origin` (a position tracked since "/point" was
 * picked) and, when `targetId` names a block that still exists, insert a
 * blockLink chip to it there.
 */
export function insertBlockLinkAt(
  editor: AnyEditor,
  origin: () => number,
  targetId: string | undefined
): void {
  editor.transact((tr) => {
    const pos = Math.max(0, Math.min(origin(), tr.doc.content.size));
    tr.setSelection(TextSelection.near(tr.doc.resolve(pos)));
  });
  const target = targetId ? editor.getBlock(targetId) : undefined;
  if (!target) return;
  editor.insertInlineContent([
    {
      type: 'blockLink',
      props: {
        blockId: target.id,
        label: blockLinkLabel(target as unknown as NoteFile['blocks'][number]),
      },
    },
    ' ',
  ]);
}
