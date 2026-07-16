import { createReactInlineContentSpec } from '@blocknote/react';
import { resolveNoteIcon } from '../core/display-icons';
import { vscodeApi } from './vscode-api';

/**
 * Inline chip linking to another note, inserted via the "/page" slash command.
 * Stores the store-relative note path plus a title/icon snapshot for display;
 * clicking asks the host to open the linked note beside this one.
 */
export const NoteLink = createReactInlineContentSpec(
  {
    type: 'noteLink',
    propSchema: {
      notePath: { default: '' },
      title: { default: '' },
      icon: { default: '' },
    },
    content: 'none',
  },
  {
    render: ({ inlineContent }) => {
      const { notePath, title, icon } = inlineContent.props;
      const open = () => vscodeApi.postMessage({ type: 'openNote', notePath });
      return (
        <button type="button" className="noat-file-link" title={notePath} onClick={open}>
          <span className="noat-file-link-icon">{resolveNoteIcon(icon || undefined)}</span>
          {title || 'Untitled'}
        </button>
      );
    },
  }
);
