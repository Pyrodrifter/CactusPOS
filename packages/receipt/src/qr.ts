import type { ReceiptLogo } from '@cactus/shared';

/**
 * QR codes, worked out here so the receipt printer, the browser and the preview all show the same dots.
 *
 * Receipt printers differ in whether and how they draw QR codes themselves, but every one this till supports
 * prints pictures. So the code is computed once and printed as a picture, like the logo.
 *
 * Byte mode, error correction level M (the code still reads with about 15% of it damaged), versions 1 to 20:
 * up to 666 bytes, far more than a web address or WiFi details need. The method follows ISO/IEC 18004 and
 * the structure of Project Nayuki's reference encoder. Tests read the result back with an independent decoder.
 */
export const QR_MAX_BYTES = 666;
const MAX_VERSION = 20;
/** Level M, per version (index 0 unused): error-correction bytes per block, and number of blocks. */
const ECC_PER_BLOCK = [0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26];
const BLOCKS = [0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16];

/** Modules available for data and error correction once the fixed patterns are taken out. */
function rawModules(version: number): number {
  let result = (16 * version + 128) * version + 64;
  if (version >= 2) {
    const aligns = Math.floor(version / 7) + 2;
    result -= (25 * aligns - 10) * aligns - 55;
    if (version >= 7) result -= 36;
  }
  return result;
}
const dataBytes = (version: number): number => Math.floor(rawModules(version) / 8) - ECC_PER_BLOCK[version]! * BLOCKS[version]!;

/* Reed-Solomon error correction over GF(256), polynomial 0x11D. */
function multiply(x: number, y: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z;
}
function divisor(degree: number): number[] {
  const result = new Array<number>(degree).fill(0);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < degree; j++) {
      result[j] = multiply(result[j]!, root);
      if (j + 1 < degree) result[j]! ^= result[j + 1]!;
    }
    root = multiply(root, 0x02);
  }
  return result;
}
function remainder(data: readonly number[], div: readonly number[]): number[] {
  const result = div.map(() => 0);
  for (const byte of data) {
    const factor = byte ^ result.shift()!;
    result.push(0);
    div.forEach((coefficient, i) => { result[i]! ^= multiply(coefficient, factor); });
  }
  return result;
}

function alignmentCentres(version: number, size: number): number[] {
  if (version === 1) return [];
  const count = Math.floor(version / 7) + 2;
  const step = Math.ceil((version * 4 + 4) / (count * 2 - 2)) * 2;
  const result = [6];
  for (let pos = size - 7; result.length < count; pos -= step) result.splice(1, 0, pos);
  return result;
}

