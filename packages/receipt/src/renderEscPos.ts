import type { Block, Columns, TextSize } from './blocks.js';
import { layout } from './renderText.js';

/**
 * ESC/POS: the command set almost every thermal receipt printer speaks (Epson, Star in ESC/POS
 * mode, Bixolon, Xprinter and other generics). Only widely supported commands are used.
 */
const ESC = 0x1b, GS = 0x1d, LF = 0x0a;

export interface EscPosOptions {
  columns?: Columns;
  /** Set false for printers without an auto-cutter: feeds extra paper to tear instead. */
  cutter?: boolean;
  /** Drawer kick connector pin: 0 (pin 2, most drawers) or 1 (pin 5). */
  drawerPin?: 0 | 1;
}

/**
 * Code page 858 (Western Europe + euro): covers Dutch, Papiamento and Spanish accents.
 * Anything not in the table is reduced to plain ASCII rather than printed as garbage.
 */
const CP858: Record<string, number> = {
  'Ç': 0x80, 'ü': 0x81, 'é': 0x82, 'â': 0x83, 'ä': 0x84, 'à': 0x85, 'å': 0x86, 'ç': 0x87, 'ê': 0x88, 'ë': 0x89, 'è': 0x8a, 'ï': 0x8b,
  'î': 0x8c, 'ì': 0x8d, 'Ä': 0x8e, 'Å': 0x8f, 'É': 0x90, 'æ': 0x91, 'Æ': 0x92, 'ô': 0x93, 'ö': 0x94, 'ò': 0x95, 'û': 0x96, 'ù': 0x97,
  'ÿ': 0x98, 'Ö': 0x99, 'Ü': 0x9a, 'ø': 0x9b, '£': 0x9c, 'Ø': 0x9d, '×': 0x9e, 'á': 0xa0, 'í': 0xa1, 'ó': 0xa2, 'ú': 0xa3, 'ñ': 0xa4,
  'Ñ': 0xa5, '¿': 0xa8, '¡': 0xad, 'Á': 0xb5, 'Â': 0xb6, 'À': 0xb7, 'ã': 0xc6, 'Ã': 0xc7, 'Ê': 0xd2, 'Ë': 0xd3, 'È': 0xd4, '€': 0xd5,
  'Í': 0xd6, 'Î': 0xd7, 'Ï': 0xd8, 'Ó': 0xe0, 'ß': 0xe1, 'Ô': 0xe2, 'Ò': 0xe3, 'õ': 0xe4, 'Õ': 0xe5, 'Ú': 0xe9, 'Û': 0xea, 'Ù': 0xeb,
  '°': 0xf8, '·': 0xfa,
};
const ASCII_FALLBACK: Record<string, string> = { '‘': "'", '’': "'", '“': '"', '”': '"', '–': '-', '—': '-', '…': '...', '′': "'", '•': '*' };

export function encodeText(s: string): number[] {
  const out: number[] = [];
  for (const ch of s) {
    const code = ch.codePointAt(0)!;
    if (code >= 0x20 && code < 0x7f) out.push(code);
    else if (CP858[ch] !== undefined) out.push(CP858[ch]);
    else {
      const alt = ASCII_FALLBACK[ch] ?? ch.normalize('NFD').replace(/[̀-ͯ]/g, '');
      for (const a of alt) { const c = a.codePointAt(0)!; out.push(c >= 0x20 && c < 0x7f ? c : 0x3f); }
    }
  }
  return out;
}

function qrCommands(data: string): number[] {
  const bytes = [...Buffer.from(data, 'utf8')];
  const len = bytes.length + 3;
  return [
    GS, 0x28, 0x6b, 4, 0, 49, 65, 50, 0,          // model 2
    GS, 0x28, 0x6b, 3, 0, 49, 67, 6,              // module size 6
    GS, 0x28, 0x6b, 3, 0, 49, 69, 49,             // error correction M
    GS, 0x28, 0x6b, len & 0xff, len >> 8, 49, 80, 48, ...bytes, // store
    GS, 0x28, 0x6b, 3, 0, 49, 81, 48,             // print
  ];
}

/** GS ! n: the high half is extra width, the low half extra height. The narrow font is a separate command. */
const MAGNIFY: Record<TextSize, number> = { small: 0x00, normal: 0x00, tall: 0x01, wide: 0x10, large: 0x11, huge: 0x22 };

export function renderEscPos(blocks: readonly Block[], opts: EscPosOptions = {}): Uint8Array {
  const columns = opts.columns ?? 48;
  const out: number[] = [ESC, 0x40, ESC, 0x74, 19]; // initialise, select code page 858
  // What the printer is set to now. A command is sent only when a line needs something else, so a plain
  // receipt carries exactly the bytes it always did.
  let bold = false, magnify = 0x00, align = 'left', narrow = false, underline = false, inverse = false;
  for (const x of layout(blocks, columns)) {
    if (x.kind === 'line') {
      const l = x.line;
      if (l.align !== align) { align = l.align; out.push(ESC, 0x61, align === 'center' ? 1 : align === 'right' ? 2 : 0); }
      if (l.bold !== bold) { bold = l.bold; out.push(ESC, 0x45, bold ? 1 : 0); }
      if (MAGNIFY[l.size] !== magnify) { magnify = MAGNIFY[l.size]; out.push(GS, 0x21, magnify); }
      if ((l.size === 'small') !== narrow) { narrow = l.size === 'small'; out.push(ESC, 0x4d, narrow ? 1 : 0); }
      if (l.underline !== underline) { underline = l.underline; out.push(ESC, 0x2d, underline ? 1 : 0); }
      if (l.inverse !== inverse) { inverse = l.inverse; out.push(GS, 0x42, inverse ? 1 : 0); }
      out.push(...encodeText(l.text), LF);
    } else if (x.kind === 'raster') {
      align = x.align;
      const bytes = x.image.hex.match(/../g)!.map((h) => parseInt(h, 16));
      // GS v 0: bytes per row and rows, each as low byte then high byte (a picture can be taller than 255 dots).
      out.push(ESC, 0x61, align === 'center' ? 1 : align === 'right' ? 2 : 0, GS, 0x76, 0x30, 0, x.image.width / 8, 0, x.image.height & 0xff, x.image.height >> 8, ...bytes, LF);
    } else if (x.kind === 'qr') {
      out.push(ESC, 0x61, 1, ...qrCommands(x.data), LF);
      align = 'center';
    } else if (x.kind === 'feed') {
      out.push(ESC, 0x64, Math.min(255, x.lines));
    } else if (x.kind === 'cut') {
      if (opts.cutter === false) out.push(ESC, 0x64, 4);
      else out.push(GS, 0x56, 66, 0);
    } else if (x.kind === 'drawer') {
      out.push(ESC, 0x70, opts.drawerPin ?? 0, 25, 250);
    }
  }
  return Uint8Array.from(out);
}

/** Just the drawer pulse, for "open drawer" without printing. */
export function drawerKick(pin: 0 | 1 = 0): Uint8Array {
  return Uint8Array.from([ESC, 0x40, ESC, 0x70, pin, 25, 250]);
}
