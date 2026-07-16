import { codeBlockOptions } from '@blocknote/code-block';
import { BlockNoteSchema, type PartialBlock, defaultInlineContentSpecs } from '@blocknote/core';
import { BlockNoteView } from '@blocknote/mantine';
import {
  type DefaultReactSuggestionItem,
  SuggestionMenuController,
  useCreateBlockNote,
} from '@blocknote/react';
import { type KeyboardEvent, useEffect, useState } from 'react';
import { noteIconForStorage } from '../core/display-icons';
import { type NoteFile, serializeNote } from '../core/note';
import { FileLink } from './FileLink';
import { NoteIconPicker } from './NoteIconPicker';
import { searchWorkspaceFiles } from './file-search-client';
import { smartArrows } from './smart-arrows';
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
    codeBlock: codeBlockOptions,
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
          onChange={() => emit(title, icon)}
        >
          <SuggestionMenuController triggerCharacter="@" getItems={getFileItems} />
        </BlockNoteView>
      </div>
    </div>
  );
}
