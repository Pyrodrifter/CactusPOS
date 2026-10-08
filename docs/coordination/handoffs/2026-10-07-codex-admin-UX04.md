# Handoff: UX04 — touch-friendly admin UI
- Agent: codex-admin   Date: 2026-10-07   Branch: agent/codex-admin/UX04

## What changed
- Scoped `admin.css` refresh: warm pale canvas, white form/list cards, navy/teal controls, lime section markers, generous spacing and readable headings.
- Admin navigation uses shared local SVG icons and 52px buttons; on phones the settings and category rows scroll horizontally within their own containers.
- Menu/category controls now have useful text alongside icons; boundary reorder controls are disabled. Item availability is visually distinct and announced with item names.
- Modifier editing has real field labels, stacked option rows on phones and 52px controls. Item, staff and tax editors use native modal dialogs for focus containment, Escape dismissal and focus restoration.
- Business and printer fields are grouped into section cards. Save actions expose busy states and reject repeated interactions; errors use alerts and save confirmations use status announcements.
- Added a small local EN/NL map for new descriptions and control labels without changing the central catalog.

## Contracts touched
None. HTTP methods, bodies, business/tax calculations, staff roles, PIN-preservation behavior and printer settings are preserved. No dependencies added.

## How to verify
From this worktree:
```powershell
npm ci
npm run typecheck
npm run lint
npm test
npm run build
```
All passed: six workspaces typechecked, lint clean, 7 test files / 99 tests, production build succeeded.

Browser verification used cached Playwright with headless Microsoft Edge against an isolated Fastify server on port 3104 with `CACTUS_DB=:memory:` and sample fixtures. Real databases and existing demo services were untouched.

- At 390px and 1024px, every rendered admin button/input/select was at least 48px in both dimensions (buttons/fields generally 52px); admin page and form/dialog content had no horizontal overflow.
- Saved a modifier delta and confirmed integer cents in `/menu`; toggled item availability twice and reordered a category.
- Saved business name and verified the persisted response/session update.
- Created a staff account, updated its name while leaving its PIN blank, and successfully signed in with the original PIN; default role remained staff.
- Staff write to `/admin/business` returned 403. A staff browser opening `/admin` redirected to `/pos`, with no admin navigation link.
- Invalid tax-rate input displayed an alert; a valid dated rate saved through the original route.
- Printer address saved while printing remained disabled; the test-page action displayed the original disabled-printer error without sending to hardware.
- New copy changed to Dutch. Modal Escape restored focus to the originating item edit button. No browser page errors.

Screenshots and browser result summary:
`C:/Users/Pyro/.codex/visualizations/2026/10/07/01a117b3-edfd-7150-b8dd-0646df8987e8/admin/`

Useful captures: `menu-phone.png`, `menu-tablet.png`, `item-phone.png`, `modifiers-phone.png`, `item-tablet.png`, `business-phone.png`, `business-desktop-nl.png`, `staff-phone.png`, `tax-phone.png`, `printer-phone.png`, `printer-nl-top-phone.png`.

## Gotchas / decisions
- Only the admin lane and this handoff changed. Core styles, routing, language catalogs, API helpers and receipt-editor ownership were respected.
- Admin styles use sufficient specificity to survive the legacy global CSS imported after app styles; specifically the old 44px `.tabs button` height is overridden.
- Category name prompts and destructive confirmations retain existing native browser behavior; item/staff/tax editing now uses native `<dialog>`.
- Printer verification used disabled printing and fixture data; physical hardware was not tested.
- Browser screenshots show the baseline shared shell; the root UX01 changes can be integrated independently.
- Coordinator owns the UX04 BOARD transition and independent review after integration.

## Follow-ups
- T07 may consolidate the local EN/NL additions into the shared catalog.
- Independent review and combined-shell verification remain for the coordinator; no cross-lane requests required.
