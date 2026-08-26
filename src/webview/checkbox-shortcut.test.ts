// @vitest-environment jsdom
import { codeBlockOptions } from '@blocknote/code-block';
import {
  BlockNoteEditor,
  BlockNoteSchema,
  createCodeBlockSpec,
  createStyleSpec,
  defaultBlockSpecs,
  defaultInlineContentSpecs,
  defaultStyleSpecs,
} from '@blocknote/core';
import { expect, test } from 'vitest';
import { nestedBackspace } from './nested-backspace';
import { smartArrows } from './smart-arrows';

const codeBlock = createCodeBlockSpec(codeBlockOptions);

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

const schema = BlockNoteSchema.create({
  blockSpecs: { ...defaultBlockSpecs, codeBlock },
  inlineContentSpecs: defaultInlineContentSpecs,
  styleSpecs: {
    ...defaultStyleSpecs,
    superscript: verticalStyle('sup', 'superscript'),
    subscript: verticalStyle('sub', 'subscript'),
  },
});

type SchemaEditor = BlockNoteEditor<typeof schema>;

function typeChar(editor: SchemaEditor, char: string): boolean {
  const view = editor._tiptapEditor.view;
  const from = view.state.selection.from;
  const handled = view.someProp('handleTextInput', (f) => f(view, from, from, char));
  if (!handled) {
    view.dispatch(view.state.tr.insertText(char, from));
  }
  return handled ?? false;
}

function makeEditor(): SchemaEditor {
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
