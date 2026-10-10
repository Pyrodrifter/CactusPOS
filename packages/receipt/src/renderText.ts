import type { ReceiptLogo } from '@cactus/shared';
import type { Block, Columns, RuleStyle, TextSize } from './blocks.js';

/** Break text into lines of at most `width` characters, on spaces where possible. */
export function wrap(text: string, width: number): string[] {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const word of para.split(' ')) {
      let w = word;
      while (w.length > width) {
        if (line) { out.push(line); line = ''; }
        out.push(w.slice(0, width));
        w = w.slice(width);
      }
      if (!line) line = w;
      else if (line.length + 1 + w.length <= width) line += ` ${w}`;
      else { out.push(line); line = w; }
    }
    out.push(line);
  }
  return out;
}

export function alignLine(text: string, width: number, align: 'left' | 'center' | 'right' = 'left'): string {
  const pad = Math.max(0, width - text.length);
  if (align === 'right') return ' '.repeat(pad) + text;
  if (align === 'center') return ' '.repeat(Math.floor(pad / 2)) + text;
  return text;
}

/** "left ........ right" within width. A long left side wraps; the value stays on the first line. */
export function rowLines(left: string, right: string, width: number): string[] {
  const room = Math.max(4, width - right.length - 1);
  const parts = wrap(left, room);
  const first = parts[0] ?? '';
  return [first + ' '.repeat(Math.max(1, width - first.length - right.length)) + right, ...parts.slice(1).map((p) => `  ${p}`.slice(0, width))];
}

/**
 * How many characters of a size fit on a line that holds `columns` normal ones. The narrow font is 9 dots
 * wide against 12, so it fits a third more; double and triple width fit a half and a third.
 */
export function columnsFor(size: TextSize, columns: number): number {
  if (size === 'small') return Math.floor(columns * 4 / 3);
  if (size === 'wide' || size === 'large') return Math.floor(columns / 2);
  if (size === 'huge') return Math.floor(columns / 3);
  return columns;
}

const RULES: Record<Exclude<RuleStyle, 'space'>, string> = { dashed: '-', solid: '_', double: '=', dotted: '. ', stars: '* ', wave: '~' };
/** The characters of a divider line across the paper. */
export function ruleLine(style: Exclude<RuleStyle, 'space'>, columns: number): string {
  const pattern = RULES[style];
  return pattern.repeat(Math.ceil(columns / pattern.length)).slice(0, columns).trimEnd();
}

/** Dots across the paper for a column setting: a normal character is 12 dots wide. */
export const paperDots = (columns: number): number => columns * 12;

/**
 * A picture no wider than `maxWidth` dots. The editor draws for the paper width of the design, but the
 * printer's own setting has the last word, so a picture made for 80 mm is scaled down on a 58 mm roll
 * instead of losing its right-hand side.
 */
export function fitRaster(image: ReceiptLogo, maxWidth: number): ReceiptLogo {
  const limit = Math.max(8, Math.floor(maxWidth / 8) * 8);
  if (image.width <= limit) return image;
  const scale = limit / image.width;
  const height = Math.max(1, Math.round(image.height * scale));
  const source = image.hex.match(/../g)!.map((h) => parseInt(h, 16));
  const stride = image.width / 8;
  let hex = '';
  for (let y = 0; y < height; y++) {
    const sy = Math.min(image.height - 1, Math.floor(y / scale));
    for (let byte = 0; byte < limit / 8; byte++) {
      let value = 0;
      for (let bit = 0; bit < 8; bit++) {
        const sx = Math.min(image.width - 1, Math.floor((byte * 8 + bit) / scale));
        if (source[sy * stride + (sx >> 3)]! & (128 >> (sx & 7))) value |= 128 >> bit;
      }
      hex += value.toString(16).padStart(2, '0');
    }
  }
  return { width: limit, height, hex };
}

/**
 * One printable line with its style, already wrapped for its size.
 * Shared by the plain-text and ESC/POS renderers so both wrap identically.
 */
export interface Line { text: string; bold: boolean; size: TextSize; underline: boolean; inverse: boolean; align: 'left' | 'center' | 'right' }
export type LaidOut = { kind: 'line'; line: Line } | { kind: 'raster'; image: ReceiptLogo; align: 'left' | 'center' | 'right'; alt?: string } | { kind: 'qr'; data: string } | { kind: 'cut' } | { kind: 'drawer' } | { kind: 'feed'; lines: number };

export function layout(blocks: readonly Block[], columns: Columns): LaidOut[] {
  const out: LaidOut[] = [];
  const push = (text: string, s: Partial<Line> = {}) => out.push({ kind: 'line', line: { text, bold: false, size: 'normal', underline: false, inverse: false, align: 'left', ...s } });
  for (const b of blocks) {
    switch (b.t) {
      case 'text': {
        const size = b.size ?? 'normal';
        for (const l of wrap(b.text, columnsFor(size, columns))) push(l, { bold: !!b.bold, size, underline: !!b.underline, inverse: !!b.inverse, align: b.align ?? 'left' });
        break;
      }
      case 'row': {
        const size = b.size ?? 'normal';
        for (const l of rowLines(b.left, b.right, columnsFor(size, columns))) push(l, { bold: !!b.bold, size });
        break;
      }
      case 'sub': for (const l of wrap(b.text, columns - 3)) push(`   ${l}`); break;
      case 'rule': if (b.style === 'space') out.push({ kind: 'feed', lines: 1 }); else push(ruleLine(b.style ?? 'dashed', columns)); break;
      case 'raster': out.push({ kind: 'raster', image: fitRaster(b.image, paperDots(columns)), align: b.align ?? 'center', alt: b.alt }); break;
      case 'feed': out.push({ kind: 'feed', lines: b.lines }); break;
      case 'qr':
        out.push({ kind: 'qr', data: b.data });
        if (b.caption) push(b.caption, { align: 'center' });
        break;
      case 'cut': out.push({ kind: 'cut' }); break;
      case 'drawer': out.push({ kind: 'drawer' }); break;
    }
  }
  return out;
}

/** Plain-text rendering: what the paper will look like, for previews, logs and tests. */
export function renderText(blocks: readonly Block[], columns: Columns = 48): string {
  const lines: string[] = [];
  for (const x of layout(blocks, columns)) {
    if (x.kind === 'line') lines.push(alignLine(x.line.text, columnsFor(x.line.size, columns), x.line.align).trimEnd());
    else if (x.kind === 'qr') lines.push(alignLine(`[QR ${x.data}]`, columns, 'center'));
    // A picture cannot be shown as text; lettering says what it spells, so a log still reads as the receipt did.
    else if (x.kind === 'raster') lines.push(alignLine(x.alt ? `[${x.alt}]` : '[LOGO]', columns, x.align));
    else if (x.kind === 'feed') lines.push(...Array<string>(x.lines).fill(''));
  }
  return lines.join('\n');
}
