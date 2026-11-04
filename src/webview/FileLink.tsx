import { createReactInlineContentSpec } from '@blocknote/react';
import { useRef, useState } from 'react';
import { FILE_ICON } from '../core/display-icons';
import { readFilePreview } from './file-search-client';
import { vscodeApi } from './vscode-api';

/**
 * Inline chip linking to a file in the workspace, inserted via "@".
 * Stores the workspace-relative path; clicking asks the host to open it beside.
 * Hovering fetches a short text preview once (undefined while loading, null
 * when the host has nothing to show — binary, missing, or empty).
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

      const [preview, setPreview] = useState<string | null | undefined>(undefined);
      const [hovering, setHovering] = useState(false);
      const fetched = useRef(false);

      const onEnter = () => {
        setHovering(true);
        if (fetched.current) return;
        fetched.current = true;
        void readFilePreview(filePath).then((text) => setPreview(text ?? null));
      };

      return (
        <span
          className="noat-file-link-wrap"
          onMouseEnter={onEnter}
          onMouseLeave={() => setHovering(false)}
        >
          <button type="button" className="noat-file-link" title={filePath} onClick={open}>
            <span className="noat-file-link-icon">{FILE_ICON}</span>
            {fileName}
          </button>
          {hovering && (
            <span className="noat-file-link-preview" role="tooltip" contentEditable={false}>
              <span className="noat-file-link-preview-path">{filePath}</span>
              {preview === undefined ? (
                <span className="noat-file-link-preview-empty">Loading…</span>
              ) : preview === null ? (
                <span className="noat-file-link-preview-empty">No preview available</span>
              ) : (
                <span className="noat-file-link-preview-body">{preview}</span>
              )}
            </span>
          )}
        </span>
      );
    },
  }
);
