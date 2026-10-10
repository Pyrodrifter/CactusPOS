# App audit — master at 36f2e8d
- Agent: claude   Date: 2026-10-10   Branch: agent/claude/audit-2026-10-10

Owner request: "app audit". Read-only review of the whole app: no program code was changed.
Fix tasks are on the BOARD as A01–A09; the one business question is Q11 in QUESTIONS.md.

## What was checked, and how
| Check | Result |
|---|---|
| `npm run typecheck`, `npm run lint`, `npm test` on master | pass: 6 workspaces, 0 lint warnings, 177 tests in 14 files |
| Production build of the web app (into a scratch folder) | pass |
| `npm audit` (all dependencies) | 0 known vulnerabilities |
| Full read of server, shared, receipt, printer, books-bridge, the till, kitchen, pickup, menu board, sign-in, shell, PWA worker, launcher | findings below |
| `e2e/ux08-touch.mjs` in headless Edge against a throwaway till (temp database, fresh build of master) | pass at 1180, 1024, 820 and 390 px |
| `page.measure()` on kitchen, pickup, menu board, Tabs, Orders and all 8 Admin sections at 1180 and 390 px | no control under 48 px, no sideways overflow |
| `e2e/ux08-checkout.mjs` | **fails** (stale script, see A08); an adapted copy passes: lost-reply retry makes one order, cash checkout, paid screen closes |
| Probe script against an in-memory database for the four money and access findings | all four reproduced (figures below) |

Not checked: a real receipt printer or cash drawer, real tablets on the truck network, the Linux installer,
the Windows installer end to end, PyroBookKeeper accepting the posted days, and behaviour over a real WiFi drop.

## Rules of the road: how the code stands
- **Integer cents:** holds. No float money arithmetic anywhere; rounding only in `shared/money.ts` and `tax.ts`.
- **Prices include tax, tax is data:** holds. Rates come from tax categories with `validFrom`; nothing hardcoded in the UI.
- **Nothing is deleted:** holds for orders, events, payments, audit log, Z reports and receipt designs (database triggers, tested). The ledger self-check stayed clean after every probe.
- **Gapless receipt numbers:** holds (counter inside the payment transaction, tested with 4 processes).
- **Offline first:** holds. No screen, font or script is loaded from the internet.
- **Touch first:** holds on every screen measured.

## Findings that should be fixed before real sales

