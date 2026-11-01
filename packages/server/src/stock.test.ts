import { beforeEach, describe, expect, it, vi, afterEach } from 'vitest';
import { openDb, SCHEMA_VERSION } from './db.js';
import { PosService, type Staff } from './service.js';
import { Stock } from './stock.js';
import { seedSample } from './seedData.js';
import { StockList } from '@cactus/shared';

const staff: Staff = { id: 'staff1', name: 'Staff', role: 'staff' };
const owner: Staff = { id: 'owner1', name: 'Owner', role: 'owner' };
let db: ReturnType<typeof openDb>;
let svc: PosService;
let stock: Stock;
beforeEach(() => { db = openDb(':memory:'); seedSample(db); svc = new PosService(db); stock = new Stock(db, svc); });
afterEach(() => { vi.useRealTimers(); });

const burgers = { id: 'b', name: 'Burgers', kind: 'prepared' as const, unit: 'pcs', menuItemIds: ['burger'], lowAt: 2 };
const row = (id: string) => stock.list().items.find((i) => i.id === id)!;
const sell = (qty: number) => svc.createOrder({ lines: [{ itemId: 'burger', qty, modifierOptionIds: [] }], source: 'pos' }, staff);

describe('stock', () => {
  it('counts what is left of the prepared items from the orders of the day', () => {
    stock.save(burgers);
    stock.adjust('b', 20, staff);
    const order = sell(3);
    expect(row('b')).toMatchObject({ qty: 20, sold: 3, left: 17 });
    StockList.parse(stock.list());
    svc.voidOrder(order.id, 'mistake', undefined, owner);
    expect(row('b')).toMatchObject({ qty: 20, sold: 0, left: 20 });
  });

  it('starts prepared items at zero the next day; general stock carries over', () => {
    vi.useFakeTimers({ now: new Date('2026-11-02T16:00:00Z'), toFake: ['Date'] });
    stock.save(burgers);
    stock.save({ id: 'buns', name: 'Buns', kind: 'whole', unit: 'bags', menuItemIds: ['burger'] });
    stock.adjust('b', 20, staff);
    stock.adjust('buns', 5, staff);
    sell(1);
    vi.setSystemTime(new Date('2026-11-03T16:00:00Z'));
    expect(row('b')).toMatchObject({ qty: 0, sold: 0, left: 0 });
    expect(row('buns')).toMatchObject({ qty: 5, sold: 0, left: 5, menuItemIds: [] });
  });

  it('refuses a count below zero and keeps every move', () => {
    stock.save(burgers);
    stock.adjust('b', 2, staff);
    expect(() => stock.adjust('b', -3, staff)).toThrow(/below zero/);
    stock.adjust('b', -2, staff);
    expect(db.prepare('SELECT COUNT(*) AS n FROM stock_moves').get()).toEqual({ n: 2 });
    expect(() => db.prepare('DELETE FROM stock_moves').run()).toThrow(/append-only/);
    expect(() => db.prepare('UPDATE stock_moves SET delta = 9').run()).toThrow(/append-only/);
  });

  it('takes a removed item off the list and refuses further counts', () => {
    stock.save(burgers);
    stock.adjust('b', 2, staff);
    stock.remove('b');
    expect(stock.list().items).toEqual([]);
    expect(() => stock.adjust('b', 1, staff)).toThrow(/not found/);
    expect(SCHEMA_VERSION).toBeGreaterThanOrEqual(8);
  });
});
