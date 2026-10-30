import { z } from 'zod';
import { IsoDate, type ZReport } from '@cactus/shared';
import { daysCsv, DEFAULT_ACCOUNTS, journalCsv, type AccountMap } from '@cactus/books-bridge';
import { getKv, setKv, type DB } from './db.js';
import type { PosService } from './service.js';

const Code = z.string().regex(/^[0-9A-Za-z.-]{1,20}$/, 'Account codes are 1-20 letters, digits, dots or dashes');
/** Settings saved by older versions may still hold a `pbkFolder`; parsing drops it. */
export const BooksSettings = z.object({
  accounts: z.object({
    cash: Code, card: Code, abbPayable: Code, tips: Code, overShort: Code,
    revenueByCategory: z.record(z.string(), Code),
    revenueTaxed: Code, revenueExempt: Code, revenueOutsideScope: Code,
  }).default(DEFAULT_ACCOUNTS),
});
export type BooksSettings = z.infer<typeof BooksSettings>;
export const ExportQuery = z.object({ from: IsoDate.optional(), to: IsoDate.optional() });

/** Bookkeeping exports: CSV files any accountant or accounting program can open. */
export class Books {
  constructor(private db: DB, private pos: PosService) {}

  settings(): BooksSettings { return BooksSettings.parse(getKv(this.db, 'books', {})); }
  save(s: BooksSettings): BooksSettings {
    setKv(this.db, 'books', s);
    return s;
  }

  private zReports(from?: string, to?: string): ZReport[] {
    const rows = this.db.prepare('SELECT data FROM z_reports ORDER BY number').all() as { data: string }[];
    return rows.map((r) => JSON.parse(r.data) as ZReport).filter((x) => (!from || x.businessDate >= from) && (!to || x.businessDate <= to));
  }
  private source(): string { return this.pos.business().name.replace(/[^A-Za-z0-9]+/g, '') || 'POS'; }

  daysCsv(from?: string, to?: string): string { return daysCsv(this.zReports(from, to)); }
  journalCsv(from?: string, to?: string): string { return journalCsv(this.zReports(from, to), this.settings().accounts as AccountMap, this.source()); }
}
