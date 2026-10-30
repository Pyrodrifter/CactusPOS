# Money and ABB (v1)

Code: `packages/shared/src/money.ts`, `tax.ts`. Rules downstream consumers (receipts, books bridge, reports) can rely on.

## Money
- Integer cents, USD. Supported range +/- `MAX_CENTS` = $100,000,000.00. Every public entry point rejects fractions, NaN, infinity and out-of-range values with `MoneyError` (HTTP 400). Inside that range all arithmetic is exact.
- Rounding: halves away from zero (`roundDiv`). Never returns -0.
- `formatMoney` rejects anything that is not integer cents in range, like every other entry point.
- Sums of signed lines are checked too: if credits and sales combine into a net outside the range, `computeTotals` throws rather than return it.
- `parseMoney` returns `null` for anything that is not a plain non-negative amount with at most 2 decimals.

## ABB on a receipt
- Menu prices include ABB. Tax contained in a price: `taxInGross(gross, bps) = round(gross * bps / (10000 + bps))`. `net = gross - tax`, so `net + tax = gross` always.
- **Rounding policy: per line.** Tax is extracted from each order line (unit price x quantity, including options) and the lines are added up, so the receipt, the day report and the bookkeeping exports agree to the cent. Each `OrderLine.taxCents` is stored with the order; `Order.taxCents` is their sum; `Order.breakdown` has one row per category and rate.
- The alternative, per group (`computeTotals(..., 'group')`), extracts once per category total and can differ by a cent on receipts with several small lines (two 9-cent lines at 6%: 2 cents vs 1). It exists for comparison only. Which one the Belastingdienst expects is an open question for the accountant, not something the code asserts.
- The receipt total is always the sum of the prices charged, under either policy.
- Typing a price without ABB (menu editor only): `grossFromNet(net, bps) = net + round(net * bps / 10000)` gives the inclusive price that is stored. `taxInGross` of that price returns exactly the ABB that was added. There is no mode that charges ABB on top: consumer prices on Bonaire must include it.

## Rates over time
- A category holds `rates: [{ validFrom, bps }]`. The rate in force is the latest row on or before the business date. Change a rate by adding a row.
- A taxed category with **no row covering the date is an error** (`TaxConfigError`, HTTP 409 "Tax setup problem"), never a silent 0%.
- Two rows with the same `validFrom`, impossible dates and non-integer or out-of-range rates are rejected by `TaxCategorySchema` and by `rateAt`.
- Default rows start 2011-01-01 (when ABB began). That is a starting point for the till, not evidence of historic rates.
- `exempt` and `outside_scope` are distinct kinds, both 0%, and stay separate in the breakdown.

## Not decided here
Classification of Cactus Blue's food, drinks and resold goods (QUESTIONS Q1, Q1b). Defaults stay `unverified: true`.
