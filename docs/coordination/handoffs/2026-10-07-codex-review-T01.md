# Review: T01 — Money and ABB engine
- Reviewer: codex; date: 2026-10-07; branch: agent/codex/T06
- Reviewed implementation at 43a238aa360ea60bedaa469ae775239f93cbd9bb.
- Result: **not accepted; leave T01 in review**. No implementation, tests, contracts, or configuration changed.

## Blocking findings

1. **P1 — Missing per-line receipt calculation and PBK rounding parity.** `packages/shared/src/tax.ts:70` only aggregates gross by category before extracting tax. Two 9-cent lines at 6% produce 1 cent ABB in `computeTotals`; extracting each line produces 1 + 1 = 2 cents. PBK `packages/core/src/tax/abb.ts` explicitly splits each line and sums those results in `calculateDocument`. The task requests extraction per line and per receipt and reuse/mirroring of PBK. `taxInGross` can split a scalar, but no receipt operation preserves per-line tax results, sums them, or exposes a choice of rounding policy. Add/document the required line and receipt operations (or explicit policy) and regression tests for a cart where the policies differ. Preserve the existing gross-total invariant. Document the PBK difference and chosen policy for downstream receipts/books consumers; no legal rounding requirement is inferred here.

2. **P1 — Integer-cent invariant is not enforced by money/tax entry points.** `money.ts:21` returns unsafe integers instead of null/rejection: `parseMoney('90071992547409.93')` yields `9007199254740992`. `computeTotals` accepts an exempt 0.5-cent line and returns total/net 0.5; `taxInGross(NaN, 600)` returns NaN. Although `assertCents` exists, these operations never call it. Validate finite safe integer cents and rates, positive integer denominators, and safe accumulated totals; reject invalid inputs predictably. Rates must not permit -10000 (zero divisor), fractional values, or nonfinite values to flow into calculations. Add public-entry regression tests.

3. **P2 — Claimed exact rounding loses precision on valid safe integers.** `money.ts:10` doubles the numerator before division, and `tax.ts:39` first multiplies gross by bps without checking intermediate safety. For safe gross `9007199254740981` and 600 bps the implementation returns `509841467249490` tax cents; exact BigInt arithmetic returns `509841467249489`. Use exact arithmetic internally or explicitly constrain/reject amounts whose intermediates cannot be represented safely. `roundDiv(-1, 100)` also returns negative zero; PBK normalizes this to zero to prevent negative-zero monetary formatting/storage. Test supported boundaries and negative credits.

4. **P2 — Done-when unit coverage is incomplete.** The six committed shared tests contain no explicit inclusive price round-trip test; the mixed-cart test obtains its expected 6% amount from the same `taxInGross` function under test and does not assert the independent 8% amount or full breakdown. Add independent expected values for 6%, 8%, exempt/outside-scope, mixed totals, rounding ties and policy divergence, effective-date boundaries (including unsorted history), and an explicit supported inclusive round-trip. Do not assume that all arbitrary rounded gross prices can be reconstructed by reapplying tax to rounded net; define the invariant/API first.

## Verified behavior and checks

- `npm run typecheck`: all six workspaces pass.
- `npm test`: 2 files, 13 tests pass. Scoped `npm test -- packages/shared/src/tax.test.ts`: 6 tests pass.
- Read-only external investigation via Node/tsx confirmed `taxInGross(1060, 600) = 60`, `taxInGross(1080, 800) = 80`, and exempt scalar tax = 0. Existing tests cover mixed gross total and the 2027 effective-date boundary.
- Exhaustive gross reconstruction for 0..10000 cents at 6% preserved `net + tax = gross`; this is not a replacement for committed round-trip coverage.
- Defaults preserve separate exempt/outside-scope kinds and remain `unverified: true`. Q1 remains unanswered and unverified; this review does not certify food/drink classification, producer status, or launch defaults.
- PBK sources and `docs/bonaire-tax.md` were read locally for implementation parity only; no current legal/tax advice is asserted.

## Additional date-contract gap

`rateAt` returns zero for a taxed category before its earliest rate row (for example the default service category on `1999-01-01`), while PBK `findRateRule` rejects missing coverage. Duplicate effective dates and invalid ISO dates are not rejected. Define/document missing-history and duplicate-date behavior, then test it; silently treating an uncovered taxed category as exempt is unsafe for historical imports. The placeholder 2000 start date also differs from PBK's 2011 ABB start, so defaults should not be used as historical legal evidence.

## Contracts touched and follow-ups

None. Findings belong to the shared lane and are recorded here for its owner. T01 remains `review`; no commit or dependency installation was made. Re-review after the above changes and committed tests pass.
