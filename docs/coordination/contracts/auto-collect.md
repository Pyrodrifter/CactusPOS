# Ready orders picked up automatically (KIT01)

Owner request: an order that is ready can be marked picked up (`collected`) by itself after a set time, so the kitchen
and the pickup board do not wait for a tap. Since UX22 this is **off by default**: the Order screen confirms pickups
(owner request after the tryout), and a timer would clear orders from under the cashier. A till where the owner chose
a time keeps it.

- `Order.readyAt` (optional ISO time) is set each time an order becomes `ready` and removed when it moves to
  another status. Older orders without it use `updatedAt`.
- The server checks every 5 seconds. A ready, non-void order whose `readyAt` is `seconds` or more ago is set to
  `collected` with an `order.status` event `{ status: 'collected', auto: true }`, staff id `system`. It is broadcast
  like any status change (`order.changed`, `pickup.changed`). Paying is not affected: an unpaid order stays on the
  tab list as before.
- `GET /api/auto-collect` (any signed-in staff) → `AutoCollect { seconds }`; default **0** (off). `PUT /api/auto-collect`
  (owner) with the same body; `0` switches it off; audited as `auto-collect.changed` and broadcast as
  `auto-collect.changed`. Undo on the kitchen (collected → ready) starts a fresh minute.
- Practice mode has its own server and therefore its own timer and setting.
