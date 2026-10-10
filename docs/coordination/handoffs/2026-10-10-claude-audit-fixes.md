# Handoff: A01–A09 and T27 — fixes from the app audit, and backups
- Agent: claude   Date: 2026-10-10   Branch: agent/claude/audit-fixes

Owner request ("fix them all"), after the audit in [2026-10-10-claude-app-audit.md](2026-10-10-claude-app-audit.md).
Q11 was answered: a sale or refund belongs to the day the money moved. The owner also said PIN protection matters
little (two people use the till) and that this PC is for testing only, so A02 and A06 were kept small.
One branch for all ten tasks, because they touch the same few files; one commit per layer.

## What changed
| Task | Change | Where |
|---|---|---|
| A01 | A sale counts on the day it was **paid**, a refund on the day the paid order was **voided**. Orders record `paidDate`, `voidedAt`, `voidDate`; the row has `paid_date`, `void_date` (migration 5, backfilled, fixed once set). A same-day refund still nets to nothing; a refund of an earlier day comes off that day's sales, ABB and tenders (figures can be negative) and is named in `refundedEarlier`. Printed report and Admin → Today say so. "Today's orders" includes an older tab paid today | `server/reports.ts`, `service.ts`, `db.ts`, `shared/reports.ts`, `domain.ts`, `receipt/dayReport.ts`, `ReportsAdmin.tsx` |
| A02 | Five wrong manager PINs on a void lock that person's guesses for 30 s (`429`); each refusal is in the audit log | `server/app.ts` |
| A03 | `PayBody.expectedTotalCents`: the till sends the total on the pay sheet; the server answers `409` when the order changed, the sheet reloads the order and shows the new total | `domain.ts`, `service.ts`, `Pos.tsx` |
| A04 | Server repeats `hello` every 15 s and pings every connection (drops one that did not answer). Screens treat 40 s of silence as dead, reconnect and reload. Every request has a 12 s limit; the cart and retry key are kept. A send error now survives a screen change | `server/app.ts`, `web/lib/liveSocket.ts` (new), `live.ts`, `api.ts`, `Pos.tsx` |
| A05 | The server opens the installed app's database however it is started; `CACTUS_DB` still names another file and `npm run dev` sets it to the checkout's own. A database from an earlier hand-started run is copied over once; when both exist the server names both and uses the standard one | `server/dataHome.ts` (new), `main.ts`, `seed.ts`, `scripts/dev.mjs` |
| A06 | Admin's first page shows one line while 1234 or 1111 still works | `auth.ts`, `app.ts`, `Admin.tsx` |
| A07 | Kitchen and pickup lists keep unfinished work from an earlier day for 16 hours (midnight no longer empties the boards; an older tab that orders again is a fresh ticket). `500` replies carry one fixed sentence, the cause goes to the server log. Audit rows for printer and bookkeeping settings. The three undocumented routes are documented | `service.ts`, `app.ts`, `contracts/http.md` |
| A08 | `e2e/ux08-checkout.mjs` follows the Pay later sheet; `npm run e2e` builds, starts a throwaway till on 3082 and runs every check in `e2e/`; new `e2e/audit-fixes.mjs` | `e2e/`, `package.json` |
| A09 | `scripts/shot.mjs` reads the browser's debugging address from its profile folder and closes the browser through the debugging connection, so no Edge and no profile folder stay behind | `scripts/shot.mjs` |
| T27 | Automatic, checked backups (`VACUUM INTO`): on start, on day close, every 30 minutes when something changed; optional second folder; Admin → Backups; `launch.mjs --restore` and `Restore CactusPOS backup.bat`, which move the replaced data aside instead of deleting it | `server/backup.ts` (new), `BackupAdmin.tsx` (new), `ops/app/restore.mjs` (new), `launch.mjs`, `ops/windows/restore.ps1` |

No new dependency.

## Contracts touched
- `Order`: `paidDate`, `voidedAt`, `voidDate` (optional). `PayBody.expectedTotalCents` (optional, so an older cached screen still works).
- `DayReport`: `sales`, `tenders[].amountCents/tipCents`, `tipsCents` may be negative; new optional `refundedEarlier`. Stored Z reports still parse.
- `hello` is now also the heartbeat; no new event type, so older screens ignore nothing new.
- New routes: `GET /api/admin/staff/example-pins`, `GET|PUT|POST /api/admin/backups...`. `GET /api/orders?scope=active|today` return more (see `http.md`).
- `packages/web/src/lib/api.ts`: `api()` throws `ApiError` with status `0` when the till does not answer (it used to throw a `TypeError`).
- Database schema 5. Docs: `http.md`, `events.md`, `database.md` (was still at version 3), `books.md`, new `backups.md`, `ops/install.md`, `README.md`.

## How to verify
```sh
npm run check     # typecheck, lint, 219 tests in 20 files, build
npm run e2e       # 3 browser checks against a throwaway till
```
Run on 2026-10-10: both pass. New tests: `moneyDates.test.ts` (the two audit cases, same-day refund, migration backfill),
`guards.test.ts` (A02, A03, A06, A07, heartbeat), `backup.test.ts` (a backup opened on its own equals the original and
passes `verifyLedger`), `dataHome.test.ts`, `liveSocket.test.ts`, `ops/app/restore.test.mjs`.

Also done by hand on a throwaway data folder (`CACTUS_HOME`), with the real launcher and server: start, 3 sales, backup,
2 more sales, `--restore <file> --yes`. The till came back with 3 orders, the 5-order database was in
`data/replaced-<time>/`, the server restarted and the next sale got receipt #4. `restore.ps1` was run against an empty
folder and reported "There is no backup" as it should. After three `shot.mjs` runs no `msedge.exe` on a `cactus-shot-`
profile and no such folder was left.

**Not verified:** the typed "yes" question of the restore (only `--yes` and the no-terminal refusal were run), a
double-click on the `.bat`, a real WiFi cut on a real tablet (the reconnect logic is tested with a fake socket and the
server heartbeat with a real one), the Linux installer, and PyroBookKeeper accepting a day with negative lines.

## Gotchas / decisions
- **Restoring an older backup rewinds receipt numbers**: sales made after it leave the till and their numbers are issued
  again. The launcher warns and keeps the replaced database; the docs say to keep that folder.
- Split payments (T22) will need the day per payment, not per order. `paid_date` on the order is enough while an order has one payment.
- "Unpaid" and "voided before payment" in a day report still count orders **opened** that day.
- Backups are pruned (newest 30, last of each day for 90 days). That deletes old copies, not records; say so if the
  owner wants them kept forever.
- A07 carry-over is by hours, not by date: yesterday's forgotten, never-bumped ticket leaves the boards after 16 hours.
- The example-PIN line is on Admin's first page only, on purpose (owner: PINs are not a priority).
- A second copy of the backups only exists once the owner names a folder in Admin → Backups. Until then all copies are on the same laptop.
- This PC: the main checkout's `packages/server/data/cactus.sqlite` is now the *development* database only. `npm start` and `start.bat` open `%LOCALAPPDATA%\CactusPOS\data\cactus.sqlite` and print a notice that the other file exists.

## Follow-ups
- BOARD: A01–A09 and T27 set to `review`. T07 released (it was `doing` under claude since 2026-10-07 with no branch).
- REQUESTS R18 (to codex): review, and a heads-up on the shared files this touched.
- Still open from the audit: T26c (https for installed copies), the review backlog, Q1/Q2/Q3/Q5c for the owner, and the
  menu board needing a staff sign-in on a customer-facing screen.
