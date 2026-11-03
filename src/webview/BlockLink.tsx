import type { BlockNoteEditor } from '@blocknote/core';
import { createReactInlineContentSpec, useEditorChange } from '@blocknote/react';
import { useState } from 'react';
import { blockLinkLabel } from '../core/block-links';
import type { NoteFile } from '../core/note';

const POINT_ICON = '\u21b3';
const FLASH_MS = 1600;
const flashTimers = new WeakMap<HTMLElement, ReturnType<typeof setTimeout>>();

// biome-ignore lint/suspicious/noExplicitAny: works with any schema
type AnyEditor = BlockNoteEditor<any, any, any>;

function liveLabel(editor: AnyEditor, blockId: string): string | undefined {
  const block = editor.getBlock(blockId);
  return block ? blockLinkLabel(block as unknown as NoteFile['blocks'][number]) : undefined;
}

/** Scroll the block with `blockId` into view, flash it, and put the caret there. */
export function jumpToBlock(editor: AnyEditor, blockId: string): void {
  // The block's own content row, so nested children don't flash with it.
  const element = document.querySelector<HTMLElement>(
    `.bn-block-outer[data-id="${CSS.escape(blockId)}"] > .bn-block > .bn-block-content`
  );
  if (!element || !editor.getBlock(blockId)) return;
  element.scrollIntoView({ behavior: 'smooth', block: 'center' });
  element.classList.remove('noat-point-flash');
  // Reflow so re-adding the class restarts the animation on repeat clicks.
  void element.offsetWidth;
  element.classList.add('noat-point-flash');
  clearTimeout(flashTimers.get(element));
  flashTimers.set(
    element,
    setTimeout(() => element.classList.remove('noat-point-flash'), FLASH_MS)
  );
  editor.setTextCursorPosition(blockId, 'start');
  editor.focus();
}

/**
 * Inline chip pointing at another block in the same note, inserted via
 * "/point". Stores the target block id plus a label snapshot from insert time;
 * the chip shows the target's current text while it exists, and the snapshot
 * (struck through) once the target is deleted.
 */
export const BlockLink = createReactInlineContentSpec(
  {
    type: 'blockLink',
    propSchema: {
      blockId: { default: '' },
      label: { default: '' },
    },
    content: 'none',
  },
  {
    render: ({ inlineContent, editor }) => {
      const { blockId, label } = inlineContent.props;
      const [current, setCurrent] = useState(() => liveLabel(editor, blockId));
      useEditorChange(() => setCurrent(liveLabel(editor, blockId)), editor);

      const missing = current === undefined;
      return (
        <button
          type="button"
          className={missing ? 'noat-file-link noat-block-link-missing' : 'noat-file-link'}
          title={missing ? 'The line this pointed to was deleted' : 'Jump to line'}
          onClick={() => jumpToBlock(editor, blockId)}
        >
          <span className="noat-file-link-icon">{POINT_ICON}</span>
          {current ?? (label || 'Missing line')}
        </button>
      );
    },
  }
);
