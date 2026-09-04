import { createExtension } from '@blocknote/core';
import { createReactBlockSpec } from '@blocknote/react';
import { useLayoutEffect, useRef, useState } from 'react';
import { renderLatex } from './Math';

/**
 * Standalone display equation, written as `$$...$$`. Like the inline `math`
 * spec it stores only the LaTeX source, but it is a block so it gets its own
 * drag handle and can hold multi-line LaTeX (alignments, cases, matrices).
 */
export const createEquationBlockSpec = createReactBlockSpec(
  {
    type: 'equation',
    propSchema: {
      latex: { default: '' },
    },
    content: 'none',
  },
  {
    render: ({ block, editor }) => {
      const latex = block.props.latex;
      const [draft, setDraft] = useState<string | null>(latex === '' ? '' : null);
      const textarea = useRef<HTMLTextAreaElement>(null);

      useLayoutEffect(() => {
        if (draft !== null) textarea.current?.focus();
      }, [draft]);

      const commit = (): void => {
        if (draft !== null)
          editor.updateBlock(block, { type: 'equation', props: { latex: draft } });
        setDraft(null);
      };

      if (draft !== null) {
        return (
          <textarea
            ref={textarea}
            className="noat-equation-input"
            value={draft}
            placeholder="LaTeX"
            rows={draft.split('\n').length}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={commit}
            // Enter stays a newline here -- display equations are routinely
            // multi-line. Mod+Enter is the way out, Escape discards.
            onKeyDown={(event) => {
              if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) commit();
              else if (event.key === 'Escape') setDraft(null);
              else return;
              event.preventDefault();
              event.stopPropagation();
            }}
          />
        );
      }

      return (
        <button
          type="button"
          className="noat-equation"
          onClick={() => setDraft(latex)}
          // biome-ignore lint/security/noDangerouslySetInnerHtml: KaTeX output, sanitized by trust:false
          dangerouslySetInnerHTML={{ __html: renderLatex(latex, true) }}
        />
      );
    },
  },
  [
    createExtension({
      key: 'equation-shortcut',
      // Block-level input rules, the same mechanism that turns "# " into a
      // heading. `$$ ` opens an empty equation; `$$x$$` captures what was
      // typed, which is also the shape agents write through the MCP bridge.
      inputRules: [
        {
          find: /^\$\$\s$/,
          replace: () => ({ type: 'equation', props: { latex: '' } }),
        },
        {
          find: /^\$\$([^$\n]+)\$\$$/,
          replace: ({ match }) => ({ type: 'equation', props: { latex: match[1] ?? '' } }),
        },
      ],
    }),
  ]
);
