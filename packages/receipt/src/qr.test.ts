import { describe, expect, it } from 'vitest';
import jsQR from 'jsqr';
import { QR_MAX_BYTES, QR_QUIET, qrMatrix, qrRaster } from './qr.js';
import { wifiQr } from './build.js';

/**
 * The till draws its own QR codes. These tests read them back with jsQR, a decoder written by other people,
 * so "it decodes to what we put in" does not rest on our encoder agreeing with itself.
 */
function scan(image: { width: number; height: number; hex: string }): string | null {
  const bytes = image.hex.match(/../g)!.map((h) => parseInt(h, 16));
  const rgba = new Uint8ClampedArray(image.width * image.height * 4);
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      const black = (bytes[y * image.width / 8 + (x >> 3)]! & (128 >> (x & 7))) !== 0;
      rgba.set(black ? [0, 0, 0, 255] : [255, 255, 255, 255], (y * image.width + x) * 4);
    }
  }
  return jsQR(rgba, image.width, image.height)?.data ?? null;
}

describe('QR codes', () => {
  it('a web address and WiFi details read back exactly', () => {
    for (const text of ['https://www.cactusblue.us', 'https://instagram.com/cactusblue', wifiQr('Cactus Blue Guest', 'burgers&waves;2026'), 'Jalapeños é ü ñ € 🌵']) {
      expect(scan(qrRaster(text)!)).toBe(text);
    }
  });

  it('every size of code the till can make reads back, from the smallest to the largest', () => {
    const sizes = new Set<number>();
    // Lengths chosen to walk through all twenty sizes, including both ends of the range.
    for (const length of [1, 14, 15, 26, 27, 42, 62, 84, 106, 122, 152, 180, 213, 251, 287, 331, 362, 412, 450, 504, 560, 624, 640, QR_MAX_BYTES]) {
      const text = Array.from({ length }, (_, i) => 'abcdefghijklmnopqrstuvwxyz0123456789:/?=&.-_'[(i * 7 + length) % 44]).join('');
      const matrix = qrMatrix(text)!;
      expect(matrix.length % 4).toBe(1); // 21, 25, 29 ... squares
      sizes.add((matrix.length - 17) / 4);
      expect(scan(qrRaster(text, 3)!)).toBe(text);
    }
    expect([...sizes].sort((a, b) => a - b)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
  });

  it('refuses what cannot be a code instead of drawing something unreadable', () => {
    expect(qrMatrix('')).toBeNull();
    expect(qrMatrix('x'.repeat(QR_MAX_BYTES + 1))).toBeNull();
    expect(qrRaster('é'.repeat(QR_MAX_BYTES / 2 + 1))).toBeNull(); // counted in bytes, not letters
  });

  it('is printed in whole dots with a white margin, and shrinks to fit narrow paper', () => {
    const text = 'https://www.cactusblue.us';
    const squares = qrMatrix(text)!.length + QR_QUIET * 2;
    const normal = qrRaster(text, 6, 576)!;
    expect(normal.height).toBe(squares * 6);
    expect(normal.width % 8).toBe(0);
    expect(normal.hex).toHaveLength(normal.width / 8 * normal.height * 2);
    expect(normal.hex.startsWith('00'.repeat(normal.width / 8 * QR_QUIET * 6))).toBe(true); // the margin on top
    // A long text on 58 mm paper (384 dots): fewer dots per square, never a fraction, still readable.
    const long = 'x'.repeat(300);
    const narrow = qrRaster(long, 8, 384)!;
    expect(narrow.width).toBeLessThanOrEqual(384);
    expect(narrow.height % (qrMatrix(long)!.length + QR_QUIET * 2)).toBe(0);
    expect(scan(narrow)).toBe(long);
  });
});