const MASKS: ((x: number, y: number) => boolean)[] = [
  (x, y) => (x + y) % 2 === 0, (_x, y) => y % 2 === 0, (x) => x % 3 === 0, (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0, (x, y) => (x * y) % 2 + (x * y) % 3 === 0,
  (x, y) => ((x * y) % 2 + (x * y) % 3) % 2 === 0, (x, y) => ((x + y) % 2 + (x * y) % 3) % 2 === 0,
];

/** How hard a pattern is for a camera: long runs, blocks, shapes that look like the corner squares, lopsided ink. */
function penalty(m: readonly boolean[][]): number {
  const n = m.length;
  let result = 0, ink = 0;
  const lines: string[] = [];
  for (let i = 0; i < n; i++) {
    let row = '', column = '';
    for (let j = 0; j < n; j++) { row += m[i]![j] ? '1' : '0'; column += m[j]![i] ? '1' : '0'; if (m[i]![j]) ink++; }
    lines.push(row, column);
  }
  for (const line of lines) {
    for (const run of line.match(/0+|1+/g) ?? []) if (run.length >= 5) result += run.length - 2;
    for (const shape of ['10111010000', '00001011101']) for (let at = line.indexOf(shape); at >= 0; at = line.indexOf(shape, at + 1)) result += 40;
  }
  for (let y = 0; y < n - 1; y++) {
    for (let x = 0; x < n - 1; x++) if (m[y]![x] === m[y]![x + 1] && m[y]![x] === m[y + 1]![x] && m[y]![x] === m[y + 1]![x + 1]) result += 3;
  }
  return result + Math.floor(Math.abs(ink * 20 - n * n * 10) / (n * n)) * 10;
}

/**
 * The squares of a QR code holding `text`: `matrix[row][column]`, true = black. Null when the text is empty
 * or longer than a code of this kind can hold (QR_MAX_BYTES in UTF-8).
 */
export function qrMatrix(text: string): boolean[][] | null {
  const bytes = [...new TextEncoder().encode(text)];
  if (bytes.length === 0) return null;
  let version = 1;
  for (; ; version++) {
    if (version > MAX_VERSION) return null;
    if (4 + (version < 10 ? 8 : 16) + bytes.length * 8 <= dataBytes(version) * 8) break;
  }

  // The message: "these are bytes", how many, the bytes, an end mark, then padding up to the capacity.
  const bits: number[] = [];
  const push = (value: number, length: number) => { for (let i = length - 1; i >= 0; i--) bits.push((value >>> i) & 1); };
  push(0b0100, 4);
  push(bytes.length, version < 10 ? 8 : 16);
  for (const b of bytes) push(b, 8);
  const capacity = dataBytes(version) * 8;
  push(0, Math.min(4, capacity - bits.length));
  push(0, (8 - bits.length % 8) % 8);
  for (let pad = 0xec; bits.length < capacity; pad ^= 0xec ^ 0x11) push(pad, 8);
  const data: number[] = [];
  for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((byte, bit) => (byte << 1) | bit, 0));

  // Split into blocks, give each its error-correction bytes, and deal them out in turn.
  const blockCount = BLOCKS[version]!, eccLength = ECC_PER_BLOCK[version]!, total = Math.floor(rawModules(version) / 8);
  const shortBlocks = blockCount - total % blockCount, shortLength = Math.floor(total / blockCount);
  const div = divisor(eccLength);
  const blocks: number[][] = [];
  for (let i = 0, taken = 0; i < blockCount; i++) {
    const part = data.slice(taken, taken + shortLength - eccLength + (i < shortBlocks ? 0 : 1));
    taken += part.length;
    const ecc = remainder(part, div);
    if (i < shortBlocks) part.push(0); // a filler so all blocks are equally long; skipped when dealing out
    blocks.push(part.concat(ecc));
  }
  const codewords: number[] = [];
  for (let i = 0; i < blocks[0]!.length; i++) {
    blocks.forEach((block, j) => { if (i !== shortLength - eccLength || j >= shortBlocks) codewords.push(block[i]!); });
  }

  const size = version * 4 + 17;
  const dark = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const fixed = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const set = (x: number, y: number, on: boolean) => { dark[y]![x] = on; fixed[y]![x] = true; };

  // Fixed patterns: timing lines, the three corner squares, the small alignment squares.
  for (let i = 0; i < size; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
  for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]] as const) {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const x = cx + dx, y = cy + dy, ring = Math.max(Math.abs(dx), Math.abs(dy));
        if (x >= 0 && x < size && y >= 0 && y < size) set(x, y, ring !== 2 && ring !== 4);
      }
    }
  }
  const centres = alignmentCentres(version, size), last = centres.length - 1;
  centres.forEach((cx, i) => centres.forEach((cy, j) => {
    if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) return; // a corner square is there
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
  }));
  // Which error-correction level and mask were used, written twice around the corner squares.
  const drawFormat = (mask: number) => {
    const info = mask; // level M is 00 in the two bits above the mask
    let rem = info;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const word = ((info << 10) | rem) ^ 0x5412;
    const bit = (i: number) => ((word >>> i) & 1) !== 0;
    for (let i = 0; i <= 5; i++) set(8, i, bit(i));
    set(8, 7, bit(6)); set(8, 8, bit(7)); set(7, 8, bit(8));
    for (let i = 9; i < 15; i++) set(14 - i, 8, bit(i));
    for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(i));
    set(8, size - 8, true);
  };
  drawFormat(0);
  if (version >= 7) {
    let rem = version;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const word = (version << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const on = ((word >>> i) & 1) !== 0, a = size - 11 + i % 3, b = Math.floor(i / 3);
      set(a, b, on); set(b, a, on);
    }
  }

  // The message goes into what is left, in a zigzag of two-wide columns from the bottom right.
  let index = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let step = 0; step < size; step++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j, y = ((right + 1) & 2) === 0 ? size - 1 - step : step;
        if (!fixed[y]![x] && index < codewords.length * 8) {
          dark[y]![x] = ((codewords[index >>> 3]! >>> (7 - (index & 7))) & 1) !== 0;
          index++;
        }
      }
    }
  }

  // Of the eight standard masks, keep the one a camera reads most easily.
  const flip = (mask: number) => { for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!fixed[y]![x] && MASKS[mask]!(x, y)) dark[y]![x] = !dark[y]![x]; };
  let best = 0, lowest = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    flip(mask); drawFormat(mask);
    const score = penalty(dark);
    if (score < lowest) { lowest = score; best = mask; }
    flip(mask);
  }
  flip(best); drawFormat(best);
  return dark;
}

/** White margin a QR code needs on every side, in squares. */
export const QR_QUIET = 4;

/**
 * A QR code as a printer picture: `scale` dots per square, reduced to whole dots so the code with its white
 * margin fits `maxDots`. Whole dots matter: a QR code scaled by a fraction is hard to read.
 */
export function qrRaster(text: string, scale = 6, maxDots = 576): ReceiptLogo | null {
  const m = qrMatrix(text);
  if (!m) return null;
  const squares = m.length + QR_QUIET * 2;
  const dots = Math.max(1, Math.min(scale, Math.floor(maxDots / squares)));
  const side = squares * dots, width = Math.ceil(side / 8) * 8, stride = width / 8;
  const left = Math.floor((width - side) / 2) + QR_QUIET * dots;
  const blank = '00'.repeat(stride);
  let hex = blank.repeat(QR_QUIET * dots);
  for (const line of m) {
    const row = new Uint8Array(stride);
    line.forEach((on, column) => {
      if (!on) return;
      for (let x = left + column * dots; x < left + (column + 1) * dots; x++) row[x >> 3]! |= 128 >> (x & 7);
    });
    hex += [...row].map((byte) => byte.toString(16).padStart(2, '0')).join('').repeat(dots);
  }
  return { width, height: side, hex: hex + blank.repeat(QR_QUIET * dots) };
}
