# Drawer journal and settlement review (REL08)

Owner confirmed 2026-10-30: count **all physical cash including opening float** at settlement.

- Owner-only GET `/api/cash/movements?date=YYYY-MM-DD` returns `CashMovement[]` for a business date.
- Owner-only POST `/api/cash/movements` requires an `Idempotency-Key` and `CashMovementBody`: positive
  integer cents, direction `in|out`, required reason. Server stamps the current business date, staff id/name,
  UUID and timestamp. Opening float is a cash-in (record it each morning); top-ups and withdrawals are other
  entries. These are cash transfers, never sales, tips or ABB changes. No arbitrary expense/tax posting.
- Optional `reverses` refers to a movement from today. The new entry must have the exact opposite direction
  and same amount; only one reversal per original, and reversals cannot themselves be reversed. Nothing is
  updated/deleted. A retry returns the original entry; reusing its key with different content returns 409.
- No movement automatically opens hardware or prints. Explicit existing POST `/api/print/drawer` remains
  available when a compatible printer/drawer is configured; practice keeps physical hardware disabled.
- `DayReport.drawer` is optional for stored-report compatibility. It contains cash-in/out totals, movements
  and expected physical cash = existing `cashExpectedCents` + cash-in − cash-out. Existing `cashExpectedCents`
  stays sales cash only so old reports and sales-bookkeeping postings retain their meaning.
- GET `/api/reports/day` adds `revision` (SHA256 of report excluding generation time) and `changedSinceClose`.
  Owner GET `/api/reports/day/orders?date=...` returns orders paid/refunded on that date, plus unpaid orders
  opened that day. The day UI reuses existing append-only `/orders/:id/correct`: original receipt retained,
  replacement receipt issued, payment/items adjusted. Corrections are dated today; historical Z snapshots
  remain fixed. Review/correct from today's settlement, then refresh before closing.
- `CloseDayBody.cashCountBasis` = `drawer` for new UI, omitted/`sales` for legacy clients. Stored Z reports
  retain the basis. `expectedRevision` optionally refuses a stale close with 409 and no Z-number allocation.
  New UI always supplies it, reloading after a mismatch for another review. Stored reports include the drawer
  journal snapshot; subsequent movements/corrections require another numbered close rather than changing it.

Database migration 6: append-only `cash_movements` with unique request key, business date, JSON payload,
unique optional `reverses` foreign key, and update/delete/replace guards. Insert and audit are atomic.
Aggregates are checked against shared money bounds before commit. Practice starts with no live cash entries.
New cash entries are included in backup change detection through their audit records.
