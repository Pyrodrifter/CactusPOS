# Independent review: T05A — PWA shell
- Agent: codex-review   Date: 2026-10-07   Branch: agent/codex/T05A
- Status: independent core checks completed; reviewer interrupted before the restart/update drill and final verdict. Parent completed that drill separately; a fresh integrated reviewer will issue approval.

## Checks completed
- Read BOARD acceptance requirements, implementation, worker handoff, browser registration/update UI, and server/session/live client behavior.
- `npm run typecheck`: all six workspaces passed.
- `npm test`: seven test files / 99 tests passed.
- `npm run lint`: passed with zero warnings.
- `npm run build`: passed; manifest, PNG icons, worker and versioned production assets present.
- Isolated localhost Fastify server uses `openDb(':memory:')` and `seedSample`; original demo is untouched. Temporary Playwright loads from npm cache, no repository dependencies added.
- Persistent desktop Edge at 390 × 844: manifest CDP reports zero errors and `Page.getInstallabilityErrors` returns an empty error list. Incognito profiles correctly report `in-incognito`, so the installability acceptance used a regular temporary profile.
- Offline reload/navigation loads `/login`, `/pos`, `/kitchen`, `/pickup` shells and the explicit local server failure banner. Authenticated menu data and attempted order/payment POSTs fail offline. Cache Storage inventory contains only static build assets, manifest and icons.
- Phone viewport screenshot, visually inspected: `C:/Users/Pyro/AppData/Local/Temp/cactuspos-T05A-review/offline-phone.png`.

## Remaining verification
- Local server restart recovery (health, menu, persistent session, live order updates, active cart).
- Waiting worker, cancel/accept confirmation, other-tab behavior and old asset availability.
- Final evidence: `C:/Users/Pyro/AppData/Local/Temp/cactuspos-T05A-review/evidence.json` after completion.

## Parent completion evidence (not an independent approval)
- A separate bounded Edge drill passed on the refreshed core: server restart kept the session and active cart, refreshed the menu without navigation, and delivered a new live kitchen order.
- A waiting release did not reload an active cart; cancelling kept it, accepting reloaded only the approving tab, and a peer tab retained its cart. Previous static chunks remained available offline and cache inventory contained no API responses.
- Evidence: `C:/Users/Pyro/.codex/worktrees/cactuspos-pwa/CactusPOS/.local/screenshots/evidence.json` (PASS). The temporary worker change was restored and the fixture server/browser stopped.
- Final independent PWA/software acceptance is included in the combined UX-wave review. Physical target-device acceptance is unchanged.

## Scope and limitations
- Desktop Edge verifies software behavior only; physical phone HTTPS trust, WiFi and home-screen installation remain the target-device acceptance drill.
- No source, BOARD, existing demo process or real sales data modified. Dist worker changes are temporary and restored after the update drill.
