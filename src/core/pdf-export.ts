import PDFDocument from 'pdfkit';
import type { NoteFile } from './note';

type Block = NoteFile['blocks'][number];

const PAGE_MARGINS = { top: 64, bottom: 64, left: 60, right: 60 };
const BODY_SIZE = 10.5;
const CODE_SIZE = 9;
const TABLE_SIZE = 9.5;
const TEXT_COLOR = '#1f1f1f';
const MUTED_COLOR = '#8a8a8a';
const LINK_COLOR = '#0b6e99';
const CODE_BG_COLOR = '#f4f4f2';
const RULE_COLOR = '#dddddd';
const CHILD_INDENT = 18;
const HEADING_SIZES: Record<number, number> = { 1: 19, 2: 15.5, 3: 13, 4: 12, 5: 11, 6: 10.5 };

/** BlockNote's named text colors (light palette), for `textColor` props/styles. */
const NAMED_TEXT_COLORS: Record<string, string> = {
  gray: '#9b9a97',
  brown: '#64473a',
  red: '#e03e3e',
  orange: '#d9730d',
  yellow: '#dfab01',
  green: '#4d6461',
  blue: '#0b6e99',
  purple: '#6940a5',
  pink: '#ad1a72',
};

// Characters in the 0x80–0x9F WinAnsi block (curly quotes, dashes, bullet, …).
const WIN_ANSI_EXTRA = new Set(
  '\u20ac\u201a\u0192\u201e\u2026\u2020\u2021\u02c6\u2030\u0160\u2039\u0152\u017d\u2018\u2019\u201c\u201d\u2022\u2013\u2014\u02dc\u2122\u0161\u203a\u0153\u017e\u0178'
);

/**
 * The PDF's built-in fonts (Helvetica/Courier) only cover WinAnsi. Drop
 * anything else (emoji, CJK, …) instead of printing garbage glyphs.
 */
export function toWinAnsi(text: string): string {
  return Array.from(text.replace(/\t/g, '  '))
    .map((char) => {
      const code = char.codePointAt(0) ?? 0;
      if (code === 0x0a) return char;
      if (code >= 0x20 && code <= 0x7e) return char;
      if (code >= 0xa0 && code <= 0xff) return char;
      if (WIN_ANSI_EXTRA.has(char)) return char;
      return '';
    })
    .join('');
}

interface InlineRun {
  text: string;
  bold: boolean;
  italic: boolean;
  code: boolean;
  underline: boolean;
  strike: boolean;
  color?: string;
  link?: string;
}

function fontFor(run: Pick<InlineRun, 'bold' | 'italic' | 'code'>): string {
  if (run.code) return run.bold ? 'Courier-Bold' : 'Courier';
  if (run.bold && run.italic) return 'Helvetica-BoldOblique';
  if (run.bold) return 'Helvetica-Bold';
  if (run.italic) return 'Helvetica-Oblique';
  return 'Helvetica';
}

/** Flatten BlockNote inline content (rich text, links, fileLink chips) into styled runs. */
export function inlineRuns(content: unknown, inherited: Partial<InlineRun> = {}): InlineRun[] {
  if (!Array.isArray(content)) return [];
  return content.flatMap((item): InlineRun[] => {
    if (typeof item !== 'object' || item === null) return [];
    const inline = item as {
      type?: string;
      text?: string;
      href?: string;
      content?: unknown;
      styles?: Record<string, unknown>;
      props?: { path?: string };
    };
    if (inline.type === 'link') {
      return inlineRuns(inline.content, { ...inherited, link: inline.href, underline: true });
    }
    if (inline.type === 'fileLink') {
      const path = inline.props?.path ?? '';
      return path.length > 0
        ? [
            {
              text: path,
              bold: false,
              italic: false,
              code: true,
              underline: false,
              strike: false,
              color: LINK_COLOR,
            },
          ]
        : [];
    }
    if (typeof inline.text !== 'string') return [];
    const styles = inline.styles ?? {};
    const namedColor =
      typeof styles.textColor === 'string' ? NAMED_TEXT_COLORS[styles.textColor] : undefined;
    return [
      {
        text: inline.text,
        bold: styles.bold === true || inherited.bold === true,
        italic: styles.italic === true || inherited.italic === true,
        code: styles.code === true,
        underline: styles.underline === true || inherited.underline === true,
        strike: styles.strike === true,
        ...(namedColor || inherited.color ? { color: namedColor ?? inherited.color } : {}),
        ...(inherited.link ? { link: inherited.link } : {}),
      },
    ];
  });
}

