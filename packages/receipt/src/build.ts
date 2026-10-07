import { formatMoney, type Business, type Order } from '@cactus/shared';
import type { Block } from './blocks.js';

export type ReceiptLang = 'en' | 'nl';

const T = {
  en: {
    receipt: 'Receipt', ticket: 'Ticket', total: 'TOTAL', inclAbb: 'Prices include ABB', abbOver: 'over', cash: 'Cash', card: 'Card',
    change: 'Change', tip: 'Tip', void: '*** VOID ***', unpaid: '*** NOT PAID ***', copy: 'COPY', exempt: 'Exempt', outside: 'Outside scope of ABB',
    note: 'Note', order: 'ORDER', test: 'Printer test', testBody: 'If you can read this, the printer works.',
  },
  nl: {
    receipt: 'Bon', ticket: 'Volgnr', total: 'TOTAAL', inclAbb: 'Prijzen zijn inclusief ABB', abbOver: 'over', cash: 'Contant', card: 'Pin',
    change: 'Wisselgeld', tip: 'Fooi', void: '*** GEANNULEERD ***', unpaid: '*** NIET BETAALD ***', copy: 'KOPIE', exempt: 'Vrijgesteld', outside: 'Buiten toepassing ABB',
    note: 'Opmerking', order: 'BESTELLING', test: 'Printertest', testBody: 'Als u dit kunt lezen, werkt de printer.',
  },
} as const;

const pct = (bps: number) => `${(bps / 100).toFixed(bps % 100 ? 2 : 0)}%`;

export interface ReceiptOptions {
  lang?: ReceiptLang;
  /** Marks a reprint so two papers for one sale cannot both pass as the original. */
  copy?: boolean;
  /** Extra blocks before the footer (WiFi QR, promo): filled by the receipt editor later. */
  extra?: Block[];
  openDrawer?: boolean;
}

/**
 * Customer receipt. Carries what a simplified Bonaire invoice needs: business name, address and
 * CRIB number, sequential number, date, what was sold, the consideration and the ABB per rate.
 */
export function buildReceipt(o: Order, b: Business, opts: ReceiptOptions = {}): Block[] {
  const lang = opts.lang ?? b.locale ?? 'en';
  const t = T[lang];
  const m = (c: number) => formatMoney(c, 'en-US', b.currency);
  const when = new Intl.DateTimeFormat('en-GB', { timeZone: b.timezone, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    .format(new Date(o.payments[0]?.at ?? o.createdAt));
  const out: Block[] = [];
  if (opts.openDrawer) out.push({ t: 'drawer' });
  out.push({ t: 'text', text: b.name, align: 'center', bold: true, size: 'large' });
  if (b.address) out.push({ t: 'text', text: b.address, align: 'center' });
  if (b.phone) out.push({ t: 'text', text: b.phone, align: 'center' });
  if (b.crib) out.push({ t: 'text', text: `CRIB ${b.crib}`, align: 'center' });
  out.push({ t: 'rule' });
  out.push({ t: 'row', left: `${t.receipt} #${o.receiptNumber ?? '-'}`, right: `${t.ticket} ${o.ticketNumber}` });
  out.push({ t: 'text', text: when });
  if (opts.copy) out.push({ t: 'text', text: t.copy, align: 'center', bold: true });
  if (o.status === 'void') out.push({ t: 'text', text: t.void, align: 'center', bold: true });
  else if (!o.paid) out.push({ t: 'text', text: t.unpaid, align: 'center', bold: true });
  out.push({ t: 'rule' });
  for (const l of o.lines) {
    out.push({ t: 'row', left: `${l.qty} x ${l.name}`, right: m(l.lineTotalCents) });
    for (const x of l.modifiers) out.push({ t: 'sub', text: `+ ${x.name}` });
    if (l.note) out.push({ t: 'sub', text: `"${l.note}"` });
  }
  out.push({ t: 'rule' });
  out.push({ t: 'row', left: t.total, right: m(o.totalCents), bold: true, size: 'large' });
  out.push({ t: 'text', text: t.inclAbb });
  for (const r of o.breakdown) {
    if (r.kind === 'taxed') out.push({ t: 'row', left: `ABB ${pct(r.bps)} ${t.abbOver} ${m(r.netCents)}`, right: m(r.taxCents) });
    else out.push({ t: 'row', left: r.kind === 'exempt' ? t.exempt : t.outside, right: m(r.grossCents) });
  }
  if (o.payments.length) out.push({ t: 'rule' });
  for (const p of o.payments) {
    if (p.method === 'cash') {
      out.push({ t: 'row', left: t.cash, right: m(p.tenderedCents ?? p.amountCents) });
      if (p.changeCents) out.push({ t: 'row', left: t.change, right: m(p.changeCents) });
    } else {
      out.push({ t: 'row', left: p.reference ? `${t.card} ${p.reference}` : t.card, right: m(p.amountCents) });
    }
    if (p.tipCents) out.push({ t: 'row', left: t.tip, right: m(p.tipCents) });
  }
  out.push({ t: 'rule' });
  if (opts.extra?.length) out.push(...opts.extra, { t: 'rule' });
  if (b.receiptFooter) out.push({ t: 'text', text: b.receiptFooter, align: 'center' });
  out.push({ t: 'feed', lines: 3 }, { t: 'cut' });
  return out;
}

/** Kitchen ticket: big, no prices. Optionally only the lines for one station. */
export function buildKitchenTicket(o: Order, b: Business, opts: { lang?: ReceiptLang; station?: string } = {}): Block[] {
  const t = T[opts.lang ?? b.locale ?? 'en'];
  const time = new Intl.DateTimeFormat('en-GB', { timeZone: b.timezone, hour: '2-digit', minute: '2-digit' }).format(new Date(o.createdAt));
  const lines = opts.station ? o.lines.filter((l) => l.station === opts.station) : o.lines;
  const out: Block[] = [
    { t: 'row', left: `${t.order} #${o.ticketNumber}`, right: time, bold: true, size: 'large' },
    { t: 'rule' },
  ];
  for (const l of lines) {
    out.push({ t: 'text', text: `${l.qty} x ${l.name}`, bold: true, size: 'large' });
    for (const x of l.modifiers) out.push({ t: 'sub', text: `+ ${x.name}` });
    if (l.note) out.push({ t: 'sub', text: `"${l.note}"` });
  }
  if (o.note) out.push({ t: 'rule' }, { t: 'text', text: `${t.note}: ${o.note}`, bold: true });
  out.push({ t: 'feed', lines: 3 }, { t: 'cut' });
  return out;
}

export function buildTestPage(b: Business, lang: ReceiptLang = b.locale ?? 'en'): Block[] {
  const t = T[lang];
  return [
    { t: 'text', text: b.name, align: 'center', bold: true, size: 'large' },
    { t: 'text', text: t.test, align: 'center' },
    { t: 'rule' },
    { t: 'text', text: t.testBody },
    { t: 'row', left: 'Jalapeños é ü ñ €', right: '$19.75' },
    { t: 'row', left: 'left', right: 'right', bold: true },
    { t: 'qr', data: 'https://www.belastingdienst-cn.nl', caption: 'QR' },
    { t: 'feed', lines: 3 },
    { t: 'cut' },
  ];
}

/** WiFi QR payload understood by phone cameras. */
export function wifiQr(ssid: string, password: string, security: 'WPA' | 'WEP' | 'nopass' = 'WPA'): string {
  const e = (s: string) => s.replace(/([\\;,:"])/g, '\\$1');
  return `WIFI:T:${security};S:${e(ssid)};P:${e(password)};;`;
}
