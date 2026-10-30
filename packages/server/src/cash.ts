import { randomUUID } from 'node:crypto';
import { sumCents, type CashMovement, type CashMovementBody, type DrawerSummary } from '@cactus/shared';
import { tx, type DB } from './db.js';
import { HttpError, type PosService } from './service.js';
import type { Staff } from './auth.js';

export class CashJournal {
  constructor(private db: DB, private pos: PosService, private salesCash: () => number) {}
  request(key: string): CashMovement | null {
    const row = this.db.prepare('SELECT data FROM cash_movements WHERE request_key=?').get(key) as { data: string } | undefined;
    return row ? JSON.parse(row.data) as CashMovement : null;
  }
  list(date = this.pos.businessDate()): CashMovement[] {
    return (this.db.prepare('SELECT data FROM cash_movements WHERE business_date=? ORDER BY rowid').all(date) as { data: string }[])
      .map((row) => JSON.parse(row.data) as CashMovement);
  }
  summary(date: string, cashSales: number): DrawerSummary {
    const movements = this.list(date);
    const cashInCents = sumCents(movements.filter((row) => row.direction === 'in').map((row) => row.amountCents));
    const cashOutCents = sumCents(movements.filter((row) => row.direction === 'out').map((row) => row.amountCents));
    return { cashInCents, cashOutCents, expectedCents: sumCents([cashSales, cashInCents, -cashOutCents]), movements };
  }
  add(body: CashMovementBody, by: Staff, key: string): CashMovement {
    return tx(this.db, () => {
      const old = this.db.prepare('SELECT data FROM cash_movements WHERE request_key=?').get(key) as { data: string } | undefined;
      if (old) {
        const prior = JSON.parse(old.data) as CashMovement;
        if (prior.direction !== body.direction || prior.amountCents !== body.amountCents || prior.reason !== body.reason || prior.reverses !== body.reverses) {
          throw new HttpError(409, 'This cash request was already used for a different entry');
        }
        return prior;
      }
      const date = this.pos.businessDate();
      if (body.reverses) {
        const row = this.db.prepare('SELECT data FROM cash_movements WHERE id=?').get(body.reverses) as { data: string } | undefined;
        if (!row) throw new HttpError(404, 'Cash entry not found');
        const original = JSON.parse(row.data) as CashMovement;
        if (original.businessDate !== date || original.reverses || original.direction === body.direction || original.amountCents !== body.amountCents) {
          throw new HttpError(409, 'A reversal must offset an original entry from today with the same amount');
        }
        if (this.db.prepare('SELECT 1 FROM cash_movements WHERE reverses=?').get(body.reverses)) throw new HttpError(409, 'This cash entry has already been reversed');
      }
      const entry: CashMovement = { ...body, id: randomUUID(), businessDate: date, at: new Date().toISOString(), staffId: by.id, staffName: by.name };
      this.db.prepare('INSERT INTO cash_movements(id,request_key,business_date,reverses,data) VALUES(?,?,?,?,?)')
        .run(entry.id, key, date, body.reverses ?? null, JSON.stringify(entry));
      // Validate the resulting drawer totals inside the transaction; overflow rolls everything back.
      this.summary(date, this.salesCash());
      this.db.prepare('INSERT INTO audit_log(type,payload,staff_id,at) VALUES(?,?,?,?)').run('cash.movement', JSON.stringify(entry), by.id, entry.at);
      return entry;
    });
  }
}
