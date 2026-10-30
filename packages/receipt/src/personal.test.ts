import { describe, expect, it } from 'vitest';
import { DEFAULT_RECEIPT_TEMPLATE, DocumentDesign, Lettering, ReceiptTemplate, type Business, type Order } from '@cactus/shared';
import { buildKitchenTicket, buildReceipt, columnsFor, fitRaster, layout, renderEscPos, renderHtml, renderText, ruleLine } from './index.js';

/** Personal receipts (UX12): printer text looks, lettering as pictures, messages above the items, dividers. */
const biz: Business = {
  name: 'Cactus Blue', crib: '123456789', address: 'Donkey Beach, Bonaire', phone: '', timezone: 'America/Kralendijk',
  currency: 'USD', locale: 'en', receiptFooter: 'Thank you!',
};
const order: Order = {
  id: 'o1', ticketNumber: 7, receiptNumber: 42, status: 'sent', paid: true, source: 'pos',
  lines: [{ id: 'l1', itemId: 'burger', name: 'Kiteburger', qty: 1, unitPriceCents: 1600, lineTotalCents: 1600, taxCents: 91, taxCategoryId: 'service_6', station: 'kitchen', modifiers: [] }],
  payments: [{ id: 'p1', method: 'card', amountCents: 1600, tipCents: 0, at: '2026-10-07T16:05:00.000Z' }],
  totalCents: 1600, taxCents: 91,
  breakdown: [{ taxCategoryId: 'service_6', name: 'ABB 6%', kind: 'taxed', bps: 600, grossCents: 1600, taxCents: 91, netCents: 1509 }],
  createdAt: '2026-10-07T16:00:00.000Z', updatedAt: '2026-10-07T16:05:00.000Z', createdBy: 'staff1',
};
const design = (extra: Record<string, unknown> = {}) => DocumentDesign.parse(extra);
/** A 16 x 2 picture: top row solid, bottom row every other dot. */
const art = (text: string) => Lettering.parse({ text, font: 'Segoe Script', size: 'l', bold: false, image: { width: 16, height: 2, hex: 'ffffaaaa' } });
const has = (bytes: Uint8Array, seq: number[]) => bytes.some((_, i) => seq.every((b, j) => bytes[i + j] === b));
const before = (bytes: Uint8Array, seq: number[], text: string) => {
  const at = Buffer.from(bytes).indexOf(Buffer.from(text, 'latin1'));
  const cmd = Buffer.from(bytes).lastIndexOf(Buffer.from(seq), at);
  return at >= 0 && cmd >= 0;
};

