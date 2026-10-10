import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuditList, CorrectOrderResponse, DayReport, Order, OrderList, ZReport } from '@cactus/shared';
import { buildReceipt, renderText } from '@cactus/receipt';
import { dayBooking } from '@cactus/books-bridge';
import { openDb, type DB } from './db.js';
import { seedSample } from './seedData.js';
import { buildApp } from './app.js';

/**
 * Correcting a paid order (UX14): the mistake is fixed in one step, and nothing is rewritten. The original
 * stays on record as void, a replacement sale gets the next receipt number, and the money figures move by
 * the difference only. Sample menu: burger 1400, fries 500, cola 300, juice 450, all at 6% ABB.
 */
const NOON = Date.parse('2026-03-02T16:00:00Z'); // noon in Kralendijk
const DAY = 24 * 3600_000;

let db: DB;
let app: ReturnType<typeof buildApp>['app'];
let svc: ReturnType<typeof buildApp>['svc'];
let reports: ReturnType<typeof buildApp>['reports'];
let owner: Record<string, string>;
let staff: Record<string, string>;

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOON);
  db = openDb(':memory:');
  seedSample(db);
  ({ app, svc, reports } = buildApp(db, { webDist: '/nonexistent' }));
  const login = async (pin: string) => ({ 'x-token': (await app.inject({ method: 'POST', url: '/api/login', payload: { pin } })).json().token as string });
  owner = await login('1234');
  staff = await login('1111');
});
afterEach(async () => { await app.close(); vi.useRealTimers(); });

const post = (url: string, headers: Record<string, string>, payload: object) => app.inject({ method: 'POST', url, headers, payload });
async function sale(lines: object[], pay: object = { method: 'cash' }): Promise<Order> {
  const o = Order.parse((await post('/api/orders', staff, { lines })).json());
  return Order.parse((await post(`/api/orders/${o.id}/pay`, staff, pay)).json());
}
const lineOf = (o: Order, name: string) => o.lines.find((l) => l.name === name)!;
const correct = (o: Order, body: object, headers = owner) => post(`/api/orders/${o.id}/correct`, headers, { method: 'cash', reason: 'rang up the wrong thing', ...body });

