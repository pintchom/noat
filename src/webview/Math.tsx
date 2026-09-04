import { createReactInlineContentSpec } from '@blocknote/react';
import katex from 'katex';
import { useLayoutEffect, useRef, useState } from 'react';

/**
 * KaTeX emits no raw HTML under the default `trust: false` -- `\href`,
 * `\htmlClass` and friends render as error text instead. That is what makes the
 * output safe to inject as HTML. `throwOnError: false` turns a malformed
 * formula into red inline text rather than an exception mid-render.
 */
export function renderLatex(latex: string, displayMode: boolean): string {
  return katex.renderToString(latex, { throwOnError: false, displayMode });
}

/**
 * Inline formula, written as `$...$`. Only the LaTeX source is stored; the
 * rendered markup is regenerated on every render, so nothing stale ever lands
 * in the note file.
 */
export const InlineMath = createReactInlineContentSpec(
  {
    type: 'math',
    propSchema: {
      latex: { default: '' },
    },
    content: 'none',
  },
  {
    render: ({ inlineContent, updateInlineContent }) => {
      const latex = inlineContent.props.latex;
      // A chip inserted empty (from the slash menu) opens straight into its
      // input -- an empty formula renders to nothing to click on otherwise.
      const [draft, setDraft] = useState<string | null>(latex === '' ? '' : null);
      const input = useRef<HTMLInputElement>(null);

      // Autofocus waits for a layout effect: only by then is the node view
      // actually in the document.
      useLayoutEffect(() => {
        if (draft !== null) input.current?.focus();
      }, [draft]);

      const commit = (): void => {
        if (draft !== null) updateInlineContent({ type: 'math', props: { latex: draft } });
        setDraft(null);
      };

      if (draft !== null) {
        return (
          <input
            ref={input}
            className="noat-math-input"
            value={draft}
            placeholder="LaTeX"
            size={Math.max(6, draft.length + 1)}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={commit}
            // The editor must not see these keys: Enter would split the block
            // and Escape would clear the selection out from under the input.
            onKeyDown={(event) => {
              if (event.key === 'Enter') commit();
              else if (event.key === 'Escape') setDraft(null);
              else return;
              event.preventDefault();
              event.stopPropagation();
            }}
          />
        );
      }

      // A button rather than a span so the formula is reachable and editable
      // by keyboard, the same way the fileLink chip is.
      return (
        <button
          type="button"
          className="noat-math"
          title={latex}
          onClick={() => setDraft(latex)}
          // biome-ignore lint/security/noDangerouslySetInnerHtml: KaTeX output, sanitized by trust:false
          dangerouslySetInnerHTML={{ __html: renderLatex(latex, false) }}
        />
      );
    },
  }
);
