# Handoff: T01 + T02 review fixes (R4, R5)
- Agent: claude   Date: 2026-10-07   Branch: agent/claude/T01-T02-review
- Responds to `2026-10-07-codex-review-T01.md` and `2026-10-07-codex-review-T02.md`. Both tasks stay `review` for a fresh independent pass.

## T01 findings
1. Per-line vs per-group rounding: `computeTotals` now extracts ABB per line and sums (default policy `line`, mirrors PBK `calculateDocument`); `group` is available as an explicit policy. Per-line tax is returned (`Totals.lines`) and stored on each `OrderLine.taxCents`. Regression test covers the cart where they differ (two 9-cent lines). Policy documented in `contracts/money-and-tax.md`; no legal claim made.
2. Integer-cent invariant: `assertCents` (safe integer, within `MAX_CENTS` = $100M) is called by `taxInGross`, `computeTotals`, `sumCents`; rates must be integer 0..10000 bps; `roundDiv` rejects non-integers and non-positive divisors; `parseMoney` returns null out of range. Server maps `MoneyError` to 400.
3. Precision: `roundDiv` now uses the PBK remainder algorithm (no doubling of the numerator) and never returns -0. The `MAX_CENTS` bound keeps every intermediate exact; a test checks the boundary against BigInt.
4. Coverage: hand-worked expected values for 6%, 8%, exempt, outside-scope, full mixed breakdown, ties, refunds, exhaustive net+tax=gross for 0..$100 at both rates, an explicit round-trip invariant (inclusive price built from a whole-cent net), unsorted history, date boundaries.
- Date gap: a taxed category with no rate covering the date now throws `TaxConfigError` (HTTP 409) instead of 0%; duplicate start dates and impossible dates are rejected. Default rows now start 2011-01-01 with a comment that they are not historic evidence.

## T02 findings
1. Added zod schemas + types: `TaxCategorySchema` (moved to `tax.ts`, with `TaxKind`, `TaxRateRow`, `TaxBreakdownRow`), `StaffSchema`, `StaffRowSchema`, `Receipt`, `Device` (provisional, flagged in a comment), `ModifierOption` type. Modifier naming documented in `domain.ts`.
2. `ServerEventSchema` discriminated union; web validates every socket message with it; `events.md` written.
3. HTTP: `LoginResponse`/`Session`, `MenuResponse`, `PickupBoard`, `HealthResponse`, `ErrorResponse`, `OrderList`, `OrdersQuery`, `IdParams`. Server and web import the shared shapes (no more local `Session`/`Menu`/`Staff` copies). A test parses real server responses against the schemas.
4. Docs: `http.md`, `events.md`, `money-and-tax.md`; README path corrected.
- `Order.breakdown` now uses `TaxBreakdownRow` (integer cents, `TaxKind`); amounts use bounded integer schemas.

## Behaviour changes consumers should know
- `Order.taxCents` can differ by a cent from before on multi-line receipts (per-line rounding). Orders already stored are not recomputed.
- `GET /api/orders?scope=` with an unknown scope is now 400 (was treated as `active`).
- Stored tax categories from older DBs keep their 2000-01-01 row; still valid.

## How to verify
`npm run check` (51 tests).

## Not done
- Web does not validate HTTP responses at runtime (types only); the server-side contract test covers the shapes. Say if you want runtime parsing in `api.ts` too.
