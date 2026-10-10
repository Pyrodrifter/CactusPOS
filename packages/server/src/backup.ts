import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import { getKv, setKv, type DB } from './db.js';
import { HttpError } from './service.js';

export const BackupSettings = z.object({
  /** A second place every backup is copied to: a USB stick, or a folder a cloud program keeps in sync. Empty = none. */
  folder: z.string().max(400).default(''),
});
export type BackupSettings = z.infer<typeof BackupSettings>;

export interface BackupFile { name: string; at: string; bytes: number }
export interface BackupRun {
  name: string; at: string; orders: number; lastReceipt: number;
  /** Also written to the second folder. False when none is set or it could not be reached. */
  copied: boolean;
}
export interface BackupState {
  /** False when this database has no backup folder (an in-memory test database). */
  enabled: boolean;
  /** Where the backups are kept on the till computer. */
  folder: string;
  settings: BackupSettings;
  /** Newest first. */
  files: BackupFile[];
  last: BackupRun | null;
  /** Why the latest attempt, or the copy to the second folder, did not work. */
  problem: string | null;
}

interface Status { last: (BackupRun & { fingerprint: string }) | null; problem: string | null }

const NAME = /^cactus-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})\.sqlite$/;
const two = (n: number) => String(n).padStart(2, '0');

