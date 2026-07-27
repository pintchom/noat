import { codeBlockOptions } from '@blocknote/code-block';
import {
  BlockNoteSchema,
  type PartialBlock,
  createCodeBlockSpec,
  defaultBlockSpecs,
  defaultInlineContentSpecs,
  defaultStyleSpecs,
} from '@blocknote/core';
import {
  SuggestionMenu,
  filterSuggestionItems,
  insertOrUpdateBlockForSlashMenu,
} from '@blocknote/core/extensions';
import { BlockNoteView } from '@blocknote/mantine';
import {
  type DefaultReactSuggestionItem,
  FormattingToolbar,
  FormattingToolbarController,
  SuggestionMenuController,
  getDefaultReactSlashMenuItems,
  getFormattingToolbarItems,
  useCreateBlockNote,
} from '@blocknote/react';
import { createParser } from 'prosemirror-highlight/shiki';
import {
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  useEffect,
  useRef,
  useState,
} from 'react';
import { NOTE_ICON, noteIconForStorage, resolveNoteIcon } from '../core/display-icons';
import { type InlineComment, type NoteFile, serializeNote } from '../core/note';
import { stripCommentRef } from '../core/note-text';
import { Comment } from './Comment';
import { CommentPopover } from './CommentPopover';
import { CommentRef } from './CommentRef';
import { CommentToolbarButton } from './CommentToolbarButton';
import { FileLink } from './FileLink';
import { NoteIconPicker } from './NoteIconPicker';
import { NoteLink } from './NoteLink';
import { searchWorkspaceFiles } from './file-search-client';
import { searchNotes } from './note-search-client';
import { smartArrows } from './smart-arrows';
import '@blocknote/mantine/style.css';

/**
 * Code block spec with Shiki syntax highlighting. The default spec ships
 * without a highlighter (BlockNote keeps it out to save bundle size), so
 * code blocks would render as plain text.
 *
 * BlockNote's highlight plugin reuses a parser cached under the well-known
 * `Symbol.for('blocknote.shikiParser')` before building its own single-theme
 * one. Registering a dual-theme parser before the highlighter promise
 * resolves makes every token carry both palettes (GitHub Light inline,
 * GitHub Dark via the `--shiki-dark` custom property), so styles.css can
 * follow IDE theme changes live without re-highlighting.
 */
const codeBlock = createCodeBlockSpec({
  ...codeBlockOptions,
  createHighlighter: async () => {
    const highlighter = await codeBlockOptions.createHighlighter();
    const parser = createParser(highlighter, {
      themes: { light: 'github-light', dark: 'github-dark' },
      defaultColor: 'light',
    });
    (globalThis as Record<symbol, unknown>)[Symbol.for('blocknote.shikiParser')] = parser;
    return highlighter;
  },
});

const schema = BlockNoteSchema.create({
  blockSpecs: {
    ...defaultBlockSpecs,
    codeBlock,
    comment: Comment,
  },
  inlineContentSpecs: {
    ...defaultInlineContentSpecs,
    fileLink: FileLink,
    noteLink: NoteLink,
  },
  styleSpecs: {
    ...defaultStyleSpecs,
    commentRef: CommentRef,
  },
});

// Trigger for the /page note picker. Opened programmatically (never typed),
// mirroring how BlockNote's own Emoji slash item opens the ":" picker.
const NOTE_PICKER_TRIGGER = '※';

// Just enough delay for the pointer to travel from a comment highlight into
// its popover without the card closing mid-way.
const POPOVER_HIDE_GRACE_MS = 120;

function readDarkTheme(): boolean {
  return (
    document.body.classList.contains('vscode-dark') ||
    document.body.classList.contains('vscode-high-contrast')
  );
}

