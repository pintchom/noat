import type { LiteElement, LiteNode } from 'mathjax-full/js/adaptors/lite/Element.js';
import { liteAdaptor } from 'mathjax-full/js/adaptors/liteAdaptor.js';
import { RegisterHTMLHandler } from 'mathjax-full/js/handlers/html.js';
import { TeX } from 'mathjax-full/js/input/tex.js';
import { AllPackages } from 'mathjax-full/js/input/tex/AllPackages.js';
import { mathjax } from 'mathjax-full/js/mathjax.js';
import { SVG } from 'mathjax-full/js/output/svg.js';

/**
 * MathJax's SVG output is drawn on a 1000-units-per-em grid, and it uses the
 * TeX fonts, whose x-height (0.442em) is smaller than Helvetica's (0.523em).
 * Sizing math at the surrounding point size therefore looks a size too small,
 * so match x-heights instead.
 */
const UNITS_PER_EM = 1000;
const X_HEIGHT_RATIO = 0.523 / 0.442;

/** Typeset math, positioned by its baseline like a run of text. */
export interface MathBox {
  /** Advance width, in points. */
  width: number;
  /** Extent above the baseline, in points. */
  ascent: number;
  /** Extent below the baseline, in points. */
  depth: number;
  /** Draw at `x` with the math baseline on `baseline`, in `color` unless the LaTeX overrides it. */
  draw(doc: PDFKit.PDFDocument, x: number, baseline: number, color: string): void;
}

type Convert = (latex: string, display: boolean) => LiteElement;

let convert: Convert | undefined;

/** MathJax setup costs ~200ms and most notes have no math, so build it on demand. */
function converter(): Convert {
  if (!convert) {
    RegisterHTMLHandler(liteAdaptor());
    const document = mathjax.document('', {
      InputJax: new TeX({ packages: AllPackages }),
      OutputJax: new SVG({ fontCache: 'none' }),
    });
    convert = (latex, display) => document.convert(latex, { display }) as LiteElement;
  }
  return convert;
}

interface Paint {
  fill: string | null;
  stroke: string | null;
  strokeWidth: number;
}

function paintValue(
  value: string | undefined,
  current: string | null,
  base: string
): string | null {
  if (value === undefined) return current;
  if (value === 'none') return null;
  return value === 'currentColor' ? base : value;
}

const TRANSFORM_PATTERN = /(translate|scale|matrix|rotate)\(([^)]*)\)/g;

function applyTransform(doc: PDFKit.PDFDocument, value: string): void {
  for (const [, name, rawArgs] of value.matchAll(TRANSFORM_PATTERN)) {
    const args = (rawArgs ?? '')
      .split(/[\s,]+/)
      .filter((part) => part.length > 0)
      .map(Number);
    if (args.some(Number.isNaN)) continue;
    if (name === 'translate') doc.translate(args[0] ?? 0, args[1] ?? 0);
    else if (name === 'scale') doc.scale(args[0] ?? 1, args[1] ?? args[0] ?? 1);
    else if (name === 'rotate') {
      const [angle = 0, cx, cy] = args;
      doc.rotate(angle, cx !== undefined && cy !== undefined ? { origin: [cx, cy] } : {});
    } else if (name === 'matrix') {
      const [a = 1, b = 0, c = 0, d = 1, e = 0, f = 0] = args;
      doc.transform(a, b, c, d, e, f);
    }
  }
}

function isElement(node: LiteNode): node is LiteElement {
  return !node.kind.startsWith('#');
}

/** `points="x1,y1 x2,y2 ..."` as the `[x, y]` pairs pdfkit's `polygon` wants. */
function polygonPoints(value: string | undefined): [number, number][] {
  const numbers = (value ?? '')
    .split(/[\s,]+/)
    .filter((part) => part.length > 0)
    .map(Number);
  if (numbers.some(Number.isNaN)) return [];
  const points: [number, number][] = [];
  for (let i = 0; i + 1 < numbers.length; i += 2) {
    points.push([numbers[i] as number, numbers[i + 1] as number]);
  }
  return points;
}

