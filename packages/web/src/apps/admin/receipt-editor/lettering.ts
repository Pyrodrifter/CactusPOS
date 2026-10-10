import type { Lettering, ReceiptLogo } from '@cactus/shared';

/**
 * Pictures for the receipt printer, made in the browser.
 *
 * A receipt printer knows one typeface. It does print pictures, so "lettering" is drawn here, on a canvas, in
 * any font this device has, and stored in the design as black and white dots. The printer and every other
 * device then show exactly these dots: nothing about the font has to exist anywhere else.
 */

/** Dots across the printable width: 8 per millimetre, 72 mm on an 80 mm roll and 48 mm on a 58 mm roll. */
export const paperDots = (widthMm: 58 | 80): number => (widthMm === 58 ? 384 : 576);

/** Letter height in dots for each lettering size (8 dots = 1 mm on paper). */
export const LETTER_PX: Record<Lettering['size'], number> = { s: 34, m: 48, l: 68, xl: 96 };

/**
 * Packs canvas pixels (RGBA) into rows of bits, most significant bit first: a dot is black when the pixel is
 * darker than `threshold` (0-255). `width` must be a multiple of 8.
 */
export function packPixels(rgba: ArrayLike<number>, width: number, height: number, threshold = 165): ReceiptLogo {
  let hex = '';
  for (let y = 0; y < height; y++) {
    for (let byte = 0; byte < width / 8; byte++) {
      let value = 0;
      for (let bit = 0; bit < 8; bit++) {
        const i = (y * width + byte * 8 + bit) * 4;
        // Transparent counts as paper, not as black.
        const ink = (rgba[i + 3] ?? 255) < 128 ? 255 : rgba[i]! * 0.299 + rgba[i + 1]! * 0.587 + rgba[i + 2]! * 0.114;
        if (ink < threshold) value |= 128 >> bit;
      }
      hex += value.toString(16).padStart(2, '0');
    }
  }
  return { width, height, hex };
}

/** A photo or logo file as printer dots, scaled to fit `maxWidth` x `maxHeight`. */
export async function pictureFrom(file: File, maxWidth: number, maxHeight: number): Promise<ReceiptLogo> {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 5_000_000) throw new Error('Use a PNG, JPG or WebP image under 5 MB.');
  const source = await createImageBitmap(file);
  try {
    const scale = Math.min(maxWidth / source.width, maxHeight / source.height, 1);
    const width = Math.max(8, Math.ceil(source.width * scale / 8) * 8), height = Math.max(1, Math.round(source.height * scale));
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, width, height);
    ctx.drawImage(source, (width - source.width * scale) / 2, 0, source.width * scale, height);
    return packPixels(ctx.getImageData(0, 0, width, height).data, width, height);
  } finally { source.close(); }
}

const GENERIC = ['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy'];
/** How a font name goes into CSS: the five generic families bare, any other name quoted with a plain fallback. */
export const cssFamily = (font: string): string => (GENERIC.includes(font) ? font : `"${font.replace(/["\\]/g, '')}", sans-serif`);

/** Fonts worth offering when the device has them: handwriting and display faces first, then plainer ones. */
const CANDIDATES = [
  // Windows
  'Segoe Script', 'Segoe Print', 'Ink Free', 'Brush Script MT', 'Lucida Handwriting', 'Freestyle Script', 'Mistral', 'Gabriola', 'Comic Sans MS', 'MV Boli',
  'Cooper Black', 'Impact', 'Arial Black', 'Bahnschrift', 'Rockwell', 'Stencil', 'Showcard Gothic', 'Broadway', 'Magneto', 'Forte', 'Kristen ITC', 'Jokerman',
  'Papyrus', 'Bauhaus 93', 'Berlin Sans FB', 'Ravie', 'Snap ITC', 'Algerian', 'Old English Text MT', 'Vivaldi', 'Edwardian Script ITC', 'Copperplate Gothic Bold',
  'Georgia', 'Palatino Linotype', 'Garamond', 'Century Gothic', 'Trebuchet MS', 'Verdana', 'Courier New', 'Consolas',
  // macOS, iPad and iPhone
  'Snell Roundhand', 'Bradley Hand', 'Chalkduster', 'Marker Felt', 'Noteworthy', 'SignPainter', 'Savoye LET', 'Zapfino', 'Phosphate', 'American Typewriter',
  'Copperplate', 'Didot', 'Futura', 'Optima', 'Baskerville', 'Avenir Next', 'Gill Sans', 'Chalkboard SE', 'Menlo',
  // Android and Linux
  'Dancing Script', 'Coming Soon', 'Roboto', 'Noto Serif', 'Ubuntu', 'DejaVu Serif', 'Liberation Serif',
];

