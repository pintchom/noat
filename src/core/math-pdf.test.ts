import { describe, expect, it } from 'vitest';
import { typesetMath } from './math-pdf';

/** A stand-in for pdfkit that records the drawing calls the SVG walker makes. */
function recorder() {
  const ops: string[] = [];
  const record = (op: string) => {
    ops.push(op);
    return doc;
  };
  const doc = {
    save: () => record('save'),
    restore: () => record('restore'),
    translate: () => doc,
    scale: () => doc,
    transform: () => doc,
    rotate: () => doc,
    lineWidth: () => doc,
    moveTo: () => doc,
    lineTo: () => doc,
    ellipse: () => record('ellipse'),
    polygon: () => record('polygon'),
    path: () => record('path'),
    rect: () => record('rect'),
    fill: () => record('fill'),
    stroke: () => record('stroke'),
    fillAndStroke: () => record('fillAndStroke'),
  };
  return { ops, doc: doc as unknown as PDFKit.PDFDocument };
}

describe('typesetMath', () => {
  it('measures a formula against its baseline', () => {
    const box = typesetMath('E = mc^2', false, 10.5);
    expect(box).toBeDefined();
    if (!box) return;
    expect(box.width).toBeGreaterThan(10);
    expect(box.ascent).toBeGreaterThan(5);
    // `mc^2` has no descender, so the box barely dips below the baseline.
    expect(box.depth).toBeLessThan(box.ascent);
  });

  it('scales linearly with the requested point size', () => {
    const small = typesetMath('x+1', false, 10);
    const large = typesetMath('x+1', false, 20);
    expect(small && large).toBeTruthy();
    if (!small || !large) return;
    expect(large.width / small.width).toBeCloseTo(2, 5);
  });

  it('draws glyph outlines, with save/restore balanced', () => {
    const { ops, doc } = recorder();
    typesetMath('x+1', false, 10.5)?.draw(doc, 0, 0, '#000000');
    expect(ops.filter((op) => op === 'path').length).toBeGreaterThan(2);
    expect(ops.filter((op) => op === 'save').length).toBe(
      ops.filter((op) => op === 'restore').length
    );
  });

  it('draws a fraction bar as a filled rect', () => {
    const { ops, doc } = recorder();
    typesetMath('\\frac{a}{b}', true, 10.5)?.draw(doc, 0, 0, '#000000');
    expect(ops).toContain('rect');
  });

  it('draws \\enclose decorations, which are SVG shapes rather than glyphs', () => {
    const { ops, doc } = recorder();
    typesetMath('\\enclose{circle}{x}', false, 10.5)?.draw(doc, 0, 0, '#000000');
    expect(ops).toContain('ellipse');
  });

  it('renders unknown commands as MathJax error text instead of throwing', () => {
    const { ops, doc } = recorder();
    const box = typesetMath('\\notarealcommand', false, 10.5);
    expect(box?.width).toBeGreaterThan(0);
    box?.draw(doc, 0, 0, '#000000');
    expect(ops).toContain('path');
  });
});
