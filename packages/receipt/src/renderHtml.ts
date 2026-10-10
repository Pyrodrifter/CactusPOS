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
 * A complete printable page (browser print fallback when no receipt printer is set up).
 * The sizes mirror the printer's: tall and wide are the normal letter stretched one way, which CSS does by
 * laying the line out at double or half width and scaling it back, so it wraps where the printer wraps.
 */
export function renderHtml(blocks: readonly Block[], opts: { title?: string; widthMm?: 58 | 80 } = {}): string {
  const width = opts.widthMm === 58 ? 48 : 72;
  return `<!doctype html><meta charset="utf-8"><title>${esc(opts.title ?? 'Receipt')}</title>
<style>
@page{margin:4mm}
body{font:13px/1.35 ui-monospace,Menlo,Consolas,monospace;width:${width}mm;margin:8px auto;color:#000;overflow-x:hidden}
.center{text-align:center}.right{text-align:right}.b{font-weight:700}.lg{font-size:18px}
.t{white-space:pre-wrap;overflow-wrap:anywhere}.row{display:flex;justify-content:space-between;gap:8px}.row span:first-child{min-width:0;overflow-wrap:anywhere}.row span:last-child{white-space:nowrap}
.sub{padding-left:1.5em;color:#444;font-size:12px}hr{border:0;border-top:1px dashed #000;margin:4px 0}
hr.solid{border-top-style:solid}.lg{font-size:22px;line-height:1.2}.sub{overflow-wrap:anywhere}
hr.double{border-top:3px double #000}hr.dotted{border-top:2px dotted #000}
.deco{white-space:nowrap;overflow:hidden;line-height:1.2;margin:2px 0}
.sm{font-size:10px}.huge{font-size:36px;line-height:1.1}
.tall{font-size:26px;line-height:1.15;width:200%;transform:scaleX(.5);transform-origin:0 0}
.wide{width:50%;transform:scaleX(2);transform-origin:0 0}
.u{text-decoration:underline}.inv{background:#000;color:#fff;padding:0 .35em;-webkit-print-color-adjust:exact;print-color-adjust:exact;-webkit-box-decoration-break:clone;box-decoration-break:clone}
@media print{body{margin:0}}
</style>
${renderHtmlFragment(blocks)}`;
}
