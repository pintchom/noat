import { codeBlockOptions } from '@blocknote/code-block';
import {
  BlockNoteSchema,
  type PartialBlock,
  createCodeBlockSpec,
  defaultBlockSpecs,
  defaultInlineContentSpecs,
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
import { type KeyboardEvent, useEffect, useState } from 'react';
import { NOTE_ICON, noteIconForStorage, resolveNoteIcon } from '../core/display-icons';
import { type NoteFile, serializeNote } from '../core/note';
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
  },
  inlineContentSpecs: {
    ...defaultInlineContentSpecs,
    fileLink: FileLink,
    noteLink: NoteLink,
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
  onEdit,
}: {
  note: NoteFile;
  onEdit: (text: string) => void;
}) {
  const [title, setTitle] = useState(note.title);
  const [icon, setIcon] = useState(noteIconForStorage(note.icon));
  const isDark = useVsCodeDarkTheme();

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
          slashMenu={false}
          onChange={() => emit(title, icon)}
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
