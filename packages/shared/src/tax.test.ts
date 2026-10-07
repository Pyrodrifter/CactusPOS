import { describe, expect, it } from 'vitest';
import { BONAIRE_DEFAULT_TAX, computeTotals, rateAt, taxInGross } from './tax.js';
import { parseMoney, roundDiv } from './money.js';

describe('money', () => {
  it('rounds half away from zero', () => {
    expect(roundDiv(5, 2)).toBe(3);
    expect(roundDiv(-5, 2)).toBe(-3);
    expect(roundDiv(4, 3)).toBe(1);
  });
  it('parses', () => {
    expect(parseMoney('12,5')).toBe(1250);
    expect(parseMoney('0.99')).toBe(99);
    expect(parseMoney('abc')).toBeNull();
  });
});

describe('ABB inclusive tax', () => {
  it('extracts 6% from an inclusive price', () => {
    expect(taxInGross(1060, 600)).toBe(60);
    expect(taxInGross(1000, 600)).toBe(57);
  });
  it('mixed cart groups by category and totals equal gross', () => {
    const t = computeTotals(
      [
        { taxCategoryId: 'service_6', grossCents: 1250 },
        { taxCategoryId: 'service_6', grossCents: 350 },
        { taxCategoryId: 'goods_8', grossCents: 500 },
        { taxCategoryId: 'exempt', grossCents: 300 },
      ],
      BONAIRE_DEFAULT_TAX, '2026-10-07');
    expect(t.totalCents).toBe(2400);
    expect(t.breakdown.find((b) => b.taxCategoryId === 'service_6')!.taxCents).toBe(taxInGross(1600, 600));
    expect(t.breakdown.find((b) => b.taxCategoryId === 'exempt')!.taxCents).toBe(0);
    expect(t.taxCents + t.netCents).toBe(t.totalCents);
  });
  it('respects effective dates', () => {
    const cat = { id: 'x', name: 'x', kind: 'taxed' as const, rates: [{ validFrom: '2000-01-01', bps: 600 }, { validFrom: '2027-01-01', bps: 700 }] };
    expect(rateAt(cat, '2026-12-31')).toBe(600);
    expect(rateAt(cat, '2027-01-01')).toBe(700);
  });
  it('rejects unknown categories', () => {
    expect(() => computeTotals([{ taxCategoryId: 'nope', grossCents: 1 }], BONAIRE_DEFAULT_TAX, '2026-10-07')).toThrow();
  });
});
