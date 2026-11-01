# HTTP + WebSocket contract (v1)

Schemas are authoritative in `packages/shared/src/domain.ts` (`LoginResponse`, `MenuResponse`, `Order`, `OrderList`, `PickupBoard`, `HealthResponse`, `ErrorResponse`, `OrdersQuery`, `IdParams` and the request bodies named below); a test parses real server responses against them. All bodies are JSON. Money is integer cents.
Auth: `x-token` header from `POST /api/login`. Errors: `{ "error": "message" }` with a 4xx status.

Release 0.2.1 uses patched Zod 4 for validation. Invalid bodies still return HTTP 400 with
`error: "Invalid request"`; the optional `issues` array is diagnostic information whose
issue codes and wording may change between validator versions. Clients use the status and
`error`, not specific issue codes. Request/response fields, integer-cent limits, defaults,
receipt-template compatibility and persisted database format stay the same.

## Public
| Route | Notes |
|---|---|
| `GET /api/health` | `{ ok, app: 'cactuspos', version, startedAt, business, time }`. `app` identifies the program on the port; `startedAt` is constant for one run of the server (the launcher in `ops/app` uses both) |
| `GET /api/pickup` | `{ preparing: number[], ready: number[], names?: { [ticket]: string } }` ticket numbers, and the name given to an order (owner request, UX22). Public: anyone on the truck network can read these first names; never items or amounts |
| `POST /api/login` `{ pin }` | `{ token, staff, business }`. 5 wrong PINs from one address = 429 for 30 s |

## Signed-in staff
| Route | Body | Returns |
|---|---|---|
| `POST /api/logout` | | `Ack`. Works without a session too (logging out twice is fine) |
| `GET /api/menu` | | `{ categories, items, taxCategories }` |
| `POST /api/menu/items/:id/available` | `AvailabilityBody` | `MenuItem` (sold-out toggle) |
| `GET /api/orders?scope=active\|today\|open` | | `Order[]`. `active` = today's orders still needing attention, plus kitchen work carried over from an earlier day for up to 16 hours (an order sent before midnight, an older tab that ordered again). `today` = opened, paid or voided today. `open` = every unpaid, non-void order from any day (the tab list), oldest first |
| `GET /api/orders/:id` | | `Order` |
| `POST /api/orders` | `CreateOrderBody` | `201 Order` (status `sent`, ticket number assigned). Accepts `Idempotency-Key` |
| `POST /api/orders/:id/lines` | `AddLinesBody` | `Order` with a new round of lines. `409` if paid or void. Accepts `Idempotency-Key` |
| `POST /api/orders/:id/tab` | `TabNameBody` | `Order`. Names or renames the tab; empty clears it |
| `POST /api/orders/:id/pay` | `PayBody` | `Order` (receipt number assigned, `paidDate` set). `PayBody.expectedTotalCents` is the total the cashier saw: when the order has changed since, `409` and nothing is recorded; the screen reloads the order and asks again. Accepts `Idempotency-Key` |
| `POST /api/orders/:id/status` | `StatusBody` | `Order` |
| `POST /api/orders/:id/void` | `VoidBody` | `Order` (`voidedAt`, `voidDate` set). Paid or started orders need an owner session or `managerPin`. Five wrong manager PINs by one signed-in person = `429` for 30 s; each refused PIN is written to the audit log (`void.manager_pin_refused`) |
| `POST /api/orders/:id/correct` | `CorrectOrderBody` `{ keep: [{ lineId, qty }], add: OrderLineInput[], method, reference?, tipCents?, reason, managerPin?, expectedTotalCents? }` | `CorrectOrderResponse` `{ order, replaced }`. Fixes a **paid** order in one step. Nothing is rewritten: `replaced` is the original, now `void` with `correctedBy`; `order` is a new paid sale on the next receipt number with `corrects`, the same ticket number and kitchen state. Kept lines keep what they were sold for, added lines are priced now. Owner session or `managerPin` (wrong PINs share the limit of void). `400` nothing left or an unknown line, `409` not paid, already void or corrected, or `expectedTotalCents` differs. Accepts `Idempotency-Key` |
| `GET /api/orders/:id/receipt[?copy=1]` | | Printable HTML receipt (browser fallback). `copy=1` marks a reprint. See `printer.md` |

