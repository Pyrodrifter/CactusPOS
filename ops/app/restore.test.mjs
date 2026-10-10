import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { inspectDatabase, listBackups, restoreBackup } from './restore.mjs';

let dir;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'cactus-restore-test-')); });
afterEach(() => { try { rmSync(dir, { recursive: true, force: true }); } catch { /* Windows may hold a file for a moment */ } });

/** A database with the two tables the restore looks at, holding `orders` orders. */
function till(file, orders) {
  mkdirSync(join(file, '..'), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('CREATE TABLE orders (id TEXT PRIMARY KEY, receipt_number INTEGER); CREATE TABLE order_events (seq INTEGER PRIMARY KEY, at TEXT);');
  for (let i = 1; i <= orders; i++) {
    db.prepare('INSERT INTO orders VALUES (?, ?)').run(`o${i}`, i);
    db.prepare('INSERT INTO order_events(at) VALUES (?)').run(`2026-10-0${i}T12:00:00.000Z`);
  }
  db.close();
  return file;
}

describe('listBackups', () => {
  it('lists backup files newest first and nothing else', () => {
    const backups = join(dir, 'backups');
    mkdirSync(backups);
    for (const name of ['cactus-20261009-220000.sqlite', 'cactus-20261010-130509.sqlite', 'cactus-20261010-090000.sqlite', 'cactus.sqlite', 'notes.txt', 'cactus-20261010-130509.sqlite-wal']) writeFileSync(join(backups, name), '');
    expect(listBackups(backups).map((b) => b.name)).toEqual(['cactus-20261010-130509.sqlite', 'cactus-20261010-090000.sqlite', 'cactus-20261009-220000.sqlite']);
    expect(listBackups(backups)[0]).toMatchObject({ at: '2026-10-10T13:05:09.000Z', path: join(backups, 'cactus-20261010-130509.sqlite') });
    expect(listBackups(join(dir, 'missing'))).toEqual([]);
  });
});

describe('inspectDatabase', () => {
  it('says what a backup holds without changing it', async () => {
    const file = till(join(dir, 'cactus-20261010-130509.sqlite'), 3);
    const before = readFileSync(file);
    expect(await inspectDatabase(file)).toEqual({ file, orders: 3, lastReceipt: 3, lastChange: '2026-10-03T12:00:00.000Z' });
    expect(readFileSync(file).equals(before)).toBe(true);
    expect(readdirSync(dir)).toEqual(['cactus-20261010-130509.sqlite']); // no -wal or -shm left beside it
  });
  it('refuses a missing file, another program\'s database and a file that is no database', async () => {
    await expect(inspectDatabase(join(dir, 'nope.sqlite'))).rejects.toThrow(/There is no file/);
    const other = join(dir, 'other.sqlite');
    const db = new DatabaseSync(other);
    db.exec('CREATE TABLE notes (text TEXT)');
    db.close();
    await expect(inspectDatabase(other)).rejects.toThrow(/not a CactusPOS database/);
    const junk = join(dir, 'junk.sqlite');
    writeFileSync(junk, 'this is a text file, not a database, but long enough to be read as one page of something');
    await expect(inspectDatabase(junk)).rejects.toThrow(/not a CactusPOS database|cannot be opened/);
  });
});

describe('restoreBackup', () => {
  it('puts the backup in place and keeps what it replaced, with its companion files', async () => {
    const dbPath = till(join(dir, 'data', 'cactus.sqlite'), 5);
    writeFileSync(`${dbPath}-wal`, 'wal');
    writeFileSync(`${dbPath}-shm`, 'shm');
    const backup = till(join(dir, 'data', 'backups', 'cactus-20261009-220000.sqlite'), 2);
    const { aside } = restoreBackup({ dbPath, backupFile: backup, now: new Date('2026-10-10T14:00:05Z') });
    expect(aside).toBe(join(dir, 'data', 'replaced-20261010-140005'));
    expect(readdirSync(aside).sort()).toEqual(['cactus.sqlite', 'cactus.sqlite-shm', 'cactus.sqlite-wal']);
    expect((await inspectDatabase(join(aside, 'cactus.sqlite'))).orders).toBe(5);
    expect((await inspectDatabase(dbPath)).orders).toBe(2);
    expect(existsSync(`${dbPath}-wal`)).toBe(false); // the old journal must not be replayed into the restored file
    expect(existsSync(backup)).toBe(true);
  });
  it('works on a computer that has no database yet', async () => {
    const backup = till(join(dir, 'usb', 'cactus-20261009-220000.sqlite'), 4);
    const dbPath = join(dir, 'fresh', 'data', 'cactus.sqlite');
    expect(restoreBackup({ dbPath, backupFile: backup })).toEqual({ aside: null });
    expect((await inspectDatabase(dbPath)).orders).toBe(4);
  });
  it('changes nothing when the backup is missing or is the live database itself', async () => {
    const dbPath = till(join(dir, 'data', 'cactus.sqlite'), 5);
    expect(() => restoreBackup({ dbPath, backupFile: join(dir, 'gone.sqlite') })).toThrow(/There is no file/);
    expect(() => restoreBackup({ dbPath, backupFile: dbPath })).toThrow(/not a backup/);
    expect((await inspectDatabase(dbPath)).orders).toBe(5);
    expect(readdirSync(join(dir, 'data'))).toEqual(['cactus.sqlite']);
  });
});
