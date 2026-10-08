import { z } from 'zod';
import { MAX_CENTS } from './money.js';
import { TaxBreakdownRow, TaxCategorySchema } from './tax.js';

/**
 * Wire and storage contracts. Everything that crosses a package boundary is a zod schema here;
 * the docs in docs/coordination/contracts/ explain intent and give examples.
 */

/** Integer cents within the supported range. */
export const CentsZ = z.number().int().min(-MAX_CENTS).max(MAX_CENTS);
/** A price or amount that cannot be negative. */
export const PriceZ = z.number().int().min(0).max(MAX_CENTS);
export const IsoDateTime = z.string().min(10);

export const Role = z.enum(['owner', 'staff']);
export type Role = z.infer<typeof Role>;

/* ---------- menu ---------- */
/**
 * "Modifier" in the plan = one ModifierOption (e.g. "Extra cheese +$1").
 * Options are grouped in a ModifierGroup that says whether a choice is required and whether
 * several may be picked. Option ids must be unique within an item.
 */
export const ModifierOption = z.object({ id: z.string().min(1), name: z.string().min(1).max(60), priceDeltaCents: CentsZ });
export type ModifierOption = z.infer<typeof ModifierOption>;
export const ModifierGroup = z.object({
  id: z.string().min(1), name: z.string().max(60), required: z.boolean().default(false),
  multi: z.boolean().default(false), options: z.array(ModifierOption),
});
export type ModifierGroup = z.infer<typeof ModifierGroup>;

export const MenuItem = z.object({
  id: z.string().min(1), categoryId: z.string().min(1), name: z.string().min(1).max(80),
  /** Tax-inclusive price. */
  priceCents: PriceZ,
  taxCategoryId: z.string().min(1),
  station: z.string().default('kitchen'),
  available: z.boolean().default(true),
  modifierGroups: z.array(ModifierGroup).default([]),
  /** Market-price item: the cashier types the price for each sale (e.g. catch of the day). */
  openPrice: z.boolean().default(false),
  description: z.string().max(300).optional(),
});
export type MenuItem = z.infer<typeof MenuItem>;

export const MenuCategory = z.object({ id: z.string().min(1), name: z.string().min(1).max(60), sort: z.number().int().default(0) });
export type MenuCategory = z.infer<typeof MenuCategory>;

/* ---------- orders ---------- */
export const OrderLineInput = z.object({
  itemId: z.string(),
  qty: z.number().int().min(1).max(99),
  modifierOptionIds: z.array(z.string()).default([]),
  note: z.string().max(200).optional(),
  /** Tax-inclusive price typed at the counter. Required for, and only used by, openPrice items. */
  priceCents: z.number().int().positive().max(1_000_000).optional(),
});
export type OrderLineInput = z.infer<typeof OrderLineInput>;

/** A line keeps its own copy of name, price and tax, so later menu or rate changes never rewrite history. */
export const OrderLine = z.object({
  id: z.string(), itemId: z.string(), name: z.string(), qty: z.number().int().min(1),
  unitPriceCents: PriceZ,
  modifiers: z.array(ModifierOption),
  note: z.string().optional(), taxCategoryId: z.string(), station: z.string(),
  lineTotalCents: PriceZ,
  /** ABB contained in lineTotalCents. Absent on orders stored before per-line tax was recorded. */
  taxCents: CentsZ.optional(),
  /** Which round of the order this line was added in. Absent means the first. */
  round: z.number().int().positive().optional(),
});
export type OrderLine = z.infer<typeof OrderLine>;

export const PaymentMethod = z.enum(['cash', 'card']);
export type PaymentMethod = z.infer<typeof PaymentMethod>;
export const Payment = z.object({
  id: z.string(), method: PaymentMethod, amountCents: PriceZ,
  tenderedCents: PriceZ.optional(), changeCents: PriceZ.optional(),
  reference: z.string().optional(), tipCents: PriceZ.default(0), at: IsoDateTime,
});
export type Payment = z.infer<typeof Payment>;

