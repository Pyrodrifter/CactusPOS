import { describe, expect, it } from 'vitest';
import { ABB_CHARGED, BONAIRE_DEFAULT_TAX, computeTotals, effectiveTaxCategories, grossFromNet, rateAt, taxInGross, TaxExemption, TaxCategorySchema, type TaxCategory } from './tax.js';
import { assertCents, formatMoney, MAX_CENTS, parseMoney, roundDiv, sumCents } from './money.js';

const D = '2026-10-07';

describe('money', () => {
  it('rounds half away from zero, exactly', () => {
    expect(roundDiv(5, 2)).toBe(3);
    expect(roundDiv(-5, 2)).toBe(-3);
    expect(roundDiv(4, 3)).toBe(1);
    expect(roundDiv(1, 2)).toBe(1);
    expect(roundDiv(49, 100)).toBe(0);
    expect(roundDiv(50, 100)).toBe(1);
  });
  it('never returns negative zero', () => {
    expect(Object.is(roundDiv(-1, 100), 0)).toBe(true);
    expect(Object.is(taxInGross(-1, 600), 0)).toBe(true);
  });
  it('is exact at the largest supported amount (checked against BigInt)', () => {
    for (const bps of [600, 800, 9999]) {
      const exact = (BigInt(MAX_CENTS) * BigInt(bps) * 2n + BigInt(10000 + bps)) / (BigInt(10000 + bps) * 2n);
      expect(taxInGross(MAX_CENTS, bps)).toBe(Number(exact));
    }
  });
  it('rejects invalid divisors and non-integers', () => {
    expect(() => roundDiv(1, 0)).toThrow();
    expect(() => roundDiv(1, -3)).toThrow();
    expect(() => roundDiv(1.5, 2)).toThrow();
    expect(() => roundDiv(NaN, 2)).toThrow();
  });
  it('assertCents rejects fractions, NaN, infinity and out-of-range amounts', () => {
    for (const bad of [0.5, NaN, Infinity, MAX_CENTS + 1, -MAX_CENTS - 1, 2 ** 53 + 2]) expect(() => assertCents(bad)).toThrow();
    expect(assertCents(-1975)).toBe(-1975);
    expect(() => sumCents([MAX_CENTS, 1])).toThrow();
  });
  it('parses user input and refuses absurd amounts', () => {
    expect(parseMoney('12,5')).toBe(1250);
    expect(parseMoney('0.99')).toBe(99);
    expect(parseMoney(' 19.75 ')).toBe(1975);
    expect(parseMoney('abc')).toBeNull();
    expect(parseMoney('-5')).toBeNull();
    expect(parseMoney('1.234')).toBeNull();
    expect(parseMoney('90071992547409.93')).toBeNull();
    expect(parseMoney('100000000')).toBe(MAX_CENTS);
    expect(parseMoney('100000000.01')).toBeNull();
  });
});

describe('ABB contained in an inclusive price', () => {
  it('6% and 8% against hand-worked values', () => {
    expect(taxInGross(1060, 600)).toBe(60);   // 10.00 net
    expect(taxInGross(1000, 600)).toBe(57);   // 56.60
    expect(taxInGross(1975, 600)).toBe(112);  // 111.79
    expect(taxInGross(1080, 800)).toBe(80);
    expect(taxInGross(500, 800)).toBe(37);    // 37.04
    expect(taxInGross(275, 600)).toBe(16);    // 15.57
    expect(taxInGross(1234, 0)).toBe(0);
  });
  it('rounding ties go away from zero', () => {
    expect(taxInGross(53, 10000)).toBe(27);   // 26.5
    expect(taxInGross(-53, 10000)).toBe(-27);
  });
  it('refunds mirror sales', () => {
    expect(taxInGross(-1975, 600)).toBe(-112);
  });
  it('net + tax is exactly the price charged, for every price up to $100', () => {
    for (const bps of [600, 800]) {
      for (let gross = 0; gross <= 10000; gross++) {
        const tax = taxInGross(gross, bps);
        const net = gross - tax;
        expect(net + tax).toBe(gross);
        // The extracted tax is the correctly rounded share: within half a cent of gross*r/(1+r).
        expect(Math.abs(tax * (10000 + bps) - gross * bps) * 2).toBeLessThanOrEqual(10000 + bps);
      }
    }
  });
  it('an inclusive price built from a whole-cent net round-trips', () => {
    for (let net = 0; net <= 5000; net += 7) {
      const gross = net + roundDiv(net * 600, 10000);
      expect(gross - taxInGross(gross, 600)).toBe(net);
    }
  });
  it('a price typed without ABB becomes the inclusive price, and the receipt gives the same ABB back', () => {
    expect(grossFromNet(1500, 600)).toBe(1590);  // 15.00 + 0.90
    expect(grossFromNet(1000, 800)).toBe(1080);
    expect(grossFromNet(275, 600)).toBe(292);    // 2.75 + 0.165, tie rounds up
    expect(grossFromNet(1234, 0)).toBe(1234);
    for (const bps of [0, 600, 700, 800]) {
      for (let net = 0; net <= 20000; net++) {
        const gross = grossFromNet(net, bps);
        expect(taxInGross(gross, bps)).toBe(gross - net);
      }
    }
    expect(() => grossFromNet(100.5, 600)).toThrow();
  });
  it('rejects bad rates and amounts instead of producing NaN', () => {
    expect(() => taxInGross(NaN, 600)).toThrow();
    expect(() => taxInGross(100.5, 600)).toThrow();
    expect(() => taxInGross(100, -10000)).toThrow();
    expect(() => taxInGross(100, 6.5)).toThrow();
    expect(() => taxInGross(100, Infinity)).toThrow();
  });
});

