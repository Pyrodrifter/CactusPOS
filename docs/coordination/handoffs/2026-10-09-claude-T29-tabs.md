# Handoff: T29 — Tabs (order now, add rounds, pay later)
- Agent: claude   Date: 2026-10-09   Branch: agent/claude/T29-tabs-ui (server and kitchen parts merged earlier from agent/claude/T29)

## What changed
- **shared / server** (merged 2026-10-08): `tabName`, per-line `round`, `Order.round`, `kitchenRound`, `kitchenSince`; `POST /api/orders/:id/lines`, `POST /api/orders/:id/tab`, `GET /api/orders?scope=open`; idempotent with `Idempotency-Key`; kitchen tickets print only the new round. Tests in `packages/server/src/tabs.test.ts`.
- **kitchen** (merged 2026-10-08): tab name on the card, "Round N", "Added" markers, beep when a round is added, clock restarts from `kitchenSince`.
- **counter** (this branch), on top of Codex's UX08 counter:
  - `Pos.tsx`: a **Tabs** view between Order and Orders with a count of unpaid orders. The old "Send" button is now **Pay later**: it opens a small sheet with an optional name ("Open tab for Mike" / "Send to the kitchen"). Choosing **Add items** on a tab puts the cart in *adding* mode: a banner "Adding to Mike" with a cancel button, and one main button "Add to Mike" that posts the cart to `/orders/:id/lines`. The adding mode lives in the draft context, so it survives switching to Kitchen and back like the cart does.
  - `Tabs.tsx` / `tabs.css`: tab cards (name, ticket, items, age, kitchen state, total) and the tab sheet (rename, lines per round, Print bill, Add items, Pay).
  - Orders list shows the tab name in front of the lines.
  - Phones (480px and narrower): the three view buttons drop their icons so Order / Tabs / Orders and search stay on one row.

## Contracts touched
None in this branch. `contracts/http.md` section "Tabs" was added with the server part.

## How to verify
- `npm run check` (149 tests) passes.
- Throwaway server: `CACTUS_SEED=cactus-blue CACTUS_DB=<temp file> PORT=3071 CACTUS_STRICT_PORT=1 npx tsx packages/server/src/main.ts`, sign in with the seed owner PIN.
  1. Add two items, **Pay later**, type a name, **Open tab for ...**. The kitchen gets the ticket; the Tabs count goes up.
  2. **Tabs**, tap the card, **Add items**, add a drink, **Add to ...**. Kitchen shows "Round 2" with only the new line marked "Added".
  3. **Tabs**, tap the card, **Pay**. One payment, one receipt with all rounds; the tab disappears from the list.
- I ran this flow in headless Edge with `scripts/shot.mjs` at 1180x820, 1024x700, 820x1180 and 390x844; `page.measure()` reported no horizontal overflow and no control under 48px on the counter, the tab list, the tab sheet, the adding mode and the pay-later sheet.

## Not checked
- A real tablet or phone, and the on-screen keyboard over the pay-later sheet.
- Dutch strings were written by me and not read by a native speaker.

## Gotchas / decisions
- Every unpaid order is an open tab; a name is optional. An unnamed one is listed as "Ticket #N".
- `.pos button` in `pos.css` sets `display: inline-flex` on every button under the counter. Components rendered inside `.pos` that need another layout must outrank it (see `.tab-list .tab-card`).
- The cart's "Send" label changed to "Pay later". `cart.send` in the i18n table is no longer used by the counter.
- UX09 (Codex) also edits `Pos.tsx` and `pos.css`; my changes are localized (search for `T29`, `tabUi`, `PayLaterSheet`, `.pos-tab-banner`). Whoever merges second resolves. See REQUESTS R13.

## Follow-ups
- T22 (split payments, discounts, refunds) applies to tabs too: paying part of a tab is not possible yet.
- Moving lines between tabs and merging tabs are not built. No request for them so far.
