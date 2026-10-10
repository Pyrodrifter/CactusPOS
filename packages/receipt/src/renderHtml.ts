import type { ReceiptLogo } from '@cactus/shared';
import type { Block, Look } from './blocks.js';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

function picture(image: ReceiptLogo, alt = 'Logo'): string {
  const bytes = image.hex.match(/../g)!.map((h) => parseInt(h, 16));
  const paths: string[] = [];
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      if ((bytes[y * image.width / 8 + Math.floor(x / 8)]! & (128 >> (x % 8))) === 0) continue;
      const from = x;
      while (x + 1 < image.width && (bytes[y * image.width / 8 + Math.floor((x + 1) / 8)]! & (128 >> ((x + 1) % 8))) !== 0) x++;
      paths.push(`M${from} ${y}h${x - from + 1}v1H${from}z`);
    }
  }
  return `<svg role="img" aria-label="${esc(alt)}" viewBox="0 0 ${image.width} ${image.height}" style="width:${image.width / 8}mm;max-width:100%;height:auto" xmlns="http://www.w3.org/2000/svg"><path d="${paths.join('')}" fill="black"/></svg>`;
}

/** Class names for a printer text look. `large` keeps its old name so pages printed before still match. */
function look(b: Look): string {
  const size = b.size && b.size !== 'normal' ? ` ${b.size === 'large' ? 'lg' : b.size === 'small' ? 'sm' : b.size}` : '';
  return `${b.bold ? ' b' : ''}${size}${b.underline ? ' u' : ''}`;
}

/** Body markup only: used for on-screen previews. */
export function renderHtmlFragment(blocks: readonly Block[]): string {
  return blocks.map((b) => {
    switch (b.t) {
      // Inverse is a black band behind the letters only, as the printer does it: hence the inner span.
      case 'text': return `<div class="t ${b.align ?? 'left'}${look(b)}">${b.inverse ? `<span class="inv">${esc(b.text)}</span>` : esc(b.text)}</div>`;
      case 'row': return `<div class="row${look(b)}"><span>${esc(b.left)}</span><span>${esc(b.right)}</span></div>`;
      case 'sub': return `<div class="sub">${esc(b.text)}</div>`;
      case 'rule':
        if (b.style === 'space') return '<div style="height:.6em"></div>';
        if (b.style === 'stars' || b.style === 'wave') return `<div class="deco" aria-hidden="true">${(b.style === 'stars' ? '* ' : '~').repeat(80)}</div>`;
        return `<hr${b.style && b.style !== 'dashed' ? ` class="${b.style}"` : ''}>`;
      case 'raster': return `<div class="t ${b.align ?? 'center'}">${picture(b.image, b.alt)}</div>`;
      case 'feed': return `<div style="height:${b.lines * 0.6}em"></div>`;
      case 'qr': return `<div class="t center qr" data-qr="${esc(b.data)}">[QR]${b.caption ? `<br>${esc(b.caption)}` : ''}</div>`;
      default: return '';
    }
  }).join('\n');
}

/**
 * A complete printable page (browser print fallback when no receipt printer is set up, and the editor's preview).
 *
 * The page is a character grid like the printer's: exactly as many characters wide as the paper holds (48 on
 * 80 mm, 32 on 58 mm), in a letter size at which that is the real paper width or just under, so a line wraps
 * on screen where it wraps on paper. The sizes are the printer's own multiples. Tall and wide are the normal
 * letter stretched one way, which CSS does by laying the line out at double or half width and scaling it back.
 */
export function renderHtml(blocks: readonly Block[], opts: { title?: string; widthMm?: 58 | 80 } = {}): string {
  const columns = opts.widthMm === 58 ? 32 : 48;
  return `<!doctype html><meta charset="utf-8"><title>${esc(opts.title ?? 'Receipt')}</title>
<style>
@page{margin:4mm}
body{font:9.4px/1.4 ui-monospace,Menlo,Consolas,monospace;width:${columns}ch;margin:8px auto;color:#000;overflow-x:hidden}
.center{text-align:center}.right{text-align:right}.b{font-weight:700}
.t{white-space:pre-wrap;overflow-wrap:anywhere}.row{display:flex;justify-content:space-between;gap:1ch}.row span:first-child{min-width:0;overflow-wrap:anywhere}.row span:last-child{white-space:nowrap}
.sub{padding-left:3ch;color:#444;overflow-wrap:anywhere}hr{border:0;border-top:1px dashed #000;margin:.5em 0}
hr.solid{border-top-style:solid}hr.double{border-top:3px double #000}hr.dotted{border-top:2px dotted #000}
.deco{white-space:nowrap;overflow:hidden}
.sm{font-size:.75em}.lg{font-size:2em;line-height:1.2}.huge{font-size:3em;line-height:1.15}
.tall{font-size:2em;line-height:1.2;width:200%;transform:scaleX(.5);transform-origin:0 0}
.wide{width:50%;transform:scaleX(2);transform-origin:0 0}
.u{text-decoration:underline}.inv{background:#000;color:#fff;padding:0 .35em;-webkit-print-color-adjust:exact;print-color-adjust:exact;-webkit-box-decoration-break:clone;box-decoration-break:clone}
@media print{body{margin:0}}
</style>
${renderHtmlFragment(blocks)}`;
}