describe('receipt totals', () => {
  it('mixed cart: full breakdown against hand-worked values', () => {
    const t = computeTotals(
      [
        { taxCategoryId: 'service_6', grossCents: 1250 }, // 70.75 -> 71
        { taxCategoryId: 'service_6', grossCents: 350 },  // 19.81 -> 20
        { taxCategoryId: 'goods_8', grossCents: 500 },    // 37.04 -> 37
        { taxCategoryId: 'exempt', grossCents: 300 },
        { taxCategoryId: 'outside_scope', grossCents: 200 },
      ],
      BONAIRE_DEFAULT_TAX, D);
    expect(t.totalCents).toBe(2600);
    expect(t.taxCents).toBe(128);
    expect(t.netCents).toBe(2472);
    expect(t.lines.map((l) => l.taxCents)).toEqual([71, 20, 37, 0, 0]);
    const row = (id: string) => t.breakdown.find((b) => b.taxCategoryId === id)!;
    expect(row('service_6')).toMatchObject({ bps: 600, grossCents: 1600, taxCents: 91, netCents: 1509, kind: 'taxed' });
    expect(row('goods_8')).toMatchObject({ bps: 800, grossCents: 500, taxCents: 37, netCents: 463 });
    expect(row('exempt')).toMatchObject({ bps: 0, grossCents: 300, taxCents: 0, netCents: 300, kind: 'exempt' });
    expect(row('outside_scope')).toMatchObject({ grossCents: 200, taxCents: 0, kind: 'outside_scope' });
  });
  it('per-line rounding (default, same as the books) vs per-group rounding', () => {
    const lines = [{ taxCategoryId: 'service_6', grossCents: 9 }, { taxCategoryId: 'service_6', grossCents: 9 }];
    const byLine = computeTotals(lines, BONAIRE_DEFAULT_TAX, D);
    const byGroup = computeTotals(lines, BONAIRE_DEFAULT_TAX, D, 'group');
    expect(byLine.taxCents).toBe(2);   // 0.51 -> 1, twice
    expect(byGroup.taxCents).toBe(1);  // 1.02 -> 1
    // Either way the customer pays the sum of the prices, and the receipt adds up.
    for (const t of [byLine, byGroup]) {
      expect(t.totalCents).toBe(18);
      expect(t.netCents + t.taxCents).toBe(18);
      expect(t.breakdown[0]!.netCents + t.breakdown[0]!.taxCents).toBe(18);
    }
    expect(byLine.lines.reduce((s, l) => s + l.taxCents, 0)).toBe(byLine.taxCents);
  });
  it('an empty receipt is zero', () => {
    expect(computeTotals([], BONAIRE_DEFAULT_TAX, D)).toMatchObject({ totalCents: 0, taxCents: 0, netCents: 0, breakdown: [] });
  });
  it('rejects fractional cents, unknown categories and overflow', () => {
    expect(() => computeTotals([{ taxCategoryId: 'exempt', grossCents: 0.5 }], BONAIRE_DEFAULT_TAX, D)).toThrow();
    expect(() => computeTotals([{ taxCategoryId: 'nope', grossCents: 1 }], BONAIRE_DEFAULT_TAX, D)).toThrow(/Unknown tax category/);
    expect(() => computeTotals([{ taxCategoryId: 'exempt', grossCents: MAX_CENTS }, { taxCategoryId: 'exempt', grossCents: 1 }], BONAIRE_DEFAULT_TAX, D)).toThrow();
  });
});

