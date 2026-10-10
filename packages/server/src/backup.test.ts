import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openDb, type DB } from './db.js';
import { seedSample } from './seedData.js';
import { buildApp } from './app.js';
import { PosService } from './service.js';
import { backupName, backupsToRemove, backupTime, type BackupState } from './backup.js';

let dir: string;
let db: DB;
let app: ReturnType<typeof buildApp>['app'];
let svc: ReturnType<typeof buildApp>['svc'];
let backups: ReturnType<typeof buildApp>['backups'];
let owner: Record<string, string>;
let staff: Record<string, string>;
const others: DB[] = [];

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'cactus-backup-test-'));
  db = openDb(join(dir, 'data', 'cactus.sqlite'));
  seedSample(db);
  ({ app, svc, backups } = buildApp(db, { webDist: '/nonexistent', backupDir: join(dir, 'data', 'backups') }));
  const login = async (pin: string) => ({ 'x-token': (await app.inject({ method: 'POST', url: '/api/login', payload: { pin } })).json().token as string });
  owner = await login('1234');
  staff = await login('1111');
});
afterEach(async () => {
  await app.close();
  for (const d of [db, ...others.splice(0)]) { try { d.close(); } catch { /* already closed */ } }
  vi.useRealTimers();
  vi.restoreAllMocks();
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* Windows may hold a file for a moment */ }
});

const post = (url: string, headers: Record<string, string>, payload: object = {}) => app.inject({ method: 'POST', url, headers, payload });
async function sale(itemId: string, pay = true): Promise<string> {
  const id = (await post('/api/orders', staff, { lines: [{ itemId, qty: 1 }] })).json().id as string;
  if (pay) await post(`/api/orders/${id}/pay`, staff, { method: 'cash' });
  return id;
}
const state = async () => (await app.inject({ method: 'GET', url: '/api/admin/backups', headers: owner })).json() as BackupState;

