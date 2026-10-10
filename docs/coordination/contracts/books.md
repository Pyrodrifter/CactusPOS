# Bookkeeping export (v1)

Code: `packages/books-bridge` (pure functions), `packages/server/src/books.ts` (settings, files, routes). Owner only.
Everything is built from **closed days** (Z reports); a day closed more than once is represented by its latest close.

## The day booking
`dayBooking(zReport, accounts, source)` returns one balanced double-entry booking per day (positive = debit, negative = credit):

| Line | Account (default) | Amount |
|---|---|---|
| Cash sales | `cash` (1000) | debit |
| Card sales + card tips | `card` (1100) | debit |
| Revenue per tax category, net of ABB | `revenueByCategory[id]` (service_6 8000, goods_8 8200, exempt 8300, outside_scope 8100) | credit |
| ABB per taxed category | `abbPayable` (1600) | credit |
| Tips | `tips` (1800): owed to staff, not revenue | credit |
| Cash over/short, when cash was counted | `cash` and `overShort` (4550) | either way |

A day is booked on the money that moved that day (see "Day reports" in `http.md`). A sale paid and refunded on the same day nets to nothing and is not booked. A refund of an **earlier** day's sale is in that day's figures as negative amounts, so the same lines book it in reverse: cash or card credited, revenue and ABB debited. Defaults follow PyroBookKeeper's chart of accounts; every code is editable in Admin > Bookkeeping. Whether card takings belong on the bank account or a clearing account is the bookkeeper's call.

## CSV (for any accountant or program)
`GET /api/books/days.csv?from=&to=` and `GET /api/books/journal.csv?from=&to=` (dates optional, `YYYY-MM-DD`).
- UTF-8 with BOM, CRLF, comma separated, dot decimals, dates `YYYY-MM-DD`. Text cells starting with `= + - @` are prefixed with `'` so a spreadsheet cannot run them as formulas.
- `days.csv`: `date, z_report, closed_at, orders, first_receipt, last_receipt, sales_incl_abb, sales_net, abb_total, net_<rate>, abb_<rate> (one pair per rate in range), exempt, outside_scope, cash, card, tips, refunds, cash_counted, cash_over_short, note`.
- `journal.csv`: `date, reference, account, debit, credit, description, memo`. Debits equal credits per `reference`.

## PyroBookKeeper link (optional)
See ADR-0002 for why it works this way.
- Setting `pbkFolder`: a PyroBookKeeper data folder **on the till computer**. Saving is refused unless the folder exists and contains a `journal` folder.
- `POST /api/books/pbk/post` appends to `<pbkFolder>/journal/<posDeviceId>.jsonl`, the POS's own file. It never opens another device's file for writing.
- Each closed day becomes one `journal.posted` event (`source: { kind: 'import', batch: '<business>-z<number>' }`), envelope `schemaVersion: 1`, UUIDv7 ids, `seq` continuing from the file.
- Idempotent: what was already posted is read back from the file itself (by `batch`), so running it again posts nothing. A day closed again gets a `journal.reversed` for the old entry followed by the new one.
- `GET /api/books` returns `{ settings, pbk: { configured, ok, problem?, postedDays, pendingDays }, today }`.

### Limits
- PyroBookKeeper builds its **ABB return from invoices**, not from journal entries. These postings show in its ledger, trial balance, P&L and balance sheet and credit account 1600, but do not appear on its ABB form; its reconciliation will list them as "posted by another process". The POS day reports are the source for the ABB figure.
- Written against PyroBookKeeper schema version 1. If that version is raised, review `packages/books-bridge/src/pbk.ts` before changing `PBK_SCHEMA_VERSION`.
- A locked period in PyroBookKeeper is not checked before posting.
- The link runs when the owner presses the button; nothing posts automatically.