## Owner only (`403` otherwise). Every change is written to the append-only `audit_log`.
| Route | Body |
|---|---|
| `PUT /api/admin/menu/categories/:id` | `MenuCategory` without id. Send `color` every time: leaving it out clears the choice |
| `DELETE /api/admin/menu/categories/:id` | `409` while it still has items |
| `PUT /api/admin/menu/items/:id` | `MenuItem` without id. Option ids must be unique within the item. Optional `tags`: allergens and diet marks from `MENU_TAGS` |
| `DELETE /api/admin/menu/items/:id` | Past orders keep their own snapshot |
| `GET` / `PUT /api/admin/business` | `BusinessSchema` |
| `PUT /api/admin/tax/:id` | `TaxCategorySchema`. Change a rate by adding a `validFrom` row, never by editing one |
| `POST /api/admin/tax/:id/apply-to-menu` | Owner (TAX03). Every menu item gets this tax category, in one step; the menu editor no longer picks tax per item. Audit `tax.applied`; broadcasts a menu change. `{ items }` = how many changed |
| `DELETE /api/admin/tax/:id` | Owner (TAX03). Removes a category no menu item uses and no order was ever sold under; `409` otherwise. Audit `tax.deleted` |
| `GET /api/admin/tax` | Owner. `{ categories, exemption }`: the categories as set up (not the exempt view `/api/menu` gives while ABB is off) and the ABB switch |
| `PUT /api/admin/tax-exemption` | Owner. `TaxExemption` `{ charged, reason }`; `reason` required when `charged` is false. Audit `tax.exemption`; broadcasts a menu change |
| `GET /api/admin/staff` | `StaffRow[]` (PINs are never returned) |
| `POST /api/admin/staff`, `PUT /api/admin/staff/:id` | `StaffInput`. PIN 4-8 digits, unique; at least one active owner must remain |
| `GET /api/admin/staff/example-pins` | `{ staff: Staff[] }`: active people who can still sign in with a PIN every new database starts with (1234, 1111). Admin shows a reminder |
| `GET /api/admin/audit` | `AuditList`: last 200 changes, newest first, each `{ seq, type, payload, staffId, at }` |
| `POST /api/admin/receipt-templates/restore` | `RestoreTemplateBody` `{ baseVersion, version }`. Publishes an earlier design again as a new version. `409` when another screen saved meanwhile. See `service-and-receipts.md` |
| `POST /api/admin/receipt-templates/test-print` | `PreviewTemplateBody`. Prints a sample of an unsaved design. `409` without a printer |
| `PUT /api/books/settings` | `BooksSettings` (account codes). See `books.md` |
| `GET /api/admin/backups`, `PUT /api/admin/backups/settings`, `POST /api/admin/backups/run` | See `backups.md` |

## Day reports (owner only). Schemas in `packages/shared/src/reports.ts`
| Route | Body | Returns |
|---|---|---|
| `GET /api/reports/day[?date=YYYY-MM-DD]` | | `{ report: DayReport, closed: ZReport \| null, today }`. Default date is today in the business time zone |
| `POST /api/reports/day/close` | `CloseDayBody` | `201 ZReport`. Can be repeated; the latest number for a date counts. A future date is `400` |
| `GET /api/reports/z` | | `ZReportList`, newest first (60) |
| `POST /api/reports/day/print` | `{ date? }` | print job. `409` without a printer |
| `GET /api/reports/day/print.html[?date=]` | | printable page (browser fallback) |