describe('backups', () => {
  it('a backup restored on its own reproduces every order, payment and receipt number', async () => {
    const voided = await sale('burger');
    await sale('fries');
    await sale('cola', false); // an open tab
    await post(`/api/orders/${voided}/void`, owner, { reason: 'refund' });
    await post('/api/reports/day/close', owner, { date: svc.businessDate() }); // also makes a backup by itself

    const after = (await post('/api/admin/backups/run', owner)).json() as BackupState;
    expect(after.enabled).toBe(true);
    expect(after.last).toMatchObject({ orders: 3, lastReceipt: 2, copied: false });
    expect(after.problem).toBeNull();
    expect(after.files[0]!.name).toBe(after.last!.name);
    expect(after.files[0]!.bytes).toBeGreaterThan(0);

    // Open the copy the way a fresh install would, with nothing else beside it.
    const restored = openDb(join(dir, 'data', 'backups', after.last!.name));
    others.push(restored);
    const copy = new PosService(restored);
    expect(copy.verifyLedger()).toEqual([]);
    const all = (from: DB) => from.prepare('SELECT id, receipt_number, business_date, paid_date, void_date, data FROM orders ORDER BY id').all();
    expect(all(restored)).toEqual(all(db));
    expect(restored.prepare('SELECT * FROM payments ORDER BY id').all()).toEqual(db.prepare('SELECT * FROM payments ORDER BY id').all());
    expect(restored.prepare('SELECT COUNT(*) AS n FROM order_events').get()).toEqual(db.prepare('SELECT COUNT(*) AS n FROM order_events').get());
    expect(restored.prepare('SELECT number FROM z_reports').all()).toEqual([{ number: 1 }]);
    expect(copy.auth.findByPin('1234')?.role).toBe('owner');
  });

  it('only runs when something changed, and again when the last file is gone', async () => {
    const first = backups.runIfChanged();
    expect(first).not.toBeNull();
    expect(backups.runIfChanged()).toBeNull();
    await sale('water');
    const second = backups.runIfChanged();
    expect(second!.orders).toBe(1);
    expect(second!.name).not.toBe(first!.name);
    rmSync(join(dir, 'data', 'backups', second!.name));
    expect(backups.runIfChanged()).not.toBeNull();
  });

  it('closing the day makes a backup straight away', async () => {
    await sale('juice');
    expect((await state()).files).toHaveLength(0);
    await post('/api/reports/day/close', owner, { date: svc.businessDate() });
    const s = await state();
    expect(s.files).toHaveLength(1);
    expect(s.last!.orders).toBe(1);
  });

  it('copies each backup to a second folder; a missing folder is reported and the first copy still counts', async () => {
    const usb = join(dir, 'usb');
    mkdirSync(usb);
    expect((await app.inject({ method: 'PUT', url: '/api/admin/backups/settings', headers: owner, payload: { folder: join(dir, 'nowhere') } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'PUT', url: '/api/admin/backups/settings', headers: owner, payload: { folder: join(dir, 'data', 'backups') } })).statusCode).toBe(400);
    const saved = await app.inject({ method: 'PUT', url: '/api/admin/backups/settings', headers: owner, payload: { folder: usb } });
    expect((saved.json() as BackupState).settings.folder).toBe(usb);

    await sale('fries');
    const ok = (await post('/api/admin/backups/run', owner)).json() as BackupState;
    expect(ok.last!.copied).toBe(true);
    expect(readdirSync(usb)).toEqual([ok.last!.name]);

    rmSync(usb, { recursive: true });
    await sale('cola');
    const unplugged = (await post('/api/admin/backups/run', owner)).json() as BackupState;
    expect(unplugged.last).toMatchObject({ orders: 2, copied: false });
    expect(unplugged.problem).toMatch(/Saved on this computer, but not in .*usb/);
    expect(existsSync(join(dir, 'data', 'backups', unplugged.last!.name))).toBe(true);
  });

  it('is for the owner only, and leaves other files in the folder alone', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/admin/backups', headers: staff })).statusCode).toBe(403);
    expect((await post('/api/admin/backups/run', staff)).statusCode).toBe(403);
    mkdirSync(join(dir, 'data', 'backups'), { recursive: true });
    writeFileSync(join(dir, 'data', 'backups', 'notes.txt'), 'mine');
    await post('/api/admin/backups/run', owner);
    expect((await state()).files.map((f) => f.name).every((n) => n.startsWith('cactus-'))).toBe(true);
    expect(existsSync(join(dir, 'data', 'backups', 'notes.txt'))).toBe(true);
  });

  it('is switched off for a database that has no folder', async () => {
    const memory = openDb(':memory:');
    others.push(memory);
    seedSample(memory);
    const plain = buildApp(memory, { webDist: '/nonexistent' });
    const token = { 'x-token': (await plain.app.inject({ method: 'POST', url: '/api/login', payload: { pin: '1234' } })).json().token as string };
    expect((await plain.app.inject({ method: 'GET', url: '/api/admin/backups', headers: token })).json()).toMatchObject({ enabled: false, files: [], last: null });
    expect((await plain.app.inject({ method: 'POST', url: '/api/admin/backups/run', headers: token, payload: {} })).statusCode).toBe(409);
    expect(plain.backups.runIfChanged()).toBeNull();
    await plain.app.close();
  });
});

describe('which backups are kept', () => {
  it('names sort by time and carry their moment', () => {
    const at = new Date('2026-10-10T13:05:09Z');
    expect(backupName(at)).toBe('cactus-20261010-130509.sqlite');
    expect(backupTime('cactus-20261010-130509.sqlite')).toBe('2026-10-10T13:05:09.000Z');
    expect(backupTime('cactus-20261010-130509-2.sqlite')).toBeNull();
    expect(backupTime('cactus.sqlite')).toBeNull();
  });

  it('keeps the newest thirty and the last one of each day for ninety days', () => {
    const now = new Date('2026-10-10T20:00:00Z');
    const names: string[] = [];
    for (let day = 0; day < 120; day++) {
      for (const hour of [14, 18, 22]) names.push(backupName(new Date(Date.UTC(2026, 9, 10 - day, hour))));
    }
    const remove = new Set(backupsToRemove([...names, 'notes.txt', 'cactus.sqlite'], now));
    const kept = names.filter((n) => !remove.has(n)).sort().reverse();
    expect(remove.has('notes.txt') || remove.has('cactus.sqlite')).toBe(false);
    expect(kept.slice(0, 30)).toEqual([...names].sort().reverse().slice(0, 30)); // everything from the last ten days
    const older = kept.slice(30);
    expect(older.every((n) => n.endsWith('-220000.sqlite'))).toBe(true); // then only the last of each day
    expect(older).toHaveLength(81); // days 10 to 90 back
    expect(backupTime(kept.at(-1)!)!.slice(0, 10)).toBe('2026-07-12');
  });
});
