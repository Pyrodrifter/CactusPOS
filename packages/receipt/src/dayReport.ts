import { formatMoney, type Business, type DayReport, type ZReport } from '@cactus/shared';
import type { Block } from './blocks.js';
import type { ReceiptLang } from './build.js';

const T = {
  en: {
    x: 'X REPORT (not closed)', z: 'Z REPORT', day: 'Day', printed: 'Printed', closed: 'Closed', sales: 'SALES', gross: 'Total incl. ABB', net: 'Net',
    orders: 'Orders sold', receipts: 'Receipts', earlier: 'Refunds of earlier days', corrections: 'Corrected orders', tax: 'ABB', over: 'over', exempt: 'Exempt', outside: 'Outside scope', tenders: 'PAYMENTS', cash: 'Cash', card: 'Card',
    tips: 'Tips', refunds: 'REFUNDS (voided after payment)', unpaid: 'Unpaid open orders', voided: 'Voided before payment', drawer: 'CASH DRAWER',
    expected: 'Expected from sales', counted: 'Counted', diff: 'Over / short', items: 'ITEMS SOLD', none: 'No sales',
  },
  nl: {
    x: 'X-RAPPORT (niet afgesloten)', z: 'Z-RAPPORT', day: 'Dag', printed: 'Afgedrukt', closed: 'Afgesloten', sales: 'OMZET', gross: 'Totaal incl. ABB', net: 'Netto',
    orders: 'Verkochte bestellingen', receipts: 'Bonnen', earlier: 'Terugbetaald van eerdere dagen', corrections: 'Gecorrigeerde bestellingen', tax: 'ABB', over: 'over', exempt: 'Vrijgesteld', outside: 'Buiten toepassing', tenders: 'BETALINGEN', cash: 'Contant', card: 'Pin',
    tips: 'Fooien', refunds: 'TERUGBETAALD (geannuleerd na betaling)', unpaid: 'Open onbetaalde bestellingen', voided: 'Geannuleerd voor betaling', drawer: 'KASSALADE',
    expected: 'Verwacht uit verkoop', counted: 'Geteld', diff: 'Verschil', items: 'VERKOCHTE ITEMS', none: 'Geen verkoop',
  },
} as const;

const pct = (bps: number) => `${(bps / 100).toFixed(bps % 100 ? 2 : 0)}%`;

/** End-of-day report for the receipt printer. Pass a ZReport once the day is closed, a DayReport for a reading. */
export function buildDayReport(input: DayReport | ZReport, b: Business, lang: ReceiptLang = b.locale ?? 'en'): Block[] {
  const t = T[lang];
  const z = 'report' in input ? input : null;
  const r = z ? z.report : (input as DayReport);
  const m = (c: number) => formatMoney(c, 'en-US', b.currency);
  const when = (iso: string) => new Intl.DateTimeFormat('en-GB', { timeZone: b.timezone, dateStyle: 'short', timeStyle: 'short' }).format(new Date(iso));
  const out: Block[] = [
    { t: 'text', text: b.name, align: 'center', bold: true, size: 'large' },
    { t: 'text', text: z ? `${t.z} #${z.number}` : t.x, align: 'center', bold: true },
    { t: 'row', left: t.day, right: r.businessDate },
    { t: 'row', left: z ? t.closed : t.printed, right: when(z ? z.closedAt : r.generatedAt) },
    { t: 'rule' },
    { t: 'text', text: t.sales, bold: true },
    { t: 'row', left: t.gross, right: m(r.sales.grossCents), bold: true },
    { t: 'row', left: t.net, right: m(r.sales.netCents) },
  ];
  for (const x of r.tax) {
    if (x.kind === 'taxed') out.push({ t: 'row', left: `${t.tax} ${pct(x.bps)} ${t.over} ${m(x.netCents)}`, right: m(x.taxCents) });
    else out.push({ t: 'row', left: x.kind === 'exempt' ? t.exempt : t.outside, right: m(x.grossCents) });
  }
  // Already inside the totals above; shown so a total lower than the day's own sales explains itself.
  if (r.refundedEarlier) out.push({ t: 'row', left: `${t.earlier} (${r.refundedEarlier.count})`, right: `-${m(r.refundedEarlier.grossCents)}` });
  // What the corrections changed in all: the corrected sales less the originals they replaced.
  if (r.corrections) out.push({ t: 'row', left: `${t.corrections} (${r.corrections.count})`, right: `${r.corrections.addedCents >= r.corrections.removedCents ? '+' : ''}${m(r.corrections.addedCents - r.corrections.removedCents)}` });
  out.push({ t: 'row', left: t.orders, right: String(r.orders.sold) });
  if (r.receipts.first !== null) out.push({ t: 'row', left: t.receipts, right: `#${r.receipts.first} - #${r.receipts.last}` });
  out.push({ t: 'rule' }, { t: 'text', text: t.tenders, bold: true });
  for (const x of r.tenders) out.push({ t: 'row', left: `${x.method === 'cash' ? t.cash : t.card} (${x.count})`, right: m(x.amountCents) });
  if (r.tipsCents) out.push({ t: 'row', left: t.tips, right: m(r.tipsCents) });
  if (r.refunds.length) {
    out.push({ t: 'rule' }, { t: 'text', text: t.refunds, bold: true });
    for (const x of r.refunds) out.push({ t: 'row', left: `${x.method === 'cash' ? t.cash : t.card} (${x.count})`, right: `-${m(x.amountCents)}` });
  }
  if (r.orders.unpaid) out.push({ t: 'row', left: `${t.unpaid} (${r.orders.unpaid})`, right: m(r.orders.unpaidCents) });
  if (r.orders.voidedUnpaid) out.push({ t: 'row', left: t.voided, right: String(r.orders.voidedUnpaid) });
  out.push({ t: 'rule' }, { t: 'text', text: t.drawer, bold: true }, { t: 'row', left: t.expected, right: m(r.cashExpectedCents) });
  if (z && z.countedCashCents !== null && z.cashDifferenceCents !== null) {
    out.push({ t: 'row', left: t.counted, right: m(z.countedCashCents) });
    out.push({ t: 'row', left: t.diff, right: `${z.cashDifferenceCents > 0 ? '+' : ''}${m(z.cashDifferenceCents)}`, bold: true });
  }
  out.push({ t: 'rule' }, { t: 'text', text: t.items, bold: true });
  if (!r.items.length) out.push({ t: 'text', text: t.none });
  for (const i of r.items) out.push({ t: 'row', left: `${i.qty} x ${i.name}`, right: m(i.grossCents) });
  if (z?.note) out.push({ t: 'rule' }, { t: 'text', text: z.note });
  out.push({ t: 'feed', lines: 3 }, { t: 'cut' });
  return out;
}
