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
      { text: '', bold: false, align: 'right', art: art('Hasta luego') },
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
