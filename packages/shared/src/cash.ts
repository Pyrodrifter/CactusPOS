import { z } from 'zod';
import { CentsZ, IsoDateTime, PriceZ } from './domain.js';
import { IsoDate } from './tax.js';

export const CashMovementBody = z.object({
  direction: z.enum(['in', 'out']), amountCents: PriceZ.refine((value) => value > 0, 'Amount must be positive'),
  reason: z.string().trim().min(1).max(300), reverses: z.string().min(1).optional(),
});
export type CashMovementBody = z.infer<typeof CashMovementBody>;
export const CashMovement = CashMovementBody.extend({
  id: z.string().min(1), businessDate: IsoDate, at: IsoDateTime, staffId: z.string(), staffName: z.string(),
});
export type CashMovement = z.infer<typeof CashMovement>;
export const CashRequestStatus = z.object({ movement: CashMovement.nullable() });
export type CashRequestStatus = z.infer<typeof CashRequestStatus>;
export const DrawerSummary = z.object({
  cashInCents: PriceZ, cashOutCents: PriceZ, expectedCents: CentsZ, movements: z.array(CashMovement),
});
export type DrawerSummary = z.infer<typeof DrawerSummary>;
