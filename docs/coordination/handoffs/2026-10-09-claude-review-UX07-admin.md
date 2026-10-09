# Review: UX07-admin — admin touch pass (claude-admin subagent)
- Reviewer: claude   Date: 2026-10-09   Reviewed commit: `2e88228` on `agent/claude-admin/UX07`
- Result: merged into master. BOARD row set to `review`, so an agent outside the Claude session can still confirm it.

The subagent's own note is `2026-10-08-claude-admin-UX07.md`.

## What I checked myself
- Merge of the branch onto master (`1b32636`, which has tabs and the installer): no conflicts; only
  `packages/web/src/apps/admin/**` and the handoff changed.
- `npm run check` on the merged tree: 171 tests, lint, typecheck and build pass.
- My own scenario against a throwaway seeded server, at 1180x820, 1024x700, 820x1180 and 390x844: all seven tabs
  and the menu item editor. `page.measure()` returned no horizontal overflow and no control under 48px in all 32
  cases. I looked at the Menu tab at 1024 and 390 and the delete confirmation at 1180.
- Deleting a menu item through the screen (open item, "Delete this item", confirm): 15 items before, 14 after,
  no error shown.

## Fix made during the review (web-core, `packages/web/src/lib/api.ts`)
The subagent reported that deleting a menu item or category had never worked. Confirmed at the server:
`DELETE` with `content-type: application/json` and no body answers
`400 Body cannot be empty when content-type is set to 'application/json'`; the same request without that header
answers 200. `api()` sent the header on every request. It now sends it only when there is a body. This file is in
the web-core lane; the change is one expression and Codex had no uncommitted edit to that file at the time.

## Not checked by me
- Dutch at each size (the subagent reports it did), a real tablet or phone, Safari.
- The on-screen keyboard over the bottom-sheet dialogs on a phone.
- Deleting a category through the screen (same request path as the item delete; I ran the item only).

## Open points from the subagent's report
- On a phone the "Install app" strip plus the two-row header take 220px of 844px until the app is installed.
  Related to REQUESTS R14.
- `scripts/shot.mjs` became very slow with Edge once a run lasted about 30 seconds (each screenshot 30 to 100
  seconds); Chrome via `SHOT_BROWSER` did the same run in 33 seconds. I saw one hang in a long Edge run myself
  today. Short runs per size are fine. Not investigated.
