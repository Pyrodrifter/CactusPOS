# Handoff: UX03 — Kitchen and pickup screen touch polish
- Agent: codex-screens   Date: 2026-10-07   Branch: agent/codex-screens/UX03

## What changed
- Kitchen: dark ticket board with local SVG icons, status counts, paid/unpaid badges, elapsed-time chips, warm overdue accents, distinct ready tickets, notes, and useful empty states.
- Kitchen actions: labeled start/ready/recall/collected controls measure 58px on tablet/TV and 60px on phones, with visible keyboard focus. An in-flight guard and disabled/busy feedback prevent repeated status calls; failed requests show a translated message and recover. Offline mode preserves received tickets and disables status actions.
- Pickup: warm customer board with white preparing cards, teal ready panel, lime number tiles, clear status headings/counts, connection feedback, and friendly empty states. Ready comes first on phones; the TV layout gives ready orders more space. Ticket-number fonts adapt to longer numbers without splitting them.
- Public pickup still displays ticket numbers only. New UI copy uses local EN/NL maps via useLang().lang as agreed in [the polish brief](../decisions/UI-2026-10-07.md).
- Changes stay in packages/web/src/apps/kitchen/** and pickup/**; each screen imports its own scoped CSS. No dependencies added.

## Contracts touched
None. Existing HTTP status actions, WebSocket events, order filtering, kitchen alert sound and public pickup privacy remain in use.

## How to verify
- npm ci
- npm run check — passed: all workspace typechecks, ESLint, 99 tests across 7 files, production build.
- Git diff whitespace check passes.
- Edge Playwright smoke checks passed against buildApp + seedSample with an isolated in-memory SQLite DB on 127.0.0.1:3233: live start → ready → recall → ready → collected; pickup updates; pending repeated-click sends one status request; simulated failure feedback and recovery; empty queues; pickup contains no items/notes; Dutch copy; visible focus; no uncaught page errors.
- Browser sizes: 390×844, 1024×1000, 1440×1000. No kitchen/pickup horizontal overflow. All kitchen actions >=48px; measured 58–60px heights.
- Server-stop check passed: cached tickets remain visible, both screens show reconnecting feedback, kitchen actions become disabled. New writes are not replayed.
- Synthetic pickup WebSocket fixtures exercised 3-, 4-, 5- and 9-digit ticket numbers at phone/TV widths; all numbers remain on one line and the page does not overflow.

Isolated harness scripts and screenshots are retained locally (ignored; no real data or DB files) at:
C:/Users/Pyro/.codex/worktrees/cactuspos-screens-ui/CactusPOS/.local/ux03/

Re-run fixture server: node --import tsx .local/ux03/server.ts
Functional screenshots/checks: node .local/ux03/smoke.mjs
Long-number fixture screenshots/checks: node .local/ux03/long-numbers.mjs
Offline/Dutch/focus screenshots/checks: node .local/ux03/offline.mjs (stop only the fixture server after READY_FOR_SERVER_STOP).

Screenshot evidence:
- kitchen-phone.png, kitchen-tablet.png, kitchen-tv.png
- pickup-phone.png, pickup-tablet.png, pickup-tv.png
- kitchen-error.png, kitchen-empty.png, pickup-empty.png
- kitchen-nl-phone.png, pickup-nl-phone.png
- kitchen-offline-phone.png, pickup-offline-phone.png
- pickup-long-phone.png, pickup-long-tv.png
- result.json records measurements from the live-flow checks.

## Gotchas / decisions
- Requires the provided src/ui/Icon.tsx with the icon names listed in the shared polish brief.
- Root selectors use .kitchen.dark and .pickup.pickup-board to preserve scoped screen styles when the existing global CSS is loaded after application imports. All other styles remain under .kitchen or .pickup; shared shell, tokens, lib and catalogs were not edited.
- Successful status submissions stay busy until the live projection confirms the new state; reconnect reloads the projection. Requests are disabled while offline.
- The screenshot shell is the baseline shell in this worktree; the parent owns UX01 navigation/global integration and should review the combined layout after cherry-picking.
- Physical viewing from 3 metres and optional pickup auto-scroll/sound belong to T24; this task verified responsive browser screenshots and retained existing behavior.

## Follow-ups
- Parent integrates/reviews UX03 and updates BOARD.md per the agreed split; this agent deliberately did not edit BOARD.md.
- T07 can consolidate the two local copy maps when the shared catalogs are updated.