function drawNode(doc: PDFKit.PDFDocument, node: LiteNode, inherited: Paint, base: string): void {
  if (!isElement(node)) return;
  const attributes = node.attributes as Record<string, string | undefined>;
  const paint: Paint = {
    fill: paintValue(attributes.fill, inherited.fill, base),
    stroke: paintValue(attributes.stroke, inherited.stroke, base),
    strokeWidth: attributes['stroke-width']
      ? Number(attributes['stroke-width'])
      : inherited.strokeWidth,
  };
  const stroking = paint.stroke !== null && paint.strokeWidth > 0;
  const number = (name: string): number => Number(attributes[name] ?? 0) || 0;

  doc.save();
  if (attributes.transform) applyTransform(doc, attributes.transform);

  // ponytail: `text` nodes (MathJax's fallback for characters missing from the
  // TeX fonts, e.g. \unicode{x2603}) are skipped -- drawing them needs an
  // embedded font, and the rest of this exporter is built-in fonts only.
  const painted = paint.fill !== null || stroking;
  if (node.kind === 'path' && attributes.d && painted) {
    doc.path(attributes.d);
  } else if (node.kind === 'rect' && painted) {
    doc.rect(number('x'), number('y'), number('width'), number('height'));
  } else if (node.kind === 'line' && stroking) {
    doc.moveTo(number('x1'), number('y1')).lineTo(number('x2'), number('y2'));
  } else if (node.kind === 'ellipse' && painted) {
    doc.ellipse(number('cx'), number('cy'), number('rx'), number('ry'));
  } else if (node.kind === 'polygon' && painted && polygonPoints(attributes.points).length > 2) {
    doc.polygon(...polygonPoints(attributes.points));
  } else {
    for (const child of node.children) drawNode(doc, child, paint, base);
    doc.restore();
    return;
  }

  if (stroking) doc.lineWidth(paint.strokeWidth);
  if (paint.fill && stroking) doc.fillAndStroke(paint.fill, paint.stroke ?? paint.fill);
  else if (paint.fill) doc.fill(paint.fill);
  else doc.stroke(paint.stroke ?? base);
  doc.restore();
}

const cache = new Map<string, MathBox | undefined>();
/** The extension host is long-lived, so the memo is dropped rather than grown. */
const CACHE_LIMIT = 512;

/**
 * Typeset `latex` for a PDF at `size` points, or `undefined` if MathJax cannot
 * produce SVG at all (malformed input renders as red error text, not a throw).
 * Memoized: a formula is usually measured before it is drawn.
 */
export function typesetMath(latex: string, display: boolean, size: number): MathBox | undefined {
  const key = `${display ? 'D' : 'I'}|${size}|${latex}`;
  const cached = cache.get(key);
  if (cached !== undefined || cache.has(key)) return cached;
  const box = buildMath(latex, display, size);
  if (cache.size >= CACHE_LIMIT) cache.clear();
  cache.set(key, box);
  return box;
}

function buildMath(latex: string, display: boolean, size: number): MathBox | undefined {
  let svg: LiteElement | undefined;
  try {
    const container = converter()(latex, display);
    svg = container.children.find((child) => child.kind === 'svg') as LiteElement | undefined;
  } catch {
    return undefined;
  }
  if (!svg) return undefined;

  const [minX = 0, minY = 0, boxWidth = 0, boxHeight = 0] = String(svg.attributes.viewBox ?? '')
    .split(/[\s,]+/)
    .map(Number);
  const scale = (size * X_HEIGHT_RATIO) / UNITS_PER_EM;
  const children = svg.children;

  return {
    width: boxWidth * scale,
    ascent: -minY * scale,
    depth: (minY + boxHeight) * scale,
    draw(doc, x, baseline, color) {
      doc.save();
      doc.translate(x - minX * scale, baseline);
      doc.scale(scale, scale);
      const root: Paint = { fill: color, stroke: null, strokeWidth: 1 };
      for (const child of children) drawNode(doc, child, root, color);
      doc.restore();
    },
  };
}
