// Putting a backup back. Used by `launch.mjs --restore`; the steps for people are in ops/install.md ("Backups").
// The backups themselves are made by the server (packages/server/src/backup.ts), which also names the files.
import { copyFileSync, existsSync, mkdirSync, readdirSync, renameSync, statSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';

const NAME = /^cactus-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})\.sqlite$/;
const two = (n) => String(n).padStart(2, '0');

/** Backup files in a folder, newest first. Other files are ignored. */
export function listBackups(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((name) => NAME.test(name)).sort().reverse().map((name) => {
    const m = NAME.exec(name);
    return { name, path: join(dir, name), at: `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}.000Z` };
  });
}

/** Opens a database file without changing it and says what is in it. Throws a plain message when it is not a usable till database. */
export async function inspectDatabase(file) {
  if (!existsSync(file) || !statSync(file).isFile()) throw new Error(`There is no file ${file}`);
  const { DatabaseSync } = await import('node:sqlite');
  let db;
  try { db = new DatabaseSync(file, { readOnly: true }); } catch (e) { throw new Error(`${file} cannot be opened as a database (${e.message}).`, { cause: e }); }
  try {
    const check = db.prepare('PRAGMA integrity_check').get().integrity_check;
    if (check !== 'ok') throw new Error(`${file} is damaged (${check}). Choose another backup.`);
    const one = (sql) => db.prepare(sql).get().n;
    return {
      file,
      orders: one('SELECT COUNT(*) AS n FROM orders') ?? 0,
      lastReceipt: one('SELECT MAX(receipt_number) AS n FROM orders') ?? 0,
      lastChange: one('SELECT MAX(at) AS n FROM order_events') ?? null,
    };
  } catch (e) {
    if (/no such table|not a database|file is not/i.test(e.message)) throw new Error(`${file} is not a CactusPOS database.`, { cause: e });
    throw e;
  } finally { db.close(); }
}

/**
 * Replaces the till's database with a backup. The server must be stopped.
 * The database being replaced is moved, never deleted: it goes to `<data folder>/replaced-<time>/` with its
 * `-wal` and `-shm` files, so the step can be undone by hand. Returns that folder (null when there was nothing).
 */
export function restoreBackup({ dbPath, backupFile, now = new Date() }) {
  if (resolve(dbPath) === resolve(backupFile)) throw new Error('That file is the database in use, not a backup.');
  if (!existsSync(backupFile)) throw new Error(`There is no file ${backupFile}`);
  const dataDir = dirname(dbPath);
  mkdirSync(dataDir, { recursive: true });
  const live = [dbPath, `${dbPath}-wal`, `${dbPath}-shm`].filter((file) => existsSync(file));
  let aside = null;
  if (live.length) {
    const stamp = `${now.getUTCFullYear()}${two(now.getUTCMonth() + 1)}${two(now.getUTCDate())}-${two(now.getUTCHours())}${two(now.getUTCMinutes())}${two(now.getUTCSeconds())}`;
    aside = join(dataDir, `replaced-${stamp}`);
    mkdirSync(aside); // fails rather than mixing two replaced databases in one folder
    for (const file of live) renameSync(file, join(aside, basename(file)));
  }
  try {
    copyFileSync(backupFile, dbPath);
  } catch (e) {
    // Rather the old data back than a till without a database.
    if (aside) for (const file of live) renameSync(join(aside, basename(file)), file);
    throw e;
  }
  return { aside };
}
