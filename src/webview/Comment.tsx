import { createReactBlockSpec } from '@blocknote/react';

/**
 * Review-comment callout, inserted via "/comment": feedback on the content
 * just above it, visually distinct from the note itself. Agents read these
 * over MCP and delete them once addressed, so presence means "still open".
 */
export const Comment = createReactBlockSpec(
  {
    type: 'comment',
    propSchema: {},
    content: 'inline',
  },
  {
    render: ({ contentRef }) => (
      <div className="noat-comment">
        <span className="noat-comment-icon" aria-hidden="true">
          💬
        </span>
        <div className="noat-comment-body" ref={contentRef} />
      </div>
    ),
  }
)();