describe('receipt visibility controls', () => {
  const logo = { width: 8, height: 1, hex: 'aa' };
  it('prints an uploaded logo without a duplicate business name or name lettering', () => {
    const d = design({ logo, nameArt: art(biz.name), showBusinessName: false });
    const blocks = buildReceipt(order, biz, { design: d });
    expect(blocks.some((b) => b.t === 'raster' && b.image === d.logo)).toBe(true);
    expect(blocks.some((b) => b.t === 'raster' && b.alt === biz.name)).toBe(false);
    expect(renderText(blocks)).not.toContain(biz.name);
    expect(has(renderEscPos(blocks), [0x1d, 0x76, 0x30, 0, 1, 0, 1, 0, 0xaa])).toBe(true);
    expect(renderHtml(blocks)).not.toContain(`>${biz.name}</div>`);
    expect(renderText(buildReceipt(order, biz, { design: { ...d, showLogo: false, showBusinessName: true } }))).toContain(biz.name);
  });
  it('hides header lines independently without deleting saved words or images', () => {
    const d = design({ logo, title: 'TOP SENTINEL', subtitle: 'SUB SENTINEL', showLogo: false, showBusinessName: false, showAddress: false, showPhone: false, showTitle: false, showSubtitle: false });
    const text = renderText(buildReceipt(order, biz, { design: d }));
    for (const value of [biz.name, biz.address, biz.phone, 'TOP SENTINEL', 'SUB SENTINEL']) if (value) expect(text).not.toContain(value);
    expect(text).toContain(`CRIB ${biz.crib}`);
    expect(d.logo).toEqual(logo); expect(d.title).toBe('TOP SENTINEL');
  });
  it('hides duplicate order numbers, time and tab labels while preserving receipt identity and status', () => {
    const sample = { ...order, tabName: 'TAB SENTINEL', status: 'void' as const };
    const text = renderText(buildReceipt(sample, biz, { copy: true, design: design({ showOrderNumber: false, showDateTime: false, showTabName: false }) }));
    expect(text).toContain(`Receipt #${order.receiptNumber}`); expect(text).toContain('COPY'); expect(text).toContain('VOID');
    expect(text).not.toContain(`Ticket ${order.ticketNumber}`); expect(text).not.toContain(`ORDER #${order.ticketNumber}`); expect(text).not.toContain('TAB SENTINEL');
    const date = new Intl.DateTimeFormat('en-GB', { timeZone: biz.timezone, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(order.payments[0]!.at));
    expect(text).not.toContain(date);
  });
  it('hides the payment section or only the card reference without changing totals', () => {
    const sample = { ...order, payments: [{ ...order.payments[0]!, method: 'card' as const, reference: 'REFERENCE_SENTINEL', tipCents: 123 }] };
    const without = buildReceipt(sample, biz, { design: design({ showPaymentDetails: false }) });
    expect(without.some((b) => b.t === 'row' && /^(Cash|Card|Change|Tip)/.test(b.left))).toBe(false);
    expect(without.some((b) => b.t === 'row' && b.left === 'TOTAL')).toBe(true);
    const card = renderText(buildReceipt(sample, biz, { design: design({ showPaymentReference: false }) }));
    expect(card).toContain('Card'); expect(card).not.toContain('REFERENCE_SENTINEL'); expect(card).toContain('Tip');
  });
  it('leaves the ABB and exempt lines off when showTax is off, keeping the total', () => {
    const exempt = { ...order, breakdown: [...order.breakdown, { taxCategoryId: 'exempt', name: 'Exempt', kind: 'exempt' as const, bps: 0, grossCents: 500, taxCents: 0, netCents: 500 }] };
    const on = renderText(buildReceipt(exempt, biz, { design: design({}) }));
    expect(on).toMatch(/ABB/); expect(on).toContain('Exempt');
    const blocks = buildReceipt(exempt, biz, { design: design({ showTax: false }) });
    const off = renderText(blocks);
    expect(off).not.toMatch(/ABB/); expect(off).not.toContain('Exempt');
    expect(blocks.some((b) => b.t === 'row' && b.left === 'TOTAL')).toBe(true);
  });
  it('disables individual messages/QR codes or all extras without discarding their configuration', () => {
    const d = design({ messages: [{ text: 'OFF SENTINEL', bold: false, align: 'left', enabled: false }, { text: 'ON SENTINEL', bold: false, align: 'left' }],
      codes: [{ kind: 'link', value: 'https://disabled.example', enabled: false }, { kind: 'link', value: 'https://enabled.example' }] });
    const blocks = buildReceipt(order, biz, { design: d });
    expect(renderText(blocks)).not.toContain('OFF SENTINEL'); expect(renderText(blocks)).toContain('ON SENTINEL');
    expect(blocks.filter((b) => b.t === 'qr').map((b) => b.data)).toEqual(['https://enabled.example']);
    const allOff = buildReceipt(order, biz, { design: { ...d, showMessages: false, showCodes: false } });
    expect(renderText(allOff)).not.toContain('ON SENTINEL'); expect(allOff.some((b) => b.t === 'qr')).toBe(false);
    expect(d.messages).toHaveLength(2); expect(d.codes).toHaveLength(2);
  });
  it('suppresses both an explicit/footer fallback and a closing image independently', () => {
    const d = design({ closing: logo, showFooter: false, showClosingImage: false });
    const sampleBiz = { ...biz, receiptFooter: 'BUSINESS FOOTER SENTINEL' };
    expect(renderText(buildReceipt(order, sampleBiz, { design: d }))).not.toContain('BUSINESS FOOTER SENTINEL');
    expect(renderText(buildReceipt(order, sampleBiz, { design: { ...d, footer: 'DESIGN FOOTER SENTINEL' } }))).not.toContain('DESIGN FOOTER SENTINEL');
    expect(buildReceipt(order, biz, { design: d }).some((b) => b.t === 'raster')).toBe(false);
    expect(buildReceipt(order, biz, { design: { ...d, showClosingImage: true } }).some((b) => b.t === 'raster')).toBe(true);
  });
  it('keeps kitchen routing/preparation instructions when optional branding/time/tab details are off', () => {
    const sample = { ...order, tabName: 'TAB SENTINEL', note: 'ORDER NOTE SENTINEL', lines: order.lines.map((line) => ({ ...line, note: 'LINE NOTE SENTINEL', modifiers: [{ id: 'extra', name: 'EXTRA SENTINEL', priceDeltaCents: 0 }] })) };
    const blocks = buildKitchenTicket(sample, biz, { design: design({ logo, showBusinessName: false, showLogo: false, showOrderNumber: false, showDateTime: false, showTabName: false, showNotes: false, showModifiers: false }) });
    const text = renderText(blocks);
    expect(text).toContain(`ORDER #${order.ticketNumber}`); expect(text).toContain('ORDER NOTE SENTINEL');
    expect(text).toContain('LINE NOTE SENTINEL'); expect(text).toContain('EXTRA SENTINEL');
    expect(text).not.toContain(biz.name); expect(text).not.toContain('TAB SENTINEL');
    for (const line of order.lines) for (const modifier of line.modifiers) expect(text).toContain(modifier.name);
    expect(blocks.find((b) => b.t === 'row')).toMatchObject({ right: '' });
  });
});

describe('designs saved before looks existed', () => {
  it('still parse, and print byte for byte as they did', () => {
    const old = { receipt: { widthMm: 80, align: 'center', title: 'Welcome', subtitle: 'Donkey Beach', footer: '', logo: null, numberSize: 'large', itemSize: 'normal', separator: 'solid', showPhone: true, showModifiers: true, showNotes: true, messages: [{ text: 'See you soon', bold: true, align: 'center' }] }, kitchen: DEFAULT_RECEIPT_TEMPLATE.kitchen };
    const parsed = ReceiptTemplate.parse(old);
    expect(parsed.receipt).toMatchObject({ nameArt: null, closing: null });
    expect(parsed.receipt.nameStyle).toBeUndefined();
    const bytes = renderEscPos(buildReceipt(order, biz, { design: parsed.receipt }));
    // None of the new commands: narrow font, underline, inverse.
    for (const cmd of [[0x1b, 0x4d], [0x1b, 0x2d], [0x1d, 0x42]]) expect(has(bytes, cmd)).toBe(false);
    const text = renderText(buildReceipt(order, biz, { design: parsed.receipt }));
    expect(text.split('\n').slice(0, 3)).toEqual(['                    Welcome', '      Cactus Blue', '             Donkey Beach, Bonaire']);
    expect(text).toContain('See you soon');
  });
});

describe('printer text looks', () => {
  it('each size has its own line length and printer command', () => {
    expect([columnsFor('small', 48), columnsFor('normal', 48), columnsFor('tall', 48), columnsFor('wide', 48), columnsFor('large', 48), columnsFor('huge', 48)]).toEqual([64, 48, 48, 24, 24, 16]);
    expect(columnsFor('small', 32)).toBe(42);
    const long = 'x'.repeat(40);
    expect(layout([{ t: 'text', text: long, size: 'small' }], 48)).toHaveLength(1);
    expect(layout([{ t: 'text', text: long, size: 'huge' }], 48)).toHaveLength(3);
    const bytes = renderEscPos([
      { t: 'text', text: 'tiny', size: 'small' }, { t: 'text', text: 'TALL', size: 'tall' }, { t: 'text', text: 'WIDE', size: 'wide' },
      { t: 'text', text: 'BIG', size: 'huge', underline: true }, { t: 'text', text: 'SALE', inverse: true }, { t: 'text', text: 'plain' },
    ]);
    expect(before(bytes, [0x1b, 0x4d, 1], 'tiny')).toBe(true);
    expect(before(bytes, [0x1d, 0x21, 0x01, 0x1b, 0x4d, 0], 'TALL')).toBe(true); // tall, and back to the normal font
    expect(before(bytes, [0x1d, 0x21, 0x10], 'WIDE')).toBe(true);
    expect(before(bytes, [0x1d, 0x21, 0x22, 0x1b, 0x2d, 1], 'BIG')).toBe(true);
    expect(before(bytes, [0x1b, 0x2d, 0, 0x1d, 0x42, 1], 'SALE')).toBe(true);
    expect(before(bytes, [0x1d, 0x42, 0], 'plain')).toBe(true); // everything is switched off again
  });

  it('name, title, subtitle and footer take the look chosen for them', () => {
    const d = design({
      title: 'Aloha', subtitle: 'since 2019', footer: 'Masha danki!',
      nameStyle: { size: 'huge', bold: true }, titleStyle: { size: 'small' }, subtitleStyle: { underline: true }, footerStyle: { size: 'tall', inverse: true },
    });
    const lines = layout(buildReceipt(order, biz, { design: d }), 48).flatMap((x) => (x.kind === 'line' ? [x.line] : []));
    const find = (text: string) => lines.find((l) => l.text.includes(text))!;
    expect(find('Cactus')).toMatchObject({ size: 'huge', bold: true });
    expect(find('Aloha')).toMatchObject({ size: 'small', bold: false });
    expect(find('since 2019')).toMatchObject({ underline: true, size: 'normal' });
    expect(find('Masha danki!')).toMatchObject({ size: 'tall', inverse: true });
    // "Cactus Blue" is 11 letters and a huge line holds 16, so it stays on one line on 80 mm paper.
    expect(lines.filter((l) => l.size === 'huge').map((l) => l.text)).toEqual(['Cactus Blue']);
    const html = renderHtml(buildReceipt(order, biz, { design: d }));
    expect(html).toContain('<div class="t center b huge">Cactus Blue</div>');
    expect(html).toContain('<div class="t center tall"><span class="inv">Masha danki!</span></div>');
    expect(html).toContain('<div class="t center u">since 2019</div>');
  });

  it('the order number can be huge on both papers', () => {
    const receipt = layout(buildReceipt(order, biz, { design: design({ numberSize: 'huge' }) }), 48);
    expect(receipt.some((x) => x.kind === 'line' && x.line.text === 'ORDER #7' && x.line.size === 'huge')).toBe(true);
    const ticket = layout(buildKitchenTicket(order, biz, { design: design({ numberSize: 'huge' }) }), 48);
    expect(ticket.some((x) => x.kind === 'line' && x.line.text.startsWith('ORDER #7') && x.line.size === 'huge')).toBe(true);
  });
});

describe('lettering', () => {
  it('stands in for the business name as a picture, on the receipt and the kitchen ticket', () => {
    const d = design({ nameArt: art('Cactus Blue') });
    const blocks = buildReceipt(order, biz, { design: d });
    expect(renderText(blocks)).toContain('[Cactus Blue]'); // a text log still reads as the paper did
    expect(renderText(blocks).match(/Cactus Blue/g)).toHaveLength(1);
    const html = renderHtml(blocks);
    expect(html).toContain('aria-label="Cactus Blue" viewBox="0 0 16 2"');
    expect(has(renderEscPos(blocks), [0x1d, 0x76, 0x30, 0, 2, 0, 2, 0, 0xff, 0xff, 0xaa, 0xaa])).toBe(true);
    expect(renderText(buildKitchenTicket(order, biz, { design: d }))).toContain('[Cactus Blue]');
  });

  it('is not used for a business that has been renamed: the real name must be on the paper', () => {
    const text = renderText(buildReceipt(order, { ...biz, name: 'Blue Cactus Grill' }, { design: design({ nameArt: art('Cactus Blue') }) }));
    expect(text).toContain('Blue Cactus Grill');
    expect(text).not.toContain('[Cactus Blue]');
  });

  it('a message can be lettering, and messages go above the items or below the totals', () => {
    const d = design({ messages: [
      { text: 'Fresh from the grill', bold: false, align: 'center', position: 'top', size: 'wide' },
      { text: 'Hasta luego', bold: false, align: 'right', art: art('Hasta luego') },
      { text: '', bold: false, align: 'center', art: art('Left over from an emptied line') },
      { text: 'Tag us @cactusblue', bold: true, align: 'center' },
      { text: '   ', bold: false, align: 'left' },
    ] });
    const lines = renderText(buildReceipt(order, biz, { design: d })).split('\n');
    const at = (needle: string) => lines.findIndex((l) => l.includes(needle));
    expect(at('Fresh from the')).toBeGreaterThan(at('ORDER #7'));
    expect(at('Fresh from the')).toBeLessThan(at('Kiteburger'));
    expect(at('[Hasta luego]')).toBeGreaterThan(at('TOTAL'));
    expect(at('Tag us @cactusblue')).toBeGreaterThan(at('[Hasta luego]'));
    expect(lines[at('[Hasta luego]')]!.endsWith('[Hasta luego]')).toBe(true); // right aligned
    expect(at('Left over')).toBe(-1); // no words, no line, whatever picture is still stored
  });

  it('a closing picture is the last thing before the paper is cut', () => {
    const blocks = buildReceipt(order, biz, { design: design({ closing: { width: 8, height: 1, hex: '18' } }) });
    const kinds = layout(blocks, 48).map((x) => x.kind);
    expect(kinds.slice(-3)).toEqual(['raster', 'feed', 'cut']);
  });

  it('pictures taller than 255 dots and wider than the paper print whole', () => {
    const tall = { width: 8, height: 300, hex: 'ff'.repeat(300) };
    expect(has(renderEscPos([{ t: 'raster', image: tall }]), [0x1d, 0x76, 0x30, 0, 1, 0, 0x2c, 0x01])).toBe(true); // 300 = 0x012c
    // Made for 80 mm (576 dots), printed on 58 mm (32 columns = 384 dots): scaled, not cut off.
    const wide = { width: 576, height: 30, hex: ('f0'.repeat(72)).repeat(30) };
    const fitted = fitRaster(wide, 384);
    expect(fitted).toMatchObject({ width: 384, height: 20 });
    expect(fitted.hex).toHaveLength(384 / 8 * 20 * 2);
    expect(fitRaster(wide, 576)).toBe(wide);
    const laid = layout([{ t: 'raster', image: wide }], 32)[0]!;
    expect(laid.kind === 'raster' && laid.image.width).toBe(384);
    // Every dot of a solid picture is still there after scaling.
    expect(fitRaster({ width: 576, height: 4, hex: 'ff'.repeat(72 * 4) }, 384).hex).toMatch(/^f+$/);
  });
});

describe('dividers', () => {
  it('print as a line of their own characters across the paper', () => {
    expect(ruleLine('double', 12)).toBe('============');
    expect(ruleLine('dotted', 12)).toBe('. . . . . .');
    expect(ruleLine('stars', 11)).toBe('* * * * * *');
    expect(ruleLine('wave', 5)).toBe('~~~~~');
    for (const [style, mark] of [['double', '='], ['stars', '* *'], ['wave', '~~~']] as const) {
      const text = renderText(buildReceipt(order, biz, { design: design({ separator: style }) }), 32);
      expect(text).toContain(mark);
      expect(text.split('\n').every((l) => l.length <= 32)).toBe(true);
    }
    expect(renderHtml(buildReceipt(order, biz, { design: design({ separator: 'double' }) }))).toContain('<hr class="double">');
  });
});

describe('QR codes on a design', () => {
  const wifi = { kind: 'wifi', ssid: 'Cactus Blue Guest', password: 'burgers4ever', caption: 'Free WiFi', position: 'bottom' };
  const link = { kind: 'link', value: ' https://www.cactusblue.us ', caption: 'Our menu', size: 'l', position: 'top' };

  it('WiFi and link codes go where they were put, with caption and the WiFi details in words', () => {
    const blocks = buildReceipt(order, biz, { design: design({ codes: [wifi, link], closing: { width: 8, height: 1, hex: '18' } }) });
    const lines = renderText(blocks).split('\n');
    const at = (needle: string) => lines.findIndex((l) => l.includes(needle));
    expect(at('[QR https://www.cactusblue.us]')).toBeGreaterThan(at('ORDER #7'));
    expect(at('Our menu')).toBe(at('[QR https://www.cactusblue.us]') + 1);
    expect(at('Our menu')).toBeLessThan(at('Kiteburger'));
    expect(at('[QR WIFI:T:WPA;S:Cactus Blue Guest;P:burgers4ever;;]')).toBeGreaterThan(at('TOTAL'));
    expect(lines.slice(at('Free WiFi'), at('Free WiFi') + 3).map((l) => l.trim())).toEqual(['Free WiFi', 'WiFi: Cactus Blue Guest', 'Password: burgers4ever']);
    expect(at('[LOGO]')).toBeGreaterThan(at('Password:')); // the closing picture stays last
    // The sizes are printer dots per square: large is 8, medium 6.
    const sizes = blocks.flatMap((b) => (b.t === 'qr' ? [b.scale] : []));
    expect(sizes).toEqual([8, 6]);
  });

  it('an open network has no password, and the words can be left off', () => {
    const text = renderText(buildReceipt(order, { ...biz, locale: 'nl' }, { design: design({ codes: [{ kind: 'wifi', ssid: 'Strand', security: 'nopass', password: 'ignored' }, { ...wifi, showPassword: false }] }) }));
    expect(text).toContain('[QR WIFI:T:nopass;S:Strand;P:;;]');
    expect(text).toContain('WiFi: Strand');
    expect(text.match(/Wachtwoord:/g)).toBeNull();
    expect(text.match(/WiFi: /g)).toHaveLength(1);
  });

  it('a code with nothing filled in is left out, and the preview draws the same squares', () => {
    const empty = renderText(buildReceipt(order, biz, { design: design({ codes: [{ kind: 'wifi' }, { kind: 'link', value: '  ' }] }) }));
    expect(empty).not.toContain('[QR');
    const html = renderHtml(buildReceipt(order, biz, { design: design({ codes: [link] }) }));
    expect(html).toMatch(/<svg role="img" aria-label="QR https:\/\/www\.cactusblue\.us" viewBox="0 0 33 33"/); // 25 squares and a margin of 4
    expect(html).toContain('width:33mm'); // 33 squares at 8 dots, 8 dots to the millimetre
    expect(html).toContain('<br>Our menu');
  });
});
