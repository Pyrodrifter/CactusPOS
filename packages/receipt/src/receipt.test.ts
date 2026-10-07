import { describe, expect, it } from 'vitest';
import type { Business, Order } from '@cactus/shared';
import { buildKitchenTicket, buildReceipt, encodeText, renderEscPos, renderHtml, renderText, rowLines, wifiQr, wrap } from './index.js';

const biz: Business = {
  name: 'Cactus Blue', crib: '123456789', address: 'Donkey Beach, Bonaire', phone: '', timezone: 'America/Kralendijk',
  currency: 'USD', locale: 'en', receiptFooter: 'Thank you!',
};
const order: Order = {
  id: 'o1', ticketNumber: 7, receiptNumber: 42, status: 'sent', paid: true, source: 'pos', note: 'no napkins',
  lines: [
    { id: 'l1', itemId: 'cactus_double', name: 'Cactus Double', qty: 1, unitPriceCents: 2075, lineTotalCents: 2075, taxCents: 117, taxCategoryId: 'service_6', station: 'kitchen',
      modifiers: [{ id: 'x_bacon', name: 'Extra bacon', priceDeltaCents: 100 }] },
    { id: 'l2', itemId: 'soda', name: 'Soft Drink', qty: 2, unitPriceCents: 275, lineTotalCents: 550, taxCents: 31, taxCategoryId: 'service_6', station: 'bar',
      modifiers: [{ id: 'd_coke', name: 'Coke', priceDeltaCents: 0 }] },
  ],
  payments: [{ id: 'p1', method: 'cash', amountCents: 2625, tenderedCents: 3000, changeCents: 375, tipCents: 0, at: '2026-10-07T16:05:00.000Z' }],
  totalCents: 2625, taxCents: 148,
  breakdown: [{ taxCategoryId: 'service_6', name: 'ABB 6%', kind: 'taxed', bps: 600, grossCents: 2625, taxCents: 148, netCents: 2477 }],
  createdAt: '2026-10-07T16:00:00.000Z', updatedAt: '2026-10-07T16:05:00.000Z', createdBy: 'staff1',
};

describe('layout helpers', () => {
  it('wraps on spaces and breaks over-long words', () => {
    expect(wrap('one two three', 7)).toEqual(['one two', 'three']);
    expect(wrap('abcdefghij', 4)).toEqual(['abcd', 'efgh', 'ij']);
  });
  it('rows keep the amount on the first line and never exceed the width', () => {
    expect(rowLines('Fries', '$5.00', 20)).toEqual(['Fries          $5.00']);
    const long = rowLines('1 x The Hungry Mans Double Burger Deluxe', '$19.75', 32);
    expect(long[0]!.endsWith('$19.75')).toBe(true);
    expect(long.every((l) => l.length <= 32)).toBe(true);
    expect(long.length).toBeGreaterThan(1);
  });
});

