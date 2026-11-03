// @vitest-environment jsdom
import { BlockNoteEditor, trackPosition } from '@blocknote/core';
import { expect, test } from 'vitest';
import { insertBlockLinkAt } from './point-link';
import { schema } from './schema';

function setup() {
  const editor = BlockNoteEditor.create({
    schema,
    initialContent: [
      { id: 'target', type: 'heading', content: 'Deploy steps' },
      { id: 'source', type: 'paragraph', content: 'See ' },
    ],
  });
  // Left unmounted: React chips can only render headless outside a React tree.
  editor.setTextCursorPosition('source', 'end');
  return editor;
}

test('inserts a blockLink chip where /point was typed, even after the caret moved', () => {
  const editor = setup();
  const origin = trackPosition(editor, editor.prosemirrorState.selection.from);
  editor.setTextCursorPosition('target', 'start');

  insertBlockLinkAt(editor, origin, 'target');

  const content = editor.getBlock('source')?.content as Array<{
    type: string;
    props?: Record<string, string>;
  }>;
  expect(content.map((piece) => piece.type)).toEqual(['text', 'blockLink', 'text']);
  expect(content[1]?.props).toEqual({ blockId: 'target', label: 'Deploy steps' });
});

test('keeps the insert point when blocks are added above it meanwhile', () => {
  const editor = setup();
  const origin = trackPosition(editor, editor.prosemirrorState.selection.from);
  editor.insertBlocks([{ type: 'paragraph', content: 'added by an agent' }], 'target', 'before');

  insertBlockLinkAt(editor, origin, 'target');

  const content = editor.getBlock('source')?.content as Array<{ type: string }>;
  expect(content.map((piece) => piece.type)).toContain('blockLink');
});

test('cancelling (no target) inserts nothing', () => {
  const editor = setup();
  const origin = trackPosition(editor, editor.prosemirrorState.selection.from);

  insertBlockLinkAt(editor, origin, undefined);

  const content = editor.getBlock('source')?.content as Array<{ type: string }>;
  expect(content.map((piece) => piece.type)).toEqual(['text']);
});
