# Independent re-review: UX02 phone cart touch repair

- Reviewer: codex-pos-touch-rereview · 2026-10-07
- Worktree: `C:/Users/Pyro/.codex/worktrees/cactuspos-pwa/CactusPOS`
- Integrated repair: `ac24217`; production reviewed after coordinator marker at `9193394`.
- Verdict: **Approve UX02. R11's material phone checkout obstruction is resolved.**

Read AGENTS, BOARD, R11, the final integrated UX-wave review, original UX02/POS integration handoffs and repair handoff. Waited for `2026-10-07-codex-UX02-touch-repair-ready.md` before starting any browser or server drill. Coordinator's final `npm run check` passed six workspace typechecks, clean lint, 99 tests and production build; this focused independent review did not repeat the already approved whole-wave suite or rebuild sources.

## Independent production results

**10/10 grouped checks passed; zero page errors.** Twenty captured layouts had zero horizontal document overflow, zero controls smaller than 48px and zero unnamed controls. Sixteen maximum-scroll geometry records checked the cart Clear/Send/Send & pay and both summary controls at five points each (center and near each edge), in addition to ordinary Playwright clicks. No force clicks, hidden UI or script-generated button clicks were used.

| Check | Independent result |
|---|---|
| 390×844, 320×600, 390×600 and 1024×768 | Burger + cheese quantity 2 is $30; modifier quantity, cart plus/minus, Clear, Send and cart Send & pay work normally. Phone summary opens the cart and its Pay shortcut opens checkout. Tablet cart checkout works with no phone shortcut expected. |
| Original maximum-scroll failure | At 390×844, cart primary is x33/y599.516/w324/h58; summary starts at y694.516. All five points hit the primary button. Summary touch controls end at y757.516, above navigation's y771 top. |
| Long cart | Eight separate SAMPLE lines at 320×600; normal add/remove controls for every line, both checkout paths and Clear pass; maximum-scroll primary and summary hit tests pass. |
| Cash | At 390×600, normal double click during delayed payment sends exactly one create and one payment; one order/payment stored, $30 total/$50 tender/$20 change. Paid/change stays visible after Escape and backdrop click; Next order explicitly closes it and clears cart. |
| Open price/card | At 320×600, Add is disabled before price; keypad enters $12.50; full cart primary is reachable; card reference SAMPLE touch review and $2 tip persist in the stored payment; Next order works. |
| Keyboard/focus | Modifier focus stays in dialog through Shift+Tab/Tab, Escape returns to menu trigger, and keyboard focus has a visible outline. |
| PWA strips | Fresh regular persistent Edge produced a real Install app strip and empty CDP installability errors. Offline and reconnect preserve cart and clear maximum-scroll hit geometry. A real waiting service worker adds update strip beside Install app; cart and sticky Pay still work, and declining reload preserves cart. |

Screenshot inspection covered the tall/short phone cart, compact cash/card/open-price sheets, paid/change confirmation, tablet cart, eight-line cart bottom, offline and combined install/update strips.

## Nonblocking geometry observation / harness correction

At 320px, navigation's Pickup board label wraps, increasing the navigation background to 78.875px while the shell reserves 76px. Its background covers 2.5–2.8px of the summary's lower padding. The actual 52px summary buttons remain at least 7px above navigation, all five edge/center hit tests succeed, and normal summary/Pay clicks pass. No text or touch control is covered, so this is not the original R11 reachability defect or a material UX02 regression. The first harness treated background-container overlap as target overlap and also erroneously attempted the hidden phone shortcut on tablet; corrected those assertions to measure actual interactive targets and phone-only availability. Initial evidence remains in `evidence-first.json`; the completed corrected drill is `evidence.json`.

## Reproduction and artifacts

- Command: `node --import ./node_modules/tsx/dist/loader.mjs C:/Users/Pyro/.codex/visualizations/2026/10/07/01a117b3-edfd-7150-b8dd-0646df8987e8/pos-touch-rereview/review.mjs`, from the root worktree.
- Harness, evidence and PNGs: `C:/Users/Pyro/.codex/visualizations/2026/10/07/01a117b3-edfd-7150-b8dd-0646df8987e8/pos-touch-rereview/`.
- Fresh regular Edge profile, SAMPLE-only memory database and port 0. Production assets were copied outside the worktree before the real service-worker update test. Browser/WebSocket/server/database teardown completed; original demo 5173/3000, all implementation sources and root dist remained untouched. No new dependency or real sales data.
- Physical phone safe areas, touch/vibration and printers are not hardware-certified by this software drill. Prior UX01/UX03/UX04/T05A approvals and existing shared/server coordination remain outside this targeted repair review.

Coordinator owns final BOARD/R11 reconciliation and committing this review. No further material findings or repair request from this independent re-review.
