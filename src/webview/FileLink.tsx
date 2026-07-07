import { createReactInlineContentSpec } from '@blocknote/react';
import { vscodeApi } from './vscode-api';

/**
 * Inline chip linking to a file in the workspace, inserted via "@".
 * Stores the workspace-relative path; clicking asks the host to open it beside.
 */
export const FileLink = createReactInlineContentSpec(
  {
    type: 'fileLink',
    propSchema: {
      path: { default: '' },
    },
    content: 'none',
  },
  {
    render: ({ inlineContent }) => {
      const filePath = inlineContent.props.path;
      const fileName = filePath.split('/').pop() ?? filePath;
      const open = () => vscodeApi.postMessage({ type: 'openFile', path: filePath });
      return (
        <button type="button" className="noat-file-link" title={filePath} onClick={open}>
          <span className="noat-file-link-icon">{'</>'}</span>
          {fileName}
        </button>
      );
    },
  }
);
