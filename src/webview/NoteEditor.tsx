import { codeBlockOptions } from '@blocknote/code-block';
import {
  BlockNoteSchema,
  type PartialBlock,
  createCodeBlockSpec,
  createStyleSpec,
  defaultBlockSpecs,
  defaultInlineContentSpecs,
  defaultStyleSpecs,
} from '@blocknote/core';
import { SuggestionMenu, filterSuggestionItems } from '@blocknote/core/extensions';
import { BlockNoteView } from '@blocknote/mantine';
import {
  type DefaultReactSuggestionItem,
  SuggestionMenuController,
  getDefaultReactSlashMenuItems,
  useCreateBlockNote,
} from '@blocknote/react';
import { createParser } from 'prosemirror-highlight/shiki';
import { type KeyboardEvent, useEffect, useRef, useState } from 'react';
import { NOTE_ICON, noteIconForStorage, resolveNoteIcon } from '../core/display-icons';
import { type NoteFile, serializeNote } from '../core/note';
import { FileLink } from './FileLink';
import { NoteIconPicker } from './NoteIconPicker';
import { NoteLink } from './NoteLink';
import { resolveAssetUrl, saveAsset } from './asset-client';
import { searchWorkspaceFiles } from './file-search-client';
import { nestedBackspace } from './nested-backspace';
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

/**
 * Superscript and subscript, for exponents and chemistry. BlockNote ships
 * neither, so they are custom boolean styles rendering plain `<sup>`/`<sub>`.
 * The tags carry the meaning, so `toExternalHTML` is left to default and the
 * markdown bridge in src/mcp/markdown.ts recognises them by tag name.
 */
const verticalStyle = (tag: 'sup' | 'sub', type: 'superscript' | 'subscript') =>
  createStyleSpec(
    { type, propSchema: 'boolean' },
    {
      render: () => {
        const dom = document.createElement(tag);
        return { dom, contentDOM: dom };
      },
      parse: (element) => (element.tagName.toLowerCase() === tag ? true : undefined),
    }
  );

const superscript = verticalStyle('sup', 'superscript');
const subscript = verticalStyle('sub', 'subscript');

const schema = BlockNoteSchema.create({
  blockSpecs: {
    ...defaultBlockSpecs,
    codeBlock,
  },
  inlineContentSpecs: {
    ...defaultInlineContentSpecs,
    fileLink: FileLink,
    noteLink: NoteLink,
  },
  styleSpecs: {
    ...defaultStyleSpecs,
    superscript,
    subscript,
  },
});

