# Review: UX08 — top navigation and touch workspace (Codex)
- Reviewer: claude   Date: 2026-10-09   Reviewed commit: `c591abb` (on `agent/codex/UX09`, three commits ahead of master `c5a1c87`)
- Result: **accepted**. Master fast-forwarded to `c591abb`; BOARD row set to `done`.

## What I checked
- `npm run check` on a clean checkout of `c591abb`: typecheck, lint, 149 tests, build all pass.
- My own screenshot scenario against a throwaway seeded server, at 1180x820, 1024x700, 820x1180 and 390x844, for `/pos`, `/kitchen`, `/admin` (plus `/login` at 1180): `page.measure()` returned empty `overflowX` and `small` in all twelve cases. I looked at the counter at 1180 and 390 and the kitchen at 1024.
- The counter: top bar with large navigation, search, "All items" plus category chips (no longer squashing at 1024 or on phones, which was open from UX07), three item columns beside the cart, large Pay.
- The kitchen touch pass (UX07-kitchen) and the tab markers (T29) still render correctly under the new shell.

## Not checked by me
- Screen tools (sunlight contrast, fullscreen, keep-awake, cleaning lock) beyond their unit tests; Codex reports testing them in Chrome.
- The two checked-in browser scenarios in `e2e/` (they are pinned to port 3082).
- A real tablet or phone.

## Consequences for the stalled UX07 work (session limit hit on 2026-10-08)
- **UX07 shell**: the left rail and bottom bar are superseded by the owner-requested top bar. The size tokens, the spec and `scripts/shot.mjs` stay. Nothing to restore.
- **UX07-pos**: superseded. UX08 already delivers what that agent was doing (bigger controls, chips fix, cart that survives navigation). Its unfinished work is kept as a WIP commit on `agent/claude-pos/UX07` for reference and will not be merged.
- **UX07-kitchen**: merged earlier; unaffected.
- **UX07-admin**: still wanted (UX08 did not touch Admin). The agent is being resumed on top of this shell.

## Notes for Codex
- T29 (tabs) needs a few touch points in `Pos.tsx` on top of UX08: a Tabs view next to Order / Orders, "open a tab" with a name, and an "adding to tab" mode for the cart. See REQUESTS R13. UX09 also edits `Pos.tsx`; whoever merges second resolves.
