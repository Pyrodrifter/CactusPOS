# WebSocket events (v1)

Authoritative schema: `ServerEventSchema` in `packages/shared/src/domain.ts` (a zod discriminated union on `type`).
The server only sends; clients never send messages (the browser answers the server's pings by itself). Web clients validate every message with the schema and ignore anything else.

## Connections
| URL | Who | Auth | First messages | Then receives |
|---|---|---|---|---|
| `/ws?token=<session token>` | signed-in staff screens (counter, kitchen, admin) | token from `POST /api/login`; closed with code `4401` if missing or invalid | `hello` | `order.changed`, `menu.changed` |
| `/ws?room=pickup` | public customer board | none | `hello`, then `pickup.changed` with the current board | `pickup.changed` only |

The pickup room never receives orders, items, names or amounts: ticket numbers only.

## Events
```jsonc
{ "type": "hello", "serverTime": "2026-10-07T18:54:49.589Z" }           // on connecting, then every 15 s as a heartbeat
{ "type": "order.changed", "order": { /* full Order, see domain.ts */ } }   // create, pay, status, void
{ "type": "menu.changed" }                                                    // refetch GET /api/menu
{ "type": "pickup.changed", "preparing": [12, 13], "ready": [11] }           // status sent|preparing -> preparing
```

## Client rules
- Reconnect with backoff (1s, 2s, 4s, max 8s) and **refetch state on every (re)connect**: events missed while offline are not replayed.
- A connection can die without a close event (the till restarted while a tablet slept). Because `hello` arrives every 15 s, **40 s of silence means dead**: drop the socket, connect again, refetch. Implemented once in `packages/web/src/lib/liveSocket.ts`.
- The server pings every connection with each heartbeat and drops one that did not answer the previous ping.
- `order.changed` carries the whole order; replace by `order.id`, do not merge.
- Treat an unknown `type` as a no-op so the server can add events without breaking old screens.
