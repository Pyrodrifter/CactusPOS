import { randomBytes } from 'node:crypto';
import type { DayBooking } from './journal.js';

/**
 * PyroBookKeeper journal format.
 *
 * PyroBookKeeper keeps its books as append-only JSONL files, one per device, in
 * `<data folder>/journal/<deviceId>.jsonl`, and replays all of them in a deterministic order.
 * The rule that makes that safe is that every device appends only to its own file. The POS
 * therefore acts as one more device: it writes its own file and never touches the others.
 *
 * Written against PyroBookKeeper schema version 1 (`packages/core/src/events/events.ts`).
 * If PyroBookKeeper raises its schema version, review this file before raising the number here.
 */
export const PBK_SCHEMA_VERSION = 1;

export interface PbkEnvelope {
  id: string;
  deviceId: string;
  seq: number;
  at: string;
  schemaVersion: number;
  actor: string;
  event:
    | { type: 'journal.posted'; entry: { id: string; date: string; memo: string; lines: { account: string; amount: number; description: string; contactId: null }[]; source: { kind: 'import'; batch: string }; createdAt: string } }
    | { type: 'journal.reversed'; id: string; reason: string };
}

/** UUIDv7 (time-ordered), the id form PyroBookKeeper uses for every record. */
export function uuidv7(now = Date.now()): string {
  const ts = now.toString(16).padStart(12, '0');
  const rand = randomBytes(10);
  const a = (0x7000 | (((rand[0]! << 8) | rand[1]!) & 0x0fff)).toString(16).padStart(4, '0');
  const b = (0x8000 | (((rand[2]! << 8) | rand[3]!) & 0x3fff)).toString(16).padStart(4, '0');
  return `${ts.slice(0, 8)}-${ts.slice(8, 12)}-${a}-${b}-${rand.subarray(4, 10).toString('hex')}`;
}

export function postedEnvelope(booking: DayBooking, at: string, deviceId: string, seq: number, actor = 'CactusPOS'): PbkEnvelope {
  const now = Date.parse(at);
  return {
    id: uuidv7(now), deviceId, seq, at, schemaVersion: PBK_SCHEMA_VERSION, actor,
    event: {
      type: 'journal.posted',
      entry: {
        id: uuidv7(now), date: booking.date, memo: booking.memo,
        lines: booking.lines.map((l) => ({ account: l.account, amount: l.amountCents, description: l.description, contactId: null })),
        source: { kind: 'import', batch: booking.reference },
        createdAt: at,
      },
    },
  };
}

export function reversedEnvelope(entryId: string, reason: string, at: string, deviceId: string, seq: number, actor = 'CactusPOS'): PbkEnvelope {
  return { id: uuidv7(Date.parse(at)), deviceId, seq, at, schemaVersion: PBK_SCHEMA_VERSION, actor, event: { type: 'journal.reversed', id: entryId, reason } };
}

/** One JSONL line, newline included. */
export const encodeLine = (e: PbkEnvelope) => `${JSON.stringify(e)}\n`;

/** Highest sequence number already in a device's journal text (0 for an empty or missing file). */
export function lastSeq(text: string): number {
  let max = 0;
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try { const seq = (JSON.parse(line) as { seq?: unknown }).seq; if (typeof seq === 'number' && seq > max) max = seq; } catch { /* a half-written line: ignore, PyroBookKeeper does too */ }
  }
  return max;
}
