# Independent review: T02 — Domain contracts
- Agent: codex   Date: 2026-10-07   Branch: agent/codex/T06
- Reviewed implementation: master 43a238a, in the existing T06 worktree.
- Outcome: **keep T02 in review**. Required schemas and boundary documentation are incomplete.

## What was verified
- `packages/shared/src/index.ts` exports domain and tax modules; server and web already import the shared package successfully.
- Zod schemas exist for MenuItem, OrderLine, Payment, Order, ModifierOption and ModifierGroup (`domain.ts:6-76`). Modifier is represented by option/group schemas rather than a standalone named Modifier; document this mapping explicitly.
- Five HTTP request body schemas exist and are parsed by the server: CreateOrderBody, PayBody, StatusBody, VoidBody and LoginBody (`domain.ts:78-89`; `server/src/app.ts:63-102`).
- `npm run typecheck` passed for all six workspaces. `npm test` passed: 2 files, 13 tests. These checks establish import compatibility, but do not establish completeness of contracts.

## Blocking findings against Done when
1. **Required domain schemas are missing.** TaxCategory is only a TypeScript interface (`shared/src/tax.ts:19`); Receipt, Device and Staff have no shared Zod schemas or exports. Staff is defined in the server (`server/src/service.ts:21`) and duplicated inline in the web Session (`web/src/lib/api.ts:3-7`). Add and export the required schemas and their inferred types, preserving the current tax engine consumer type compatibility. Define Receipt and Device from the planned domain and coordinate any needed consumer integration rather than inventing business rules.
2. **WS events are compile-time types only.** `ServerEvent` is a TypeScript union (`shared/src/domain.ts:92`), not a Zod schema. Add an exported discriminated union for `hello`, `order.changed`, `menu.changed` and `pickup.changed`, with inferred types. Document public pickup versus authenticated staff connections and initial messages; current server emits hello to both, an initial pickup board only to pickup, order changes only to staff, and pickup changes only to pickup (`server/src/app.ts:21-56`).
3. **HTTP boundary contracts are partial.** Only mutation/login bodies are modeled. Shared response schemas are absent for login/session/business, menu, pickup, health, order lists and errors; route params and order scope query are also unmodeled. The menu aggregate is independently declared by server (`service.ts:36`) and POS (`Pos.tsx:9`), and login Session is local to web. Add exported schemas covering implemented routes and document methods, paths, authentication, query/params, success/error responses and the HTML receipt endpoint. Consumers should import common shapes so later server changes cannot silently diverge.
4. **Contract docs have not been written.** `docs/coordination/contracts/` contains only README.md, which lists `http.md` and `events.md` as planned. Its authoritative path `packages/shared/src/contracts` does not exist. Write the HTTP/event docs with examples and correct the path reference to the actual shared schema location.

## Consumer comparison and practical limits
- The current request bodies, order objects and emitted WS event names align with the consumers inspected; no concrete incompatible wire payload was found in the implemented walking skeleton.
- Runtime validation is absent on received WS messages (`web/src/lib/live.ts:32,66`) and HTTP responses are generic casts (`web/src/lib/api.ts:21-34`). In combination with missing shared response/event schemas, duplicated declarations cannot verify the complete boundary. Consumer validation/integration should be coordinated with the owning lanes; no implementation was changed during this review.
- The Order tax breakdown schema accepts fractional cents and unrestricted `kind` (`domain.ts:69-72`), unlike the integer-cent rule and TaxKind type. Tighten these fields using shared tax schemas and integer cent validation; retain tested rounding behavior.
- No tax classification, legal receipt field requirement beyond the existing PLAN, or future device-registration behavior was guessed. Business questions remain with the owner.

## Contracts touched
None. Review note only; BOARD T02 remains `review` with its existing owner.

## Follow-ups
- Shared lane: complete the missing domain/HTTP/WS exports, document modifier naming, and constrain tax breakdown cents/kind.
- Shared/server lanes: write http.md and events.md against the actual app routes and connection behavior, then coordinate consumer imports with web-core/web-pos.
- Request a fresh independent T02 review after these changes; rerun `npm run typecheck` and `npm test` and include meaningful contract validation tests.
