# Independent re-review: T02 — Domain contracts
- Agent: codex   Date: 2026-10-07
- Reviewed T02 fix commit: `6fde62e`; final checks and reproduction also ran on `c4558cd` (the concurrently completed T13/T14 work).
- A subsequent read through `792c2ac` found only a T05A board claim and a browser receipt COPY fix relative to that checked snapshot; neither changes the two findings below. The receipt HTTP description was updated by that fix.
- Verdict: **keep T02 in review**. The missing named domain/event contracts and most response contracts are now present, but an accepted request still produces an Order and WS event rejected by those contracts. The audit response boundary is also still local to the server.
- Scope: independent, read-only review of source and BOARD; this report is the only file written. No commits, development process changes, or production/real database access.

## Acceptance criteria and resolved original findings
| T02 Done when | Result |
|---|---|
| Schemas exported | All named domain concepts now have exported Zod schemas and inferred types. Modifier is explicitly mapped to ModifierOption plus ModifierGroup. TaxCategory, Staff, Receipt and Device are present. ServerEventSchema is an exported discriminated union. Implemented HTTP boundaries have substantial coverage, with the remaining gaps below. |
| Contract docs written | README now points to the actual schema files. http.md, events.md and money-and-tax.md exist and explain auth, request bodies, responses, money, and socket rooms. Some HTTP response details are still incomplete. |
| Server + web can import types | Passed: all six workspaces typecheck. Server imports the shared menu/staff/business shapes; POS/admin import MenuResponse and StaffRow; Session comes from shared. Both web socket consumers parse ServerEventSchema. |

The original unrestricted tax kind and fractional tax-breakdown cents are fixed: Order.breakdown uses TaxBreakdownRow, whose kind is TaxKind and whose monetary fields require integers. Device is expressly provisional with no producing route yet. Receipt is an exported summary linked to an Order; the current HTML endpoint renders Order plus Business rather than returning that Receipt shape. Neither provisional device registration nor future receipt-template behavior was invented during this review.

## Remaining material findings

### 1. [P1] Accepted modifier combinations produce invalid orders and silently dropped live events
Sources: `packages/server/src/admin.ts:44`, `packages/server/src/service.ts:76`, `:84`, `:90`, `:94`; nonnegative response fields in `packages/shared/src/domain.ts:62` and `:86`; received-event validation in `packages/web/src/lib/live.ts:6`.

Menu validation checks each modifier against the base price separately. Order creation adds all selected modifiers without checking the final unit price is nonnegative. Two valid groups can therefore reduce the same item below zero. This is a concrete HTTP/WS contract mismatch, not merely an opportunity to tighten a schema.

Reproduced with a seeded, in-memory database and an isolated Fastify app:
1. Login as the seeded owner (`1234`) and staff (`1111`).
2. Owner PUT `/api/admin/menu/items/discount_probe` with category `sides`, tax category `service_6`, price `1400`, and two modifier groups. Each group contains one distinct option with `priceDeltaCents: -800`. The response is **200**, and the saved item satisfies MenuItem.
3. Staff POST `/api/orders` with one such item, qty `1`, and both option IDs.
4. The response is **201**, `unitPriceCents = -200`, `lineTotalCents = -200`, `totalCents = -200`, and `taxCents = -11`. Order.safeParse fails on all four nonnegative fields.
5. A connected staff socket receives the corresponding `order.changed` event; ServerEventSchema.safeParse fails. The web's readEvent returns null for this event, so a connected kitchen/POS does not apply the new order. The public board nevertheless receives its ticket number through a valid pickup.changed event.

Duplicate modifier IDs in OrderLineInput also repeat monetary deltas because pricing maps every submitted ID while cardinality checks count unique matching options. Address that case together with the aggregate price guard. Keep the nonnegative Order contract; reject an invalid final price before allocating/persisting a ticket or broadcasting. Add a regression test that exercises HTTP creation and the actual emitted event, including several discount groups and repeated input IDs.

### 2. [P2] Audit and acknowledgement responses still lack shared contracts
Sources: `packages/server/src/admin.ts:118`, `packages/server/src/app.ts` (`/api/admin/audit`, logout and admin DELETE handlers), `packages/shared/src/domain.ts:170`, `docs/coordination/contracts/http.md:38`.

GET `/api/admin/audit` still returns a server-local `{ seq, type, payload, staffId, at }[]` declaration; no corresponding exported Zod schema or inferred type exists. The docs say only “last 200 admin changes,” leaving the object fields undefined for another consumer. The actual probe returned 200 with these five keys. This pre-existing route crosses the server/web boundary and remains outside the authoritative shared contracts despite the original review requesting complete implemented HTTP response coverage.

Logout and category/item DELETE return `{ ok: true }` without a common exported acknowledgement schema. Add the audit row/list and acknowledgement contracts, import the audit shape in the server, document the response types/statuses for these and the owner mutation routes, and validate representative real responses in the contract tests. The audit payload can remain unknown if its event-specific subcontracts are intentionally deferred; the envelope should still be shared.

## Checks and practical limits
- `npm run typecheck`: passed all six workspaces, both before and after T13/T14 landed.
- `npm test`: initial T02-fix checkout passed 3 files / 51 tests; final `c4558cd` checkout passed 6 files / 75 tests.
- Existing contract tests parse real login, menu, created/paid order, order list, pickup, health and error responses. They also exercise tax setup failure and reject malformed constructed events.
- Independent probes parsed real admin business, staff list, category save and item save responses against their exported schemas. All ordinary responses tested passed.
- Actual socket probes used a new loopback listener with port 0, one staff socket and one public pickup socket. Ordinary order creation passed Order and ServerEventSchema. Staff received `hello`, then `order.changed`; pickup received `hello`, the initial `pickup.changed`, then a further pickup update. The negative-order reproduction failed both contracts as described above. All isolated sockets/apps/databases were closed after the probes.
- No HTTP runtime parsing was added to api.ts. Its type-only imports satisfy T02 import compatibility; runtime HTTP parsing remains a documented limitation rather than a separate approval blocker.
- HTTP docs place logout under “Signed-in staff,” but an anonymous POST currently returns 200 (idempotent logout). The HTTP socket summary says pickup receives only pickup.changed, while events.md correctly lists the initial hello. Align these minor descriptions with actual behavior.
- T13/T14 added printing routes and replaced the receipt renderer during this review. Their new boundaries and physical printer behavior were not independently approved by this T02 report; the final test rerun accounts for their integration. The HTTP receipt endpoint is now implemented through the receipt package; the subsequent COPY fix updated its description and added `?copy=1`.

## Contracts touched
None. No source, BOARD, REQUESTS, or other agent-owned files were changed.

## Approval state and follow-up
**T02 is not approved for done.** Shared/server owners should resolve findings 1 and 2, rerun typecheck/tests, and request a fresh independent pass. The P1 fix belongs in the server lane and needs a regression demonstrating that every accepted sale produces a valid Order and WS order.changed event. The P2 fix belongs in shared/server and should be a small contract commit with matching docs.
