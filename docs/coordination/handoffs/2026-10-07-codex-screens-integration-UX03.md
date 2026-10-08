# Handoff: UX03 — Integrate screen polish with T54 and refreshed core
- Agent: codex-screens   Date: 2026-10-07   Branch: agent/codex-screens/UX03-integrated

## What changed
- Merged agent/codex/UX01 at a82722b into UX03 at 63c8236. Resolved only Kitchen.tsx and Pickup.tsx conflicts; all root/core/admin/POS/PWA changes come from the merged root branch. No manual BOARD changes.
- Kept UX03 scoped CSS, local SVG icons, status hierarchy, responsive layouts, large touch actions, connection states, accessible inline failure messages, and the pending guard that waits for the live projection.
- Added T54 behavior: five-second kitchen age updates; amber warnings after five minutes and stronger red late emphasis after ten minutes; fresh ticket feedback; individual modifiers with emphasis for No/Geen exclusions; guarded action haptics.
- Pickup now reads the public business name from /api/health, retries on connection changes, shows a local EN/NL clock, and gives newly mounted ready numbers a pop/glow animation. The existing shared reduced-motion rule applies to both arrival animations.
- Public pickup remains anonymous and displays ticket numbers, business name, clock, and connection information. It never renders menu items, order notes, staff/customer names, or sales totals.

## Contracts touched
None. Existing public health and pickup events and authenticated order status routes are unchanged. No new dependency or real data.

## How to verify
- npm run check passed: all workspace typechecks, ESLint with zero warnings, 99 tests in seven files, and production Vite build.
- Scoped git diff a82722b --check passed for kitchen, pickup, and this handoff. The inherited root ui/touch.tsx has an extra blank line at EOF reported by the full staged whitespace check; that cross-lane file was not edited here.
- Edge Playwright checks used the production build with an isolated in-memory seedSample SQLite server at 127.0.0.1:3340. Browser flow passed start -> ready -> recall -> ready -> collected, live pickup updates, duplicate-tap guard, request failure/recovery, empty states, new ticket/ready animation, five/ten-minute hierarchy, public health business name, clock, and anonymous pickup privacy. No uncaught page errors.
- Browser screenshots and measurements verified the refreshed UX01 shell with kitchen and pickup at 390x844, 1024x1000, and 1440x1000. No horizontal overflow; kitchen action heights are 60px on phone and 58px on tablet/TV. Screenshot layouts were visually inspected.
- A server-stop drill passed: both screens retain their last received state and show reconnecting feedback; kitchen status actions are disabled. Dutch pickup copy and visible keyboard focus passed.
- Synthetic pickup WebSocket fixtures passed with three-, four-, five-, and nine-digit ticket numbers at phone and TV sizes; every number stays on one line without page overflow.

Local ignored harness and screenshot evidence:
C:/Users/Pyro/.codex/worktrees/cactuspos-screens-ui/CactusPOS/.local/ux03-integrated/

Run the fixture server with node --import tsx .local/ux03-integrated/server.ts, then node .local/ux03-integrated/smoke.mjs. Each smoke run consumes the fixture orders, so restart the fixture server for another run. Long-number checks: node .local/ux03-integrated/long-numbers.mjs. Offline checks: node .local/ux03-integrated/offline.mjs; stop the fixture server when READY_FOR_SERVER_STOP appears.

Screenshots:
- kitchen-phone.png, kitchen-tablet.png, kitchen-tv.png
- pickup-phone.png, pickup-tablet.png, pickup-tv.png
- kitchen-arrival.png, pickup-arrival.png, kitchen-error.png
- kitchen-empty.png, pickup-empty.png
- kitchen-nl-phone.png, pickup-nl-phone.png
- kitchen-offline-phone.png, pickup-offline-phone.png
- pickup-long-phone.png, pickup-long-tv.png
- result.json contains live-flow measurements.

## Gotchas / decisions
- The merge includes root work up to a82722b. Later root commits should merge normally; only kitchen/pickup app files were edited manually here.
- Successful status submissions stay busy until the live projection confirms the change; reconnect reloads the projection. Pending guards/errors from UX03 are retained.
- New ready-number animation is attached to keyed list-item mount, so recall followed by ready triggers it again. Existing numbers retain their DOM nodes through unrelated board updates.
- Physical hardware/TV viewing from three metres, station filtering, and pickup auto-scroll/optional sound remain outside this integration task.

## Follow-ups
- Parent performs integration/review and handles BOARD status. No cross-lane request was needed.
- T07 can consolidate app-local EN/NL copy into the shared catalogs.
