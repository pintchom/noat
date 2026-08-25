// @vitest-environment jsdom
import { BlockNoteEditor, type PartialBlock } from '@blocknote/core';
import { expect, test } from 'vitest';
import { nestedBackspace } from './nested-backspace';

// Toggle blocks read their open state from localStorage, which this jsdom
// version doesn't provide.
const storage = new Map<string, string>();
Object.defineProperty(window, 'localStorage', {
  value: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  },
});

const toggleWithChecklist: PartialBlock[] = [
  {
    type: 'toggleListItem',
    content: 'toggle',
    children: [
      { id: 'a', type: 'checkListItem', content: 'a' },
      { id: 'b', type: 'checkListItem', content: 'b' },
      { id: 'c', type: 'checkListItem', content: 'c' },
      { id: 'd', type: 'checkListItem', content: 'd' },
    ],
  },
];

function createMountedEditor(initialContent: PartialBlock[]): BlockNoteEditor {
  const editor = BlockNoteEditor.create({ extensions: [nestedBackspace], initialContent });
  editor.mount(document.createElement('div'));
  return editor;
}

/** Runs a Backspace keydown through the editor's handlers, like a real keypress. */
function pressBackspace(editor: BlockNoteEditor): void {
  const view = editor.prosemirrorView;
  if (!view) throw new Error('editor is not mounted');
  const event = new KeyboardEvent('keydown', { key: 'Backspace' });
  view.someProp('handleKeyDown', (handler) => handler(view, event));
}

/** The document as indented "type(text)" lines, for whole-tree assertions. */
function shape(editor: BlockNoteEditor): string[] {
  const walk = (blocks: (typeof editor.document)[number][], depth: number): string[] =>
    blocks.flatMap((block) => {
      const text = Array.isArray(block.content)
        ? block.content.map((piece) => ('text' in piece ? piece.text : '')).join('')
        : '';
      return [`${'  '.repeat(depth)}${block.type}(${text})`, ...walk(block.children, depth + 1)];
    });
  return walk(editor.document, 0);
}

test('backspace-deleting an emptied middle checklist item leaves its siblings nested', () => {
  const editor = createMountedEditor(toggleWithChecklist);
  editor.updateBlock('b', { content: [] });
  editor.setTextCursorPosition('b', 'start');

  // First Backspace un-formats the empty checkbox to a paragraph, second
  // deletes the emptied line. Without the fix the second one lifted the line
  // out of the toggle with every sibling below it in tow.
  pressBackspace(editor);
  pressBackspace(editor);

  expect(shape(editor)).toEqual([
    'toggleListItem(toggle)',
    '  checkListItem(a)',
    '  checkListItem(c)',
    '  checkListItem(d)',
  ]);
});

test('backspace at the start of a non-empty nested middle paragraph merges upward', () => {
  const editor = createMountedEditor(toggleWithChecklist);
  editor.setTextCursorPosition('b', 'start');

  pressBackspace(editor); // checkbox -> paragraph, in place
  pressBackspace(editor); // merge "b" into "a", siblings untouched

  expect(shape(editor)).toEqual([
    'toggleListItem(toggle)',
    '  checkListItem(ab)',
    '  checkListItem(c)',
    '  checkListItem(d)',
  ]);
});

test('backspace on the last nested child still outdents it', () => {
  const editor = createMountedEditor(toggleWithChecklist);
  editor.updateBlock('d', { content: [], type: 'paragraph' });
  editor.setTextCursorPosition('d', 'start');

  pressBackspace(editor);

  expect(shape(editor)).toEqual([
    'toggleListItem(toggle)',
    '  checkListItem(a)',
    '  checkListItem(b)',
    '  checkListItem(c)',
    'paragraph()',
  ]);
});

test('backspace on a top-level paragraph keeps the default merge', () => {
  const editor = createMountedEditor([
    { type: 'paragraph', content: 'first' },
    { id: 'second', type: 'paragraph', content: 'second' },
    { type: 'paragraph', content: 'third' },
  ]);
  editor.setTextCursorPosition('second', 'start');

  pressBackspace(editor);

  expect(shape(editor)).toEqual(['paragraph(firstsecond)', 'paragraph(third)']);
});