function plainTextOf(runs: InlineRun[]): string {
  return runs.map((run) => run.text).join('');
}

function tableCellRuns(cell: unknown): InlineRun[] {
  if (Array.isArray(cell)) return inlineRuns(cell);
  if (typeof cell === 'object' && cell !== null) {
    return inlineRuns((cell as { content?: unknown }).content);
  }
  return [];
}

function dataUrlImage(url: string): Buffer | undefined {
  const match = url.match(/^data:image\/(?:png|jpe?g);base64,(.+)$/);
  return match?.[1] ? Buffer.from(match[1], 'base64') : undefined;
}

type BlockProps = {
  level?: number;
  checked?: boolean;
  textAlignment?: 'left' | 'center' | 'right' | 'justify';
  textColor?: string;
  url?: string;
  name?: string;
  caption?: string;
  previewWidth?: number;
};

function propsOf(block: Block): BlockProps {
  const props = (block as { props?: unknown }).props;
  return typeof props === 'object' && props !== null ? (props as BlockProps) : {};
}

/** Render a note to a shareable PDF (US Letter, built-in fonts, no network). */
export async function noteToPdf(
  note: Pick<NoteFile, 'title' | 'updatedAt' | 'blocks'>
): Promise<Buffer> {
  const doc = new PDFDocument({
    size: 'LETTER',
    margins: PAGE_MARGINS,
    bufferPages: true,
    info: { Title: note.title, Creator: 'NOAT' },
  });

  const chunks: Buffer[] = [];
  doc.on('data', (chunk: Buffer) => chunks.push(chunk));
  const finished = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  const left = PAGE_MARGINS.left;
  const contentWidth = doc.page.width - PAGE_MARGINS.left - PAGE_MARGINS.right;
  const bottomLimit = (): number => doc.page.height - doc.page.margins.bottom;

  const ensureRoom = (height: number): void => {
    const pageCapacity = doc.page.height - doc.page.margins.top - doc.page.margins.bottom;
    if (doc.y + height > bottomLimit() && height < pageCapacity) doc.addPage();
  };

  const renderRuns = (
    runs: InlineRun[],
    x: number,
    width: number,
    options: { size?: number; color?: string; align?: string } = {}
  ): void => {
    const size = options.size ?? BODY_SIZE;
    const visible = runs
      .map((run) => ({ ...run, text: toWinAnsi(run.text) }))
      .filter((run) => run.text.length > 0);
    if (visible.length === 0) {
      doc.moveDown(0.7);
      return;
    }
    ensureRoom(size * 1.5);
    for (const [index, run] of visible.entries()) {
      doc
        .font(fontFor(run))
        .fontSize(run.code ? size - 1 : size)
        .fillColor(run.color ?? options.color ?? TEXT_COLOR);
      const textOptions = {
        width,
        align: (options.align ?? 'left') as 'left',
        lineGap: 2,
        continued: index < visible.length - 1,
        underline: run.underline,
        strike: run.strike,
        // `null` (not undefined) is required to clear a link inherited from a
        // previous continued call — pdfkit merges options across segments.
        link: run.link ?? null,
      };
      if (index === 0) doc.text(run.text, x, doc.y, textOptions);
      else doc.text(run.text, textOptions);
    }
  };

  const renderPrefixed = (
    prefix: string,
    runs: InlineRun[],
    x: number,
    width: number,
    prefixColor: string = MUTED_COLOR
  ): void => {
    doc.font('Helvetica').fontSize(BODY_SIZE);
    const indent = Math.max(16, doc.widthOfString(prefix) + 6);
    ensureRoom(BODY_SIZE * 1.5);
    const y = doc.y;
    doc.fillColor(prefixColor).text(prefix, x, y, { width: indent, lineBreak: false });
    if (runs.length > 0 && plainTextOf(runs).trim().length > 0) {
      doc.y = y;
      renderRuns(runs, x + indent, width - indent);
    } else {
      doc.y = y + doc.currentLineHeight() + 2;
    }
  };

  const renderCodeBlock = (code: string, x: number, width: number): void => {
    const pad = 8;
    const text = toWinAnsi(code).replace(/\n+$/, '');
    doc.font('Courier').fontSize(CODE_SIZE);
    const height = doc.heightOfString(text || ' ', { width: width - pad * 2, lineGap: 1.5 });
    ensureRoom(height + pad * 2);
    const fits = doc.y + height + pad * 2 <= bottomLimit();
    if (fits) {
      doc
        .save()
        .rect(x, doc.y - 2, width, height + pad * 2)
        .fill(CODE_BG_COLOR)
        .restore();
    }
    doc
      .fillColor('#333333')
      .text(text || ' ', x + pad, doc.y + pad, { width: width - pad * 2, lineGap: 1.5 });
    doc.y += pad + 2;
  };

  const renderTable = (content: unknown, x: number, width: number): void => {
    const table = content as {
      rows?: Array<{ cells?: unknown[] }>;
      columnWidths?: Array<number | null>;
      headerRows?: number;
    };
    const rows = table.rows ?? [];
    if (rows.length === 0) return;
    const columnCount = Math.max(...rows.map((row) => row.cells?.length ?? 0), 1);
    const rawWidths = table.columnWidths ?? [];
    const columnWidths = ((): number[] => {
      const given = Array.from({ length: columnCount }, (_, i) => rawWidths[i]);
      if (given.every((w): w is number => typeof w === 'number' && w > 0)) {
        const total = given.reduce((sum, w) => sum + w, 0);
        return given.map((w) => (w / total) * width);
      }
      return Array.from({ length: columnCount }, () => width / columnCount);
    })();
    const pad = 4;
    const headerRows = table.headerRows ?? 0;

    for (const [rowIndex, row] of rows.entries()) {
      const isHeader = rowIndex < headerRows;
      const cellTexts = Array.from({ length: columnCount }, (_, i) =>
        toWinAnsi(plainTextOf(tableCellRuns(row.cells?.[i])))
      );
      doc.font(isHeader ? 'Helvetica-Bold' : 'Helvetica').fontSize(TABLE_SIZE);
      const rowHeight =
        Math.max(
          ...cellTexts.map((text, i) =>
            doc.heightOfString(text || ' ', { width: (columnWidths[i] ?? width) - pad * 2 })
          )
        ) +
        pad * 2;
      ensureRoom(rowHeight);
      const y = doc.y;
      cellTexts.reduce((cx, text, i) => {
        const cellWidth = columnWidths[i] ?? width / columnCount;
        doc.save().rect(cx, y, cellWidth, rowHeight).lineWidth(0.5).stroke(RULE_COLOR).restore();
        doc.fillColor(TEXT_COLOR).text(text, cx + pad, y + pad, { width: cellWidth - pad * 2 });
        return cx + cellWidth;
      }, x);
      doc.y = y + rowHeight;
    }
    doc.y += 4;
  };

  const renderMedia = (block: Block, x: number, width: number): void => {
    const props = propsOf(block);
    const url = props.url ?? '';
    const caption = props.caption ?? '';
    const imageBuffer = block.type === 'image' && url ? dataUrlImage(url) : undefined;
    if (imageBuffer) {
      try {
        const fitWidth = Math.min(width, props.previewWidth ?? width);
        ensureRoom(120);
        doc.x = x;
        doc.image(imageBuffer, { fit: [fitWidth, 420] });
        doc.y += 4;
      } catch {
        renderRuns(
          [
            {
              text: `[${block.type} could not be embedded]`,
              bold: false,
              italic: true,
              code: false,
              underline: false,
              strike: false,
              color: MUTED_COLOR,
            },
          ],
          x,
          width
        );
      }
    } else {
      const label = props.name || url || '(no file)';
      renderRuns(
        [
          {
            text: `[${block.type}: ${label}]`,
            bold: false,
            italic: true,
            code: false,
            underline: false,
            strike: false,
            color: MUTED_COLOR,
            ...(url.startsWith('http') ? { link: url, underline: true } : {}),
          },
        ],
        x,
        width
      );
    }
    if (caption) {
      renderRuns(
        [
          {
            text: caption,
            bold: false,
            italic: true,
            code: false,
            underline: false,
            strike: false,
            color: MUTED_COLOR,
          },
        ],
        x,
        width,
        { size: BODY_SIZE - 1.5 }
      );
    }
  };

  const renderBlocks = (blocks: Block[], x: number, width: number): void => {
    let ordinal = 0;
    for (const block of blocks) {
      ordinal = block.type === 'numberedListItem' ? ordinal + 1 : 0;
      const props = propsOf(block);
      const content = (block as { content?: unknown }).content;
      const runs = inlineRuns(content);
      const align = props.textAlignment ?? 'left';
      const blockColor = props.textColor ? NAMED_TEXT_COLORS[props.textColor] : undefined;

      switch (block.type) {
        case 'heading': {
          const size = HEADING_SIZES[props.level ?? 1] ?? BODY_SIZE;
          doc.moveDown(0.5);
          renderRuns(
            runs.map((run) => ({ ...run, bold: true })),
            x,
            width,
            { size, align, ...(blockColor ? { color: blockColor } : {}) }
          );
          doc.moveDown(0.25);
          break;
        }
        case 'bulletListItem':
        case 'toggleListItem':
          renderPrefixed('\u2022', runs, x, width, TEXT_COLOR);
          break;
        case 'numberedListItem':
          renderPrefixed(`${ordinal}.`, runs, x, width, TEXT_COLOR);
          break;
        case 'checkListItem':
          renderPrefixed(props.checked === true ? '[x]' : '[ ]', runs, x, width);
          break;
        case 'codeBlock': {
          doc.moveDown(0.3);
          renderCodeBlock(plainTextOf(runs), x, width);
          doc.moveDown(0.3);
          break;
        }
        case 'quote': {
          const barX = x + 2;
          const indented = x + 14;
          const startY = doc.y;
          renderRuns(
            runs.map((run) => ({ ...run, italic: true })),
            indented,
            width - 14,
            { color: MUTED_COLOR, align }
          );
          if (doc.y > startY) {
            doc
              .save()
              .rect(barX, startY, 2.5, doc.y - startY)
              .fill('#cccccc')
              .restore();
          }
          break;
        }
        case 'table':
          renderTable(content, x, width);
          break;
        case 'image':
        case 'video':
        case 'audio':
        case 'file':
          renderMedia(block, x, width);
          break;
        default:
          renderRuns(runs, x, width, { align, ...(blockColor ? { color: blockColor } : {}) });
      }

      const children = (block as { children?: Block[] }).children;
      if (Array.isArray(children) && children.length > 0) {
        renderBlocks(children, x + CHILD_INDENT, width - CHILD_INDENT);
      }
      doc.moveDown(0.35);
    }
  };

  // Header: title, updated-at line, rule.
  const title = toWinAnsi(note.title).trim() || 'Untitled';
  doc.font('Helvetica-Bold').fontSize(22).fillColor(TEXT_COLOR);
  doc.text(title, left, doc.y, { width: contentWidth });
  doc.moveDown(0.3);
  doc.font('Helvetica').fontSize(9).fillColor(MUTED_COLOR);
  doc.text(`Exported from NOAT \u00b7 last updated ${note.updatedAt.slice(0, 10)}`, left, doc.y, {
    width: contentWidth,
  });
  doc.moveDown(0.6);
  doc
    .moveTo(left, doc.y)
    .lineTo(left + contentWidth, doc.y)
    .lineWidth(1)
    .strokeColor(RULE_COLOR)
    .stroke();
  doc.moveDown(1);

  if (note.blocks.length === 0) {
    doc.font('Helvetica-Oblique').fontSize(BODY_SIZE).fillColor(MUTED_COLOR);
    doc.text('This note is empty.', left, doc.y, { width: contentWidth });
  } else {
    renderBlocks(note.blocks, left, contentWidth);
  }

  // Page numbers, centered in the bottom margin of every page.
  const pages = doc.bufferedPageRange();
  for (let i = pages.start; i < pages.start + pages.count; i++) {
    doc.switchToPage(i);
    const savedBottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc.font('Helvetica').fontSize(8).fillColor(MUTED_COLOR);
    doc.text(`${i + 1} / ${pages.count}`, left, doc.page.height - 40, {
      width: contentWidth,
      align: 'center',
      lineBreak: false,
    });
    doc.page.margins.bottom = savedBottom;
  }

  doc.end();
  return finished;
}
