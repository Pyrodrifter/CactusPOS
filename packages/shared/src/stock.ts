import { z } from 'zod';
import { IsoDate } from './tax.js';

/**
 * Simple stock (contract: docs/coordination/contracts/stock.md). Quantities are whole numbers in the unit the
 * owner names. `prepared` is what was made for today and starts at zero each business day; `processed` and
 * `whole` are the general stock and carry over.
 */
export const StockKind = z.enum(['prepared', 'processed', 'whole']);
export type StockKind = z.infer<typeof StockKind>;

export const StockItem = z.object({
  id: z.string().min(1).max(80), name: z.string().trim().min(1).max(60), kind: StockKind,
  /** Free text: pcs, kg, bags. */
  unit: z.string().trim().max(20).default(''),
  /** At or below this the row turns amber. */
  lowAt: z.number().int().min(0).max(1_000_000).optional(),
  /** Prepared items only: menu items whose sales count against what was prepared, one per item sold. */
  menuItemIds: z.array(z.string().min(1)).max(100).default([]),
});
export type StockItem = z.infer<typeof StockItem>;

/** `qty` = prepared today, or in stock. `sold` = sold today of the linked menu items. `left` = qty - sold. */
export const StockRow = StockItem.extend({ qty: z.number().int(), sold: z.number().int().min(0), left: z.number().int() });
export type StockRow = z.infer<typeof StockRow>;
export const StockList = z.object({ date: IsoDate, items: z.array(StockRow) });
export type StockList = z.infer<typeof StockList>;

export const StockAdjustBody = z.object({ delta: z.number().int().min(-1_000_000).max(1_000_000).refine((n) => n !== 0) });
