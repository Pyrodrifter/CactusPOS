/** Money is always integer cents (USD). Never floats. */
export type Cents = number;

/**
 * Largest amount the POS handles: $100,000,000.00. The bound is what makes the arithmetic exact:
 * every intermediate product (amount x basis points, amount x quantity 99) stays far below
 * Number.MAX_SAFE_INTEGER, so no calculation can silently lose a cent.
 */
export const MAX_CENTS = 10_000_000_000;

export class MoneyError extends RangeError {}

/** Throws unless n is an integer number of cents within +/- MAX_CENTS. */
export function assertCents(n: number, what = 'amount'): Cents {
  if (!Number.isSafeInteger(n)) throw new MoneyError(`${what} must be an integer number of cents, got ${n}`);
  if (Math.abs(n) > MAX_CENTS) throw new MoneyError(`${what} is out of range: ${n}`);
  return n;
}

/**
 * Integer division rounding halves away from zero (commercial rounding).
 * Same rule and same algorithm as PyroBookKeeper `divRoundHalfUp`, so the till and the books
 * agree to the cent. Exact integer arithmetic; never returns -0.
 */
export function roundDiv(num: number, den: number): number {
  if (!Number.isSafeInteger(num)) throw new MoneyError(`numerator must be a safe integer, got ${num}`);
  if (!Number.isSafeInteger(den) || den <= 0) throw new MoneyError(`denominator must be a positive integer, got ${den}`);
  const n = Math.abs(num);
  const q = Math.floor(n / den);
  const magnitude = (n - q * den) * 2 >= den ? q + 1 : q;
  return magnitude === 0 ? 0 : num < 0 ? -magnitude : magnitude;
}

/** Adds amounts, checking every input and the running total. */
export function sumCents(values: readonly number[]): Cents {
  let total = 0;
  for (const v of values) total = assertCents(total + assertCents(v), 'total');
  return total;
}

export function formatMoney(cents: Cents, locale = 'en-US', currency = 'USD'): string {
  return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(cents / 100);
}

/** Parse "12", "12.5", "12,50" into cents. Returns null if invalid or out of range. */
export function parseMoney(input: string): Cents | null {
  const m = /^\s*(\d{1,9})(?:[.,](\d{1,2}))?\s*$/.exec(input);
  if (!m) return null;
  const cents = Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0') || 0);
  return cents <= MAX_CENTS ? cents : null;
}
