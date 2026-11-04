import { createReactBlockSpec } from '@blocknote/react';
// ponytail: the whole of Mermaid (~2.7 MB minified, cytoscape included) lands
// in the webview bundle; import mermaid/core and register only the diagram
// types we draw if the bundle ever needs to slim down.
import mermaid from 'mermaid';
import { useEffect, useRef, useState } from 'react';
import { generateDiagram } from './diagram-client';
import { useVsCodeDarkTheme } from './use-dark-theme';

function configureMermaid(isDark: boolean): void {
  mermaid.initialize({
    startOnLoad: false,
    // Model-written source is untrusted input: strict keeps HTML labels and
    // scripts out, and DOMPurify sanitizes what comes back.
    securityLevel: 'strict',
    suppressErrorRendering: true,
    theme: isDark ? 'dark' : 'default',
  });
}

/** Mermaid's complaint about a script, or '' when it parses. */
async function mermaidError(code: string): Promise<string> {
  try {
    await mermaid.parse(code);
    return '';
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

/** Full-size view scale: 1 fits the dialog's width, 8 is deep enough to read a label. */
const clampZoom = (zoom: number): number => Math.min(8, Math.max(1, zoom));

/**
 * A diagram block. The note stores the Mermaid source, never a picture — so
 * the file stays diffable, the diagram re-renders in whatever theme the IDE
 * is wearing, and the same script always draws the same thing. The
 * description that produced it rides along so it can be regenerated.
 */
export const DiagramBlock = createReactBlockSpec(
  {
    type: 'mermaid',
    propSchema: {
      code: { default: '' },
      prompt: { default: '' },
      /** Inline width in px, as dragged by the reader; 0 is the diagram's own size. */
      width: { default: 0 },
    },
    content: 'none',
  },
  {
    render: ({ block, editor }) => {
      const { code, prompt, width } = block.props;
      const isDark = useVsCodeDarkTheme();
      const [draft, setDraft] = useState(prompt);
      const [status, setStatus] = useState('');
      const [genError, setGenError] = useState('');
      const [svg, setSvg] = useState('');
      const [renderError, setRenderError] = useState('');
      const [open, setOpen] = useState(code === '');
      const [zoom, setZoom] = useState(1);
      const inputRef = useRef<HTMLInputElement>(null);
      const dialogRef = useRef<HTMLDialogElement>(null);
      const viewportRef = useRef<HTMLDivElement>(null);

      // A block inserted from "/diagram" with nothing to generate yet is
      // waiting for a description — put the caret in it.
      useEffect(() => {
        if (code === '' && prompt === '') inputRef.current?.focus();
      }, [code, prompt]);

      const save = (next: { code?: string; prompt?: string; width?: number }): void => {
        // The block can be gone by the time a slow generation lands.
        if (editor.getBlock(block.id)) editor.updateBlock(block.id, { props: next });
      };

      /**
       * Generate, then hand anything Mermaid rejects straight back to the
       * model once. Small local models miss the syntax often enough that one
       * repair pass is worth the extra few seconds; a second one isn't, so a
       * still-broken script is saved with its error showing for a human fix.
       */
      const generate = async (description: string): Promise<void> => {
        setStatus('Generating diagram…');
        setGenError('');
        let result = await generateDiagram(description);
        if (result.code) {
          configureMermaid(isDark);
          const rejected = await mermaidError(result.code);
          if (rejected) {
            setStatus('Mermaid rejected that — asking for a fix…');
            const fixed = await generateDiagram(description, {
              code: result.code,
              error: rejected,
            });
            if (fixed.code && (await mermaidError(fixed.code)) === '') result = fixed;
          }
        }
        setStatus('');
        if (!result.code) {
          setGenError(result.error ?? 'the model returned nothing');
          return;
        }
        save({ code: result.code, prompt: description });
        setOpen(false);
      };

      // A "/diagram <description>" insert arrives with a prompt and no source:
      // start generating right away instead of making the user press Generate.
      const autoStarted = useRef(false);
      useEffect(() => {
        if (autoStarted.current || code !== '' || prompt.trim() === '') return;
        autoStarted.current = true;
        void generate(prompt);
      });

      useEffect(() => {
        if (code === '') {
          setSvg('');
          setRenderError('');
          return;
        }
        let cancelled = false;
        configureMermaid(isDark);
        // Mermaid uses the id as a CSS selector, so strip the UUID's dashes.
        mermaid.render(`noat-mermaid-${block.id.replace(/[^a-zA-Z0-9]/g, '')}`, code).then(
          (result) => {
            if (cancelled) return;
            setSvg(result.svg);
            setRenderError('');
          },
          (error: unknown) => {
            if (cancelled) return;
            setSvg('');
            setRenderError(error instanceof Error ? error.message : String(error));
          }
        );
        return () => {
          cancelled = true;
        };
      }, [code, isDark, block.id]);

      // Pinch-to-zoom and ctrl+wheel arrive as a ctrl-modified wheel event.
      // React registers onWheel passively, so preventDefault only sticks on a
      // native listener -- without it the gesture zooms the whole webview.
      useEffect(() => {
        const viewport = viewportRef.current;
        if (!viewport) return;
        const onWheel = (event: WheelEvent): void => {
          if (!event.ctrlKey && !event.metaKey) return;
          event.preventDefault();
          setZoom((current) => clampZoom(current * (event.deltaY < 0 ? 1.15 : 1 / 1.15)));
        };
        viewport.addEventListener('wheel', onWheel, { passive: false });
        return () => viewport.removeEventListener('wheel', onWheel);
      }, []);

      const showPanel = open || renderError !== '';

      return (
        <div className="noat-diagram">
          {/* A native dialog: Escape, the backdrop, and focus handling come free. */}
          {/* biome-ignore lint/a11y/useKeyWithClickEvents: closing is on the
              backdrop; a dialog already closes itself on Escape. */}
          <dialog
            ref={dialogRef}
            className="noat-diagram-dialog"
            onClick={(event) => {
              if (event.target === dialogRef.current) dialogRef.current?.close();
            }}
          >
            <div className="noat-diagram-toolbar">
              <button type="button" onClick={() => setZoom((z) => clampZoom(z / 1.25))}>
                &minus;
              </button>
              <span className="noat-diagram-scale">{Math.round(zoom * 100)}%</span>
              <button type="button" onClick={() => setZoom((z) => clampZoom(z * 1.25))}>
                +
              </button>
              <span className="noat-diagram-hint">scroll to pan, ctrl+scroll to zoom</span>
              <button
                type="button"
                className="noat-diagram-close"
                onClick={() => dialogRef.current?.close()}
              >
                Close
              </button>
            </div>
            <div className="noat-diagram-viewport" ref={viewportRef}>
              <div
                className="noat-diagram-canvas"
                style={{ width: `${zoom * 100}%`, height: `${zoom * 100}%` }}
                // biome-ignore lint/security/noDangerouslySetInnerHtml: Mermaid output, sanitized by its strict security level
                dangerouslySetInnerHTML={{ __html: svg }}
              />
            </div>
          </dialog>
          {svg !== '' && (
            <div
              className={`noat-diagram-figure${width > 0 ? ' noat-diagram-sized' : ''}`}
              style={width > 0 ? { width: `${width}px` } : undefined}
              // CSS `resize` writes the new width straight onto the element, so the
              // end of a drag is where it gets read back and stored in the note.
              onPointerUp={(event) => {
                const dragged = Math.round(event.currentTarget.getBoundingClientRect().width);
                if (dragged !== width) save({ width: dragged });
              }}
            >
              <button
                type="button"
                className="noat-diagram-svg"
                aria-label="View diagram full size"
                onClick={() => {
                  setZoom(1);
                  dialogRef.current?.showModal();
                }}
                // biome-ignore lint/security/noDangerouslySetInnerHtml: Mermaid output, sanitized by its strict security level
                dangerouslySetInnerHTML={{ __html: svg }}
              />
              <button type="button" className="noat-diagram-edit" onClick={() => setOpen(!open)}>
                {open ? 'Close' : 'Edit'}
              </button>
            </div>
          )}

          {status !== '' && <div className="noat-diagram-status">{status}</div>}

          {showPanel && status === '' && (
            <div className="noat-diagram-panel">
              <div className="noat-diagram-row">
                <input
                  ref={inputRef}
                  className="noat-diagram-input"
                  value={draft}
                  placeholder="Describe the diagram…"
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key !== 'Enter' || draft.trim() === '') return;
                    event.preventDefault();
                    void generate(draft.trim());
                  }}
                />
                <button
                  type="button"
                  className="noat-diagram-generate"
                  disabled={draft.trim() === ''}
                  onClick={() => void generate(draft.trim())}
                >
                  {code === '' ? 'Generate' : 'Regenerate'}
                </button>
              </div>
              {code !== '' && (
                <textarea
                  className="noat-diagram-source"
                  spellCheck={false}
                  value={code}
                  onChange={(event) => save({ code: event.target.value, prompt })}
                />
              )}
              {renderError !== '' && (
                <div className="noat-diagram-error">Mermaid: {renderError}</div>
              )}
              {genError !== '' && <div className="noat-diagram-error">{genError}</div>}
            </div>
          )}
        </div>
      );
    },
  }
);
