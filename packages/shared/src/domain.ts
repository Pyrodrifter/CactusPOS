import { z } from 'zod';

export const Role = z.enum(['owner', 'staff']);
export type Role = z.infer<typeof Role>;

export const ModifierOption = z.object({ id: z.string(), name: z.string(), priceDeltaCents: z.number().int() });
export const ModifierGroup = z.object({
  id: z.string(), name: z.string(), required: z.boolean().default(false),
  multi: z.boolean().default(false), options: z.array(ModifierOption),
});
export type ModifierGroup = z.infer<typeof ModifierGroup>;

export const MenuItem = z.object({
  id: z.string(), categoryId: z.string(), name: z.string(),
  /** Tax-inclusive price. */
  priceCents: z.number().int().nonnegative(),
  taxCategoryId: z.string(),
  station: z.string().default('kitchen'),
  available: z.boolean().default(true),
  modifierGroups: z.array(ModifierGroup).default([]),
  /** Market-price item: the cashier types the price for each sale (e.g. catch of the day). */
  openPrice: z.boolean().default(false),
  description: z.string().max(300).optional(),
});
export type MenuItem = z.infer<typeof MenuItem>;

export const MenuCategory = z.object({ id: z.string(), name: z.string(), sort: z.number().int().default(0) });
export type MenuCategory = z.infer<typeof MenuCategory>;

export const OrderLineInput = z.object({
  itemId: z.string(),
  qty: z.number().int().min(1).max(99),
  modifierOptionIds: z.array(z.string()).default([]),
  note: z.string().max(200).optional(),
  /** Tax-inclusive price typed at the counter. Required for, and only used by, openPrice items. */
  priceCents: z.number().int().positive().max(1_000_000).optional(),
});
export type OrderLineInput = z.infer<typeof OrderLineInput>;

export const OrderLine = z.object({
  id: z.string(), itemId: z.string(), name: z.string(), qty: z.number().int(),
  unitPriceCents: z.number().int(),
  modifiers: z.array(z.object({ id: z.string(), name: z.string(), priceDeltaCents: z.number().int() })),
  note: z.string().optional(), taxCategoryId: z.string(), station: z.string(),
  lineTotalCents: z.number().int(),
});
export type OrderLine = z.infer<typeof OrderLine>;

export const PaymentMethod = z.enum(['cash', 'card']);
export const Payment = z.object({
  id: z.string(), method: PaymentMethod, amountCents: z.number().int(),
  tenderedCents: z.number().int().optional(), changeCents: z.number().int().optional(),
  reference: z.string().optional(), tipCents: z.number().int().default(0), at: z.string(),
});
export type Payment = z.infer<typeof Payment>;

export const FulfilmentStatus = z.enum(['sent', 'preparing', 'ready', 'collected', 'void']);
export type FulfilmentStatus = z.infer<typeof FulfilmentStatus>;

export const Order = z.object({
  id: z.string(),
  /** Short number shown on tickets / pickup board; restarts daily. */
  ticketNumber: z.number().int(),
  /** Gapless legal receipt number, assigned on payment. */
  receiptNumber: z.number().int().nullable(),
  status: FulfilmentStatus,
  paid: z.boolean(),
  lines: z.array(OrderLine),
  payments: z.array(Payment),
  note: z.string().optional(),
  source: z.enum(['pos', 'mobile', 'guest']).default('pos'),
  totalCents: z.number().int(),
  taxCents: z.number().int(),
  breakdown: z.array(z.object({
    taxCategoryId: z.string(), name: z.string(), kind: z.string(), bps: z.number(),
    grossCents: z.number(), taxCents: z.number(), netCents: z.number(),
  })),
  voidReason: z.string().optional(),
  createdAt: z.string(), updatedAt: z.string(), createdBy: z.string(),
});
export type Order = z.infer<typeof Order>;

export const CreateOrderBody = z.object({
  lines: z.array(OrderLineInput).min(1),
  note: z.string().max(300).optional(),
  source: z.enum(['pos', 'mobile', 'guest']).default('pos'),
});
export const PayBody = z.object({
  method: PaymentMethod, tenderedCents: z.number().int().optional(),
  reference: z.string().max(60).optional(), tipCents: z.number().int().min(0).default(0),
});
export const StatusBody = z.object({ status: z.enum(['preparing', 'ready', 'collected']) });
export const VoidBody = z.object({ reason: z.string().min(2).max(200), managerPin: z.string().optional() });
export const LoginBody = z.object({ pin: z.string().min(3).max(12) });

/** WebSocket events (server -> clients). */
export type ServerEvent =
  | { type: 'order.changed'; order: Order }
  | { type: 'menu.changed' }
  | { type: 'pickup.changed'; preparing: number[]; ready: number[] }
  | { type: 'hello'; serverTime: string };

export type CreateOrderBodyT = z.infer<typeof CreateOrderBody>;
export type PayBodyT = z.infer<typeof PayBody>;

/* ---------- Admin contracts (owner only) ---------- */
export const TaxCategorySchema = z.object({
  id: z.string().min(1).max(40),
  name: z.string().min(1).max(60),
  kind: z.enum(['taxed', 'exempt', 'outside_scope']),
  rates: z.array(z.object({ validFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), bps: z.number().int().min(0).max(10000) })),
  reason: z.string().max(200).optional(),
  unverified: z.boolean().optional(),
});
export const BusinessSchema = z.object({
  name: z.string().min(1).max(80), crib: z.string().max(30), address: z.string().max(200), phone: z.string().max(40),
  timezone: z.string().min(1).max(60), currency: z.string().length(3), locale: z.enum(['en', 'nl']),
  receiptFooter: z.string().max(300),
  /** Optional top-bar colour, e.g. #0f1d4a. */
  brandColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
});
export type Business = z.infer<typeof BusinessSchema>;
export const StaffInput = z.object({
  name: z.string().min(1).max(40), role: Role, active: z.boolean().default(true),
  /** 4-8 digits. Omit to keep the current PIN. */
  pin: z.string().regex(/^\d{4,8}$/).optional(),
});
export type StaffInputT = z.infer<typeof StaffInput>;
export interface StaffRow { id: string; name: string; role: Role; active: boolean }
export const AvailabilityBody = z.object({ available: z.boolean() });
