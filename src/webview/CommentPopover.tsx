import { useEffect, useRef, useState } from 'react';
import type { InlineComment } from '../core/note';

const POPOVER_WIDTH = 280;

/**
 * Floating card for one inline comment, anchored under its highlight. Opens
 * in edit mode for a fresh comment (saving it empty cancels it); in view
 * mode the text is clickable to edit, and resolving deletes the comment
 * together with its highlight. Edit state lives in the editor shell so the
 * hover-close logic can leave an open editor alone.
 */
export function CommentPopover({
  comment,
  editing,
  anchorRect,
  onStartEdit,
  onSave,
  onCancel,
  onResolve,
  onHoverChange,
}: {
  comment: InlineComment;
  editing: boolean;
  anchorRect: { left: number; bottom: number };
  onStartEdit: () => void;
  onSave: (text: string) => void;
  onCancel: () => void;
  onResolve: () => void;
  onHoverChange: (hovering: boolean) => void;
}) {
  const [draft, setDraft] = useState(comment.text);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (editing) {
      setDraft(comment.text);
      textareaRef.current?.focus();
    }
  }, [editing, comment.text]);

  const left = Math.max(8, Math.min(anchorRect.left, window.innerWidth - POPOVER_WIDTH - 8));
  const top = anchorRect.bottom + 6;

  return (
    // The card needs hover tracking so moving the pointer from the highlight
    // into it doesn't count as leaving the comment.
    <div
      className="noat-comment-popover"
      style={{ left, top }}
      onMouseEnter={() => onHoverChange(true)}
      onMouseLeave={() => onHoverChange(false)}
    >
      {editing ? (
        <textarea
          ref={textareaRef}
          className="noat-comment-input"
          placeholder="Comment…"
          value={draft}
          rows={2}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              onSave(draft);
            }
            if (event.key === 'Escape') onCancel();
          }}
          onBlur={() => onSave(draft)}
        />
      ) : (
        <button
          type="button"
          className="noat-comment-text"
          title="Edit comment"
          onClick={onStartEdit}
        >
          {comment.text}
        </button>
      )}
      {/* Resolving is a review action, not a composing one — while typing it
          would only invite stray clicks. */}
      {!editing && (
        <div className="noat-comment-actions">
          <button
            type="button"
            className="noat-comment-resolve"
            title="Resolve (removes the comment and its highlight)"
            onClick={onResolve}
          >
            ✓ Resolve
          </button>
        </div>
      )}
    </div>
  );
}