export const FulfilmentStatus = z.enum(['sent', 'preparing', 'ready', 'collected', 'void']);
export type FulfilmentStatus = z.infer<typeof FulfilmentStatus>;
export const OrderSource = z.enum(['pos', 'mobile', 'guest']);

export const Order = z.object({
  id: z.string(),
  /** Short number shown on tickets / pickup board; restarts daily. */
  ticketNumber: z.number().int().positive(),
  /** Gapless legal receipt number, assigned on payment. */
  receiptNumber: z.number().int().positive().nullable(),
  status: FulfilmentStatus,
  paid: z.boolean(),
  lines: z.array(OrderLine),
  payments: z.array(Payment),
  note: z.string().optional(),
  source: OrderSource.default('pos'),
  totalCents: PriceZ,
  taxCents: PriceZ,
  breakdown: z.array(TaxBreakdownRow),
  voidReason: z.string().optional(),
  /**
   * Tabs. An unpaid order is an open tab: it can be given a name, more rounds of items can be added
   * to it, and it is paid once at the end, on one receipt.
   */
  tabName: z.string().max(40).optional(),
  /** Number of the latest round added. Absent means 1. */
  round: z.number().int().positive().optional(),
  /** First round the kitchen still has to make; earlier rounds were already handed over. Absent means 1. */
  kitchenRound: z.number().int().positive().optional(),
  createdAt: IsoDateTime, updatedAt: IsoDateTime, createdBy: z.string(),
});
export type Order = z.infer<typeof Order>;

/** The lines the kitchen still has to make: everything from `kitchenRound` on. */
export function kitchenLines(order: Order): OrderLine[] {
  const from = order.kitchenRound ?? 1;
  return order.lines.filter((l) => (l.round ?? 1) >= from);
}
/** An open tab is any order that is neither paid nor void. */
export function isOpenTab(order: Order): boolean {
  return !order.paid && order.status !== 'void';
}

/**
 * The legal record of a sale: what the printed receipt must be reproducible from.
 * Today it is derived from a paid Order; the template engine (T13/T30) adds templateVersion.
 */
export const Receipt = z.object({
  receiptNumber: z.number().int().positive(),
  orderId: z.string(),
  issuedAt: IsoDateTime,
  totalCents: PriceZ,
  taxCents: PriceZ,
  breakdown: z.array(TaxBreakdownRow),
  templateVersion: z.number().int().positive().nullable().default(null),
});
export type Receipt = z.infer<typeof Receipt>;

/* ---------- people and devices ---------- */
export const StaffSchema = z.object({ id: z.string(), name: z.string(), role: Role });
export type Staff = z.infer<typeof StaffSchema>;
export const StaffRowSchema = StaffSchema.extend({ active: z.boolean() });
export type StaffRow = z.infer<typeof StaffRowSchema>;

/**
 * A screen registered with the server and the role it plays. Planned shape for T21b;
 * no route produces it yet, so treat fields as provisional until that task lands.
 */
export const DeviceRole = z.enum(['counter', 'kitchen', 'pickup', 'mobile', 'admin']);
export const Device = z.object({ id: z.string(), name: z.string().min(1).max(40), role: DeviceRole, registeredAt: IsoDateTime });
export type Device = z.infer<typeof Device>;

export const BusinessSchema = z.object({
  name: z.string().min(1).max(80), crib: z.string().max(30), address: z.string().max(200), phone: z.string().max(40),
  timezone: z.string().min(1).max(60), currency: z.string().length(3), locale: z.enum(['en', 'nl']),
  receiptFooter: z.string().max(300),
  /** Optional top-bar colour, e.g. #0f1d4a. */
  brandColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
});
export type Business = z.infer<typeof BusinessSchema>;

