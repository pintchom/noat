import { codeBlockOptions } from '@blocknote/code-block';
import { BlockNoteSchema, type PartialBlock, defaultInlineContentSpecs } from '@blocknote/core';
import { BlockNoteView } from '@blocknote/mantine';
import {
  type DefaultReactSuggestionItem,
  SuggestionMenuController,
  useCreateBlockNote,
} from '@blocknote/react';
import { useEffect, useState } from 'react';
import { type NoteFile, serializeNote } from '../core/note';
import { FileLink } from './FileLink';
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

/** Rank workspace files against the @-menu query: filename hits first. */
function filterFiles(files: string[], query: string): string[] {
  const q = query.toLowerCase();
  if (q.length === 0) return files.slice(0, 12);

  const scored = files.flatMap((file) => {
    const lower = file.toLowerCase();
    const name = lower.split('/').pop() ?? lower;
    if (name.startsWith(q)) return [{ file, score: 0 }];
    if (name.includes(q)) return [{ file, score: 1 }];
    if (lower.includes(q)) return [{ file, score: 2 }];
    return [];
  });

  return scored
    .sort((a, b) => a.score - b.score || a.file.length - b.file.length)
    .slice(0, 12)
    .map((entry) => entry.file);
}

export function NoteEditor({
  note,
  workspaceFiles,
  onEdit,
}: {
  note: NoteFile;
  workspaceFiles: string[];
  onEdit: (text: string) => void;
}) {
  const [title, setTitle] = useState(note.title);
  const isDark = useVsCodeDarkTheme();

  const editor = useCreateBlockNote({
    schema,
    codeBlock: codeBlockOptions,
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
    filterFiles(workspaceFiles, query).map((file) => ({
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
