// @vitest-environment jsdom
import { BlockNoteEditor, type PartialBlock } from '@blocknote/core';
import type { Node } from 'prosemirror-model';
import { describe, expect, it } from 'vitest';
import { findHighlights, findMatches, findPluginKey } from './find';

function docFor(blocks: PartialBlock[]): Node {
  const editor = BlockNoteEditor.create({ initialContent: blocks });
  editor.mount(document.createElement('div'));
  const view = editor.prosemirrorView;
  if (!view) throw new Error('editor is not mounted');
  return view.state.doc;
}

describe('findMatches', () => {
  it('finds case-insensitive matches across blocks', () => {
    const doc = docFor([
      { type: 'paragraph', content: 'Hello World' },
      { type: 'heading', content: 'world peace' },
    ]);
    const matches = findMatches(doc, 'world');
    expect(matches).toHaveLength(2);
    for (const match of matches) {
      expect(doc.textBetween(match.from, match.to).toLowerCase()).toBe('world');
    }
  });

  it('finds a match spanning inline formatting boundaries', () => {
    const doc = docFor([
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'find ', styles: {} },
          { type: 'text', text: 'me', styles: { bold: true } },
        ],
      },
    ]);
    const matches = findMatches(doc, 'find me');
    expect(matches).toHaveLength(1);
    expect(doc.textBetween(matches[0]?.from ?? 0, matches[0]?.to ?? 0)).toBe('find me');
  });

  it('finds overlapping occurrences', () => {
    const doc = docFor([{ type: 'paragraph', content: 'aaa' }]);
    expect(findMatches(doc, 'aa')).toHaveLength(2);
  });

  it('searches nested list children', () => {
    const doc = docFor([
      {
        type: 'bulletListItem',
        content: 'top level',
        children: [{ type: 'bulletListItem', content: 'nested target here' }],
      },
    ]);
    const matches = findMatches(doc, 'target');
    expect(matches).toHaveLength(1);
    expect(doc.textBetween(matches[0]?.from ?? 0, matches[0]?.to ?? 0)).toBe('target');
  });

  it('searches table cells', () => {
    const doc = docFor([
      {
        type: 'table',
        content: {
          type: 'tableContent',
          rows: [{ cells: [['alpha'], ['needle in cell']] }],
        },
      },
    ]);
    const matches = findMatches(doc, 'needle');
    expect(matches).toHaveLength(1);
    expect(doc.textBetween(matches[0]?.from ?? 0, matches[0]?.to ?? 0)).toBe('needle');
  });

  it('returns nothing for an empty query', () => {
    const doc = docFor([{ type: 'paragraph', content: 'anything' }]);
    expect(findMatches(doc, '')).toEqual([]);
  });

  it('returns nothing when the query is absent', () => {
    const doc = docFor([{ type: 'paragraph', content: 'hello' }]);
    expect(findMatches(doc, 'zebra')).toEqual([]);
  });
});

describe('findHighlights plugin', () => {
  it('decorates matches dispatched through the plugin meta', () => {
    const editor = BlockNoteEditor.create({
      extensions: [findHighlights],
      initialContent: [{ type: 'paragraph', content: 'alpha beta alpha' }],
    });
    editor.mount(document.createElement('div'));
    const view = editor.prosemirrorView;
    if (!view) throw new Error('editor is not mounted');

    const matches = findMatches(view.state.doc, 'alpha');
    expect(matches).toHaveLength(2);
    view.dispatch(view.state.tr.setMeta(findPluginKey, { matches, activeIndex: 1 }));

    const decorations = findPluginKey
      .getState(view.state)
      ?.find()
      .map((decoration) => ({
        from: decoration.from,
        to: decoration.to,
        class: (decoration.spec ?? {}).class,
      }));
    expect(decorations).toHaveLength(2);
    expect(decorations?.map((d) => ({ from: d.from, to: d.to }))).toEqual(matches);

    const current = view.dom.querySelectorAll('.noat-find-match-current');
    expect(current).toHaveLength(1);
    expect(current[0]?.textContent).toBe('alpha');
    expect(view.dom.querySelectorAll('.noat-find-match')).toHaveLength(2);
  });

  it('clears decorations when an empty match list is dispatched', () => {
    const editor = BlockNoteEditor.create({
      extensions: [findHighlights],
      initialContent: [{ type: 'paragraph', content: 'alpha' }],
    });
    editor.mount(document.createElement('div'));
    const view = editor.prosemirrorView;
    if (!view) throw new Error('editor is not mounted');

    const matches = findMatches(view.state.doc, 'alpha');
    view.dispatch(view.state.tr.setMeta(findPluginKey, { matches, activeIndex: 0 }));
    expect(view.dom.querySelectorAll('.noat-find-match')).toHaveLength(1);

    view.dispatch(view.state.tr.setMeta(findPluginKey, { matches: [], activeIndex: 0 }));
    expect(view.dom.querySelectorAll('.noat-find-match')).toHaveLength(0);
  });
});