### 1. A sale is reported on the day the order was opened, not the day it was paid (A01, Q11)
`Reports.day()` picks orders by `business_date`, which is the day the order was created
(`packages/server/src/reports.ts:13`). Tabs can be paid on a later day, and a paid sale can be voided on a later day.
Reproduced:
- Tab opened on day 1, day 1 closed (Z#1, cash expected $0), tab paid in cash on day 2 ($14, receipt #1).
  Day 2's report shows 0 sales and $0 cash expected. Day 1's live figures change to $14, but its stored Z report still says $0.
  The $14 is in the drawer on day 2 and in no closed day unless somebody reopens day 1 and closes it again.
- Sale paid and closed on day 2 ($5), voided on day 3: day 3 shows no refund and $0 cash expected although $5 left the drawer;
  day 2's live figures drop to $0 while its Z report still says $5.

The CSV exports and the PyroBookKeeper link read Z reports, so they carry the same gap. Which day such a sale or
refund belongs to is a bookkeeping rule: asked as Q11. The usual till rule is "the day the money moved".

### 2. The manager PIN can be guessed through the void route (A02)
Sign-in locks an address out after 5 wrong PINs. The manager PIN on `POST /api/orders/:id/void` has no such limit
(`PosService.voidOrder`, `packages/server/src/service.ts:304`). Reproduced: signed in as staff, 25 wrong manager
PINs in a row all answered 403, the 26th (correct) voided the order. A 4-digit owner PIN falls in minutes, and that
PIN also signs in as owner.

### 3. A card payment is recorded for whatever the order totals now, not what the cashier saw (A03)
The pay request carries no amount for card. If a round is added to the tab on another screen while the pay sheet is
open, the server records the new total. Reproduced: sheet showed $14.00, server recorded a $23.00 card payment.
Cash is safe by accident (the tendered amount is checked). The card terminal was charged $14, the books say $23.

### 4. Screens can go silently stale; a stalled request never ends (A04) — found by reading, not reproduced
- Neither the server nor the screens send a heartbeat on the live connection (`app.ts` `/ws`, `web/src/lib/live.ts`).
  If the connection dies without a goodbye (laptop restarted while a tablet was asleep or out of range), the kitchen
  screen keeps saying "Live updates" and shows no new tickets until someone reloads it.
- `api()` in `web/src/lib/api.ts` has no timeout. On stalled WiFi the till stays on "Sending…" with the cart locked.
  A reload is the only way out, and it throws away the retry key that prevents a double order.

### 5. No backups exist yet (T27, not started)
All sales are one SQLite file on one laptop in a truck. T27 depends on T03, and T03 has been in `review` since
2026-10-07, so by the board's own rules nobody may start it. Note for whoever builds it: the database runs in WAL
mode, so copying `cactus.sqlite` alone can miss recent sales; use `VACUUM INTO` or the SQLite backup API.

### 6. Two different databases, depending on how the till is started (A05)
The installed app keeps sales in `%LOCALAPPDATA%\CactusPOS\data`. `start.bat` and `npm start` use
`data/cactus.sqlite` relative to where the server starts, which is `packages/server/data` inside the program folder
(that file exists on this machine). Anyone who trials with `start.bat` and then installs gets an empty till, and a
program-folder update can remove the trial sales.

### 7. Example PINs, with nothing in the app that insists they are changed (A06)
A new database gets owner 1234 and staff 1111. The installers and README say so, but the app never warns. The
server listens on the whole network and tablets use plain http, so anyone on the truck WiFi can sign in as owner
until the PINs are changed. Related and already planned: T26c (https for installed copies). Without https the
tablets also get no offline shell and no "keep screen awake".

## Smaller things
- Kitchen and pickup lists are built from today's orders only (`PosService.activeOrders`). A tab from an earlier day
  that orders another round reaches the kitchen live but is gone after a reload; at midnight the pickup board empties
  even if food is still being made.
- Unexpected server errors return the internal message to the screen (`app.ts:63`).
- Printer and bookkeeping settings are saved without an audit-log row; every other owner change has one.
- Three routes are not in any contract document: `POST /api/admin/receipt-templates/restore`,
  `POST /api/admin/receipt-templates/test-print`, `PUT /api/books/settings`.
- `sessions` and `requests` rows are never pruned (harmless at this size). `staff.pin` is `UNIQUE`, which means
  nothing now that PINs are salted hashes; uniqueness is checked in code.
- Voiding a paid card sale does not remind the cashier to refund on the terminal.
- The menu board needs a staff sign-in, so a customer-facing TV holds a staff session that can open the till.

## Process and tooling
- **A08:** `e2e/ux08-checkout.mjs` fails on master since T29 put the "Pay later" sheet in front of sending. No
  browser check is part of `npm run check`, and there is no CI, so nobody saw it.
- **A09:** `scripts/shot.mjs` leaves a headless Edge running after every run on this machine. The first candidate,
  `Program Files (x86)\...\msedge.exe`, hands off to the real Edge and exits with 0; the tool reads that as a
  failure and starts a second browser, and the first stays alive on its throwaway profile. Five runs left 39 Edge
  processes and five profile folders (cleaned up by hand after this audit).
- **Board:** 28 rows are in `review`, 8 are `done`. T01–T05 have been in review since 2026-10-07/08, and
  that backlog blocks work with dependencies (T27 above). T07 (i18n) is `doing` under claude since 2026-10-07 and
  has no branch. Several `todo` rows describe things that are already built: T24 (pickup board), T31 (receipt
  editor, arrived with UX09), T35 (reports screen). The board understates what exists and overstates what is being checked.
- Still open for the owner in QUESTIONS.md: Q1/Q1b (tax categories, all still flagged unverified; CRIB number is empty,
  so receipts print without it), Q2 (printer), Q3 (card terminal), Q5c (prices).

## How to verify the reproduced findings
Start from a sample database (`seedSample`) through `buildApp` with an in-memory database, as the server tests do:
1. Finding 1: create an order with `tabName`, close the day, move the clock one day on, pay, compare
   `reports.day(day1)`, `reports.day(day2)` and `reports.latestFor(day1)`.
2. Finding 2: as staff, set an order to `preparing`, post wrong `managerPin` values to `/api/orders/:id/void` more than 5 times.
3. Finding 3: create a tab, add lines with `/api/orders/:id/lines`, pay by card; compare the payment with the first total.
Each fix task should check these in as tests.

## Follow-ups
BOARD rows A01–A09 (section "Audit 2026-10-10"), Q11 in QUESTIONS.md.
