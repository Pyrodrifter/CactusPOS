# Handoff: T00-T05, T10-T12 (walking skeleton) — claude, 2026-10-07

## What changed
- Monorepo (`shared`, `server`, `web`); `npm run dev`, `npm test`, `npm run typecheck`, `start.bat`.
- shared: integer-cent money, ABB engine (inclusive, per-category rounding, effective dates), zod domain contracts.
- server: node:sqlite, append-only `order_events` (triggers), no order deletes, gapless receipt counter, daily ticket numbers, PIN login, REST + WebSocket hub, public pickup room, default HTML receipt.
- web: PIN login, POS (menu, modifiers, cart, cash/card pay, orders list, void with manager PIN), kitchen board, pickup board, EN/NL toggle, offline banner + WS reconnect.

## Contracts touched
`packages/shared/src/domain.ts` (Order, bodies, ServerEvent). No docs in `contracts/` yet — TODO.

## How to verify
`npm test` (13 pass); `npm start`, open http://localhost:3000, PIN 1111 (staff) / 1234 (owner, seed only).
Manually verified in a browser: order with modifier -> kitchen ticket -> ready -> pickup board updates live.

## Gotchas
- Seed menu/PINs are SAMPLES. Tax defaults are flagged `unverified` (QUESTIONS Q1).
- Receipt is a v0 HTML view; ESC/POS + template engine are T13/T14/T30.
- `T07` i18n is only a minimal EN/NL dictionary in `web/src/i18n.ts`; server messages are English only.
- Pay-from-cart creates the order then pays; if payment fails the order stays unpaid in Orders.

## Follow-ups
T13/T14 (printing), T20/T21 (admin: menu, staff PINs, business details), T26 (service install), contracts docs.
