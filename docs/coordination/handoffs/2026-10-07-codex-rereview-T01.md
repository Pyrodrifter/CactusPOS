# Independent re-review: T01 — Money and ABB engine

- Reviewer: codex; date: 2026-10-07.
- Reviewed shared implementation from `6fde62e`, unchanged through repository HEAD `c4558cd8fb103e2a4553772a57155b56b967c0a1`.
- Inputs: AGENTS.md, BOARD T01, PLAN tax/architecture requirements, the original Codex T01 review, Claude's T01/T02 review-fixes handoff, and `contracts/money-and-tax.md`.
- Verdict: **changes requested; keep T01 in review**. The original rounding, date, and coverage findings are substantially resolved. Two remaining money-validation gaps contradict the new public contract.
- Scope: only this report was written. No source, tests, BOARD, processes, or DB data were changed; no commit was made.

## Remaining findings

1. **P2 — `formatMoney` still accepts invalid cents at a public money entry point.** `packages/shared/src/money.ts:41-42` divides its unvalidated input by 100. The money contract says every public entry point rejects fractional, nonfinite, and out-of-range amounts with `MoneyError`, but `formatMoney(0.5)` returns `$0.01`, `formatMoney(NaN)` returns `$NaN`, `formatMoney(Infinity)` returns `$∞`, and `formatMoney(MAX_CENTS + 1)` returns `$100,000,000.01`. Because `Cents` is a number alias, TypeScript does not prevent these calls. Validate cents before formatting and add public-entry regression coverage. This closes the remaining part of original finding 2; parsing and arithmetic validation now work as intended.

2. **P2 — Signed receipt totals can escape the supported cents range.** `packages/shared/src/tax.ts:132` returns `netCents: totalCents - taxCents` without validating that result. The API accepts signed lines and documents +/- `MAX_CENTS` as its supported range. With default categories and business date `2026-10-07`, the three valid inputs below return `totalCents = -10000000000`, `taxCents = 566037736`, and `netCents = -10566037736`. Feeding that returned net into `assertCents` throws an out-of-range error. Check the final net and derived monetary fields against the declared range, or explicitly define a different supported output range; add a signed mixed-category boundary regression. The calculation itself is exact: the defect is returning a monetary value outside the contract's supported range. This occurs at an extreme boundary and does not affect the ordinary positive carts checked here.

```ts
computeTotals([
  { taxCategoryId: 'service_6', grossCents: MAX_CENTS },
  { taxCategoryId: 'exempt', grossCents: -MAX_CENTS },
  { taxCategoryId: 'outside_scope', grossCents: -MAX_CENTS },
], BONAIRE_DEFAULT_TAX, '2026-10-07');
```

## Original findings and Done-when verification

- **Per-line/receipt calculation and PBK rounding:** resolved. Default `computeTotals` extracts per line, exposes line results, and sums them into category and receipt totals. Two 9-cent lines at 6% produce 2 cents ABB with `line`, versus 1 with explicit `group`; gross remains 18 cents under both. The contract explains the policy choice and limits `group` to comparison.
- **Money/rate input validation:** arithmetic and parsing cases from the original review are resolved. Fractions, NaN, infinity, excessive cents, invalid basis points, invalid divisors, and overflowing gross totals are rejected. Remaining formatter/output gaps are listed above.
- **Precision and negative zero:** resolved within the deliberately bounded supported tax inputs. The remainder algorithm mirrors local PBK `divRoundHalfUp`; oversized original-review gross amounts are now rejected. Independent BigInt comparisons matched 100,010 calculations: every integer basis-point value from 0 through 10000, with ten positive/negative/small/near-limit gross values each. Tax extraction and rounding normalize negative zero.
- **Required unit coverage:** met. The 21 shared tests include independent 6%/8% values, exempt/outside-scope and full mixed breakdowns, rounding ties, credit symmetry, rounding-policy divergence, unsorted effective-date history and boundaries, and an explicit inclusive round-trip for prices constructed from whole-cent net amounts. The arbitrary-gross invariant is separately stated as `net + tax = gross`.
- **Date-contract gap:** resolved for taxed categories. Missing date coverage throws instead of silently choosing zero; duplicate effective dates and impossible dates are rejected. Defaults retain `unverified: true` and the 2011 start is explicitly not historical-rate evidence.
- **Local PBK parity:** read `C:/Users/Pyro/Documents/PyroBookKeeper/packages/core/src/money.ts` and `packages/core/src/tax/{abb,rates}.ts`. Direct execution matched POS receipt gross/net/tax and individual line tax to PBK `calculateDocument` in 20 fixtures spanning 6%, 8%, exempt, outside-scope, small rounding examples, ordinary prices, negative credits, and the supported amount boundary. The fixture PBK profile had producer status enabled solely to exercise its 8% calculation. This verifies arithmetic, not Cactus Blue's classification or accounting bridge behavior.

## Validation

- `npm run typecheck`: passed for all six workspaces.
- `npm test`: passed, 6 files / 75 tests at the latest checked HEAD. An earlier run before concurrent receipt/printer work landed also passed 3 files / 51 tests.
- `npm test -- packages/shared/src/tax.test.ts`: passed, 1 file / 21 tests.
- Read-only Node/tsx probes: 100,010 BigInt comparisons and 20 PBK document fixtures passed; both remaining findings were reproduced directly against current exported functions. No temporary test files or dependencies were added.

## Contracts and follow-ups

No contracts were edited. The shared owner should close the two remaining validation gaps and add regression tests, then request re-review. BOARD was left untouched for the coordinating reviewer.

Q1 and Q1b remain unanswered. This review does not approve food/drink classification, registration/producer status, launch tax defaults, or legal rounding requirements; it assesses implementation against the repository's declared behavior and local PBK arithmetic only.