describe('correcting a paid order', () => {
  it('replaces it with the right sale: new receipt number, same ticket, original kept as void', async () => {
    const original = await sale([{ itemId: 'burger', qty: 1 }, { itemId: 'cola', qty: 2 }, { itemId: 'fries', qty: 1 }]);
    expect(original).toMatchObject({ totalCents: 2500, receiptNumber: 1 });
    // It should have been one cola, no fries, and a juice.
    const res = await correct(original, { keep: [{ lineId: lineOf(original, 'Burger').id, qty: 1 }, { lineId: lineOf(original, 'Cola').id, qty: 1 }], add: [{ itemId: 'juice', qty: 1 }], expectedTotalCents: 2150 });
    expect(res.statusCode).toBe(200);
    const { order, replaced } = CorrectOrderResponse.parse(res.json());

    expect(order).toMatchObject({ paid: true, status: 'sent', ticketNumber: original.ticketNumber, receiptNumber: 2, totalCents: 2150, taxCents: 121, corrects: { orderId: original.id, receiptNumber: 1 } });
    expect(order.lines.map((l) => [l.name, l.qty, l.lineTotalCents, l.taxCents])).toEqual([['Burger', 1, 1400, 79], ['Cola', 1, 300, 17], ['Fresh Juice', 1, 450, 25]]);
    expect(order.breakdown).toEqual([{ taxCategoryId: 'service_6', name: 'ABB 6%', kind: 'taxed', bps: 600, grossCents: 2150, taxCents: 121, netCents: 2029 }]);
    expect(order.payments).toMatchObject([{ method: 'cash', amountCents: 2150, tenderedCents: 2150, changeCents: 0 }]);
    expect(replaced).toMatchObject({ id: original.id, status: 'void', paid: true, receiptNumber: 1, voidReason: 'rang up the wrong thing', correctedBy: { orderId: order.id, receiptNumber: 2 } });
    expect(replaced.lines).toEqual(original.lines); // the first sale is still on record as it was

    // Two payments on file (nothing removed), numbers without a gap, and the three records agree.
    expect(db.prepare('SELECT receipt_number, amount_cents FROM payments ORDER BY receipt_number').all()).toEqual([{ receipt_number: 1, amount_cents: 2500 }, { receipt_number: 2, amount_cents: 2150 }]);
    expect(svc.verifyLedger()).toEqual([]);

    const r = DayReport.parse(reports.day());
    expect(r.orders).toMatchObject({ sold: 1, refunded: 0 });
    expect(r.sales).toEqual({ grossCents: 2150, taxCents: order.taxCents, netCents: 2150 - order.taxCents });
    expect(r.tenders[0]).toEqual({ method: 'cash', count: 1, amountCents: 2150, tipCents: 0 });
    expect(r.cashExpectedCents).toBe(2150); // 2500 came in, 350 went back
    expect(r.refunds).toEqual([]); // a correction is not listed as a refund
    expect(r.corrections).toEqual({ count: 1, removedCents: 2500, addedCents: 2150 });
    expect(r.receipts).toEqual({ first: 1, last: 2, count: 2 });
  });

  it('a wrong payment method is a correction too: same items, the money moves from cash to card', async () => {
    const original = await sale([{ itemId: 'burger', qty: 1 }]);
    const { order } = CorrectOrderResponse.parse((await correct(original, { keep: [{ lineId: original.lines[0]!.id, qty: 1 }], method: 'card', reference: 'T-88' })).json());
    expect(order.payments).toMatchObject([{ method: 'card', amountCents: 1400, reference: 'T-88', tipCents: 0 }]);
    const r = reports.day();
    expect(r.tenders).toEqual([{ method: 'cash', count: 0, amountCents: 0, tipCents: 0 }, { method: 'card', count: 1, amountCents: 1400, tipCents: 0 }]);
    expect(r.cashExpectedCents).toBe(0);
    expect(r.corrections).toEqual({ count: 1, removedCents: 1400, addedCents: 1400 });
  });

  it('a card tip stays with the sale, and a corrected order can be corrected again', async () => {
    const original = await sale([{ itemId: 'fries', qty: 1 }], { method: 'card', tipCents: 200 });
    const first = CorrectOrderResponse.parse((await correct(original, { keep: [{ lineId: original.lines[0]!.id, qty: 2 }], method: 'card' })).json()).order;
    expect(first.payments[0]).toMatchObject({ amountCents: 1000, tipCents: 200 });
    const second = CorrectOrderResponse.parse((await correct(first, { keep: [{ lineId: first.lines[0]!.id, qty: 3 }], method: 'card', tipCents: 0 })).json()).order;
    expect(second).toMatchObject({ totalCents: 1500, receiptNumber: 3, corrects: { orderId: first.id, receiptNumber: 2 } });
    expect((await correct(original, { keep: [{ lineId: original.lines[0]!.id, qty: 1 }] })).json().error).toMatch(/already corrected: see receipt #2/);
    const r = reports.day();
    expect(r.sales.grossCents).toBe(1500);
    expect(r.tipsCents).toBe(0);
    expect(r.corrections).toEqual({ count: 2, removedCents: 500 + 1000, addedCents: 1000 + 1500 });
    expect(svc.verifyLedger()).toEqual([]);
  });

  it('lines that stay keep what they were sold for, whatever happened to the menu since', async () => {
    const original = await sale([{ itemId: 'burger', qty: 2 }, { itemId: 'cola', qty: 1 }]);
    await app.inject({ method: 'PUT', url: '/api/admin/menu/items/burger', headers: owner, payload: { categoryId: 'mains', name: 'Burger Deluxe', priceCents: 1900, taxCategoryId: 'service_6' } });
    await app.inject({ method: 'DELETE', url: '/api/admin/menu/items/cola', headers: owner });
    const { order } = CorrectOrderResponse.parse((await correct(original, { keep: [{ lineId: lineOf(original, 'Burger').id, qty: 1 }, { lineId: lineOf(original, 'Cola').id, qty: 1 }], add: [{ itemId: 'burger', qty: 1 }] })).json());
    expect(order.lines.map((l) => [l.name, l.unitPriceCents])).toEqual([['Burger', 1400], ['Cola', 300], ['Burger Deluxe', 1900]]);
    expect(order.totalCents).toBe(3600);
  });

  it('on a later day only the difference lands on that day, and the closed day stays as it was', async () => {
    const original = await sale([{ itemId: 'burger', qty: 1 }, { itemId: 'fries', qty: 1 }]);
    const z1 = ZReport.parse((await post('/api/reports/day/close', owner, { date: '2026-03-02' })).json());
    vi.setSystemTime(NOON + DAY);
    const { order } = CorrectOrderResponse.parse((await correct(original, { keep: [{ lineId: lineOf(original, 'Burger').id, qty: 1 }] })).json());
    expect(order).toMatchObject({ totalCents: 1400, paidDate: '2026-03-03' });
    const day2 = DayReport.parse(reports.day('2026-03-03'));
    expect(day2.sales.grossCents).toBe(1400 - 1900);
    expect(day2.cashExpectedCents).toBe(-500); // the fries went back out of the drawer
    expect(day2.corrections).toEqual({ count: 1, removedCents: 1900, addedCents: 1400 });
    expect(day2.refundedEarlier).toBeUndefined();
    expect(day2.refunds).toEqual([]);
    expect(reports.day('2026-03-02').sales).toEqual(z1.report.sales);
    // The books see one balanced entry for the difference.
    const z2 = ZReport.parse((await post('/api/reports/day/close', owner, { date: '2026-03-03' })).json());
    expect(dayBooking(z2).lines.reduce((sum, l) => sum + l.amountCents, 0)).toBe(0);
    expect(dayBooking(z2).lines.find((l) => l.account === '1000')!.amountCents).toBe(-500);
  });

  it('the kitchen keeps its ticket: same number and state, with the right items', async () => {
    const original = await sale([{ itemId: 'burger', qty: 1 }]);
    await post(`/api/orders/${original.id}/status`, staff, { status: 'preparing' });
    const { order } = CorrectOrderResponse.parse((await correct(original, { add: [{ itemId: 'wrap', qty: 1, modifierOptionIds: ['hot'] }] })).json());
    expect(order).toMatchObject({ status: 'preparing', ticketNumber: original.ticketNumber });
    const active = OrderList.parse((await app.inject({ method: 'GET', url: '/api/orders?scope=active', headers: staff })).json());
    expect(active.map((o) => [o.id, o.lines.map((l) => l.name)])).toEqual([[order.id, ['Chicken Wrap']]]);
    expect(svc.pickupBoard()).toEqual({ preparing: [original.ticketNumber], ready: [] });
  });

  it('both receipts say what happened', async () => {
    const original = await sale([{ itemId: 'burger', qty: 1 }]);
    const { order, replaced } = CorrectOrderResponse.parse((await correct(original, { keep: [{ lineId: original.lines[0]!.id, qty: 1 }], add: [{ itemId: 'cola', qty: 1 }] })).json());
    const fresh = renderText(buildReceipt(order, svc.business()));
    expect(fresh).toContain('Receipt #2');
    expect(fresh).toContain('Replaces receipt #1');
    const old = renderText(buildReceipt(replaced, svc.business(), { copy: true }));
    expect(old).toContain('*** VOID ***');
    expect(old).toContain('Corrected: see receipt #2');
    expect(renderText(buildReceipt(order, { ...svc.business(), locale: 'nl' }))).toContain('Vervangt bon #1');
  });
});

describe('who may correct, and what is refused', () => {
  it('needs the owner or the manager PIN, with the same limit on wrong PINs as a void', async () => {
    const original = await sale([{ itemId: 'burger', qty: 1 }]);
    const keep = [{ lineId: original.lines[0]!.id, qty: 2 }];
    expect((await correct(original, { keep }, staff)).statusCode).toBe(403);
    for (let i = 0; i < 5; i++) expect((await correct(original, { keep, managerPin: String(7000 + i) }, staff)).statusCode).toBe(403);
    expect((await correct(original, { keep, managerPin: '1234' }, staff)).statusCode).toBe(429);
    expect(svc.getOrder(original.id).status).toBe('sent');
    const audit = AuditList.parse((await app.inject({ method: 'GET', url: '/api/admin/audit', headers: owner })).json());
    expect(audit.filter((r) => r.type === 'correct.manager_pin_refused')).toHaveLength(5);
    vi.setSystemTime(NOON + 31_000);
    const ok = await correct(original, { keep, managerPin: '1234' }, staff);
    expect(ok.statusCode).toBe(200);
    expect(ok.json().order.totalCents).toBe(2800);
  });

  it('refuses what is not a correction, and changes nothing when it refuses', async () => {
    const paid = await sale([{ itemId: 'burger', qty: 1 }]);
    const line = paid.lines[0]!.id;
    const unpaid = Order.parse((await post('/api/orders', staff, { lines: [{ itemId: 'cola', qty: 1 }] })).json());
    expect((await correct(unpaid, { keep: [{ lineId: unpaid.lines[0]!.id, qty: 1 }] })).statusCode).toBe(409); // not paid: just add or void
    expect((await correct(paid, {})).json().error).toMatch(/at least one item/); // nothing left: that is a void
    expect((await correct(paid, { keep: [{ lineId: 'nope', qty: 1 }] })).statusCode).toBe(400);
    expect((await correct(paid, { keep: [{ lineId: line, qty: 1 }, { lineId: line, qty: 1 }] })).statusCode).toBe(400);
    expect((await correct(paid, { keep: [{ lineId: line, qty: 1 }], reason: ' ' })).statusCode).toBe(400);
    expect((await correct(paid, { keep: [{ lineId: line, qty: 2 }], expectedTotalCents: 1400 })).json().error).toContain('$28.00');
    expect((await correct(paid, { add: [{ itemId: 'bowl', qty: 1, modifierOptionIds: ['mild', 'hot'] }] })).statusCode).toBe(400); // options are checked like any sale
    expect(svc.getOrder(paid.id)).toMatchObject({ status: 'sent', paid: true });
    expect(db.prepare('SELECT COUNT(*) AS n FROM orders').get()).toEqual({ n: 2 });
    expect(db.prepare("SELECT value FROM counters WHERE name = 'receipt'").get()).toEqual({ value: 1 }); // no number was used up
  });

  it('a repeated request (double tap, lost reply) corrects once', async () => {
    const original = await sale([{ itemId: 'burger', qty: 1 }]);
    const key = { ...owner, 'idempotency-key': 'correct-abc12345' };
    const body = { keep: [{ lineId: original.lines[0]!.id, qty: 1 }], method: 'card' };
    const first = CorrectOrderResponse.parse((await correct(original, body, key)).json());
    const again = CorrectOrderResponse.parse((await correct(original, body, key)).json());
    expect(again.order.id).toBe(first.order.id);
    expect(again.replaced.status).toBe('void');
    expect(db.prepare('SELECT COUNT(*) AS n FROM orders').get()).toEqual({ n: 2 });
    const other = await sale([{ itemId: 'cola', qty: 1 }]);
    expect((await correct(other, { keep: [{ lineId: other.lines[0]!.id, qty: 1 }] }, key)).statusCode).toBe(409);
  });
});
