// @vitest-environment jsdom
import { BlockNoteEditor, type PartialBlock } from '@blocknote/core';
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

function createMountedEditor(initialContent?: PartialBlock[]): BlockNoteEditor {
  const editor = BlockNoteEditor.create({ extensions: [smartArrows], initialContent });
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

test('typing --> in inline code becomes an arrow', () => {
  const editor = createMountedEditor();
  focusFirstBlock(editor);
  editor.addStyles({ code: true });

  typeText(editor, 'a --> b');

  expect(firstBlockText(editor)).toBe('a → b');
});

test('typing --> in a code block becomes an arrow', () => {
  const editor = createMountedEditor([{ type: 'codeBlock', content: 'fn x ' }]);
  const firstBlock = editor.document[0];
  if (!firstBlock) throw new Error('editor has no blocks');
  editor.setTextCursorPosition(firstBlock.id, 'end');

  typeText(editor, '--> y');

  expect(firstBlockText(editor)).toBe('fn x → y');
});

test('a trailing -- in the previous block does not turn > into an arrow', () => {
  const editor = createMountedEditor([
    { type: 'codeBlock', content: 'a--' },
    { type: 'codeBlock', content: '' },
  ]);
  const secondBlock = editor.document[1];
  if (!secondBlock) throw new Error('editor is missing the second block');
  editor.setTextCursorPosition(secondBlock.id, 'start');

  typeText(editor, '>');

  expect(firstBlockText(editor)).toBe('a--');
  const content = editor.document[1]?.content as Array<{ text: string }>;
  expect(content.map((piece) => piece.text).join('')).toBe('>');
});
