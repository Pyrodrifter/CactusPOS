import { roundDiv, type Cents } from './money.js';

/**
 * ABB (Bonaire / Caribisch Nederland) model. Not a VAT:
 *  - consumer prices INCLUDE the tax,
 *  - "exempt" and "outside scope" are different things and reported separately,
 *  - rates are data with an effective date; add a row, never edit history.
 * See PyroBookKeeper docs/bonaire-tax.md. Rates here are defaults, flagged unverified until confirmed.
 */
export type TaxKind = 'taxed' | 'exempt' | 'outside_scope';

export interface TaxRateRow {
  /** ISO date (YYYY-MM-DD) the rate takes effect. */
  validFrom: string;
  /** Basis points: 600 = 6%. */
  bps: number;
}

export interface TaxCategory {
  id: string;
  name: string;
  kind: TaxKind;
  rates: TaxRateRow[];
  /** Legal ground, required for exempt / outside_scope. */
  reason?: string;
  /** True until the owner/accountant confirmed this setup. */
  unverified?: boolean;
}

export function rateAt(cat: TaxCategory, isoDate: string): number {
  if (cat.kind !== 'taxed') return 0;
  const rows = [...cat.rates].sort((a, b) => a.validFrom.localeCompare(b.validFrom));
  let bps = 0;
  for (const r of rows) if (r.validFrom <= isoDate) bps = r.bps;
  return bps;
}

/** Tax contained in a tax-inclusive gross amount. */
export function taxInGross(gross: Cents, bps: number): Cents {
  return roundDiv(gross * bps, 10000 + bps);
}

export interface TaxableLine {
  taxCategoryId: string;
  /** Line total incl. tax, incl. modifiers. */
  grossCents: Cents;
}

export interface TaxBreakdownRow {
  taxCategoryId: string;
  name: string;
  kind: TaxKind;
  bps: number;
  grossCents: Cents;
  taxCents: Cents;
  netCents: Cents;
}

export interface Totals {
  totalCents: Cents;
  taxCents: Cents;
  netCents: Cents;
  breakdown: TaxBreakdownRow[];
}

/**
 * Tax is extracted per category group, not per line, so rounding error doesn't accumulate.
 * The total is exactly the sum of gross lines.
 */
export function computeTotals(lines: TaxableLine[], cats: TaxCategory[], isoDate: string): Totals {
  const byId = new Map(cats.map((c) => [c.id, c]));
  const groups = new Map<string, TaxBreakdownRow>();
  for (const l of lines) {
    const cat = byId.get(l.taxCategoryId);
    if (!cat) throw new Error(`Unknown tax category ${l.taxCategoryId}`);
    const bps = rateAt(cat, isoDate);
    const key = `${cat.id}@${bps}`;
    const row = groups.get(key) ?? { taxCategoryId: cat.id, name: cat.name, kind: cat.kind, bps, grossCents: 0, taxCents: 0, netCents: 0 };
    row.grossCents += l.grossCents;
    groups.set(key, row);
  }
  let total = 0;
  let tax = 0;
  const breakdown = [...groups.values()].map((r) => {
    r.taxCents = taxInGross(r.grossCents, r.bps);
    r.netCents = r.grossCents - r.taxCents;
    total += r.grossCents;
    tax += r.taxCents;
    return r;
  });
  return { totalCents: total, taxCents: tax, netCents: total - tax, breakdown };
}

/** Bonaire defaults. Rates per Handboek ABB 2026; classification of prepared food is UNVERIFIED. */
export const BONAIRE_DEFAULT_TAX: TaxCategory[] = [
  { id: 'service_6', name: 'ABB 6%', kind: 'taxed', rates: [{ validFrom: '2000-01-01', bps: 600 }], unverified: true },
  { id: 'goods_8', name: 'ABB 8%', kind: 'taxed', rates: [{ validFrom: '2000-01-01', bps: 800 }], unverified: true },
  { id: 'exempt', name: 'Exempt', kind: 'exempt', rates: [], reason: 'Specify legal ground', unverified: true },
  { id: 'outside_scope', name: 'Outside scope', kind: 'outside_scope', rates: [], reason: 'Resale of imported goods', unverified: true },
];
