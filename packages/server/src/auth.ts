import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import type { Staff } from '@cactus/shared';
import type { DB } from './db.js';

export type { Staff };

const SESSION_DAYS = 30;
/** The PINs a new database starts with (see seedData.ts). Fine for trying the till out, not for trading. */
export const EXAMPLE_PINS = ['1234', '1111'];

export function hashPin(pin: string): string {
  const salt = randomBytes(16).toString('hex');
  return `s1:${salt}:${scryptSync(pin, salt, 32).toString('hex')}`;
}
export function verifyPin(pin: string, stored: string): boolean {
  const [v, salt, hash] = stored.split(':');
  if (v !== 's1' || !salt || !hash) return false;
  const a = scryptSync(pin, salt, 32);
  const b = Buffer.from(hash, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

/** PINs are stored hashed, sessions survive a server restart (a reboot mid-rush must not log the truck out). */
export class Auth {
  constructor(private db: DB) {
    db.exec('CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, staff_id TEXT NOT NULL, created_at TEXT NOT NULL)');
    // Databases created before PIN hashing hold plain PINs: upgrade them in place.
    const plain = db.prepare("SELECT id, pin FROM staff WHERE pin NOT LIKE 's1:%'").all() as { id: string; pin: string }[];
    for (const r of plain) db.prepare('UPDATE staff SET pin = ? WHERE id = ?').run(hashPin(r.pin), r.id);
  }

  findByPin(pin: string): Staff | null {
    const rows = this.db.prepare('SELECT id, name, role, pin FROM staff WHERE active = 1').all() as unknown as (Staff & { pin: string })[];
    const hit = rows.find((r) => verifyPin(pin, r.pin));
    return hit ? { id: hit.id, name: hit.name, role: hit.role } : null;
  }

  login(pin: string): { token: string; staff: Staff } | null {
    const staff = this.findByPin(pin);
    if (!staff) return null;
    const token = randomUUID() + randomBytes(8).toString('hex');
    this.db.prepare('INSERT INTO sessions(token, staff_id, created_at) VALUES (?,?,?)').run(token, staff.id, new Date().toISOString());
    return { token, staff };
  }

  /** Resolves a token to an active staff member; role changes and deactivation apply immediately. */
  staffFor(token: string | undefined): Staff | null {
    if (!token) return null;
    const cutoff = new Date(Date.now() - SESSION_DAYS * 86400_000).toISOString();
    const r = this.db.prepare(
      'SELECT s.id, s.name, s.role FROM sessions x JOIN staff s ON s.id = x.staff_id WHERE x.token = ? AND s.active = 1 AND x.created_at > ?',
    ).get(token, cutoff) as unknown as Staff | undefined;
    return r ?? null;
  }

  /** Active staff who can still sign in with one of the example PINs. */
  withExamplePin(): Staff[] {
    const rows = this.db.prepare('SELECT id, name, role, pin FROM staff WHERE active = 1 ORDER BY name').all() as unknown as (Staff & { pin: string })[];
    return rows.filter((r) => EXAMPLE_PINS.some((pin) => verifyPin(pin, r.pin))).map((r) => ({ id: r.id, name: r.name, role: r.role }));
  }

  logout(token: string): void { this.db.prepare('DELETE FROM sessions WHERE token = ?').run(token); }
  logoutStaff(staffId: string): void { this.db.prepare('DELETE FROM sessions WHERE staff_id = ?').run(staffId); }
}

/** Slows PIN guessing: 5 wrong tries under one key (an address, a signed-in person) locks it out for 30 seconds. */
export class LoginThrottle {
  private fails = new Map<string, { n: number; until: number }>();
  blocked(key: string, now = Date.now()): boolean { return (this.fails.get(key)?.until ?? 0) > now; }
  fail(key: string, now = Date.now()): void {
    const f = this.fails.get(key) ?? { n: 0, until: 0 };
    f.n += 1;
    if (f.n >= 5) { f.until = now + 30_000; f.n = 0; }
    this.fails.set(key, f);
  }
  ok(key: string): void { this.fails.delete(key); }
}
