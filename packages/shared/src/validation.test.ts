import { describe, expect, it } from 'vitest';
import { CreateOrderBody, MenuItem, PayBody, PriceZ } from './domain.js';
import { DocumentDesign } from './receiptDesign.js';

describe('validation compatibility after the Zod 4 security update', () => {
  it('keeps old checkout payload defaults and strips unknown fields', () => {
    expect(CreateOrderBody.parse({ lines: [{ itemId: 'fixture', qty: 1 }], ignored: true })).toEqual({
      lines: [{ itemId: 'fixture', qty: 1, modifierOptionIds: [] }], source: 'pos',
    });
    expect(PayBody.parse({ method: 'card' })).toEqual({ method: 'card', tipCents: 0 });
    expect(MenuItem.parse({ id: 'fixture', categoryId: 'food', name: 'Fixture', priceCents: 100, taxCategoryId: 'food' }))
      .toMatchObject({ station: 'kitchen', available: true, openPrice: false, modifierGroups: [] });
  });

  it('keeps legacy receipt design defaults without inventing optional text styles', () => {
    const legacy = DocumentDesign.parse({ widthMm: 58, footer: 'Thank you' });
    expect(legacy).toMatchObject({ widthMm: 58, footer: 'Thank you', logo: null, nameArt: null, closing: null, codes: [], messages: [] });
    expect(legacy).not.toHaveProperty('nameStyle');
    expect(legacy).not.toHaveProperty('titleStyle');
  });

  it('refuses oversized orders and invalid money after the validator change', () => {
    expect(CreateOrderBody.safeParse({ lines: Array.from({ length: 101 }, () => ({ itemId: 'fixture', qty: 1 })) }).success).toBe(false);
    for (const cents of [-1, 1.5, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1]) {
      expect(PriceZ.safeParse(cents).success).toBe(false);
    }
  });
});
