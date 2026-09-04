// @vitest-environment jsdom
import { BlockNoteEditor } from '@blocknote/core';
import type { Transaction } from 'prosemirror-state';
import { expect, test } from 'vitest';
import { nestedBackspace } from './nested-backspace';
import { type NoatEditor, schema } from './schema';
import { smartArrows } from './smart-arrows';

function typeChar(editor: NoatEditor, char: string): boolean {
  const view = editor._tiptapEditor.view;
  const from = view.state.selection.from;
  const noop = (): Transaction => view.state.tr.insertText(char, from);
  const handled = view.someProp('handleTextInput', (f) => f(view, from, from, char, noop));
  if (!handled) {
    view.dispatch(view.state.tr.insertText(char, from));
  }
  return !!handled;
}

function makeEditor(): NoatEditor {
  const editor = BlockNoteEditor.create({
    schema,
    initialContent: [{ id: 'a', type: 'paragraph', content: '' }],
    extensions: [smartArrows, nestedBackspace],
  });
  editor.mount(document.createElement('div'));
  editor.setTextCursorPosition('a', 'end');
  return editor;
}

test('[] + space converts to unchecked checklist item', () => {
  const editor = makeEditor();
  typeChar(editor, '[');
  typeChar(editor, ']');
  typeChar(editor, ' ');
  expect(editor.getBlock('a')?.type).toBe('checkListItem');
  expect((editor.getBlock('a')?.props as { checked?: boolean })?.checked).toBe(false);
});

test('[x] + space converts to checked checklist item', () => {
  const editor = makeEditor();
  typeChar(editor, '[');
  typeChar(editor, 'x');
  typeChar(editor, ']');
  typeChar(editor, ' ');
  expect(editor.getBlock('a')?.type).toBe('checkListItem');
  expect((editor.getBlock('a')?.props as { checked?: boolean })?.checked).toBe(true);
});

test('- + space converts to bullet list item', () => {
  const editor = makeEditor();
  typeChar(editor, '-');
  typeChar(editor, ' ');
  expect(editor.getBlock('a')?.type).toBe('bulletListItem');
});

test('# + space converts to heading', () => {
  const editor = makeEditor();
  typeChar(editor, '#');
  typeChar(editor, ' ');
  expect(editor.getBlock('a')?.type).toBe('heading');
});