// Trigger for the /page note picker. Opened programmatically (never typed),
// mirroring how BlockNote's own Emoji slash item opens the ":" picker.
const NOTE_PICKER_TRIGGER = '※';

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
  externalRevision,
  onEdit,
}: {
  note: NoteFile;
  externalRevision: number;
  onEdit: (text: string) => void;
}) {
  const [title, setTitle] = useState(note.title);
  const [icon, setIcon] = useState(noteIconForStorage(note.icon));
  const isDark = useVsCodeDarkTheme();

  const editor = useCreateBlockNote({
    schema,
    extensions: [smartArrows, nestedBackspace],
    // Local images (picked, pasted, or dropped) are stored in the note
    // store's assets dir; notes keep store-relative URLs that only resolve
    // to loadable webview URIs at render time.
    uploadFile: saveAsset,
    resolveFileUrl: async (url) => resolveAssetUrl(url),
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
      })
    );
  };

  // Set while we push host content into the editor, so the resulting
  // onChange doesn't echo straight back as a fresh edit — that would restamp
  // updatedAt and re-dirty the document the user just reverted.
  const applyingExternal = useRef(false);
  const appliedRevision = useRef(externalRevision);

  // Re-apply external changes (VS Code undo, agent writes, git-sync) into the
  // live editor instead of remounting it. A remount rebuilds the ProseMirror
  // state from scratch, which drops focus and the selection every time.
  useEffect(() => {
    if (appliedRevision.current === externalRevision) return;
    appliedRevision.current = externalRevision;

    const cursor = editor.getTextCursorPosition();
    applyingExternal.current = true;
    try {
      editor.replaceBlocks(editor.document, note.blocks as unknown as PartialBlock[]);
    } finally {
      applyingExternal.current = false;
    }
    setTitle(note.title);
    setIcon(noteIconForStorage(note.icon));

    // Block ids are stable across external rewrites, so the caret can go back
    // where it was whenever its block survived the change.
    if (editor.getBlock(cursor.block.id)) {
      editor.setTextCursorPosition(cursor.block.id, 'end');
      editor.focus();
    }
  }, [externalRevision, note, editor]);

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

  const getSlashMenuItems = async (query: string): Promise<DefaultReactSuggestionItem[]> =>
    filterSuggestionItems([...getDefaultReactSlashMenuItems(editor), pageLinkItem], query);

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

  /**
   * The `.bn-toggle-wrapper` of the toggle block holding the cursor, or null
   * when the cursor isn't in one. Toggleable headings and toggleListItems both
   * render one; the wrapper holds only the toggle's own title, since child
   * blocks live in a sibling `.bn-block-group`.
   */
  const toggleWrapperAtCursor = (): HTMLElement | null => {
    const blockEl = document.querySelector(
      `[data-id="${CSS.escape(editor.getTextCursorPosition().block.id)}"]`
    );
    return blockEl?.querySelector<HTMLElement>('.bn-toggle-wrapper') ?? null;
  };

  /** True when the collapsed cursor sits after the last character of `content`. */
  const cursorAtEndOf = (content: Element): boolean => {
    const selection = window.getSelection();
    if (!selection?.isCollapsed || !selection.anchorNode) return false;
    if (!content.contains(selection.anchorNode)) return false;
    const rest = document.createRange();
    rest.setStart(selection.anchorNode, selection.anchorOffset);
    rest.setEndAfter(content);
    return rest.toString().length === 0;
  };

  /** Add an empty first child to a toggle and put the cursor in it. */
  const enterToggleBody = (): void => {
    const block = editor.getTextCursorPosition().block;
    const firstChild = block.children[0];
    if (firstChild) {
      const [inserted] = editor.insertBlocks([{ type: 'paragraph' }], firstChild, 'before');
      if (inserted) editor.setTextCursorPosition(inserted, 'end');
      return;
    }
    const created = editor.updateBlock(block, { children: [{ type: 'paragraph' }] }).children[0];
    if (created) editor.setTextCursorPosition(created.id, 'end');
  };

  /**
   * Notion-style toggle keys. Mod+Enter opens or closes the toggle holding the
   * cursor; plain Enter at the end of an open toggle's title drops into its
   * body instead of creating a sibling after it.
   *
   * Open/closed state lives in localStorage behind BlockNote's own click
   * handler and no editor command exposes it, so this clicks the same button —
   * that keeps the stored state, the `data-show-children` attribute and the
   * "add block" affordance in sync instead of adding a second source of truth.
   */
  const onToggleKeyDown = (event: KeyboardEvent<HTMLDivElement>): boolean => {
    if (event.key !== 'Enter' || event.shiftKey || event.altKey) return false;
    // An open suggestion menu owns Enter for picking its highlighted item.
    if (document.querySelector('.bn-suggestion-menu')) return false;

    const wrapper = toggleWrapperAtCursor();
    if (!wrapper) return false;

    if (event.metaKey || event.ctrlKey) {
      wrapper.querySelector<HTMLButtonElement>('.bn-toggle-button')?.click();
      return true;
    }

    const content = wrapper.querySelector('.bn-inline-content');
    if (wrapper.getAttribute('data-show-children') !== 'true') return false;
    if (!content || !cursorAtEndOf(content)) return false;
    enterToggleBody();
    return true;
  };

  // Superscript and subscript are mutually exclusive, so turning one on clears
  // the other rather than nesting `<sup>` inside `<sub>`.
  const toggleVertical = (style: 'superscript' | 'subscript'): void => {
    const other = style === 'superscript' ? 'subscript' : 'superscript';
    if (editor.getActiveStyles()[other]) editor.removeStyles({ [other]: true });
    editor.toggleStyles({ [style]: true });
  };

  // Slack-style code formatting: Mod+Shift+C toggles inline code on the
  // selection, Mod+Shift+Alt+C toggles the selected blocks into a code block.
  // Mod+Shift+. and Mod+Shift+, toggle superscript and subscript. Runs in the
  // capture phase so nothing inside ProseMirror can consume the event first.
  // event.code is used because Alt+C produces a different event.key on macOS,
  // and because Shift turns "." and "," into ">" and "<".
  const onEditorKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (onToggleKeyDown(event)) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (!(event.metaKey || event.ctrlKey) || !event.shiftKey) return;
    const action = {
      KeyC: () => (event.altKey ? toggleCodeBlock() : editor.toggleStyles({ code: true })),
      Period: () => toggleVertical('superscript'),
      Comma: () => toggleVertical('subscript'),
    }[event.code];
    if (!action) return;
    event.preventDefault();
    event.stopPropagation();
    action();
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
      <div onKeyDownCapture={onEditorKeyDown}>
        <BlockNoteView
          editor={editor}
          theme={isDark ? 'dark' : 'light'}
          slashMenu={false}
          onChange={() => {
            if (applyingExternal.current) return;
            emit(title, icon);
          }}
        >
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
      </div>
    </div>
  );
}
