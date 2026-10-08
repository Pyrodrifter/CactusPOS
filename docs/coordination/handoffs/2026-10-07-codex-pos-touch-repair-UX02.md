# Handoff: UX02 — reachable phone cart actions (R11)
- Agent: codex-pos   Date: 2026-10-07   Branch: agent/codex-pos/UX02-touch-repair
- Status: ready for parent integration and independent review; parent owns BOARD and R11 closure.
- Base: `cb1b329`; isolated worktree `C:/Users/Pyro/.codex/worktrees/cactuspos-pos-touch-fix/CactusPOS`.

## What changed
- Fixed `packages/web/src/apps/pos/pos.css` only. The mobile summary now sticks at the bottom of the shell main's content box, with its full height reserved in normal flow.
- Removed the additional 76px/navigation safe-area offset and duplicate safe-area padding. The shell already reserves the fixed navigation and safe area in main's bottom padding. Counting them again lifted the summary over the final cart action.
- Reproduced the reviewer timeout before the change: at 390x844 the checkout button occupied y599.6–657.6 while the summary started at y619. The repaired summary starts at y694.6, leaving the entire checkout button clear.
- Preserved existing POS layouts, quantities, touch/focus styles, haptics, modifiers/open prices, integer money/tax behavior, payment guards and persistent Paid/Next order confirmation. No dependency or contract changes.

## Contracts touched
None.

## How to verify
- `npm ci`: passed; no vulnerabilities.
- `npm run check`: passed: all workspace typechecks, ESLint with zero warnings, 7 Vitest files / 99 tests, production Vite build.
- `git diff --check`: passed.
- Browser probe: `node C:/Users/Pyro/.codex/visualizations/2026/10/07/01a117b3-edfd-7150-b8dd-0646df8987e8/pos-touch-repair/verify.mjs`. Uses cached Playwright and headless Edge with normal clicks, no force clicks, and no hidden UI.
- Phone matrix: 390x844, 390x600, 320x844, 320x600, each with normal, install, reconnect, waiting-update and all-three-status-strip states. All 20 combinations verify Burger + cheese quantity 2 / $30.00; mobile summary shortcut; cart Send & pay; exact cash / persistent Paid / Next order; Clear; Send; open-price SAMPLE item / $12.50 through cart checkout and sticky Pay. Short phones scroll to the cart's end normally before its final action; every action remains reachable.
- Tablet 1024x768: quantity/modifier/cart/payment/Next order passed. No page exceptions, horizontal document overflow or visible POS/dialog buttons smaller than 48px.
- Evidence directory: `C:/Users/Pyro/.codex/visualizations/2026/10/07/01a117b3-edfd-7150-b8dd-0646df8987e8/pos-touch-repair/`. `results.json` records matrix outcomes/bounds; `*-cart.png` and `*-paid.png` show cart and confirmation states; `tablet-cart.png` covers the desktop arrangement. The original failed screenshot remains in the parent `integrated/cart-phone.png`.

## Gotchas / decisions
- PWA install visibility uses its actual beforeinstallprompt listener with a fixture event. Reconnect visibility uses a fixture 503 for `/api/health` only, leaving sale endpoints connected so taps can be verified. Waiting update uses a real second service worker installation, triggered by a temporary comment in this worktree's ignored `dist/sw.js`; the original worker is restored after the probe. Combined strips are a deliberately cramped layout check.
- Isolated production fixture used port 3327 and SAMPLE-only DB `.../pos-touch-repair/sample.sqlite`; browser print popups were suppressed. No parent/demo/reviewer ports, source or DB were modified. Fixture is stopped after verification.
- Main's reserved bottom space is owned by web-core; POS now uses it once. If that shell scroll contract changes, recheck this matrix.
- Physical iOS safe-area/vibration/printer hardware were not exercised. The existing server/idempotency coordination remains unchanged.

## Follow-ups
- Parent integrates this commit, asks a different agent to verify R11, and updates BOARD/R11. This handoff does not self-approve UX02.
