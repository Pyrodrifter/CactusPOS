import { formatMoney, type Order } from '@cactus/shared';
import type { Business } from './service.js';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** Default receipt (v0). Replaced by the template engine in packages/receipt (T13/T30). */
export function renderReceiptHtml(o: Order, b: Business): string {
  const m = (c: number) => formatMoney(c, 'en-US', b.currency);
  const when = new Intl.DateTimeFormat('en-GB', { timeZone: b.timezone, dateStyle: 'short', timeStyle: 'short' }).format(new Date(o.createdAt));
  const lines = o.lines.map((l) =>
    `<tr><td>${l.qty}× ${esc(l.name)}${l.modifiers.map((x) => `<div class="mod">+ ${esc(x.name)}</div>`).join('')}</td><td class="r">${m(l.lineTotalCents)}</td></tr>`).join('');
  const tax = o.breakdown.filter((r) => r.kind === 'taxed').map((r) =>
    `<tr><td>${esc(r.name)} over ${m(r.netCents)}</td><td class="r">${m(r.taxCents)}</td></tr>`).join('');
  const pay = o.payments.map((p) => `<tr><td>${p.method === 'cash' ? 'Cash' : 'Card'}</td><td class="r">${m(p.amountCents)}</td></tr>` +
    (p.changeCents ? `<tr><td>Change</td><td class="r">${m(p.changeCents)}</td></tr>` : '')).join('');
  return `<!doctype html><meta charset="utf-8"><title>Receipt ${o.receiptNumber ?? ''}</title>
<style>body{font:13px/1.4 ui-monospace,monospace;width:300px;margin:8px auto}h1{font-size:16px;text-align:center;margin:0}
.c{text-align:center}.r{text-align:right}table{width:100%;border-collapse:collapse}.mod{color:#555;font-size:11px}hr{border:0;border-top:1px dashed #000}
@media print{body{margin:0}}</style>
<h1>${esc(b.name)}</h1><div class="c">${esc(b.address)}${b.crib ? `<br>CRIB ${esc(b.crib)}` : ''}${b.phone ? `<br>${esc(b.phone)}` : ''}</div><hr>
<div>Receipt #${o.receiptNumber ?? '—'} · Ticket ${o.ticketNumber}<br>${when}${o.status === 'void' ? '<br><b>VOID</b>' : ''}</div><hr>
<table>${lines}</table><hr>
<table><tr><td><b>Total (incl. ABB)</b></td><td class="r"><b>${m(o.totalCents)}</b></td></tr>${tax}${pay}</table><hr>
<div class="c">${esc(b.receiptFooter)}</div>`;
}
