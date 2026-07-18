import { createExtension } from '@blocknote/core';
import { Extension } from '@tiptap/core';
import type { Node } from 'prosemirror-model';
import { Plugin, PluginKey } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';

export interface FindMatch {
  from: number;
  to: number;
}

/**
 * Case-insensitive substring search across every textblock in the document
 * (paragraphs, headings, list items, table cells). Matches cross inline
 * formatting boundaries — "bold text" is found even when only "bold" is bold.
 * Leaf inline nodes (fileLink chips) count as one character, matching
 * ProseMirror position math, so offsets stay aligned after a chip.
 */
export function findMatches(doc: Node, query: string): FindMatch[] {
  const needle = query.toLowerCase();
  if (!needle) return [];
  const matches: FindMatch[] = [];
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    const text = node.textBetween(0, node.content.size, undefined, '\ufffc').toLowerCase();
    let index = text.indexOf(needle);
    while (index !== -1) {
      matches.push({ from: pos + 1 + index, to: pos + 1 + index + needle.length });
      index = text.indexOf(needle, index + 1);
    }
    return false;
  });
  return matches;
}

export interface FindUpdate {
  matches: FindMatch[];
  activeIndex: number;
}

export const findPluginKey = new PluginKey<DecorationSet>('noatFind');

const findPlugin = new Plugin<DecorationSet>({
  key: findPluginKey,
  state: {
    init: () => DecorationSet.empty,
    apply: (tr, decorations) => {
      const update = tr.getMeta(findPluginKey) as FindUpdate | undefined;
      if (update) {
        return DecorationSet.create(
          tr.doc,
          update.matches.map((match, index) =>
            Decoration.inline(match.from, match.to, {
              class:
                index === update.activeIndex
                  ? 'noat-find-match noat-find-match-current'
                  : 'noat-find-match',
            })
          )
        );
      }
      // Keep highlights roughly in place while typing; the find bar
      // recomputes exact matches on the editor's next change event.
      return tr.docChanged ? decorations.map(tr.mapping, tr.doc) : decorations;
    },
  },
  props: {
    decorations(state) {
      return this.getState(state);
    },
  },
});

const findHighlightsExtension = Extension.create({
  name: 'noatFindHighlights',
  addProseMirrorPlugins() {
    return [findPlugin];
  },
});

export const findHighlights = createExtension({
  key: 'findHighlights',
  tiptapExtensions: [findHighlightsExtension],
});