let measure: CanvasRenderingContext2D | null = null;
/** Whether this device can draw `name`: text in it measures differently from the plain fallback fonts. */
function installed(name: string): boolean {
  measure ??= document.createElement('canvas').getContext('2d');
  if (!measure) return false;
  const sample = 'mmmmmmmmmmlliWQ@g';
  for (const base of ['monospace', 'serif', 'sans-serif']) {
    measure.font = `72px ${base}`;
    const plain = measure.measureText(sample).width;
    measure.font = `72px "${name}", ${base}`;
    if (measure.measureText(sample).width !== plain) return true;
  }
  return false;
}

let found: string[] | null = null;
const added: string[] = [];
/** Fonts to choose from on this device: font files added in this visit, what is installed, then the generic ones. */
export function deviceFonts(): string[] {
  found ??= CANDIDATES.filter(installed);
  return [...added, ...found, ...GENERIC];
}
/** A short, friendly name for the generic families. */
export function fontLabel(font: string, nl: boolean): string {
  const names: Record<string, [string, string]> = { serif: ['Classic', 'Klassiek'], 'sans-serif': ['Plain', 'Strak'], monospace: ['Typewriter', 'Typemachine'], cursive: ['Handwriting', 'Handschrift'], fantasy: ['Playful', 'Speels'] };
  return names[font]?.[nl ? 1 : 0] ?? font;
}

/** Makes a font file (.ttf, .otf, .woff, .woff2) usable for lettering in this visit. Only the drawn dots are ever saved. */
export async function addFontFile(file: File): Promise<string> {
  if (file.size > 8_000_000) throw new Error('That font file is too large (8 MB at most).');
  const name = file.name.replace(/\.[^.]+$/, '').replace(/[^\w -]+/g, ' ').trim().slice(0, 60) || 'My font';
  const face = new FontFace(name, await file.arrayBuffer());
  await face.load();
  document.fonts.add(face);
  if (!added.includes(name)) added.unshift(name);
  return name;
}

/**
 * Draws one line of lettering no wider than `maxWidth` dots. Words that do not fit at the chosen size are
 * drawn smaller rather than cut off. Returns null for empty text.
 */
export function drawLettering(text: string, font: string, size: Lettering['size'], bold: boolean, maxWidth: number): Lettering | null {
  const words = text.replace(/\s+/g, ' ').trim().slice(0, 80);
  if (!words) return null;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  let px = LETTER_PX[size];
  const use = () => { ctx.font = `${bold ? 700 : 400} ${px}px ${cssFamily(font)}`; ctx.textBaseline = 'alphabetic'; };
  const extent = () => { const m = ctx.measureText(words); return { left: Math.ceil(m.actualBoundingBoxLeft), right: Math.ceil(m.actualBoundingBoxRight), up: Math.ceil(m.actualBoundingBoxAscent), down: Math.ceil(m.actualBoundingBoxDescent) }; };
  use();
  let box = extent();
  const margin = 4;
  while ((box.left + box.right + margin * 2 > maxWidth || box.up + box.down + margin * 2 > 240) && px > 12) { px -= 2; use(); box = extent(); }
  const width = Math.min(Math.floor(maxWidth / 8) * 8, Math.ceil((box.left + box.right + margin * 2) / 8) * 8);
  const height = Math.max(8, Math.min(240, box.up + box.down + margin * 2));
  canvas.width = width; canvas.height = height; // also clears the drawing settings
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = '#000'; use();
  ctx.fillText(words, Math.round((width - (box.left + box.right)) / 2) + box.left, margin + box.up);
  // Letters are drawn with soft edges; a lower threshold than for photos keeps thin strokes from fattening.
  return { text: words, font, size, bold, image: packPixels(ctx.getImageData(0, 0, width, height).data, width, height, 150) };
}
