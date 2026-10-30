import { z } from 'zod';
import { assertCents, MoneyError, roundDiv, sumCents, type Cents } from './money.js';

/**
 * ABB (Bonaire / Caribisch Nederland) model. Not a VAT:
 *  - consumer prices INCLUDE the tax,
 *  - "exempt" and "outside scope" are different things and reported separately,
 *  - rates are data with an effective date; add a row, never edit history.
 * Source: Belastingdienst Caribisch Nederland. Defaults are flagged unverified until the owner confirms them.
 */
export const TaxKind = z.enum(['taxed', 'exempt', 'outside_scope']);
export type TaxKind = z.infer<typeof TaxKind>;

const isIsoDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`))
  && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;

export const IsoDate = z.string().refine(isIsoDate, 'Expected a real date as YYYY-MM-DD');
/** Basis points: 600 = 6%. Whole numbers from 0% to 100%. */
export const Bps = z.number().int().min(0).max(10000);

export const TaxRateRow = z.object({ validFrom: IsoDate, bps: Bps });
export type TaxRateRow = z.infer<typeof TaxRateRow>;

export const TaxCategorySchema = z.object({
  id: z.string().min(1).max(40),
  name: z.string().min(1).max(60),
  kind: TaxKind,
  rates: z.array(TaxRateRow),
  /** Legal ground, required for exempt / outside_scope. */
  reason: z.string().max(200).optional(),
  /** True until the owner/accountant confirmed this setup. */
  unverified: z.boolean().optional(),
}).superRefine((c, ctx) => {
  const dates = c.rates.map((r) => r.validFrom);
  if (new Set(dates).size !== dates.length) ctx.addIssue({ code: 'custom', message: 'Two rates start on the same date', path: ['rates'] });
  if (c.kind === 'taxed' && c.rates.length === 0) ctx.addIssue({ code: 'custom', message: 'A taxed category needs at least one rate', path: ['rates'] });
});
export type TaxCategory = z.infer<typeof TaxCategorySchema>;

export class TaxConfigError extends Error {}

/**
 * Rate in force on a date. Exempt and outside-scope categories are always 0.
 * A taxed category with no rate covering the date is a configuration error, never a silent 0%:
 * treating an uncovered sale as untaxed would under-declare.
 */
export function rateAt(cat: TaxCategory, isoDate: string): number {
  if (!isIsoDate(isoDate)) throw new TaxConfigError(`Bad date ${isoDate}`);
  if (cat.kind !== 'taxed') return 0;
  let best: TaxRateRow | undefined;
  const seen = new Set<string>();
  for (const r of cat.rates) {
    if (!isIsoDate(r.validFrom)) throw new TaxConfigError(`Tax category ${cat.id} has a bad date ${r.validFrom}`);
    if (seen.has(r.validFrom)) throw new TaxConfigError(`Tax category ${cat.id} has two rates starting ${r.validFrom}`);
    seen.add(r.validFrom);
    assertBps(r.bps);
    if (r.validFrom <= isoDate && (!best || r.validFrom > best.validFrom)) best = r;
  }
  if (!best) throw new TaxConfigError(`Tax category ${cat.id} has no rate for ${isoDate}`);
  return best.bps;
}

function assertBps(bps: number): number {
  if (!Number.isInteger(bps) || bps < 0 || bps > 10000) throw new MoneyError(`Rate must be 0-10000 basis points, got ${bps}`);
  return bps;
}

/** Tax contained in a tax-inclusive gross amount. Exact; gross = net + tax always holds. */
export function taxInGross(gross: Cents, bps: number): Cents {
  return roundDiv(assertCents(gross, 'gross') * assertBps(bps), 10000 + bps);
}

/**
 * Tax-inclusive price for a price typed without ABB, for the menu editor only: what is stored and
 * charged is always the inclusive price (consumer prices exclusive of ABB are not allowed on Bonaire).
 * Exact inverse of taxInGross: taxInGross(grossFromNet(n, bps), bps) === grossFromNet(n, bps) - n.
 */
export function grossFromNet(net: Cents, bps: number): Cents {
  const n = assertCents(net, 'net');
  return assertCents(n + roundDiv(n * assertBps(bps), 10000), 'gross');
}

export interface TaxableLine {
  taxCategoryId: string;
  /** Line total incl. tax, incl. modifiers (unit price x quantity). */
  grossCents: Cents;
}

export const TaxBreakdownRow = z.object({
  taxCategoryId: z.string(), name: z.string(), kind: TaxKind, bps: Bps,
  grossCents: z.number().int(), taxCents: z.number().int(), netCents: z.number().int(),
});
export type TaxBreakdownRow = z.infer<typeof TaxBreakdownRow>;

export interface LineTax { bps: number; grossCents: Cents; taxCents: Cents; netCents: Cents }

export interface Totals {
  totalCents: Cents;
  taxCents: Cents;
  netCents: Cents;
  /** One row per category and rate, for the receipt's ABB block. */
  breakdown: TaxBreakdownRow[];
  /** Same order as the input lines. */
  lines: LineTax[];
}

/**
 * How the ABB on a receipt is rounded.
 *  - 'line'  (default): extract the tax from each line, then add the lines up. Each order line
 *    keeps its own ABB, so the receipt, the day report and the exports agree to the cent.
 *  - 'group': add the lines of a category up first, then extract once. Can differ from 'line'
 *    by a cent on receipts with several small lines (two 9-cent lines at 6%: 2 cents vs 1 cent).
 * Both keep the total equal to the sum of the prices charged. Which one the Belastingdienst
 * expects is not something this code decides.
 */
export type RoundingPolicy = 'line' | 'group';

export function computeTotals(lines: readonly TaxableLine[], cats: readonly TaxCategory[], isoDate: string, policy: RoundingPolicy = 'line'): Totals {
  const byId = new Map(cats.map((c) => [c.id, c]));
  const groups = new Map<string, TaxBreakdownRow>();
  const lineTax: LineTax[] = [];
  for (const l of lines) {
    const cat = byId.get(l.taxCategoryId);
    if (!cat) throw new TaxConfigError(`Unknown tax category ${l.taxCategoryId}`);
    const gross = assertCents(l.grossCents, 'line total');
    const bps = rateAt(cat, isoDate);
    const tax = taxInGross(gross, bps);
    lineTax.push({ bps, grossCents: gross, taxCents: tax, netCents: gross - tax });
    const key = `${cat.id}@${bps}`;
    const row = groups.get(key) ?? { taxCategoryId: cat.id, name: cat.name, kind: cat.kind, bps, grossCents: 0, taxCents: 0, netCents: 0 };
    row.grossCents = assertCents(row.grossCents + gross, 'total');
    row.taxCents += tax;
    groups.set(key, row);
  }
  const breakdown = [...groups.values()].map((r) => {
    if (policy === 'group') r.taxCents = taxInGross(r.grossCents, r.bps);
    r.netCents = assertCents(r.grossCents - r.taxCents, 'net');
    return r;
  });
  const totalCents = sumCents(breakdown.map((r) => r.grossCents));
  const taxCents = sumCents(breakdown.map((r) => r.taxCents));
  // Credits and sales can combine so that the net leaves the supported range even though every input was in it.
  return { totalCents, taxCents, netCents: assertCents(totalCents - taxCents, 'net total'), breakdown, lines: lineTax };
}

/**
 * Bonaire defaults (rates per Handboek ABB 2026). 2011-01-01 is when ABB replaced the old taxes;
 * it is a starting row for the till, not evidence of historic rates. Which category prepared food
 * and drinks fall under is UNVERIFIED until the accountant confirms it.
 */
export const BONAIRE_DEFAULT_TAX: TaxCategory[] = [
  { id: 'service_6', name: 'ABB 6%', kind: 'taxed', rates: [{ validFrom: '2011-01-01', bps: 600 }], unverified: true },
  { id: 'goods_8', name: 'ABB 8%', kind: 'taxed', rates: [{ validFrom: '2011-01-01', bps: 800 }], unverified: true },
  { id: 'exempt', name: 'Exempt', kind: 'exempt', rates: [], reason: 'Specify legal ground', unverified: true },
  { id: 'outside_scope', name: 'Outside scope', kind: 'outside_scope', rates: [], reason: 'Resale of imported goods', unverified: true },
];

/**
 * Business-wide switch for a business that charges no ABB at all (owner setting, Admin > Tax).
 * Whether a business qualifies is the owner's and the accountant's call; the till only records it.
 */
export const TaxExemption = z.object({
  /** True = ABB is charged as the categories say. False = every sale is recorded as exempt. */
  charged: z.boolean(),
  /** Legal ground, required while ABB is off. */
  reason: z.string().max(200).default(''),
}).refine((x) => x.charged || x.reason.trim().length > 0, { message: 'Write down why no ABB is charged', path: ['reason'] });
export type TaxExemption = z.infer<typeof TaxExemption>;
export const ABB_CHARGED: TaxExemption = { charged: true, reason: '' };

/**
 * The categories sales are priced with. While ABB is off every category becomes exempt with the owner's ground,
 * keeping its id so menu items and order lines still point at it. Sales made earlier keep their own breakdown.
 */
export function effectiveTaxCategories(cats: readonly TaxCategory[], ex: TaxExemption): TaxCategory[] {
  if (ex.charged) return [...cats];
  return cats.map((c) => ({ ...c, name: c.kind === 'taxed' ? `${c.name} (exempt)` : c.name, kind: 'exempt', rates: [], reason: ex.reason.trim() }));
}
