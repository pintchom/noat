import { BlockNoteSchema, type PartialBlock, defaultInlineContentSpecs } from '@blocknote/core';
import { BlockNoteView } from '@blocknote/mantine';
import {
  type DefaultReactSuggestionItem,
  SuggestionMenuController,
  useCreateBlockNote,
} from '@blocknote/react';
import { useEffect, useMemo, useState } from 'react';
import type { IdeThemeJson } from '../core/editor-messages';
import { type NoteFile, serializeNote } from '../core/note';
import { FileLink } from './FileLink';
import { searchWorkspaceFiles } from './file-search-client';
import { clearHighlighterCache, createIdeCodeBlockOptions } from './ide-highlighter';
import '@blocknote/mantine/style.css';

const schema = BlockNoteSchema.create({
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
  ideTheme,
  onEdit,
}: {
  note: NoteFile;
  ideTheme: IdeThemeJson | undefined;
  onEdit: (text: string) => void;
}) {
  const [title, setTitle] = useState(note.title);
  const bodyIsDark = useVsCodeDarkTheme();
  const isDark = ideTheme ? ideTheme.type === 'dark' : bodyIsDark;

  // One highlighter per mount; the App remounts us when the IDE theme changes.
  const codeBlock = useMemo(() => {
    clearHighlighterCache();
    return createIdeCodeBlockOptions(ideTheme, isDark);
  }, [ideTheme, isDark]);

  const editor = useCreateBlockNote({
    schema,
    codeBlock,
    initialContent: note.blocks.length > 0 ? (note.blocks as unknown as PartialBlock[]) : undefined,
  });

  const emit = (nextTitle: string): void => {
    onEdit(
      serializeNote({
        ...note,
        title: nextTitle,
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
      <input
        className="noat-title"
        value={title}
        placeholder="Untitled"
        onChange={(event) => {
          setTitle(event.target.value);
          emit(event.target.value);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === 'ArrowDown') {
            event.preventDefault();
            editor.focus();
          }
        }}
      />
      <BlockNoteView editor={editor} theme={isDark ? 'dark' : 'light'} onChange={() => emit(title)}>
        <SuggestionMenuController triggerCharacter="@" getItems={getFileItems} />
      </BlockNoteView>
    </div>
  );
}
