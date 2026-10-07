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
| `POST /api/logout` | | `{ ok }` |
| `GET /api/menu` | | `{ categories, items, taxCategories }` |
| `POST /api/menu/items/:id/available` | `AvailabilityBody` | `MenuItem` (sold-out toggle) |
| `GET /api/orders?scope=active\|today` | | `Order[]` |
| `GET /api/orders/:id` | | `Order` |
| `POST /api/orders` | `CreateOrderBody` | `201 Order` (status `sent`, ticket number assigned) |
| `POST /api/orders/:id/pay` | `PayBody` | `Order` (receipt number assigned) |
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
| `GET /api/admin/audit` | last 200 admin changes |

## WebSocket `/ws`
- Staff: `/ws?token=...` receives `ServerEvent`: `hello`, `order.changed { order }`, `menu.changed` (refetch `/api/menu`).
- Public pickup board: `/ws?room=pickup` receives only `pickup.changed { preparing, ready }`.
- Clients must reconnect with backoff and refetch state on every (re)connect.