describe('review R7: formatting and signed totals stay inside the supported range', () => {
  it('formatMoney rejects what is not integer cents in range', () => {
    for (const bad of [0.5, NaN, Infinity, MAX_CENTS + 1, -MAX_CENTS - 1]) expect(() => formatMoney(bad)).toThrow();
    expect(formatMoney(1975)).toBe('$19.75');
    expect(formatMoney(-500)).toBe('-$5.00');
    expect(formatMoney(MAX_CENTS)).toBe('$100,000,000.00');
  });
  it('a net total outside the range is an error, not a returned value', () => {
    expect(() => computeTotals([
      { taxCategoryId: 'service_6', grossCents: MAX_CENTS },
      { taxCategoryId: 'exempt', grossCents: -MAX_CENTS },
      { taxCategoryId: 'outside_scope', grossCents: -MAX_CENTS },
    ], BONAIRE_DEFAULT_TAX, D)).toThrow(/out of range/);
    // the same shape inside the range is fine and every returned amount passes assertCents
    const t = computeTotals([
      { taxCategoryId: 'service_6', grossCents: 1060 },
      { taxCategoryId: 'exempt', grossCents: -300 },
      { taxCategoryId: 'outside_scope', grossCents: -200 },
    ], BONAIRE_DEFAULT_TAX, D);
    expect(t).toMatchObject({ totalCents: 560, taxCents: 60, netCents: 500 });
    for (const v of [t.totalCents, t.taxCents, t.netCents, ...t.breakdown.flatMap((b) => [b.grossCents, b.taxCents, b.netCents])]) expect(assertCents(v)).toBe(v);
  });
});

describe('effective dates', () => {
  const cat: TaxCategory = { id: 'x', name: 'x', kind: 'taxed', rates: [{ validFrom: '2027-01-01', bps: 700 }, { validFrom: '2011-01-01', bps: 600 }] };
  it('picks the rate in force, whatever order the history is stored in', () => {
    expect(rateAt(cat, '2026-12-31')).toBe(600);
    expect(rateAt(cat, '2027-01-01')).toBe(700);
    expect(rateAt(cat, '2011-01-01')).toBe(600);
  });
  it('a sale before the first rate is an error, not 0%', () => {
    expect(() => rateAt(cat, '2010-12-31')).toThrow(/no rate/);
    expect(() => computeTotals([{ taxCategoryId: 'service_6', grossCents: 100 }], BONAIRE_DEFAULT_TAX, '1999-01-01')).toThrow(/no rate/);
  });
  it('exempt and outside-scope are always 0', () => {
    expect(rateAt(BONAIRE_DEFAULT_TAX[2]!, '1999-01-01')).toBe(0);
    expect(rateAt(BONAIRE_DEFAULT_TAX[3]!, D)).toBe(0);
  });
  it('rejects duplicate start dates and impossible dates', () => {
    expect(() => rateAt({ ...cat, rates: [{ validFrom: '2011-01-01', bps: 600 }, { validFrom: '2011-01-01', bps: 700 }] }, D)).toThrow(/two rates/);
    expect(() => rateAt(cat, '2026-02-30')).toThrow(/Bad date/);
    expect(TaxCategorySchema.safeParse({ ...cat, rates: [{ validFrom: '2026-13-01', bps: 600 }] }).success).toBe(false);
    expect(TaxCategorySchema.safeParse({ ...cat, rates: [{ validFrom: '2011-01-01', bps: 600 }, { validFrom: '2011-01-01', bps: 700 }] }).success).toBe(false);
    expect(TaxCategorySchema.safeParse({ ...cat, rates: [{ validFrom: '2011-01-01', bps: 600.5 }] }).success).toBe(false);
    expect(TaxCategorySchema.safeParse({ ...cat, rates: [] }).success).toBe(false);
  });
  it('the shipped defaults are valid and still flagged unverified', () => {
    for (const c of BONAIRE_DEFAULT_TAX) {
      expect(TaxCategorySchema.safeParse(c).success).toBe(true);
      expect(c.unverified).toBe(true);
    }
  });
});

describe('ABB switched off for the whole business', () => {
  const off = { charged: false, reason: 'Food truck exemption' };
  it('changes nothing while ABB is charged', () => {
    expect(effectiveTaxCategories(BONAIRE_DEFAULT_TAX, ABB_CHARGED)).toEqual(BONAIRE_DEFAULT_TAX);
  });
  it('records every sale as exempt, same total, no ABB, same category ids', () => {
    const cats = effectiveTaxCategories(BONAIRE_DEFAULT_TAX, off);
    expect(cats.map((c) => c.id)).toEqual(BONAIRE_DEFAULT_TAX.map((c) => c.id));
    for (const c of cats) expect(TaxCategorySchema.safeParse(c).success).toBe(true);
    const t = computeTotals([{ taxCategoryId: 'service_6', grossCents: 1975 }, { taxCategoryId: 'goods_8', grossCents: 275 }], cats, D);
    expect(t).toMatchObject({ totalCents: 2250, taxCents: 0, netCents: 2250 });
    expect(t.breakdown.every((r) => r.kind === 'exempt' && r.bps === 0)).toBe(true);
    expect(cats[0]).toMatchObject({ name: 'ABB 6% (exempt)', reason: 'Food truck exemption' });
  });
  it('cannot be switched off without a reason', () => {
    expect(TaxExemption.safeParse({ charged: false, reason: '  ' }).success).toBe(false);
    expect(TaxExemption.safeParse(off).success).toBe(true);
    expect(TaxExemption.safeParse({ charged: true }).success).toBe(true);
  });
});
