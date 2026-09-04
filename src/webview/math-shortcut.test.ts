// @vitest-environment jsdom
import { BlockNoteEditor } from '@blocknote/core';
import type { Transaction } from 'prosemirror-state';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { expect, test } from 'vitest';
import { mathInput } from './math-input';
import { nestedBackspace } from './nested-backspace';
import { type NoatEditor, schema } from './schema';
import { smartArrows } from './smart-arrows';

/**
 * Input rules fire from ProseMirror's `handleTextInput`, so typing has to go
 * through the view rather than through editor commands. Same helper as
 * checkbox-shortcut.test.ts.
 */
function typeText(editor: NoatEditor, text: string): void {
  for (const char of text) {
    const view = editor._tiptapEditor.view;
    const from = view.state.selection.from;
    const noop = (): Transaction => view.state.tr.insertText(char, from);
    const handled = view.someProp('handleTextInput', (f) => f(view, from, from, char, noop));
    if (!handled) view.dispatch(view.state.tr.insertText(char, from));
  }
}

function makeEditor(): NoatEditor {
  const editor = BlockNoteEditor.create({
    schema,
    initialContent: [{ id: 'a', type: 'paragraph', content: '' }],
    extensions: [smartArrows, nestedBackspace, mathInput],
  });
  // React-rendered inline content (the math chip) needs somewhere to render.
  // BlockNoteView installs this in the app; these tests never mount React, so
  // a throwaway root per node stands in.
  editor.elementRenderer = (node, container) => {
    const root = createRoot(container);
    flushSync(() => root.render(node));
  };
  editor.mount(document.createElement('div'));
  editor.setTextCursorPosition('a', 'end');
  return editor;
}

interface Inline {
  type: string;
  text?: string;
  props?: { latex?: string };
}

/** The inline content of the first block, or [] for a block that has none. */
function inlineOf(editor: NoatEditor): Inline[] {
  const content = editor.document[0]?.content;
  return Array.isArray(content) ? (content as never) : [];
}

/** A compact rendering of a block's inline content: math nodes as [latex]. */
function shapeOf(editor: NoatEditor): string {
  return inlineOf(editor)
    .map((item) => (item.type === 'math' ? `[${item.props?.latex}]` : (item.text ?? '')))
    .join('');
}

test('$...$ becomes an inline math node and consumes both delimiters', () => {
  const editor = makeEditor();
  typeText(editor, 'mass is $E = mc^2$ exactly');

  // The whole line, not just the node: TipTap's nodeInputRule would leave the
  // `$` delimiters behind on either side, which reads fine node-by-node.
  expect(shapeOf(editor)).toBe('mass is [E = mc^2] exactly');
});

test('$$ followed by a space converts the block into an equation', () => {
  const editor = makeEditor();
  typeText(editor, '$$ ');

  expect(editor.document[0]?.type).toBe('equation');
  expect((editor.document[0] as { props: { latex: string } }).props.latex).toBe('');
});

test('$$x$$ becomes an equation block, not a math node with stray dollars', () => {
  const editor = makeEditor();
  typeText(editor, '$$\\frac{a}{b}$$');

  expect(editor.document[0]?.type).toBe('equation');
  expect((editor.document[0] as { props: { latex: string } }).props.latex).toBe('\\frac{a}{b}');
});

test('prices are not math', () => {
  const editor = makeEditor();
  typeText(editor, 'it costs $5 or $6');

  expect(shapeOf(editor)).toBe('it costs $5 or $6');
});

test('a dollar amount inside inline code stays literal', () => {
  const editor = makeEditor();
  editor.toggleStyles({ code: true });
  typeText(editor, '$x$');

  expect(shapeOf(editor)).toBe('$x$');
});
