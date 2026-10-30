# Bookkeeping export (v1)

Code: `packages/books-bridge` (pure functions), `packages/server/src/books.ts` (settings, routes). Owner only.
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

A day is booked on the money that moved that day (see "Day reports" in `http.md`). A sale paid and refunded on the same day nets to nothing and is not booked. A refund of an **earlier** day's sale is in that day's figures as negative amounts, so the same lines book it in reverse: cash or card credited, revenue and ABB debited. Every account code is editable in Admin > Bookkeeping. Whether card takings belong on the bank account or a clearing account is the bookkeeper's call.

## CSV (for any accountant or program)
`GET /api/books/days.csv?from=&to=` and `GET /api/books/journal.csv?from=&to=` (dates optional, `YYYY-MM-DD`).
- UTF-8 with BOM, CRLF, comma separated, dot decimals, dates `YYYY-MM-DD`. Text cells starting with `= + - @` are prefixed with `'` so a spreadsheet cannot run them as formulas.
- `days.csv`: `date, z_report, closed_at, orders, first_receipt, last_receipt, sales_incl_abb, sales_net, abb_total, net_<rate>, abb_<rate> (one pair per rate in range), exempt, outside_scope, cash, card, tips, refunds, cash_counted, cash_over_short, note`.
- `journal.csv`: `date, reference, account, debit, credit, description, memo`. Debits equal credits per `reference`.
- `GET /api/books` returns `{ settings: { accounts }, today }`.

The PyroBookKeeper link that used to live here was removed on 2026-10-30 (ADR-0003).
