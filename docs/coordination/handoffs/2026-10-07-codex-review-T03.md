# Independent review: T03 — SQLite foundation
- Agent: codex   Date: 2026-10-07   Branch: master
- Scope: read-only review of schema, initialization/migrations, seed commands, order projection/event persistence, payment retention and receipt counter. Only this report was added; no implementation, BOARD or running development service was changed.
- Reviewed implementation: started at `5c3239c`; current HEAD at report time `792c2ac` (concurrent BOARD work). Relevant source fingerprints below establish the implementation tested.
- Verdict: **keep T03 in review; it does not meet Done when yet. T27's dependency must not be marked done on this evidence.** Seeding and transactional numbering work, but order/event replacement bypasses retention, payments have no protected durable record, migrations are unimplemented, and checked-in tests do not exercise concurrency.

## Acceptance evidence

| Requirement | Finding |
|---|---|
| `npm run seed` builds a database with sample menu | Pass. Ran root command with `CACTUS_DB` set explicitly to a fresh OS temporary path. Created WAL database with 8 sample items, 3 menu categories, staff and Cactus Blue business details. Also ran `npm run seed -- cactus-blue` against a separate temporary database; command loaded 15 profile items. |
| SQLite schema + migrations | Partial. Tables/indexes/triggers exist and reopen succeeds. `openDb` only executes `CREATE ... IF NOT EXISTS`; no versioned migration runner/history or schema upgrade path exists. Temporary DB reports `PRAGMA user_version = 0`. Auth/admin initialize further tables in their constructors. |
| Append-only `order_events` | Fail. Ordinary UPDATE/DELETE are blocked, but `INSERT OR REPLACE` with an existing sequence rewrites its row on the default connection. |
| No order/payment row can be deleted | Fail. Plain order DELETE is blocked, but REPLACE on a conflicting receipt number deleted the original order. Payments exist only in mutable `orders.data`; direct JSON update removed the payment while leaving a paid event. |
| Projections | Partial. Normal service mutations atomically write current order JSON plus an event. The audit payload lacks the historical order/payment/receipt values needed to rebuild authoritative state after projection corruption; no replay implementation/test exists. |
| Gapless numbers under concurrency and rollback | Allocation safety demonstrated in review harness: successful payments persisted numbers 1–10 exactly once; failure injected after allocation rolled back the counter, projection and event. Eight independent connections contended; seven of eight immediately failed after release, then harness retries completed all writes. Checked-in test only makes two sequential payment calls. |

## Blocking findings and concrete reproduction

### 1. Replacement operations bypass the deletion/event protections

`packages/server/src/db.ts:24–37` guards ordinary DELETE/UPDATE. `openDb` at line 43 does not enable recursive triggers; the tested connection returned `PRAGMA recursive_triggers = 0`. SQLite REPLACE's implicit deletion therefore did not invoke these DELETE triggers.

Using only fake orders in the isolated DB:

```sql
-- Copy the columns of a paid order, use another id but the same receipt number:
INSERT OR REPLACE INTO orders
  (id, ticket_number, receipt_number, business_date, data, created_at)
VALUES ('replacement', ?, ?, ?, ?, ?);
-- Original order id now has zero rows.

-- Copy an existing event's seq/order/staff/time, replacing its type/payload:
INSERT OR REPLACE INTO order_events
  (seq, order_id, type, payload, staff_id, at)
VALUES (?, ?, 'rewritten', '{}', ?, ?);
-- Original order.paid event becomes rewritten at the same sequence.
```

Both succeeded. These destructive probes were deliberately rolled back, so the temporary DB retained its original review fixtures. This is a database guarantee failure rather than an assertion that the current HTTP routes expose arbitrary SQL.

Required: protect conflicting inserts/replacements as well as direct deletes/updates and add regression tests using actual SQLite. Ensure the protection remains compatible with the legitimate projection upsert in `service.ts:61–66`; simply making the projection wholly immutable would break status/payment updates. Validate the intended connection pragmas for every supported opener.

### 2. Payment history can be erased from the only complete record

`service.ts:124–130` embeds payments in the mutable order JSON, then stores a summary event. No `payments` table or equivalent complete append-only payment record exists. This statement succeeded on the temporary paid order:

```sql
UPDATE orders SET data = json_set(data, '$.payments', json('[]')) WHERE id = ?;
```

The returned projection had zero payments while one `order.paid` event remained. For the review's fake card payment, its event payload was only `{"method":"card","tip":25}`. The payment id, amount (1400 cents), card reference, payment timestamp and receipt number were absent. The creation event contained only requested item ids, quantities and modifier ids; charged names/prices/tax snapshots and ticket number were absent. Repricing from the current menu cannot recover the original sale after menu/tax changes.

