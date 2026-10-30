# Database (schema version 7)

SQLite, one file. Code: `packages/server/src/db.ts`. Open it only through `openDb()`, which sets the pragmas and runs migrations.

## Migrations
- `PRAGMA user_version` holds the schema version. `MIGRATIONS` in `db.ts` run in order, each in its own transaction; a failure rolls that migration back and stops the program.
- Never edit a shipped migration; add a new one. A database newer than the program is refused.
- v1 `base`: all original tables (`IF NOT EXISTS`, so databases from before migrations existed pass through).
- v2 `ledger-hardening`: `payments` and `requests` tables, the triggers below, and a backfill of payments from order JSON.
- v3 `z-reports`: the `z_reports` table.
- v4 `receipt-design-versions`: the `receipt_templates` table.
- v5 `money-dates`: `orders.paid_date` and `orders.void_date`, filled for existing orders from the payment time and the time of the void event (business time zone), and the trigger that fixes them.
- v6 `drawer-cash-movements`: append-only cash-in/out journal, unique retry keys and reversal links.
- v7 `category-color`: `menu_categories.color`, the colour the owner picked (empty means the next palette colour).
- Pragmas on every connection: WAL, `foreign_keys`, `synchronous = FULL`, `recursive_triggers = ON`, `busy_timeout = 5000`.

## Tables
| Table | Purpose | Mutability |
|---|---|---|
| `orders` | Current state of each order: `id`, `ticket_number`, `receipt_number`, `business_date` (the day it was opened), `paid_date` and `void_date` (the business day the money moved; what day reports go by), `data` (Order JSON), `created_at` | Updatable projection, with limits below. Never deleted. |
| `order_events` | One row per change (`order.created`, `order.paid`, `order.status`, `order.void`). `payload.order` is the **complete order after the change** | Append-only |
| `payments` | One row per payment: amount, tendered, change, tip, reference, receipt number, staff, time | Append-only. The protected record of money taken |
| `z_reports` | Closed days: `number`, `business_date`, `closed_at`, `closed_by`, `data` (ZReport JSON) | Append-only |
| `receipt_templates` | Published receipt and kitchen-ticket designs: `version`, `data`, `created_at`, `staff_id` | Append-only |
| `audit_log` | Owner-side changes (menu, prices, staff, tax, business) | Append-only |
| `counters` | `receipt` (gapless, forever) and `ticket:<date>` (daily) | Only increase; never deleted |
| `requests` | Idempotency keys -> order id | Insert only in practice |
| `menu_*`, `tax_categories`, `staff`, `sessions`, `kv` | Configuration | Freely editable through the admin API |

## Guarantees enforced by triggers (hold for any connection, including tools that skip `openDb`)
- `order_events`, `payments`, `audit_log`, `z_reports`, `receipt_templates`: no UPDATE, no DELETE, and no `INSERT OR REPLACE` over an existing row.
- `orders`: no DELETE; no insert over an existing `id` or an already issued `receipt_number`; `id`, `ticket_number`, `business_date`, `created_at` never change; a `receipt_number`, `paid_date` or `void_date` never changes once set; `data` must stay valid JSON whose `payments` array never shrinks and never has fewer entries than the `payments` table.
- `counters`: values never decrease; rows are never deleted.

## Rebuilding and checking
- `PosService.orderFromEvents(id)` returns the order from its latest event snapshot. It needs nothing from today's menu, prices or tax rates.
- `PosService.verifyLedger()` cross-checks order rows, event snapshots, the payments table and receipt-number continuity; `[]` means consistent. `repairOrder(id)` restores an order row from its last event.
- Events written before v2 carry only a summary (no snapshot); for those orders the `orders` row remains the record and its payments were backfilled into `payments`.

## Writers and contention
- Migration 6 adds append-only `cash_movements` (id, unique request_key, business_date, unique optional
  reverses foreign key, JSON data). Update/delete/replace guards cover the id and every unique key. Entries
  retain positive integer cents, direction, reason, staff id/name and server date/time; reversal is a new row.
  See [cash and settlement](cash-and-settlement.md). No live entries are copied into practice.
- All writes use `BEGIN IMMEDIATE`. A writer waits up to `busy_timeout` for another program, then fails with "database is locked" (HTTP 503, nothing written).
- Receipt numbers are taken inside the payment transaction, so a failed payment never burns a number. Tested with four processes paying concurrently.
- The server itself is a single process; multi-writer support exists for backups and tools, not for running two servers on one file.

## Not covered
- The file itself can still be deleted or replaced on disk. Backups are the answer to that: see `backups.md`.
- Never copy `cactus.sqlite` by hand as a backup while the till runs: recent sales sit in `cactus.sqlite-wal` until SQLite folds them in. The server's backups use `VACUUM INTO`, which writes one complete file.
- No encryption at rest.
