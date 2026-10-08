# HTTP + WebSocket contract (v1)

Schemas are authoritative in `packages/shared/src/domain.ts` (`LoginResponse`, `MenuResponse`, `Order`, `OrderList`, `PickupBoard`, `HealthResponse`, `ErrorResponse`, `OrdersQuery`, `IdParams` and the request bodies named below); a test parses real server responses against them. All bodies are JSON. Money is integer cents.
Auth: `x-token` header from `POST /api/login`. Errors: `{ "error": "message" }` with a 4xx status.

## Public
| Route | Notes |
|---|---|
| `GET /api/health` | `{ ok, business, time }` |
| `GET /api/pickup` | `{ preparing: number[], ready: number[] }` ticket numbers only |
| `POST /api/login` `{ pin }` | `{ token, staff, business }`. 5 wrong PINs from one address = 429 for 30 s |

## Signed-in staff
| Route | Body | Returns |
|---|---|---|
| `POST /api/logout` | | `Ack`. Works without a session too (logging out twice is fine) |
| `GET /api/menu` | | `{ categories, items, taxCategories }` |
| `POST /api/menu/items/:id/available` | `AvailabilityBody` | `MenuItem` (sold-out toggle) |
| `GET /api/orders?scope=active\|today` | | `Order[]` |
| `GET /api/orders/:id` | | `Order` |
| `POST /api/orders` | `CreateOrderBody` | `201 Order` (status `sent`, ticket number assigned). Accepts `Idempotency-Key` |
| `POST /api/orders/:id/pay` | `PayBody` | `Order` (receipt number assigned). Accepts `Idempotency-Key` |
| `POST /api/orders/:id/status` | `StatusBody` | `Order` |
| `POST /api/orders/:id/void` | `VoidBody` | `Order`. Paid or started orders need an owner session or `managerPin` |
| `GET /api/orders/:id/receipt[?copy=1]` | | Printable HTML receipt (browser fallback). `copy=1` marks a reprint. See `printer.md` |

## Owner only (`403` otherwise). Every change is written to the append-only `audit_log`.
| Route | Body |
|---|---|
| `PUT /api/admin/menu/categories/:id` | `MenuCategory` without id |
| `DELETE /api/admin/menu/categories/:id` | `409` while it still has items |
| `PUT /api/admin/menu/items/:id` | `MenuItem` without id. Option ids must be unique within the item |
| `DELETE /api/admin/menu/items/:id` | Past orders keep their own snapshot |
| `GET` / `PUT /api/admin/business` | `BusinessSchema` |
| `PUT /api/admin/tax/:id` | `TaxCategorySchema`. Change a rate by adding a `validFrom` row, never by editing one |
| `GET /api/admin/staff` | `StaffRow[]` (PINs are never returned) |
| `POST /api/admin/staff`, `PUT /api/admin/staff/:id` | `StaffInput`. PIN 4-8 digits, unique; at least one active owner must remain |
| `GET /api/admin/audit` | `AuditList`: last 200 changes, newest first, each `{ seq, type, payload, staffId, at }` |

## Day reports (owner only). Schemas in `packages/shared/src/reports.ts`
| Route | Body | Returns |
|---|---|---|
| `GET /api/reports/day[?date=YYYY-MM-DD]` | | `{ report: DayReport, closed: ZReport \| null, today }`. Default date is today in the business time zone |
| `POST /api/reports/day/close` | `CloseDayBody` | `201 ZReport`. Can be repeated; the latest number for a date counts. A future date is `400` |
| `GET /api/reports/z` | | `ZReportList`, newest first (60) |
| `POST /api/reports/day/print` | `{ date? }` | print job. `409` without a printer |
| `GET /api/reports/day/print.html[?date=]` | | printable page (browser fallback) |

Definitions of sales, refunds, tenders and cash expected: see the T33 handoff and the comments in `reports.ts`.

## WebSocket `/ws`
- Staff: `/ws?token=...` receives `ServerEvent`: `hello`, `order.changed { order }`, `menu.changed` (refetch `/api/menu`).
- Public pickup board: `/ws?room=pickup` receives `hello`, then only `pickup.changed { preparing, ready }`.
- Clients must reconnect with backoff and refetch state on every (re)connect.

## Retrying safely: `Idempotency-Key`
`POST /api/orders` and `POST /api/orders/:id/pay` accept an `Idempotency-Key` header (`RequestId`: 8-80 characters of `A-Z a-z 0-9 _ -`).
- The first request with a key acts and records the key in the same transaction as the sale.
- A repeat with the same key returns the same `Order` and does **not** broadcast or print again. A repeated pay returns the paid order rather than `409 already paid`.
- Reusing a pay key for a different order is `409`. A malformed key is `400`.
- Without the header nothing changes: a second pay is `409`.
- The POS uses one key per cart for create and `pay-<orderId>` for pay. Clients must still not replay writes blindly after an *error* response; the key is for lost replies and double taps.

## Other responses
- Deletes, logout and `POST /api/print/retry` return `Ack` (`{ "ok": true }`).
- `400` invalid body, option chosen twice, or a price that would go below zero; `409` sold out, tax setup problem, already paid/void; `503` database busy (nothing written, retry).
