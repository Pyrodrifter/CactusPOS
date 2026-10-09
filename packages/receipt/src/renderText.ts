import type { Block, Columns } from './blocks.js';

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
 * One printable line with its style. Large text is double width, so it gets half the columns.
 * Shared by the plain-text and ESC/POS renderers so both wrap identically.
 */
export interface Line { text: string; bold: boolean; large: boolean; align: 'left' | 'center' | 'right' }
export type LaidOut = { kind: 'line'; line: Line } | { kind: 'raster'; image: import('@cactus/shared').ReceiptLogo; align: 'left' | 'center' | 'right' } | { kind: 'qr'; data: string } | { kind: 'cut' } | { kind: 'drawer' } | { kind: 'feed'; lines: number };

export function layout(blocks: readonly Block[], columns: Columns): LaidOut[] {
  const out: LaidOut[] = [];
  const push = (text: string, s: Partial<Line> = {}) => out.push({ kind: 'line', line: { text, bold: false, large: false, align: 'left', ...s } });
  for (const b of blocks) {
    switch (b.t) {
      case 'text': {
        const large = b.size === 'large';
        for (const l of wrap(b.text, large ? Math.floor(columns / 2) : columns)) push(l, { bold: !!b.bold, large, align: b.align ?? 'left' });
        break;
      }
      case 'row': {
        const large = b.size === 'large';
        for (const l of rowLines(b.left, b.right, large ? Math.floor(columns / 2) : columns)) push(l, { bold: !!b.bold, large });
        break;
      }
      case 'sub': for (const l of wrap(b.text, columns - 3)) push(`   ${l}`); break;
      case 'rule': if (b.style === 'space') out.push({ kind: 'feed', lines: 1 }); else push((b.style === 'solid' ? '_' : '-').repeat(columns)); break;
      case 'raster': out.push({ kind: 'raster', image: b.image, align: b.align ?? 'center' }); break;
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
    if (x.kind === 'line') lines.push(alignLine(x.line.text, x.line.large ? Math.floor(columns / 2) : columns, x.line.align).trimEnd());
    else if (x.kind === 'qr') lines.push(alignLine(`[QR ${x.data}]`, columns, 'center'));
    else if (x.kind === 'raster') lines.push(alignLine('[LOGO]', columns, x.align));
    else if (x.kind === 'feed') lines.push(...Array<string>(x.lines).fill(''));
  }
  return lines.join('\n');
}
