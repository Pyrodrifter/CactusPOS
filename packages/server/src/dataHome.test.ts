import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDb } from './db.js';
import { seedSample } from './seedData.js';
import { PosService } from './service.js';
import { chooseDb, dataHome, ordersIn, prepareDb } from './dataHome.js';

const never = () => false;

describe('where the sales database lives', () => {
  it('is the same data folder the installed app uses, on every system', () => {
    expect(dataHome({ LOCALAPPDATA: 'C:\\Users\\Ann\\AppData\\Local' }, 'win32', 'C:\\Users\\Ann')).toBe('C:\\Users\\Ann\\AppData\\Local\\CactusPOS');
    expect(dataHome({}, 'win32', 'C:\\Users\\Ann')).toBe('C:\\Users\\Ann\\AppData\\Local\\CactusPOS');
    expect(dataHome({}, 'linux', '/home/ann')).toBe('/home/ann/.local/share/cactuspos');
    expect(dataHome({ XDG_DATA_HOME: '/data' }, 'linux', '/home/ann')).toBe('/data/cactuspos');
    expect(dataHome({}, 'darwin', '/Users/ann')).toBe('/Users/ann/Library/Application Support/CactusPOS');
    expect(dataHome({ CACTUS_HOME: '/srv/till' }, 'linux', '/home/ann')).toBe('/srv/till');
  });

  it('does not depend on the folder the till was started in', () => {
    const fromRepo = chooseDb({ LOCALAPPDATA: 'C:\\L' }, 'win32', 'C:\\Users\\Ann', 'C:\\CactusPOS', never);
    const fromServer = chooseDb({ LOCALAPPDATA: 'C:\\L' }, 'win32', 'C:\\Users\\Ann', 'C:\\CactusPOS\\packages\\server', never);
    expect(fromRepo).toEqual({ path: 'C:\\L\\CactusPOS\\data\\cactus.sqlite', explicit: false, legacy: null });
    expect(fromServer.path).toBe(fromRepo.path);
  });

  it('CACTUS_DB names another file and switches everything else off', () => {
    expect(chooseDb({ CACTUS_DB: '/tmp/dev.sqlite' }, 'linux', '/home/ann', '/repo', () => true)).toEqual({ path: '/tmp/dev.sqlite', explicit: true, legacy: null });
  });

  it('notices a database left in data/ under the start folder', () => {
    const choice = chooseDb({ CACTUS_HOME: '/srv/till' }, 'linux', '/home/ann', '/repo/packages/server', (p) => p === resolve('/repo/packages/server', 'data/cactus.sqlite'));
    expect(choice.legacy).toBe(resolve('/repo/packages/server', 'data/cactus.sqlite'));
  });
});

describe('a till that was started by hand before the move', () => {
  let dir = '';
  afterEach(() => { try { rmSync(dir, { recursive: true, force: true }); } catch { /* Windows may hold a file for a moment */ } });

  function oldTill(orders: number): string {
    const file = join(dir, 'program', 'data', 'cactus.sqlite');
    const db = openDb(file);
    seedSample(db);
    const svc = new PosService(db);
    for (let i = 0; i < orders; i++) svc.createOrder({ lines: [{ itemId: 'cola', qty: 1, modifierOptionIds: [] }], source: 'pos' }, { id: 'staff1', name: 'Staff', role: 'staff' });
    db.close(); // without a checkpoint first: the sales may still sit in the -wal file
    return file;
  }

  it('is carried over once, sales and all, and the old file is left alone', () => {
    dir = mkdtempSync(join(tmpdir(), 'cactus-home-test-'));
    const legacy = oldTill(3);
    const path = join(dir, 'home', 'data', 'cactus.sqlite');
    const lines = prepareDb({ path, explicit: false, legacy });
    expect(lines.join('\n')).toContain(legacy);
    expect(lines.join('\n')).toContain(path);
    expect(ordersIn(path)).toBe(3);
    expect(ordersIn(legacy)).toBe(3);
    const moved = openDb(path);
    expect(new PosService(moved).verifyLedger()).toEqual([]);
    expect(new PosService(moved).auth.findByPin('1234')?.role).toBe('owner');
    moved.close();
  });

  it('is named, not used, when the standard place already has a database', () => {
    dir = mkdtempSync(join(tmpdir(), 'cactus-home-test-'));
    const legacy = oldTill(2);
    const path = join(dir, 'home', 'data', 'cactus.sqlite');
    openDb(path).close();
    const lines = prepareDb({ path, explicit: false, legacy });
    expect(lines[0]).toContain('2 orders');
    expect(lines.join('\n')).toContain(legacy);
    expect(lines.join('\n')).toContain(path);
    expect(ordersIn(path)).toBe(0); // nothing was merged in
  });

  it('says nothing when there is no old file, when it is empty, or when CACTUS_DB chose the file', () => {
    dir = mkdtempSync(join(tmpdir(), 'cactus-home-test-'));
    const path = join(dir, 'home', 'data', 'cactus.sqlite');
    expect(prepareDb({ path, explicit: false, legacy: null })).toEqual([]);
    expect(existsSync(path)).toBe(false);
    const legacy = oldTill(0);
    openDb(path).close();
    expect(prepareDb({ path, explicit: false, legacy })).toEqual([]);
    expect(prepareDb({ path: legacy, explicit: true, legacy: null })).toEqual([]);
    expect(ordersIn(join(dir, 'missing.sqlite'))).toBeNull();
  });
});
