import { codeBlockOptions } from '@blocknote/code-block';
import {
  BlockNoteSchema,
  type PartialBlock,
  createCodeBlockSpec,
  defaultBlockSpecs,
  defaultInlineContentSpecs,
} from '@blocknote/core';
import { BlockNoteView } from '@blocknote/mantine';
import {
  type DefaultReactSuggestionItem,
  SuggestionMenuController,
  useCreateBlockNote,
} from '@blocknote/react';
import { createParser } from 'prosemirror-highlight/shiki';
import { type KeyboardEvent, useEffect, useRef, useState } from 'react';
import { noteIconForStorage } from '../core/display-icons';
import { type NoteFile, serializeNote } from '../core/note';
import { FileLink } from './FileLink';
import { FindBar } from './FindBar';
import { NoteIconPicker } from './NoteIconPicker';
import { searchWorkspaceFiles } from './file-search-client';
import { findHighlights, findMatches, findPluginKey } from './find';
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
  },
  inlineContentSpecs: {
    ...defaultInlineContentSpecs,
    fileLink: FileLink,
  },
});

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

interface FindBarState {
  open: boolean;
  query: string;
  activeIndex: number;
  matchCount: number;
  focusToken: number;
}

const CLOSED_FIND: FindBarState = {
  open: false,
  query: '',
  activeIndex: 0,
  matchCount: 0,
  focusToken: 0,
};

export function NoteEditor({
  note,
  onEdit,
}: {
  note: NoteFile;
  onEdit: (text: string) => void;
}) {
  const [title, setTitle] = useState(note.title);
  const [icon, setIcon] = useState(noteIconForStorage(note.icon));
  const [find, setFind] = useState(CLOSED_FIND);
  const isDark = useVsCodeDarkTheme();

  const editor = useCreateBlockNote({
    schema,
    extensions: [smartArrows, findHighlights],
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

  const getFileItems = async (query: string): Promise<DefaultReactSuggestionItem[]> =>
    (await searchWorkspaceFiles(query)).map((file) => ({
      title: file.split('/').pop() ?? file,
      subtext: file,
      onItemClick: () => {
        editor.insertInlineContent([{ type: 'fileLink', props: { path: file } }, ' ']);
      },
    }));

  /**
   * Recompute matches for the query, highlight them in the document (the
   * requested index becomes the emphasized "current" match, wrapping in both
   * directions), and scroll it into view. Returns what was actually applied.
   */
  const applyFind = (query: string, index: number): { matchCount: number; activeIndex: number } => {
    const view = editor.prosemirrorView;
    if (!view) return { matchCount: 0, activeIndex: 0 };
    const matches = findMatches(view.state.doc, query);
    const activeIndex =
      matches.length > 0 ? ((index % matches.length) + matches.length) % matches.length : 0;
    view.dispatch(view.state.tr.setMeta(findPluginKey, { matches, activeIndex }));
    view.dom.querySelector('.noat-find-match-current')?.scrollIntoView({ block: 'nearest' });
    return { matchCount: matches.length, activeIndex };
  };

  const openFind = (): void => {
    // Like VS Code's find widget, a text selection seeds the query.
    const view = editor.prosemirrorView;
    const selected = view
      ? view.state.doc.textBetween(view.state.selection.from, view.state.selection.to, ' ')
      : '';
    const query = selected.trim().length > 0 ? selected : find.query;
    const applied = applyFind(query, 0);
    setFind((state) => ({
      open: true,
      query,
      ...applied,
      focusToken: state.focusToken + 1,
    }));
  };

  const changeFindQuery = (query: string): void => {
    const applied = applyFind(query, 0);
    setFind((state) => ({ ...state, query, ...applied }));
  };

  const navigateFind = (direction: 1 | -1): void => {
    const applied = applyFind(find.query, find.activeIndex + direction);
    setFind((state) => ({ ...state, ...applied }));
  };

  const closeFind = (): void => {
    applyFind('', 0);
    setFind((state) => ({ ...CLOSED_FIND, query: state.query, focusToken: state.focusToken }));
    editor.focus();
  };

  // Cmd/Ctrl+F anywhere in the webview opens the find bar (capture phase, so
  // it wins over ProseMirror and VS Code's keybinding forwarding). A ref keeps
  // the window listener stable while reading fresh state.
  const openFindRef = useRef(openFind);
  openFindRef.current = openFind;
  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent): void => {
      if (!(event.metaKey || event.ctrlKey) || event.shiftKey || event.altKey) return;
      if (event.code !== 'KeyF') return;
      event.preventDefault();
      event.stopPropagation();
      openFindRef.current();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, []);

  // Edits shift or destroy matches; re-run the search so highlights and the
  // match count stay accurate while the find bar is open.
  const refreshFind = (): void => {
    if (!find.open || !find.query) return;
    const applied = applyFind(find.query, find.activeIndex);
    setFind((state) => ({ ...state, ...applied }));
  };

  const toggleCodeBlock = (): void => {
    const selectedBlocks = editor.getSelection()?.blocks ?? [editor.getTextCursorPosition().block];
    const targetType = selectedBlocks.every((block) => block.type === 'codeBlock')
      ? ('paragraph' as const)
      : ('codeBlock' as const);
    for (const block of selectedBlocks) {
      editor.updateBlock(block, { type: targetType });
    }
  };

  // Slack-style code formatting: Mod+Shift+S toggles inline code on the
  // selection, Mod+Shift+Alt+S toggles the selected blocks into a code block.
  // Runs in the capture phase because Tiptap's strike extension binds
  // Mod+Shift+S inside ProseMirror and would otherwise consume the event.
  // event.code is used because Alt+S produces a different event.key on macOS.
  const onFormattingKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (!(event.metaKey || event.ctrlKey) || !event.shiftKey || event.code !== 'KeyS') return;
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
      {find.open && (
        <FindBar
          query={find.query}
          matchCount={find.matchCount}
          activeIndex={find.activeIndex}
          focusToken={find.focusToken}
          onQueryChange={changeFindQuery}
          onNavigate={navigateFind}
          onClose={closeFind}
        />
      )}
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
      <div onKeyDownCapture={onFormattingKeyDown}>
        <BlockNoteView
          editor={editor}
          theme={isDark ? 'dark' : 'light'}
          onChange={() => {
            emit(title, icon);
            refreshFind();
          }}
        >
          <SuggestionMenuController triggerCharacter="@" getItems={getFileItems} />
        </BlockNoteView>
      </div>
    </div>
  );
}