/** `cactus-20261010-131500.sqlite` (UTC), so names sort by time. */
export function backupName(at: Date): string {
  return `cactus-${at.getUTCFullYear()}${two(at.getUTCMonth() + 1)}${two(at.getUTCDate())}-${two(at.getUTCHours())}${two(at.getUTCMinutes())}${two(at.getUTCSeconds())}.sqlite`;
}
/** The moment a backup file was made, read from its name. Null for any other file. */
export function backupTime(name: string): string | null {
  const m = NAME.exec(name);
  return m ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}.000Z` : null;
}

/**
 * Which backup files to keep: the newest `recent` whatever their age, and the last one of each day for
 * `days` days. Everything else among our own files may go. Files with other names are never listed.
 */
export function backupsToRemove(names: readonly string[], now: Date, recent = 30, days = 90): string[] {
  const ours = names.filter((n) => NAME.test(n)).sort().reverse();
  const keep = new Set(ours.slice(0, recent));
  const oldest = new Date(now.getTime() - days * 86400_000).toISOString().slice(0, 10);
  const seenDay = new Set<string>();
  for (const name of ours) {
    const day = backupTime(name)!.slice(0, 10);
    if (day >= oldest && !seenDay.has(day)) { seenDay.add(day); keep.add(name); }
  }
  return ours.filter((n) => !keep.has(n));
}

/**
 * Copies of the whole database, made while the till keeps running.
 *
 * A copy is written with SQLite's `VACUUM INTO`, which gives one complete, consistent file. Copying
 * `cactus.sqlite` by hand does not: recent sales sit in the `-wal` file beside it until SQLite folds them in.
 * Each copy is opened and checked before it counts. A backup is made when the till starts, after a day is
 * closed and every half hour, but only when something changed since the last one.
 */
export class Backups {
  private timer: ReturnType<typeof setInterval> | undefined;
  /** `dir` null = backups off (in-memory databases in tests). */
  constructor(private db: DB, private dir: string | null) {}

  settings(): BackupSettings { return BackupSettings.parse(getKv(this.db, 'backup', {})); }
  save(s: BackupSettings): BackupSettings {
    const clean = { folder: s.folder.trim() };
    if (clean.folder) {
      const root = resolve(clean.folder);
      if (!existsSync(root) || !statSync(root).isDirectory()) throw new HttpError(400, 'That folder does not exist on the till computer');
      if (this.dir && root === resolve(this.dir)) throw new HttpError(400, 'That is the folder the backups are already in. Choose another place, such as a USB stick.');
    }
    setKv(this.db, 'backup', clean);
    return clean;
  }

  private status(): Status { return getKv<Status>(this.db, 'backup.status', { last: null, problem: null }); }

  /** Changes with every sale, payment, void, menu or settings change, day close and receipt design. */
  private fingerprint(): string {
    const max = (sql: string) => (this.db.prepare(sql).get() as { n: number | null }).n ?? 0;
    return [
      max('SELECT MAX(seq) AS n FROM order_events'), max('SELECT MAX(seq) AS n FROM audit_log'),
      max('SELECT MAX(number) AS n FROM z_reports'), max('SELECT MAX(version) AS n FROM receipt_templates'),
    ].join(':');
  }

  private list(dir: string): BackupFile[] {
    if (!existsSync(dir)) return [];
    return readdirSync(dir).filter((n) => NAME.test(n)).sort().reverse()
      .map((name) => ({ name, at: backupTime(name)!, bytes: statSync(join(dir, name)).size }));
  }

  state(): BackupState {
    const { last, problem } = this.status();
    return {
      enabled: this.dir !== null, folder: this.dir ?? '', settings: this.settings(),
      files: this.dir ? this.list(this.dir).slice(0, 30) : [],
      last: last ? { name: last.name, at: last.at, orders: last.orders, lastReceipt: last.lastReceipt, copied: last.copied } : null,
      problem,
    };
  }

  /** Makes a backup now. Throws with a plain message when it cannot; the till itself is never affected. */
  run(): BackupRun {
    if (!this.dir) throw new HttpError(409, 'Backups are not available for this database');
    const dir = this.dir;
    const fingerprint = this.fingerprint();
    // Two backups within one second: the later one takes the next free second, so names still sort by time.
    let at = new Date();
    while (existsSync(join(dir, backupName(at)))) at = new Date(at.getTime() + 1000);
    const name = backupName(at);
    const file = join(dir, name);
    let held: { orders: number; lastReceipt: number };
    try {
      mkdirSync(dir, { recursive: true });
      this.db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
      held = this.readBack(file);
    } catch (e) {
      try { if (existsSync(file)) unlinkSync(file); } catch { /* leave it; it is not listed as good */ }
      const problem = `The backup could not be made: ${e instanceof Error ? e.message : String(e)}`;
      setKv(this.db, 'backup.status', { ...this.status(), problem });
      throw new HttpError(500, problem);
    }

    // The second copy is a bonus: an unplugged USB stick must not make the first one fail.
    let copied = false, problem: string | null = null;
    const second = this.settings().folder;
    if (second) {
      try {
        if (!existsSync(second) || !statSync(second).isDirectory()) throw new Error('the folder is not there (is the USB stick plugged in?)');
        copyFileSync(file, join(second, name));
        copied = true;
        this.prune(second, at);
      } catch (e) { problem = `Saved on this computer, but not in ${second}: ${e instanceof Error ? e.message : String(e)}`; }
    }
    this.prune(dir, at);
    const run: BackupRun = { name, at: at.toISOString(), orders: held.orders, lastReceipt: held.lastReceipt, copied };
    setKv(this.db, 'backup.status', { last: { ...run, fingerprint }, problem } satisfies Status);
    return run;
  }

  /** A backup only counts once it has been read back: whole, and holding as many orders as the till has. */
  private readBack(file: string): { orders: number; lastReceipt: number } {
    const count = (sql: string, from: DatabaseSync) => (from.prepare(sql).get() as { n: number | null }).n ?? 0;
    const copy = new DatabaseSync(file, { readOnly: true });
    try {
      const check = (copy.prepare('PRAGMA integrity_check').get() as { integrity_check: string }).integrity_check;
      if (check !== 'ok') throw new Error(`the copy did not pass its check (${check})`);
      const orders = count('SELECT COUNT(*) AS n FROM orders', copy);
      if (orders !== count('SELECT COUNT(*) AS n FROM orders', this.db)) throw new Error('the copy does not hold every order');
      return { orders, lastReceipt: count('SELECT MAX(receipt_number) AS n FROM orders', copy) };
    } finally { copy.close(); }
  }

  private prune(dir: string, now: Date): void {
    try { for (const name of backupsToRemove(readdirSync(dir), now)) unlinkSync(join(dir, name)); } catch { /* tidying up can wait for the next run */ }
  }

  /** Backs up when something changed since the last good backup, or that file is gone. Never throws. */
  runIfChanged(): BackupRun | null {
    if (!this.dir) return null;
    try {
      const { last } = this.status();
      if (last && last.fingerprint === this.fingerprint() && existsSync(join(this.dir, last.name))) return null;
      return this.run();
    } catch (e) {
      console.error(`[${new Date().toISOString()}] backup failed:`, e instanceof Error ? e.message : e);
      return null;
    }
  }

  /** One backup now if needed, then a check every `everyMs`. */
  start(everyMs = 30 * 60_000): void {
    if (!this.dir || this.timer) return;
    this.runIfChanged();
    this.timer = setInterval(() => this.runIfChanged(), everyMs);
    this.timer.unref();
  }
  stop(): void { clearInterval(this.timer); this.timer = undefined; }
}
