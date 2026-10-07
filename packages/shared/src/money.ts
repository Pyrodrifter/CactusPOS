/** Money is always integer cents (USD). Never floats. */
export type Cents = number;

export function assertCents(n: number): Cents {
  if (!Number.isSafeInteger(n)) throw new Error(`Not integer cents: ${n}`);
  return n;
}

/** Round half away from zero on an exact integer ratio num/den (den > 0). */
export function roundDiv(num: number, den: number): number {
  if (den <= 0) throw new Error('den must be > 0');
  const r = Math.floor((Math.abs(num) * 2 + den) / (den * 2));
  return num < 0 ? -r : r;
}

export function formatMoney(cents: Cents, locale = 'en-US', currency = 'USD'): string {
  return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(cents / 100);
}

/** Parse "12", "12.5", "12,50" into cents. Returns null if invalid. */
export function parseMoney(input: string): Cents | null {
  const m = /^\s*(\d+)(?:[.,](\d{1,2}))?\s*$/.exec(input);
  if (!m) return null;
  return Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0') || 0);
}
