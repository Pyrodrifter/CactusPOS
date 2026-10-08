// Test helper: a separate process that pays the given orders, to prove receipt numbering holds
// when several programs write to the same database file. Used by ledger.test.ts only.
import { openDb } from '../db.js';
import { PosService } from '../service.js';

const [, , path, ...ids] = process.argv;
const db = openDb(path!, { busyTimeoutMs: 20_000 });
const svc = new PosService(db);
const staff = { id: 'staff1', name: 'Staff', role: 'staff' as const };
const numbers = ids.map((id) => svc.pay(id, { method: 'cash', tenderedCents: 1000, tipCents: 0 }, staff).receiptNumber);
db.close();
process.stdout.write(JSON.stringify(numbers));