function useVsCodeDarkTheme(): boolean {
  const [isDark, setIsDark] = useState(readDarkTheme);

  useEffect(() => {
    const observer = new MutationObserver(() => setIsDark(readDarkTheme()));
    observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  return isDark;
}

export function NoteEditor({
  note,
  onEdit,
}: {
  note: NoteFile;
  onEdit: (text: string) => void;
}) {
  const [title, setTitle] = useState(note.title);
  const [icon, setIcon] = useState(noteIconForStorage(note.icon));
  const isDark = useVsCodeDarkTheme();

  // Inline comments: entries live in the note file next to blocks; their
  // highlights are commentRef styles in the text. The ref mirrors the state
  // so emit (called from stale closures) always serializes the latest list.
  const [comments, setComments] = useState<InlineComment[]>(note.comments ?? []);
  const commentsRef = useRef(comments);
  const [popover, setPopover] = useState<{
    id: string;
    editing: boolean;
    rect: { left: number; bottom: number };
  } | null>(null);
  const hideTimer = useRef<number | undefined>(undefined);

  const editor = useCreateBlockNote({
    schema,
    extensions: [smartArrows],
    initialContent: note.blocks.length > 0 ? (note.blocks as unknown as PartialBlock[]) : undefined,
  });

  const emit = (nextTitle: string, nextIcon: string | undefined): void => {
    onEdit(
      serializeNote({
        ...note,
        title: nextTitle,
        icon: nextIcon,
        updatedAt: new Date().toISOString(),
        blocks: editor.document as unknown as NoteFile['blocks'],
        comments: commentsRef.current.length > 0 ? commentsRef.current : undefined,
      })
    );
  };

  const updateComments = (next: InlineComment[]): void => {
    commentsRef.current = next;
    setComments(next);
  };

  /** Remove one comment's highlight from every block that carries it. */
  const stripHighlight = (id: string): void => {
    const current = editor.document as unknown as NoteFile['blocks'];
    const cleaned = stripCommentRef(current, id);
    cleaned.forEach((block, index) => {
      const original = current[index];
      if (!original || block === original) return;
      const children = (block as { children?: unknown }).children;
      editor.updateBlock(original.id, {
        content: (block as { content?: unknown }).content,
        ...(Array.isArray(children) && { children }),
      } as unknown as PartialBlock);
    });
  };

  const cancelHide = (): void => window.clearTimeout(hideTimer.current);

  const scheduleHide = (): void => {
    cancelHide();
    hideTimer.current = window.setTimeout(() => {
      setPopover((current) => (current?.editing ? current : null));
    }, POPOVER_HIDE_GRACE_MS);
  };

  const openPopover = (id: string, editing: boolean): void => {
    cancelHide();
    // The highlight span may not be in the DOM yet right after addStyles.
    requestAnimationFrame(() => {
      const span = document.querySelector(`[data-noat-comment="${id}"]`);
      const rect = span?.getBoundingClientRect();
      if (rect) setPopover({ id, editing, rect: { left: rect.left, bottom: rect.bottom } });
    });
  };

  const startComment = (id: string): void => {
    updateComments([...commentsRef.current, { id, text: '', createdAt: new Date().toISOString() }]);
    openPopover(id, true);
  };

  const cancelComment = (id: string): void => {
    const entry = commentsRef.current.find((comment) => comment.id === id);
    // Abandoning a comment that never got text undoes it entirely; canceling
    // an edit of an existing comment just closes the card.
    if (entry && entry.text.trim().length === 0) {
      updateComments(commentsRef.current.filter((comment) => comment.id !== id));
      stripHighlight(id);
      emit(title, icon);
    }
    setPopover(null);
  };

  const saveComment = (id: string, text: string): void => {
    const trimmed = text.trim();
    if (trimmed.length === 0) {
      cancelComment(id);
      return;
    }
    updateComments(
      commentsRef.current.map((comment) =>
        comment.id === id ? { ...comment, text: trimmed } : comment
      )
    );
    emit(title, icon);
    setPopover(null);
  };

  const resolveComment = (id: string): void => {
    updateComments(commentsRef.current.filter((comment) => comment.id !== id));
    stripHighlight(id);
    emit(title, icon);
    setPopover(null);
  };

  const onEditorMouseOver = (event: ReactMouseEvent<HTMLDivElement>): void => {
    const target = event.target as HTMLElement;
    if (target.closest?.('.noat-comment-popover')) return;
    const span = target.closest?.('[data-noat-comment]');
    if (!span) {
      // Pointer over other content: close a lingering card. This also covers
      // highlights whose DOM node an editor re-render replaced mid-hover —
      // their mouseout never fires, so the mouseout path alone can miss it.
      if (popover && !popover.editing) scheduleHide();
      return;
    }
    cancelHide();
    const id = span.getAttribute('data-noat-comment');
    if (!id || popover?.id === id || popover?.editing) return;
    openPopover(id, false);
  };

  const onEditorMouseOut = (event: ReactMouseEvent<HTMLDivElement>): void => {
    if ((event.target as HTMLElement).closest?.('[data-noat-comment]')) scheduleHide();
  };

  const getFileItems = async (query: string): Promise<DefaultReactSuggestionItem[]> =>
    (await searchWorkspaceFiles(query)).map((file) => ({
      title: file.split('/').pop() ?? file,
      subtext: file,
      onItemClick: () => {
        editor.insertInlineContent([{ type: 'fileLink', props: { path: file } }, ' ']);
      },
    }));

  // Notion-style "/page": the slash item opens a second suggestion menu that
  // searches notes and inserts a noteLink chip for the picked one.
  const pageLinkItem: DefaultReactSuggestionItem = {
    title: 'Page',
    subtext: 'Link to another note',
    aliases: ['page', 'note', 'link', 'reference', 'noat'],
    group: 'Notes',
    icon: <span>{NOTE_ICON}</span>,
    onItemClick: () => {
      editor.getExtension(SuggestionMenu)?.openSuggestionMenu(NOTE_PICKER_TRIGGER, {
        deleteTriggerCharacter: true,
        ignoreQueryLength: true,
      });
    },
  };

  // Review-feedback callout: converts the current block (or inserts below a
  // non-empty one), matching how the default slash items place new blocks.
  const commentItem: DefaultReactSuggestionItem = {
    title: 'Comment',
    subtext: 'Feedback on the content above',
    aliases: ['comment', 'feedback', 'suggestion', 'review'],
    group: 'Notes',
    icon: <span>💬</span>,
    onItemClick: () => {
      insertOrUpdateBlockForSlashMenu(editor, { type: 'comment' });
    },
  };

  const getSlashMenuItems = async (query: string): Promise<DefaultReactSuggestionItem[]> =>
    filterSuggestionItems(
      [...getDefaultReactSlashMenuItems(editor), pageLinkItem, commentItem],
      query
    );

  const getNoteItems = async (query: string): Promise<DefaultReactSuggestionItem[]> =>
    (await searchNotes(query)).map((linked) => ({
      title: linked.title || 'Untitled',
      subtext: linked.scopeLabel,
      icon: <span>{resolveNoteIcon(linked.icon)}</span>,
      onItemClick: () => {
        editor.insertInlineContent([
          {
            type: 'noteLink',
            props: {
              notePath: linked.notePath,
              title: linked.title,
              icon: linked.icon ?? '',
            },
          },
          ' ',
        ]);
      },
    }));

  const toggleCodeBlock = (): void => {
    const selectedBlocks = editor.getSelection()?.blocks ?? [editor.getTextCursorPosition().block];
    const targetType = selectedBlocks.every((block) => block.type === 'codeBlock')
      ? ('paragraph' as const)
      : ('codeBlock' as const);
    for (const block of selectedBlocks) {
      editor.updateBlock(block, { type: targetType });
    }
  };

  // Slack-style code formatting: Mod+Shift+C toggles inline code on the
  // selection, Mod+Shift+Alt+C toggles the selected blocks into a code block.
  // Runs in the capture phase so nothing inside ProseMirror can consume the
  // event first. event.code is used because Alt+C produces a different
  // event.key on macOS.
  const onFormattingKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (!(event.metaKey || event.ctrlKey) || !event.shiftKey || event.code !== 'KeyC') return;
    event.preventDefault();
    event.stopPropagation();
    if (event.altKey) {
      toggleCodeBlock();
    } else {
      editor.toggleStyles({ code: true });
    }
  };

  return (
    <div className="noat-note">
      <div className="noat-title-area">
        <NoteIconPicker
          icon={icon}
          onChange={(nextIcon) => {
            setIcon(nextIcon);
            emit(title, nextIcon);
          }}
        />
        <input
          className="noat-title"
          value={title}
          placeholder="Untitled"
          onChange={(event) => {
            setTitle(event.target.value);
            emit(event.target.value, icon);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === 'ArrowDown') {
              event.preventDefault();
              editor.focus();
            }
          }}
        />
      </div>
      {/* biome-ignore lint/a11y/useKeyWithMouseEvents: pointer-only hover reveal; comments are reachable via the selection toolbar for keyboard flows */}
      <div
        onKeyDownCapture={onFormattingKeyDown}
        onMouseOver={onEditorMouseOver}
        onMouseOut={onEditorMouseOut}
      >
        <BlockNoteView
          editor={editor}
          theme={isDark ? 'dark' : 'light'}
          slashMenu={false}
          formattingToolbar={false}
          onChange={() => emit(title, icon)}
        >
          {/* Default selection toolbar plus a Comment button — the only way
              to attach a comment to table content, since cells can't hold
              blocks and the slash menu stays closed inside them. */}
          <FormattingToolbarController
            formattingToolbar={() => (
              <FormattingToolbar>
                {getFormattingToolbarItems()}
                <CommentToolbarButton key="commentButton" onAddComment={startComment} />
              </FormattingToolbar>
            )}
          />
          <SuggestionMenuController triggerCharacter="@" getItems={getFileItems} />
          {/* Replaces the default slash menu to add the "Page" item; the
              shouldOpen guard matches BlockNote's default (no menu inside
              table cells). */}
          <SuggestionMenuController
            triggerCharacter="/"
            getItems={getSlashMenuItems}
            shouldOpen={(tr) => !tr.selection.$from.parent.type.isInGroup('tableContent')}
          />
          <SuggestionMenuController
            triggerCharacter={NOTE_PICKER_TRIGGER}
            getItems={getNoteItems}
          />
        </BlockNoteView>
        {popover &&
          (() => {
            const active = comments.find((comment) => comment.id === popover.id);
            if (!active) return null;
            return (
              <CommentPopover
                comment={active}
                editing={popover.editing}
                anchorRect={popover.rect}
                onStartEdit={() => setPopover({ ...popover, editing: true })}
                onSave={(text) => saveComment(popover.id, text)}
                onCancel={() => cancelComment(popover.id)}
                onResolve={() => resolveComment(popover.id)}
                onHoverChange={(hovering) => (hovering ? cancelHide() : scheduleHide())}
              />
            );
          })()}
      </div>
    </div>
  );
}
