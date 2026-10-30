import { z } from 'zod';
import { CentsZ, IsoDateTime, PaymentMethod, PriceZ, Order } from './domain.js';
import { IsoDate, TaxBreakdownRow } from './tax.js';
import { DrawerSummary } from './cash.js';

/**
 * Day report: the money that moved on one business date.
 *  - Viewed any time during the day it is the "X report" (a reading, nothing is stored).
 *  - Closing the day stores it as a numbered "Z report", the figure the books are posted from.
 * A sale belongs to the day it was paid, a refund to the day the money was handed back, whatever day the
 * order was opened. A sale paid and refunded on the same day nets to nothing and is left out of the sales
 * figures; a refund of an earlier day's sale is taken off this day's sales, ABB and payments, so those can
 * be negative on a day with little else. Refunds are also listed separately.
 */
export const TenderTotal = z.object({
  method: PaymentMethod,
  count: z.number().int().nonnegative(),
  /** Money taken for sales by this method, less refunds of earlier days' sales (excludes tips). */
  amountCents: CentsZ,
  tipCents: CentsZ,
});
export type TenderTotal = z.infer<typeof TenderTotal>;

export const DayReport = z.object({
  businessDate: IsoDate,
  generatedAt: IsoDateTime,
  orders: z.object({
    /** Paid on this day and not refunded on this day. */
    sold: z.number().int().nonnegative(),
    /** Opened on this day, not paid yet, not voided. */
    unpaid: z.number().int().nonnegative(),
    unpaidCents: PriceZ,
    /** Opened on this day and voided before any payment. */
    voidedUnpaid: z.number().int().nonnegative(),
    /** Refunds given on this day (voided after payment), whatever day the sale was. */
    refunded: z.number().int().nonnegative(),
  }),
  sales: z.object({ grossCents: CentsZ, taxCents: CentsZ, netCents: CentsZ }),
  /** One row per tax category and rate, summed over the day's receipts. */
  tax: z.array(TaxBreakdownRow),
  tenders: z.array(TenderTotal),
  tipsCents: CentsZ,
  refunds: z.array(z.object({ method: PaymentMethod, count: z.number().int().nonnegative(), amountCents: PriceZ })),
  /**
   * Refunds given on this day for sales of an earlier day. Already taken off `sales`, `tax` and `tenders`
   * above; listed so the reader can see why. Absent when there were none (and on reports stored before 2026-10-10).
   */
  refundedEarlier: z.object({ count: z.number().int().positive(), grossCents: PriceZ, taxCents: PriceZ }).optional(),
  /**
   * Paid orders corrected on this day: `removedCents` is what the originals came to, `addedCents` what the
   * corrected sales come to. Both are already in the figures above (an original counts like a refund, its
   * replacement like a sale); corrections are not listed under `refunds`. Absent when there were none.
   */
  corrections: z.object({ count: z.number().int().positive(), removedCents: PriceZ, addedCents: PriceZ }).optional(),
  /** Cash this day's trading put in the drawer: cash taken for sales less cash handed back. Excludes any float. */
  cashExpectedCents: CentsZ,
  /** Physical drawer cash: sales plus recorded opening float/top-ups less withdrawals. */
  drawer: DrawerSummary.optional(),
  receipts: z.object({ first: z.number().int().positive().nullable(), last: z.number().int().positive().nullable(), count: z.number().int().nonnegative() }),
  items: z.array(z.object({ name: z.string(), qty: z.number().int().positive(), grossCents: PriceZ })),
  /** Sales per hour of the day they were paid, in the business time zone. */
  hours: z.array(z.object({ hour: z.number().int().min(0).max(23), orders: z.number().int().nonnegative(), grossCents: PriceZ })),
});
export type DayReport = z.infer<typeof DayReport>;

export const CloseDayBody = z.object({
  date: IsoDate,
  /** Cash counted in the drawer, excluding the float. Optional; gives the over/short figure. */
  countedCashCents: PriceZ.optional(),
  /** Older clients omit this and count sales cash only. New settlement screens count the entire drawer. */
  cashCountBasis: z.enum(['sales', 'drawer']).optional(),
  /** Refuse a settlement when sales/cash movements changed since the owner reviewed them. */
  expectedRevision: z.string().length(64).optional(),
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
  cashCountBasis: z.enum(['sales', 'drawer']).optional(),
  revision: z.string().length(64).optional(),
  /** Counted minus expected: positive is over, negative is short. Null when cash was not counted. */
  cashDifferenceCents: CentsZ.nullable(),
  note: z.string().optional(),
  report: DayReport,
});
export type ZReport = z.infer<typeof ZReport>;
export const ZReportList = z.array(ZReport);
export const ReportQuery = z.object({ date: IsoDate.optional() });
export const DayReview = z.object({ report: DayReport, closed: ZReport.nullable(), today: IsoDate,
  revision: z.string().length(64), changedSinceClose: z.boolean() });
export type DayReview = z.infer<typeof DayReview>;
export const DaySales = z.array(Order);
