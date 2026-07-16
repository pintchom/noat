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
import { useEffect, useState } from 'react';
import { noteIconForStorage } from '../core/display-icons';
import { type NoteFile, serializeNote } from '../core/note';
import { FileLink } from './FileLink';
import { NoteIconPicker } from './NoteIconPicker';
import { searchWorkspaceFiles } from './file-search-client';
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
      <BlockNoteView
        editor={editor}
        theme={isDark ? 'dark' : 'light'}
        onChange={() => emit(title, icon)}
      >
        <SuggestionMenuController triggerCharacter="@" getItems={getFileItems} />
      </BlockNoteView>
    </div>
  );
}
