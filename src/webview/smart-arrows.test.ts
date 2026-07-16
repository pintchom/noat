// @vitest-environment jsdom
import { BlockNoteEditor } from '@blocknote/core';
import { expect, test } from 'vitest';
import { smartArrows } from './smart-arrows';

/** Feeds characters through ProseMirror's handleTextInput — the same path real typing takes. */
function typeText(editor: BlockNoteEditor, text: string): void {
  const view = editor.prosemirrorView;
  if (!view) throw new Error('editor is not mounted');
  for (const char of text) {
    const { from, to } = view.state.selection;
    const insert = () => view.state.tr.insertText(char, from, to);
    const handled = view.someProp('handleTextInput', (handler) =>
      handler(view, from, to, char, insert)
    );
    if (!handled) {
      view.dispatch(insert());
    }
  }
}

function createMountedEditor(): BlockNoteEditor {
  const editor = BlockNoteEditor.create({ extensions: [smartArrows] });
  editor.mount(document.createElement('div'));
  return editor;
}

function firstBlockText(editor: BlockNoteEditor): string {
  const content = editor.document[0]?.content as Array<{ text: string }>;
  return content.map((piece) => piece.text).join('');
}

function focusFirstBlock(editor: BlockNoteEditor): void {
  const firstBlock = editor.document[0];
  if (!firstBlock) throw new Error('editor has no blocks');
  editor.setTextCursorPosition(firstBlock.id, 'start');
}

test('typing --> replaces it with an arrow', () => {
  const editor = createMountedEditor();
  focusFirstBlock(editor);

  typeText(editor, 'input --> output');

  expect(firstBlockText(editor)).toBe('input → output');
});

test('inline code keeps a literal -->', () => {
  const editor = createMountedEditor();
  focusFirstBlock(editor);
  editor.addStyles({ code: true });

  typeText(editor, 'a --> b');

  expect(firstBlockText(editor)).toBe('a --> b');
});
