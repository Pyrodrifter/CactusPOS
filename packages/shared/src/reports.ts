import { z } from 'zod';
import { CentsZ, IsoDateTime, PaymentMethod, PriceZ } from './domain.js';
import { IsoDate, TaxBreakdownRow } from './tax.js';

/**
 * Day report: everything sold on one business date.
 *  - Viewed any time during the day it is the "X report" (a reading, nothing is stored).
 *  - Closing the day stores it as a numbered "Z report", the figure the books are posted from.
 * "Sales" are paid orders that were not voided. Orders voided after payment are shown separately
 * as refunds and are not part of sales.
 */
export const TenderTotal = z.object({
  method: PaymentMethod,
  count: z.number().int().nonnegative(),
  /** Money taken for sales by this method (excludes tips). */
  amountCents: PriceZ,
  tipCents: PriceZ,
});
export type TenderTotal = z.infer<typeof TenderTotal>;

export const DayReport = z.object({
  businessDate: IsoDate,
  generatedAt: IsoDateTime,
  orders: z.object({
    /** Paid, not voided. */
    sold: z.number().int().nonnegative(),
    /** Sent but not paid yet, not voided. */
    unpaid: z.number().int().nonnegative(),
    unpaidCents: PriceZ,
    /** Voided before any payment. */
    voidedUnpaid: z.number().int().nonnegative(),
    /** Voided after payment: money handed back. */
    refunded: z.number().int().nonnegative(),
  }),
  sales: z.object({ grossCents: PriceZ, taxCents: PriceZ, netCents: PriceZ }),
  /** One row per tax category and rate, summed over the day's receipts. */
  tax: z.array(TaxBreakdownRow),
  tenders: z.array(TenderTotal),
  tipsCents: PriceZ,
  refunds: z.array(z.object({ method: PaymentMethod, count: z.number().int().nonnegative(), amountCents: PriceZ })),
  /** Cash that should be in the drawer from today's trading: cash from sales that stand (refunded sales net to nothing). Excludes any float. */
  cashExpectedCents: CentsZ,
  receipts: z.object({ first: z.number().int().positive().nullable(), last: z.number().int().positive().nullable(), count: z.number().int().nonnegative() }),
  items: z.array(z.object({ name: z.string(), qty: z.number().int().positive(), grossCents: PriceZ })),
  /** Sales per hour of the day in the business time zone. */
  hours: z.array(z.object({ hour: z.number().int().min(0).max(23), orders: z.number().int().nonnegative(), grossCents: PriceZ })),
});
export type DayReport = z.infer<typeof DayReport>;

export const CloseDayBody = z.object({
  date: IsoDate,
  /** Cash counted in the drawer, excluding the float. Optional; gives the over/short figure. */
  countedCashCents: PriceZ.optional(),
  note: z.string().max(300).optional(),
});
export type CloseDayBodyT = z.infer<typeof CloseDayBody>;

export const ZReport = z.object({
  /** Sequential, never reused. */
  number: z.number().int().positive(),
  businessDate: IsoDate,
  closedAt: IsoDateTime,
  closedBy: z.string(),
  countedCashCents: PriceZ.nullable(),
  /** Counted minus expected: positive is over, negative is short. Null when cash was not counted. */
  cashDifferenceCents: CentsZ.nullable(),
  note: z.string().optional(),
  report: DayReport,
});
export type ZReport = z.infer<typeof ZReport>;
export const ZReportList = z.array(ZReport);
export const ReportQuery = z.object({ date: IsoDate.optional() });