describe('customer receipt', () => {
  it('80mm text rendering (golden)', () => {
    expect(renderText(buildReceipt(order, biz), 48)).toBe([
      '      Cactus Blue',
      '             Donkey Beach, Bonaire',
      '                 CRIB 123456789',
      '------------------------------------------------',
      'Receipt #42                             Ticket 7',
      '07/10/2026, 12:05',
      '------------------------------------------------',
      '1 x Cactus Double                         $20.75',
      '   + Extra bacon',
      '2 x Soft Drink                             $5.50',
      '   + Coke',
      '------------------------------------------------',
      'TOTAL             $26.25',
      'Prices include ABB',
      'ABB 6% over $24.77                         $1.48',
      '------------------------------------------------',
      'Cash                                      $30.00',
      'Change                                     $3.75',
      '------------------------------------------------',
      '                   Thank you!',
      '',
      '',
      '',
    ].join('\n'));
  });
  it('fits 58mm paper', () => {
    const lines = renderText(buildReceipt(order, biz), 32).split('\n');
    expect(lines.every((l) => l.length <= 32)).toBe(true);
    expect(lines).toContain('1 x Cactus Double         $20.75');
  });
  it('has the fields a Bonaire receipt needs', () => {
    const txt = renderText(buildReceipt(order, biz));
    for (const must of ['Cactus Blue', 'CRIB 123456789', 'Receipt #42', '07/10/2026', 'TOTAL', '$26.25', 'ABB 6%', '$1.48']) expect(txt).toContain(must);
  });
  it('Dutch, copies, voids, unpaid and exempt lines are marked', () => {
    expect(renderText(buildReceipt(order, { ...biz, locale: 'nl' }))).toContain('TOTAAL');
    expect(renderText(buildReceipt(order, biz, { lang: 'nl' }))).toContain('Wisselgeld');
    expect(renderText(buildReceipt(order, biz, { copy: true }))).toContain('COPY');
    expect(renderText(buildReceipt({ ...order, status: 'void' }, biz))).toContain('*** VOID ***');
    expect(renderText(buildReceipt({ ...order, paid: false, payments: [], receiptNumber: null }, biz))).toContain('*** NOT PAID ***');
    const exempt = { ...order, breakdown: [{ taxCategoryId: 'exempt', name: 'Exempt', kind: 'exempt' as const, bps: 0, grossCents: 300, taxCents: 0, netCents: 300 }] };
    expect(renderText(buildReceipt(exempt, biz))).toMatch(/Exempt\s+\$3\.00/);
  });
  it('HTML escapes text and is a printable page', () => {
    const html = renderHtml(buildReceipt({ ...order, lines: [{ ...order.lines[0]!, name: '<b>Burger</b> & co' }] }, biz));
    expect(html).toContain('&lt;b&gt;Burger&lt;/b&gt; &amp; co');
    expect(html).not.toContain('<b>Burger');
    expect(html.startsWith('<!doctype html>')).toBe(true);
  });
});

describe('kitchen ticket', () => {
  it('shows items and options, never prices; can filter by station', () => {
    const all = renderText(buildKitchenTicket(order, biz));
    expect(all).toContain('ORDER #7');
    expect(all).toContain('1 x Cactus Double');
    expect(all).toContain('+ Extra bacon');
    expect(all).toContain('Note: no napkins');
    expect(all).not.toContain('$');
    const bar = renderText(buildKitchenTicket(order, biz, { station: 'bar' }));
    expect(bar).toContain('Soft Drink');
    expect(bar).not.toContain('Cactus Double');
  });
});

describe('ESC/POS bytes', () => {
  const bytes = renderEscPos(buildReceipt(order, biz, { openDrawer: true }));
  const has = (seq: number[]) => bytes.some((_, i) => seq.every((b, j) => bytes[i + j] === b));
  it('initialises, selects the code page, opens the drawer and cuts', () => {
    expect([...bytes.slice(0, 5)]).toEqual([0x1b, 0x40, 0x1b, 0x74, 19]);
    expect(has([0x1b, 0x70, 0, 25, 250])).toBe(true);
    expect([...bytes.slice(-4)]).toEqual([0x1d, 0x56, 66, 0]);
    expect(Buffer.from(bytes).toString('latin1')).toContain('Receipt #42');
  });
  it('feeds instead of cutting on printers without a cutter', () => {
    const b = renderEscPos(buildReceipt(order, biz), { cutter: false });
    expect([...b.slice(-3)]).toEqual([0x1b, 0x64, 4]);
  });
  it('encodes accents for the printer and never emits raw unicode', () => {
    expect(encodeText('Jalapeños')).toEqual([0x4a, 0x61, 0x6c, 0x61, 0x70, 0x65, 0xa4, 0x6f, 0x73]);
    expect(encodeText('€5 “ok” – ž')).toEqual([0xd5, 0x35, 0x20, 0x22, 0x6f, 0x6b, 0x22, 0x20, 0x2d, 0x20, 0x7a]);
    expect(encodeText('日本').every((b) => b === 0x3f)).toBe(true);
    expect(renderEscPos([{ t: 'text', text: 'Curaçao ☀' }]).every((b) => b <= 0xff)).toBe(true);
  });
  it('QR block stores the data and prints it', () => {
    const data = wifiQr('Cactus Guest', 'lion;fish');
    expect(data).toBe('WIFI:T:WPA;S:Cactus Guest;P:lion\\;fish;;');
    const b = renderEscPos([{ t: 'qr', data }]);
    expect(Buffer.from(b).toString('latin1')).toContain(data);
    expect(b.some((_, i) => [0x1d, 0x28, 0x6b, 3, 0, 49, 81, 48].every((x, j) => b[i + j] === x))).toBe(true);
  });
});
