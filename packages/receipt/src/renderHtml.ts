import type { Block } from './blocks.js';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

function logo(image: import('@cactus/shared').ReceiptLogo): string {
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
  return `<svg role="img" aria-label="Logo" viewBox="0 0 ${image.width} ${image.height}" style="width:${image.width / 8}mm;max-width:100%;height:auto" xmlns="http://www.w3.org/2000/svg"><path d="${paths.join('')}" fill="black"/></svg>`;
}

/** Body markup only: used for on-screen previews. */
export function renderHtmlFragment(blocks: readonly Block[]): string {
  return blocks.map((b) => {
    switch (b.t) {
      case 'text': return `<div class="t ${b.align ?? 'left'}${b.bold ? ' b' : ''}${b.size === 'large' ? ' lg' : ''}">${esc(b.text)}</div>`;
      case 'row': return `<div class="row${b.bold ? ' b' : ''}${b.size === 'large' ? ' lg' : ''}"><span>${esc(b.left)}</span><span>${esc(b.right)}</span></div>`;
      case 'sub': return `<div class="sub">${esc(b.text)}</div>`;
      case 'rule': return b.style === 'space' ? '<div style="height:.6em"></div>' : `<hr${b.style === 'solid' ? ' class="solid"' : ''}>`;
      case 'raster': return `<div class="t ${b.align ?? 'center'}">${logo(b.image)}</div>`;
      case 'feed': return `<div style="height:${b.lines * 0.6}em"></div>`;
      case 'qr': return `<div class="t center qr" data-qr="${esc(b.data)}">[QR]${b.caption ? `<br>${esc(b.caption)}` : ''}</div>`;
      default: return '';
    }
  }).join('\n');
}

/** A complete printable page (browser print fallback when no receipt printer is set up). */
export function renderHtml(blocks: readonly Block[], opts: { title?: string; widthMm?: 58 | 80 } = {}): string {
  const width = opts.widthMm === 58 ? 48 : 72;
  return `<!doctype html><meta charset="utf-8"><title>${esc(opts.title ?? 'Receipt')}</title>
<style>
@page{margin:4mm}
body{font:13px/1.35 ui-monospace,Menlo,Consolas,monospace;width:${width}mm;margin:8px auto;color:#000}
.center{text-align:center}.right{text-align:right}.b{font-weight:700}.lg{font-size:18px}
.t{white-space:pre-wrap;overflow-wrap:anywhere}.row{display:flex;justify-content:space-between;gap:8px}.row span:first-child{min-width:0;overflow-wrap:anywhere}.row span:last-child{white-space:nowrap}
.sub{padding-left:1.5em;color:#444;font-size:12px}hr{border:0;border-top:1px dashed #000;margin:4px 0}
hr.solid{border-top-style:solid}.lg{font-size:22px;line-height:1.2}.sub{overflow-wrap:anywhere}
@media print{body{margin:0}}
</style>
${renderHtmlFragment(blocks)}`;
}
