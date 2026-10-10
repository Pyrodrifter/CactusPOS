import { describe, expect, it } from 'vitest';
import { ReceiptLogo } from '@cactus/shared';
import { cssFamily, fontLabel, packPixels, paperDots } from './lettering';

/** Canvas pixels are RGBA. Drawing itself needs a browser and is covered by e2e/receipt-editor.mjs. */
const px = (...shades: (number | 'clear')[]) => shades.flatMap((s) => (s === 'clear' ? [0, 0, 0, 0] : [s, s, s, 255]));

describe('printer dots from canvas pixels', () => {
  it('packs eight pixels into a byte, darkest bit first, row by row', () => {
    const image = packPixels([...px(0, 255, 0, 255, 255, 255, 255, 0), ...px(255, 255, 255, 255, 0, 0, 0, 0)], 8, 2);
    expect(image).toEqual({ width: 8, height: 2, hex: 'a10f' });
    expect(ReceiptLogo.safeParse(image).success).toBe(true);
  });
  it('treats mid greys by the threshold and see-through pixels as paper', () => {
    expect(packPixels(px(100, 200, 100, 200, 'clear', 'clear', 0, 0), 8, 1).hex).toBe('a3');
    expect(packPixels(px(140, 140, 140, 140, 160, 160, 160, 160), 8, 1, 150).hex).toBe('f0');
  });
  it('knows the dots across each paper and how to name a font for the browser', () => {
    expect([paperDots(80), paperDots(58)]).toEqual([576, 384]);
    expect(cssFamily('cursive')).toBe('cursive');
    expect(cssFamily('Segoe Script')).toBe('"Segoe Script", sans-serif');
    expect(cssFamily('Bad"Name\\')).toBe('"BadName", sans-serif');
    expect([fontLabel('cursive', false), fontLabel('cursive', true), fontLabel('Impact', true)]).toEqual(['Handwriting', 'Handschrift', 'Impact']);
  });
});