/* ---------- HTTP requests ---------- */
export const CreateOrderBody = z.object({
  lines: z.array(OrderLineInput).min(1).max(100),
  note: z.string().max(300).optional(),
  source: OrderSource.default('pos'),
  /** Name for a tab that will be paid later, e.g. the guest's first name. */
  tabName: z.string().trim().min(1).max(40).optional(),
});
export type CreateOrderBodyT = z.infer<typeof CreateOrderBody>;
export const PayBody = z.object({
  method: PaymentMethod, tenderedCents: PriceZ.optional(),
  reference: z.string().max(60).optional(), tipCents: PriceZ.default(0),
});
export type PayBodyT = z.infer<typeof PayBody>;
export const StatusBody = z.object({ status: z.enum(['preparing', 'ready', 'collected']) });
export const VoidBody = z.object({ reason: z.string().min(2).max(200), managerPin: z.string().optional() });
export const LoginBody = z.object({ pin: z.string().min(3).max(12) });
/** `open` = every unpaid, non-void order whatever day it was started (yesterday's forgotten tab stays payable). */
export const OrdersQuery = z.object({ scope: z.enum(['active', 'today', 'open']).default('active') });
/** Adds a round of items to an open tab. */
export const AddLinesBody = z.object({ lines: z.array(OrderLineInput).min(1).max(100) });
export type AddLinesBodyT = z.infer<typeof AddLinesBody>;
/** Names or renames a tab; an empty name removes it. */
export const TabNameBody = z.object({ tabName: z.string().trim().max(40) });
export const IdParams = z.object({ id: z.string().min(1).max(80) });
export const StaffInput = z.object({
  name: z.string().min(1).max(40), role: Role, active: z.boolean().default(true),
  /** 4-8 digits. Omit to keep the current PIN. */
  pin: z.string().regex(/^\d{4,8}$/).optional(),
});
export type StaffInputT = z.infer<typeof StaffInput>;
export const AvailabilityBody = z.object({ available: z.boolean() });

/**
 * Sent as the `Idempotency-Key` header on POST /api/orders and POST /api/orders/:id/pay.
 * Repeating a request with the same key returns the first result instead of acting twice,
 * so a double tap or a retry after a lost reply cannot create a second order or payment.
 */
export const RequestId = z.string().regex(/^[A-Za-z0-9_-]{8,80}$/);

/* ---------- HTTP responses ---------- */
/** Reply of routes that only confirm: logout, deletes, print retry. */
export const Ack = z.object({ ok: z.literal(true) });
export type Ack = z.infer<typeof Ack>;
/** One owner-side change. `payload` depends on `type` and is intentionally left open. */
export const AuditRow = z.object({ seq: z.number().int().positive(), type: z.string(), payload: z.unknown(), staffId: z.string(), at: IsoDateTime });
export type AuditRow = z.infer<typeof AuditRow>;
export const AuditList = z.array(AuditRow);
export const ErrorResponse = z.object({ error: z.string(), issues: z.array(z.unknown()).optional() });
export const HealthResponse = z.object({ ok: z.literal(true), business: z.string(), time: IsoDateTime });
export const LoginResponse = z.object({ token: z.string().min(16), staff: StaffSchema, business: BusinessSchema });
/** What the browser keeps after signing in. */
export type Session = z.infer<typeof LoginResponse>;
export const MenuResponse = z.object({
  categories: z.array(MenuCategory), items: z.array(MenuItem), taxCategories: z.array(TaxCategorySchema),
});
export type MenuResponse = z.infer<typeof MenuResponse>;
/** Ticket numbers only: the public board never sees items, names or amounts. */
export const PickupBoard = z.object({ preparing: z.array(z.number().int()), ready: z.array(z.number().int()) });
export type PickupBoard = z.infer<typeof PickupBoard>;
export const OrderList = z.array(Order);

/* ---------- WebSocket events (server -> clients) ---------- */
export const ServerEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('hello'), serverTime: IsoDateTime }),
  z.object({ type: z.literal('order.changed'), order: Order }),
  z.object({ type: z.literal('menu.changed') }),
  z.object({ type: z.literal('pickup.changed'), preparing: z.array(z.number().int()), ready: z.array(z.number().int()) }),
]);
export type ServerEvent = z.infer<typeof ServerEventSchema>;
