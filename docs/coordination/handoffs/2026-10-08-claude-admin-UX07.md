# Handoff: UX07 (admin) — touch pass for the Admin screens
- Agent: claude   Date: 2026-10-08   Branch: agent/claude-admin/UX07

## What changed
Only `packages/web/src/apps/admin/**` (plus this note). No API call, route or shape changed.

- **Tabs** (`Admin.tsx`, new `controls.tsx` `ScrollRow`): seven tabs, 67px tall, icon above a 17px label. All seven fit without scrolling at 820px and wider in English and Dutch. On a phone they keep their width (`flex: none`), scroll sideways, show an arrow on the side that has more, and the chosen tab is brought into view. The bar is pinned (`position: sticky`) on a solid strip, and choosing a tab returns the page to its top.
- **Whole row to edit** (`MenuAdmin.tsx`, `StaffAdmin.tsx`, `ReportsAdmin.tsx`): menu items, staff and closed days are `.admin-row` with one `.admin-row-main` button that fills the row (77px or taller, 19px names). The sold-out control is a separate switch beside it (`role="switch"`), a sibling of the row button, so it cannot open the editor. Tapping a closed day also scrolls up to that day's figures.
- **No native dialogs**: `prompt()` and `confirm()` are gone from the admin folder. `NameDialog` (text field, Enter saves, empty name gives a message) and `ConfirmDialog` (Cancel and a solid red Delete, 14px apart) are in `controls.tsx`, both built on `AdminDialog`. Errors from the server show inside the dialog.
- **`AdminDialog`** now has a fixed heading, a scrolling body and a pinned footer (`footer` and `error` props). Close button 56px, footer buttons 64px with a 19px primary. At 620px and narrower it is a sheet on the bottom edge. In the item editor "Delete this item" moved out of the footer to the end of the form, behind a divider, so it is never next to Save.
- **Switches** (`AdminSwitch`): every on/off choice (printer settings, market price, option group Required / Allow several, staff Active) is a full-width row with the label, the word On or Off, and a switch. Role (Staff / Owner) stays a two-button choice at 64px.
- **Sizes** (`admin.css`, rewritten): buttons 64px, fields 60px with 17px text and 16px labels, hints 15px, custom arrow on selects, category chips and reorder arrows 64px. Business and Printer keep Save pinned to the bottom of the screen (`.admin-savebar`). "Save and print test page" moved into the Printer connection card.
- Menu and Staff no longer show the general one-line hint under the tabs; their own hint sits beside their buttons, which puts the list about 40px higher.
- One validation fix in `TaxAdmin.tsx`: an empty "Rate %" used to be read as 0 (`Number('')`) and saved a 0% rate starting today. It now shows the existing "Enter a rate…" message. Typing 0 still works.

## Contracts touched
None.

## How to verify
`npm run check`. Then build, start a server with the seed and look at Admin at 1180x820, 1024x700, 820x1180 and 390x844:

```bash
node scripts/shot.mjs --base http://localhost:3083 --out shots --pin 1234 --size 390x844 admin
```

Checked with `scripts/shot.mjs` scenarios at all four sizes (English), and at 390x844 and 1024x700 in Dutch: every tab top to bottom, the item editor (top and end), new / rename / delete category, delete item, staff editor, new tax rate, close-day dialog. `page.measure()` was run at every scroll step of every page and dialog: `overflowX` and `small` empty everywhere.
A second scenario exercised the behaviour through the UI against the real server: add / rename (Enter key) / reorder category, add item with the name and price messages, sold-out switch (item changes, editor stays closed), edit with an option group, market-price switch, add and edit staff with the PIN message, new tax rate, mark verified, close the day with a cash count, business save, printer save, bookkeeping save and CSV. All passed.

## Gotchas / decisions
- **Deleting a menu item or category fails on master, and still does.** `lib/api.ts` always sends `content-type: application/json`, and Fastify refuses a DELETE with that header and no body ("Body cannot be empty when content-type is set to 'application/json'"). Checked with curl: without the header the same request returns 200. The new confirm dialogs show that message. I did not change the calls (out of scope) or `lib/api.ts` (web-core lane). With the header left off in the test browser, both deletes work end to end, and the server's "Move or remove the items in this category first" shows in the dialog.
- The pinned Save bar uses `bottom: 0`. In Edge the sticky edge is the bottom of `main`'s content box, so it already sits above the phone tab bar. Not tried in Safari.
- Phone sheets sit on the bottom edge, so the on-screen keyboard can cover their buttons while a field has focus. Enter saves in the name dialog. Not tried on a real phone or tablet; everything was seen in headless Edge only.
- Tapping outside a dialog still closes it and drops unsaved edits (as before).
- `ScrollRow` sets the scroll position at once. A smooth scroll stopped part-way when the page scrolled to its top in the same tap.
- At 1100px and narrower the two reorder buttons are arrows only (they keep their `aria-label`); at 620px and narrower Delete category is the bin icon only. This keeps the toolbar on one row in Dutch.
- On a phone the first menu item starts about 580px down the 844px screen: install banner, header, tabs, categories, two toolbar rows, heading. The banner and header are the shell's.
- `copy.menu`, `copy.staff`, `copy.title`, `copy.intro`, `copy.settings` are unused strings.

## Follow-ups
- web-core: in `packages/web/src/lib/api.ts` only send `content-type` when there is a body, so DELETE works (see above).
- shell: the "Install app" banner takes 72px above Admin until the app is installed.