A day's report is about the money that moved on that day (owner decision Q11, 2026-10-10): a sale counts on the day it was
**paid** (`Order.paidDate`), a refund on the day the paid order was **voided** (`Order.voidDate`), whatever day the order was
opened. A sale paid and refunded on the same day is in neither the sales nor the payments. A refund of an earlier day's sale
is taken off that day's `sales`, `tax` and `tenders` (which can therefore be negative) and reported in `refundedEarlier`.
`refunds` lists every refund given that day. `orders.unpaid` and `orders.voidedUnpaid` still count orders opened that day.
A corrected order (see `POST /api/orders/:id/correct`) is not a refund: the original counts like a refunded sale and its replacement like a sale, so the figures move by the difference, and the day shows `corrections { count, removedCents, addedCents }` instead of an entry under `refunds`.
Closing the day also makes a backup. Other definitions: the comments in `packages/shared/src/reports.ts`.

## WebSocket `/ws`
- Staff: `/ws?token=...` receives `ServerEvent`: `hello`, `order.changed { order }`, `menu.changed` (refetch `/api/menu`).
- Public pickup board: `/ws?room=pickup` receives `hello`, then only `pickup.changed { preparing, ready, names? }`.
- Heartbeat: the server repeats `hello` to every connection every 15 s and pings it; a connection that did not answer the previous ping is dropped.
- Clients must reconnect with backoff and refetch state on every (re)connect, and must treat 40 s without any message as a dead connection (`web/src/lib/liveSocket.ts`).

## Tabs
An unpaid order **is** an open tab; there is no separate tab record.
- `CreateOrderBody.tabName` names it when it is opened ("Send, pay later"). `Order.tabName` is optional.
- `POST /api/orders/:id/lines` adds a **round**. Each line carries `round` (absent = 1); `Order.round` is the latest. Earlier lines are never re-priced or re-taxed: only the new lines are computed, then totals and the ABB breakdown are summed.
- Kitchen: `Order.kitchenRound` is the first round still to be made, and `kitchenLines(order)` (shared) returns those lines. If the order was `ready` or `collected` when a round is added, `kitchenRound` jumps to the new round and `status` returns to `sent` (a fresh ticket with only the new items). If it was still `sent` or `preparing`, status and `kitchenRound` stay and the new lines join the ticket the kitchen already has; screens should mark lines whose `round` is newer than the ones seen before.
- The ticket number never changes, so the guest keeps one number for the whole tab.
- Payment is unchanged: one payment for the full total, one receipt number, one receipt listing every round.
- With "print kitchen ticket when sent" on, an added round prints a ticket with only its lines, marked as added.

## Retrying safely: `Idempotency-Key`
`POST /api/orders`, `POST /api/orders/:id/lines`, `POST /api/orders/:id/pay` and `POST /api/orders/:id/correct` accept an `Idempotency-Key` header (`RequestId`: 8-80 characters of `A-Z a-z 0-9 _ -`).
- The first request with a key acts and records the key in the same transaction as the sale.
- A repeat with the same key returns the same `Order` and does **not** broadcast or print again. A repeated pay returns the paid order rather than `409 already paid`.
- Reusing a pay key for a different order is `409`. A malformed key is `400`.
- Without the header nothing changes: a second pay is `409`.
- The POS uses one key per cart for create and `pay-<orderId>` for pay. Clients must still not replay writes blindly after an *error* response; the key is for lost replies and double taps.

## Other responses
- Deletes, logout and `POST /api/print/retry` return `Ack` (`{ "ok": true }`).
- `400` invalid body, option chosen twice, or a price that would go below zero; `409` sold out, tax setup problem, already paid/void, or the order changed since the pay sheet opened; `503` database busy (nothing written, retry).
- `500` always carries the same sentence ("Something went wrong on the till. Please try again."); the cause is in the server log, not on the screen.
- The web client gives every request 12 s. No answer becomes an error on the screen; the cart and its `Idempotency-Key` are kept, so sending again cannot double an order.
