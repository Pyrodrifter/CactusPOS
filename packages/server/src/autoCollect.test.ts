import { describe, expect, it, beforeEach } from 'vitest';
import { openDb } from './db.js';
import { PosService, type Staff } from './service.js';
import { seedSample } from './seedData.js';

const staff: Staff = { id: 'staff1', name: 'Staff', role: 'staff' };
const owner: Staff = { id: 'owner1', name: 'Owner', role: 'owner' };
let svc: PosService;
let db: ReturnType<typeof openDb>;
beforeEach(() => { db = openDb(':memory:'); seedSample(db); svc = new PosService(db); });

const burger = () => ({ lines: [{ itemId: 'burger', qty: 1, modifierOptionIds: [] }], source: 'pos' as const });

describe('ready orders picked up by themselves', () => {
  it('marks a ready order collected after a minute, not before', () => {
    const o = svc.setStatus(svc.createOrder(burger(), staff).id, 'ready', staff);
    const readyAt = Date.parse(o.readyAt!);
    expect(svc.autoCollect(readyAt + 59_000)).toEqual([]);
    const [done] = svc.autoCollect(readyAt + 60_000);
    expect(done?.status).toBe('collected');
    expect(done?.readyAt).toBeUndefined();
    expect(svc.getOrder(o.id).status).toBe('collected');
    expect(svc.pickupBoard().ready).not.toContain(o.ticketNumber);
    const event = db.prepare("SELECT payload, staff_id FROM order_events WHERE order_id = ? ORDER BY rowid DESC LIMIT 1").get(o.id) as { payload: string; staff_id: string };
    expect(JSON.parse(event.payload)).toMatchObject({ status: 'collected', auto: true });
    expect(event.staff_id).toBe('system');
  });
  it('leaves orders that are not ready alone, and can be switched off', () => {
    const making = svc.setStatus(svc.createOrder(burger(), staff).id, 'preparing', staff);
    const ready = svc.setStatus(svc.createOrder(burger(), staff).id, 'ready', staff);
    const later = Date.parse(ready.readyAt!) + 3600_000;
    svc.setAutoCollect(0, owner);
    expect(svc.autoCollect(later)).toEqual([]);
    svc.setAutoCollect(120, owner);
    expect(svc.autoCollectSeconds()).toBe(120);
    expect(svc.autoCollect(later).map((o) => o.id)).toEqual([ready.id]);
    expect(svc.getOrder(making.id).status).toBe('preparing');
  });
  it('starts a fresh minute when an undo puts the order back to ready', () => {
    const o = svc.setStatus(svc.createOrder(burger(), staff).id, 'ready', staff);
    svc.setStatus(o.id, 'collected', staff);
    const again = svc.setStatus(o.id, 'ready', staff);
    expect(svc.autoCollect(Date.parse(again.readyAt!) + 30_000)).toEqual([]);
  });
});
