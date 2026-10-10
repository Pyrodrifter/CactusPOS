import { formatMoney, type Business, type DesignCode, type DesignMessage, type Order, type DocumentDesign, type TextStyle } from '@cactus/shared';
import type { Align, Block, Look } from './blocks.js';

export type ReceiptLang = 'en' | 'nl';

const T = {
  en: {
    receipt: 'Receipt', ticket: 'Ticket', total: 'TOTAL', inclAbb: 'Prices include ABB', abbOver: 'over', cash: 'Cash', card: 'Card',
    change: 'Change', tip: 'Tip', void: '*** VOID ***', unpaid: '*** NOT PAID ***', copy: 'COPY', exempt: 'Exempt', outside: 'Outside scope of ABB',
    note: 'Note', order: 'ORDER', tab: 'Tab', password: 'Password', replaces: 'Replaces receipt', corrected: 'Corrected: see receipt', added: '+++ ADDED TO THIS ORDER +++', test: 'Printer test', testBody: 'If you can read this, the printer works.',
  },
  nl: {
    receipt: 'Bon', ticket: 'Volgnr', total: 'TOTAAL', inclAbb: 'Prijzen zijn inclusief ABB', abbOver: 'over', cash: 'Contant', card: 'Pin',
    change: 'Wisselgeld', tip: 'Fooi', void: '*** GEANNULEERD ***', unpaid: '*** NIET BETAALD ***', copy: 'KOPIE', exempt: 'Vrijgesteld', outside: 'Buiten toepassing ABB',
    note: 'Opmerking', order: 'BESTELLING', tab: 'Rekening', password: 'Wachtwoord', replaces: 'Vervangt bon', corrected: 'Gecorrigeerd: zie bon', added: '+++ TOEGEVOEGD AAN DEZE BESTELLING +++', test: 'Printertest', testBody: 'Als u dit kunt lezen, werkt de printer.',
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
  design?: DocumentDesign;
}

/** A saved look, or how the line printed before looks could be chosen. */
const lookOf = (style: TextStyle | undefined, usual: Look): Look => (style ? { size: style.size, bold: style.bold, underline: style.underline, inverse: style.inverse } : usual);

/**
 * The business name: lettering when the design has it, otherwise printer text. The name has to be on the
 * paper, so lettering stands in for it only while it spells the name this order was sold under; if the
 * business has been renamed since, the lettering is not used and the name prints as text.
 */
function nameBlock(b: Business, design: DocumentDesign | undefined, usual: Look, align: Align): Block {
  const art = design?.nameArt;
  if (art && art.text.trim().toLowerCase() === b.name.trim().toLowerCase()) return { t: 'raster', image: art.image, align, alt: b.name };
  return { t: 'text', text: b.name, align, ...lookOf(design?.nameStyle, usual) };
}

/** Printer dots per square of a QR code, for the three sizes the editor offers. */
const CODE_DOTS = { s: 4, m: 6, l: 8 } as const;

/** The blocks of one QR code from the design: the code with its caption, and for WiFi the details in words. Empty when nothing was filled in. */
function codeBlocks(code: DesignCode, lang: ReceiptLang): Block[] {
  if (code.kind === 'link') return code.value.trim() ? [{ t: 'qr', data: code.value.trim(), caption: code.caption.trim() || undefined, scale: CODE_DOTS[code.size] }] : [];
  if (!code.ssid.trim()) return [];
  const open = code.security === 'nopass' || !code.password;
  const out: Block[] = [{ t: 'qr', data: wifiQr(code.ssid, open ? '' : code.password, open ? 'nopass' : code.security), caption: code.caption.trim() || undefined, scale: CODE_DOTS[code.size] }];
  if (code.showPassword) {
    out.push({ t: 'text', text: `WiFi: ${code.ssid}`, align: 'center', bold: true });
    if (!open) out.push({ t: 'text', text: `${T[lang].password}: ${code.password}`, align: 'center' });
  }
  return out;
}

const expand = (text: string, o: Order, b: Business) => text.replace(/\{\{(business|order|receipt)\}\}/g, (_, key: string) => key === 'business' ? b.name : String(key === 'order' ? o.ticketNumber : o.receiptNumber ?? '-'));
function decorate(blocks: Block[], o: Order, b: Business, design: DocumentDesign | undefined, kitchen = false): Block[] {
  if (!design) return blocks;
  const out = blocks.map((block): Block => block.t === 'rule' ? { ...block, style: design.separator } : block);
  const start = out[0]?.t === 'drawer' ? 1 : 0;
  const header: Block[] = [];
  if (design.logo) header.push({ t: 'raster', image: design.logo, align: design.align });
  if (design.title) header.push({ t: 'text', text: expand(design.title, o, b), align: design.align, ...lookOf(design.titleStyle, { bold: true }) });
  if (kitchen) header.push(nameBlock(b, design, { bold: true }, design.align));
  out.splice(start, 0, ...header);
  let firstRule = out.findIndex((block) => block.t === 'rule');
  if (!kitchen) {
    // Contact details occupy the header; mandatory business/CRIB/address lines remain present.
    for (let i = start; i < firstRule; i++) {
      const block = out[i]!;
      if (block.t === 'text' || block.t === 'raster') out[i] = { ...block, align: design.align };
    }
    out.splice(firstRule, 0, { t: 'text', text: `${b.locale === 'nl' ? 'BESTELLING' : 'ORDER'} #${o.ticketNumber}`, align: design.align, bold: true, size: design.numberSize });
    firstRule++;
  } else {
    const index = out.findIndex((block) => block.t === 'row');
    if (index >= 0 && out[index]!.t === 'row') out[index] = { ...out[index] as Extract<Block, { t: 'row' }>, size: design.numberSize };
  }
  // A message is printer text in its own look, or lettering (a picture of the words).
  const message = (m: DesignMessage): Block => (m.art
    ? { t: 'raster', image: m.art.image, align: m.align, alt: m.art.text }
    : { t: 'text', text: expand(m.text, o, b), align: m.align, bold: m.bold, size: m.size, underline: m.underline, inverse: m.inverse });
  // The words decide whether a line is there at all; lettering is how they are drawn.
  const filled = design.messages.filter((m) => m.text.trim());
  const above: Block[] = filled.filter((m) => m.position === 'top').map(message);
  if (design.subtitle) above.unshift({ t: 'text', text: expand(design.subtitle, o, b), align: design.align, ...lookOf(design.subtitleStyle, {}) });
  const lang: ReceiptLang = b.locale ?? 'en';
  above.push(...design.codes.filter((code) => code.position === 'top').flatMap((code) => codeBlocks(code, lang)));
  out.splice(firstRule, 0, ...above);
  const footer: Block[] = filled.filter((m) => m.position !== 'top').map(message);
  if (kitchen && design.footer) footer.push({ t: 'text', text: expand(design.footer, o, b), align: design.align, ...lookOf(design.footerStyle, {}) });
  footer.push(...design.codes.filter((code) => code.position !== 'top').flatMap((code) => codeBlocks(code, lang)));
  if (design.closing) footer.push({ t: 'raster', image: design.closing, align: 'center' });
  out.splice(out.findIndex((block) => block.t === 'feed'), 0, ...footer);
  return out;
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
  out.push(nameBlock(b, opts.design, { bold: true, size: 'large' }, 'center'));
  if (b.address) out.push({ t: 'text', text: b.address, align: 'center' });
  if (b.phone && opts.design?.showPhone !== false) out.push({ t: 'text', text: b.phone, align: 'center' });
  if (b.crib) out.push({ t: 'text', text: `CRIB ${b.crib}`, align: 'center' });
  out.push({ t: 'rule' });
  out.push({ t: 'row', left: `${t.receipt} #${o.receiptNumber ?? '-'}`, right: `${t.ticket} ${o.ticketNumber}` });
  out.push({ t: 'text', text: when });
  if (o.tabName) out.push({ t: 'text', text: `${t.tab}: ${o.tabName}` });
  if (o.corrects) out.push({ t: 'text', text: `${t.replaces} #${o.corrects.receiptNumber}` });
  if (opts.copy) out.push({ t: 'text', text: t.copy, align: 'center', bold: true });
  if (o.status === 'void') {
    out.push({ t: 'text', text: t.void, align: 'center', bold: true });
    if (o.correctedBy) out.push({ t: 'text', text: `${t.corrected} #${o.correctedBy.receiptNumber}`, align: 'center' });
  }
  else if (!o.paid) out.push({ t: 'text', text: t.unpaid, align: 'center', bold: true });
  out.push({ t: 'rule' });
  for (const l of o.lines) {
    out.push({ t: 'row', left: `${l.qty} x ${l.name}`, right: m(l.lineTotalCents), size: opts.design?.itemSize });
    if (opts.design?.showModifiers !== false) for (const x of l.modifiers) out.push({ t: 'sub', text: `+ ${x.name}` });
    if (l.note && opts.design?.showNotes !== false) out.push({ t: 'sub', text: `"${l.note}"` });
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
  if (opts.design?.showNotes && o.note) out.push({ t: 'text', text: `${t.note}: ${o.note}` });
  const footer = opts.design?.footer || b.receiptFooter;
  if (footer) out.push({ t: 'text', text: expand(footer, o, b), align: opts.design?.align ?? 'center', ...lookOf(opts.design?.footerStyle, {}) });
  out.push({ t: 'feed', lines: 3 }, { t: 'cut' });
  return decorate(out, o, b, opts.design);
}

/** Kitchen ticket: big, no prices. Optionally only the lines for one station. */
export function buildKitchenTicket(o: Order, b: Business, opts: { lang?: ReceiptLang; station?: string; fromRound?: number; design?: DocumentDesign } = {}): Block[] {
  const t = T[opts.lang ?? b.locale ?? 'en'];
  const time = new Intl.DateTimeFormat('en-GB', { timeZone: b.timezone, hour: '2-digit', minute: '2-digit' }).format(new Date(o.createdAt));
  const from = opts.fromRound ?? 1;
  const lines = o.lines.filter((l) => (l.round ?? 1) >= from && (!opts.station || l.station === opts.station));
  const out: Block[] = [
    { t: 'row', left: `${t.order} #${o.ticketNumber}`, right: time, bold: true, size: 'large' },
  ];
  if (o.tabName) out.push({ t: 'text', text: o.tabName, bold: true, size: 'large' });
  if (from > 1) out.push({ t: 'text', text: t.added, bold: true });
  out.push({ t: 'rule' });
  for (const l of lines) {
    out.push({ t: 'text', text: `${l.qty} x ${l.name}`, bold: true, size: opts.design?.itemSize ?? 'large' });
    for (const x of l.modifiers) out.push({ t: 'sub', text: `+ ${x.name}` });
    if (l.note) out.push({ t: 'sub', text: `"${l.note}"` });
  }
  if (o.note) out.push({ t: 'rule' }, { t: 'text', text: `${t.note}: ${o.note}`, bold: true });
  out.push({ t: 'feed', lines: 3 }, { t: 'cut' });
  return decorate(out, o, b, opts.design, true);
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
