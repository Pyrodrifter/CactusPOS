import { appendFileSync, existsSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import { IsoDate, type ZReport } from '@cactus/shared';
import {
  dayBooking, daysCsv, DEFAULT_ACCOUNTS, encodeLine, journalCsv, lastSeq, latestPerDay, postedEnvelope, reversedEnvelope, uuidv7,
  type AccountMap, type PbkEnvelope,
} from '@cactus/books-bridge';
import { getKv, setKv, type DB } from './db.js';
import { HttpError, type PosService } from './service.js';

const Code = z.string().regex(/^[0-9A-Za-z.-]{1,20}$/, 'Account codes are 1-20 letters, digits, dots or dashes');
export const BooksSettings = z.object({
  /** PyroBookKeeper data folder on this computer. Empty = the link is off. */
  pbkFolder: z.string().max(400).default(''),
  accounts: z.object({
    cash: Code, card: Code, abbPayable: Code, tips: Code, overShort: Code,
    revenueByCategory: z.record(z.string(), Code),
    revenueTaxed: Code, revenueExempt: Code, revenueOutsideScope: Code,
  }).default(DEFAULT_ACCOUNTS),
});
export type BooksSettings = z.infer<typeof BooksSettings>;
export const ExportQuery = z.object({ from: IsoDate.optional(), to: IsoDate.optional() });

export interface PbkStatus {
  configured: boolean;
  /** Folder exists and looks like a PyroBookKeeper data folder. */
  ok: boolean;
  problem?: string;
  postedDays: number;
  /** Closed days not yet in PyroBookKeeper, or closed again since they were posted. */
  pendingDays: string[];
}

/** Bookkeeping exports: CSV for anyone, and an optional link that posts closed days into PyroBookKeeper. */
export class Books {
  constructor(private db: DB, private pos: PosService) {}

  settings(): BooksSettings { return BooksSettings.parse(getKv(this.db, 'books', {})); }
  save(s: BooksSettings): BooksSettings {
    const clean = { ...s, pbkFolder: s.pbkFolder.trim() };
    if (clean.pbkFolder) this.checkFolder(clean.pbkFolder);
    setKv(this.db, 'books', clean);
    return clean;
  }

  private zReports(from?: string, to?: string): ZReport[] {
    const rows = this.db.prepare('SELECT data FROM z_reports ORDER BY number').all() as { data: string }[];
    return rows.map((r) => JSON.parse(r.data) as ZReport).filter((x) => (!from || x.businessDate >= from) && (!to || x.businessDate <= to));
  }
  private source(): string { return this.pos.business().name.replace(/[^A-Za-z0-9]+/g, '') || 'POS'; }

  daysCsv(from?: string, to?: string): string { return daysCsv(this.zReports(from, to)); }
  journalCsv(from?: string, to?: string): string { return journalCsv(this.zReports(from, to), this.settings().accounts as AccountMap, this.source()); }

  /* ----- PyroBookKeeper ----- */
  /** Refuses anything that is not an existing PyroBookKeeper data folder, so a typo cannot scatter files around the disk. */
  private checkFolder(folder: string): string {
    const root = resolve(folder);
    if (!existsSync(root) || !statSync(root).isDirectory()) throw new HttpError(400, 'That folder does not exist on the till computer');
    const journal = join(root, 'journal');
    if (!existsSync(journal) || !statSync(journal).isDirectory()) {
      throw new HttpError(400, 'That is not a PyroBookKeeper data folder (it has no "journal" folder). Open PyroBookKeeper once and pick its data folder.');
    }
    return journal;
  }
  private deviceId(): string {
    let id = getKv<string>(this.db, 'books.pbkDeviceId', '');
    if (!id) { id = uuidv7(); setKv(this.db, 'books.pbkDeviceId', id); }
    return id;
  }

  /** What this till has already written, read back from its own journal file: the file is the truth. */
  private written(file: string): { text: string; active: Map<string, { entryId: string; date: string }> } {
    const text = existsSync(file) ? readFileSync(file, 'utf8') : '';
    const active = new Map<string, { entryId: string; date: string }>();
    const byEntry = new Map<string, string>();
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      let e: PbkEnvelope;
      try { e = JSON.parse(line) as PbkEnvelope; } catch { continue; }
      if (e.event?.type === 'journal.posted') {
        active.set(e.event.entry.source.batch, { entryId: e.event.entry.id, date: e.event.entry.date });
        byEntry.set(e.event.entry.id, e.event.entry.source.batch);
      } else if (e.event?.type === 'journal.reversed') {
        const batch = byEntry.get(e.event.id);
        if (batch) active.delete(batch);
      }
    }
    return { text, active };
  }

  private plan(file: string) {
    const { text, active } = this.written(file);
    const source = this.source();
    const days = latestPerDay(this.zReports());
    const accounts = this.settings().accounts as AccountMap;
    const todo: { z: ZReport; reverse: { entryId: string; batch: string }[] }[] = [];
    for (const zr of days) {
      const booking = dayBooking(zr, accounts, source);
      if (active.has(booking.reference)) continue;
      // An earlier close of the same day was posted: take it out before the new figures go in.
      const reverse = [...active.entries()].filter(([, v]) => v.date === zr.businessDate).map(([batch, v]) => ({ entryId: v.entryId, batch }));
      todo.push({ z: zr, reverse });
    }
    return { text, active, todo, source, accounts };
  }

  status(): PbkStatus {
    const folder = this.settings().pbkFolder;
    if (!folder) return { configured: false, ok: false, postedDays: 0, pendingDays: [] };
    try {
      const journal = this.checkFolder(folder);
      const { active, todo } = this.plan(join(journal, `${this.deviceId()}.jsonl`));
      return { configured: true, ok: true, postedDays: active.size, pendingDays: todo.map((t) => t.z.businessDate) };
    } catch (e) {
      return { configured: true, ok: false, problem: e instanceof Error ? e.message : String(e), postedDays: 0, pendingDays: [] };
    }
  }

  /**
   * Appends every closed day that PyroBookKeeper does not have yet to this till's own journal file.
   * Safe to run again at any time: days already there are skipped, and a day that was closed again
   * is reversed and re-posted rather than doubled.
   */
  postToPbk(): { posted: number; reversed: number; file: string } {
    const folder = this.settings().pbkFolder;
    if (!folder) throw new HttpError(409, 'Choose the PyroBookKeeper data folder first');
    const journal = this.checkFolder(folder);
    const deviceId = this.deviceId();
    const file = join(journal, `${deviceId}.jsonl`);
    const { text, todo, source, accounts } = this.plan(file);
    let seq = lastSeq(text);
    let out = text && !text.endsWith('\n') ? '\n' : '';
    let reversed = 0;
    const at = new Date().toISOString();
    for (const t of todo) {
      for (const r of t.reverse) {
        out += encodeLine(reversedEnvelope(r.entryId, `Day closed again as Z report #${t.z.number}`, at, deviceId, ++seq, source));
        reversed += 1;
      }
      out += encodeLine(postedEnvelope(dayBooking(t.z, accounts, source), at, deviceId, ++seq, source));
    }
    if (todo.length) appendFileSync(file, out, 'utf8'); // one write: all of this run's lines or none
    return { posted: todo.length, reversed, file };
  }
}