Required: provide durable, complete append-only payment/order history with appropriate schemas and coordinated contract documentation. A dedicated protected payment table or complete immutable authoritative events are implementation choices for the server/shared owners. Tests must prove a projection rewrite cannot destroy financial history and that a historical sale remains recoverable without consulting today's menu/prices. Projection mutability itself is expected; loss of the only complete payment record is the defect.

### 3. Schema upgrades and permanent concurrency evidence are missing

The T03 title explicitly includes migrations, but `db.ts:40–44` reruns one static creation string. There is no schema-version tracking, ordered migration runner or upgrade fixture/test. `CREATE TABLE IF NOT EXISTS` does not add missing columns to an older table. Required: a transactional, versioned initialization/upgrade mechanism, documented DB shape, and tests covering a fresh DB, repeated initialization and upgrade of a populated earlier schema without losing records.

The checked-in receipt test (`service.test.ts:25`) pays two orders sequentially on one in-memory connection. The deletion test at line 46 checks no payment mutation or replacement case. Required: checked-in real SQLite tests for independent connections/processes, persisted uniqueness/sequential numbers and rollback after counter allocation, alongside the retention regressions above.

## Numbering verification and contention limitation

- Injected a temporary BEFORE INSERT event trigger that aborted only `order.paid`. Since `pay` first allocates the receipt and saves the projection, this fails after allocation rather than merely rejecting insufficient cash before allocation.
- Counter remained 1, failed order remained unpaid with zero payments, and event count remained unchanged. Removed the temporary trigger, retried normally, and received receipt 2. This demonstrates atomic rollback in the current `BEGIN IMMEDIATE` transaction.
- Prepared 8 fake unpaid orders and 8 Node processes, each opening the same file with the actual `openDb` and `PosService`. Held a separate write transaction and attempted all payments: all 8 returned `database is locked`, with no committed allocation.
- After releasing the lock, released all 8 writers together: 1 succeeded with receipt 3; 7 returned `database is locked`. The review harness retried remaining failures in 7 rounds. Final receipts were exactly `[1,2,3,4,5,6,7,8,9,10]`, counter 10, no unpaid contender left.
- `PRAGMA busy_timeout` was 0. Production code has no lock wait/retry. The harness retry is review machinery, **not implemented product behavior**. The single-process synchronous server serializes ordinary HTTP DB calls, so this finding specifically describes multiple SQLite writers, such as a separate service/tool, rather than proving normal eight-browser requests fail. Decide and document supported contention behavior; no number gaps were observed among committed payments.
- Closed worker connections normally, reopened the database, counted 10 orders/10 paid receipts, and obtained `PRAGMA integrity_check = ok`.

## Commands, artifacts and limits

Repo checks passed: `npm run typecheck` (all six workspaces) and `npm test` (3 files, 51 tests; 19 server tests). Passing existing checks does not prove the missing cases.

All seed and SQLite probes used newly created files under:

`C:\Users\Pyro\AppData\Local\Temp\CactusPOS-T03-review-3001f3fb7b6c40bc95b8db3cd12acb03`

The directory retains `worker.mjs`, `review.mjs`, `results.json`, `seed.sqlite`, `verify.sqlite` and `profile.sqlite` for inspection. The final successful verification used `verify.sqlite`. Exact invocation from the repo was `node --import tsx '<temporary directory>\review.mjs' '<temporary directory>'`; the harness expects a freshly seeded `verify.sqlite` for repeat execution. Destructive probes run inside intentional rollback transactions. `seed.sqlite` was from an initial harness run that killed workers before reopening; its immediate reopen hit a Windows disk I/O error. The harness was corrected to await graceful worker close and rerun from a freshly seeded `verify.sqlite`, which passed reopen/integrity checks. This initial harness lifecycle error is not reported as a product defect.

No real/local application database was opened, seeded, copied or deleted, and no live HTTP server was contacted or stopped. No tax/business rule was inferred. This report evaluates the implementation read today; concurrent server changes require a new check if they modify these files.

Source SHA256 at report time:

- `packages/server/src/db.ts`: `488F73F121BE82F30DEE37ABB7AF74ADCF2E969D90EF0A0B346A27D376491651`
- `packages/server/src/service.ts`: `9C470F5543B50C787D999E10F6B2F224F33A93CF1AD8380243662DC526C668DB`
- `packages/server/src/service.test.ts`: `01788A7584076CB8B0334C3BF7A524E123219BA45AC6CA97310762EB679D135A`

## Contracts touched / handoff

None. Review report only. Server/shared owners should fix and document persistence guarantees, add migration/retention/concurrency/rollback tests, rerun repo checks and request a fresh independent review. Leave T03 in `review`; T27 may be prepared independently but its BOARD dependency is not satisfied yet.
