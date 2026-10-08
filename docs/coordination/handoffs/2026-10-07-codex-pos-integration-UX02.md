# Handoff: UX02 integration - refreshed core plus T54 behavior
- Agent: codex-pos   Date: 2026-10-07   Branch: agent/codex-pos/UX02-integrated
- Status: ready for parent integration and independent review; parent owns BOARD update.
- Starting snapshot: `agent/codex-pos/UX02` / `1fc13f4` remains available.
- Merged core/T54 snapshot: `agent/codex/UX01` / `6df67dc`.

## What changed
- Resolved the POS merge by preserving UX02 menu/cart/history hierarchy, scoped CSS, consistent `ui/Icon.tsx` icons, EN/NL labels and safe labeled dialogs.
- Retained T54 functional additions: shared MoneyPad with keyboard cents entry and quick cash, explicit persistent Paid/change confirmation until Next order, modifier quantity/price preview, per-item counts, quantity cap and haptics, send confirmation/toast, and card terminal guidance.
- Preserved guarded send/pay/void requests, busy non-dismissable dialogs, card reference/tips, receipt fallback/reprint and created-order retention after a failed payment. A card tip is sent only for card payments.
- Polished the added controls only in `apps/pos/pos.css`: 52px steppers, 60px keypad, prominent paid/change state and a phone footer that fits the payment actions. Phone cart summary accounts for the refreshed bottom navigation.
- The merge inherits the full core, shared, server, catalogs and other app snapshots without independent edits outside POS. No dependencies added.

## Contracts touched
None. Money remains integer cents; existing API, shared totals and receipt contracts remain in use.

## How to verify
- `npm run check`: passed on final implementation (all workspace typechecks, ESLint, 7 Vitest files / 99 tests, production build).
- Isolated production server at `http://localhost:3316`, DB `data/ux02-integrated-sample.sqlite` seeded with SAMPLE fixtures only. No production/other checkout DB touched.
- Browser probe: `node C:/Users/Pyro/.codex/visualizations/2026/10/07/ux02-pos-probes/ux02-integrated.mjs`. It imports Playwright from the existing npm cache and launches headless Edge.
- Tablet 1024x768: choose Burger + cheese, modifier quantity 2 previews $30.00; menu count is 2; keyboard 5 0 0 0 gives $50.00 tender and $20.00 change. Paid screen keeps $20.00, ignores Escape/backdrop, closes only after Next order. Server assigned receipt 3 in the final probe run.
- Phone 390x844: open-price SAMPLE item keypad entry $12.50, required single-choice modifier switched A -> B ($2.00), quantity 2 gives $29.00. Card reference SAMPLE-INTEGRATION + $2.00 tip retained. Simulated first 503 / successful retry produced exactly 1 create and 2 payment calls, receipt 4. Cancel/Escape stayed disabled while pending.
- EN/NL cash screen inspected. No page exceptions, no horizontal page overflow, no visible POS/dialog button under 48px. Persistent Paid/change and refreshed shell verified at both widths.
- Screenshots inspected: `C:/Users/Pyro/.codex/worktrees/cactuspos-pos-ui/CactusPOS/data/ux02-integrated-screenshots/` contains tablet modifier/cart/cash/paid and phone paid/orders/market/cash/card-paid/cash-nl.

## Gotchas / decisions
- POS uses shared MoneyPad, Stepper, haptic and toast helpers. It retains its local focus-managed, focus-trapping Sheet because the current shared Sheet has no focus management; this also preserves busy guards and explicit Paid dismissal.
- Keypad disappears while the payment request is pending, which removes its global keyboard listener and prevents amount changes during submission.
- Send toast only appears for explicit Send, so it cannot cover the Paid/Next order confirmation during a sale.
- New app labels remain local EN/NL copy per UI brief. Physical receipt printers and vibration hardware were not tested; browser print popups are suppressed by the isolated probe.
- Immediate busy guards do not add server idempotency or replay a payment after ambiguous network failure (existing R6 remains relevant).

## Follow-ups
- Parent: merge this integration branch rather than cherry-picking the original UX02 snapshot over T54. Review final integrated behavior and set BOARD UX02 to review/done as appropriate.
- Parent can stop isolated server session 10943 after final review. Browser artifacts/DB are ignored and are not committed.
