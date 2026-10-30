import { getKv, setKv, tx, type DB } from './db.js';

/** A new sandbox gets setup, never live sales/counters/sessions/external destinations. */
export function seedPractice(source: DB, target: DB): void {
  if (getKv(target, 'practice.initialized', false)) return;
  tx(target, () => {
    for (const key of ['business', 'service-mode']) {
      const row = source.prepare('SELECT v FROM kv WHERE k = ?').get(key) as { v: string } | undefined;
      if (row) target.prepare('INSERT INTO kv(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v').run(key, row.v);
    }
    for (const table of ['staff', 'tax_categories', 'menu_categories', 'menu_items', 'receipt_templates']) {
      // Table names are fixed source code; values remain bound parameters.
      const rows = source.prepare(`SELECT * FROM ${table}`).all();
      for (const row of rows) {
        const keys = Object.keys(row);
        target.prepare(`INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`).run(...keys.map((key) => row[key]!));
      }
    }
    setKv(target, 'practice.initialized', true);
  });
}
