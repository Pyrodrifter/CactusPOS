import type { Block } from './blocks.js';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** Body markup only: used for on-screen previews. */
export function renderHtmlFragment(blocks: readonly Block[]): string {
  return blocks.map((b) => {
    switch (b.t) {
      case 'text': return `<div class="t ${b.align ?? 'left'}${b.bold ? ' b' : ''}${b.size === 'large' ? ' lg' : ''}">${esc(b.text)}</div>`;
      case 'row': return `<div class="row${b.bold ? ' b' : ''}${b.size === 'large' ? ' lg' : ''}"><span>${esc(b.left)}</span><span>${esc(b.right)}</span></div>`;
      case 'sub': return `<div class="sub">${esc(b.text)}</div>`;
      case 'rule': return '<hr>';
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
.row{display:flex;justify-content:space-between;gap:8px}.row span:last-child{white-space:nowrap}
.sub{padding-left:1.5em;color:#444;font-size:12px}hr{border:0;border-top:1px dashed #000;margin:4px 0}
@media print{body{margin:0}}
</style>
${renderHtmlFragment(blocks)}`;
}
