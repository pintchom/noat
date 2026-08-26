// @vitest-environment jsdom
import { BlockNoteEditor, type PartialBlock } from '@blocknote/core';
import { expect, test } from 'vitest';

// Mirrors how NoteEditor.tsx applies external updates: replaceBlocks inside a
// transact stamped addToHistory: false, so external rewrites (VS Code undo,
// agent writes, git-sync) never become undoable editor steps.
function applyExternal(editor: BlockNoteEditor, blocks: PartialBlock[]): void {
  editor.transact((tr) => {
    tr.setMeta('addToHistory', false);
    editor.replaceBlocks(editor.document, blocks);
  });
}

function texts(editor: BlockNoteEditor): string[] {
  return editor.document.map((block) =>
    Array.isArray(block.content)
      ? block.content.map((piece) => ('text' in piece ? piece.text : '')).join('')
      : ''
  );
}

test('undo does not revert an external rewrite', () => {
  const editor = BlockNoteEditor.create({
    initialContent: [{ id: 'a', type: 'paragraph', content: 'one' }],
  });
  editor.mount(document.createElement('div'));

  editor.updateBlock('a', { content: 'one edited' });
  applyExternal(editor, [
    { id: 'a', type: 'paragraph', content: 'one edited' },
    { id: 'b', type: 'paragraph', content: 'from outside' },
  ]);
  expect(texts(editor)).toEqual(['one edited', 'from outside']);

  // Without the addToHistory guard this undo replayed the rewrite backwards,
  // wiping "from outside" — the oscillation behind #40.
  editor.undo();

  expect(texts(editor)).toEqual(['one edited', 'from outside']);
});
