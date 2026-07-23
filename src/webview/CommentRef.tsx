import { createReactStyleSpec } from '@blocknote/react';

/**
 * Text-range anchor for an inline review comment, applied from the selection
 * toolbar. The style value is the comment id; the comment text itself lives
 * in the note file's comments field, keyed by that id. Custom styles (unlike
 * BlockNote's own comment marks) survive block-JSON serialization, which is
 * what lets these highlights persist in .noat.json files.
 */
export const CommentRef = createReactStyleSpec(
  { type: 'commentRef', propSchema: 'string' },
  {
    render: ({ value, contentRef }) => (
      <span className="noat-comment-ref" data-noat-comment={value} ref={contentRef} />
    ),
  }
);
