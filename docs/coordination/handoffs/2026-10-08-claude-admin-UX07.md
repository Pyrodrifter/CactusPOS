# Handoff: UX07 (admin) — touch pass for the Admin screens
- Agent: claude   Date: 2026-10-08, finished 2026-10-09 on top of master `37c71e0` (UX08 top bar)   Branch: agent/claude-admin/UX07

## What changed
Only `packages/web/src/apps/admin/**` (plus this note). No API call, route or shape changed.

- **Tabs** (`Admin.tsx`, new `controls.tsx` `ScrollRow`): seven tabs, 67px tall, icon above a 17px label, 10px apart. All seven fit without scrolling at 820px and wider in English and Dutch. On a phone four show; they keep their width (`flex: none`), scroll sideways, show an arrow on the side that has more, and the chosen tab is brought into view. The bar is pinned (`position: sticky; top: 0` inside `main`) on a solid strip, so it sits directly under the shell's top bar. Choosing a tab returns the page to its top.
- **Whole row to edit** (`MenuAdmin.tsx`, `StaffAdmin.tsx`, `ReportsAdmin.tsx`): menu items, staff and closed days are `.admin-row` with one `.admin-row-main` button that fills the row (77px or taller, 19px names). The sold-out control is a separate switch (`role="switch"`), a sibling of the row button with a 10px gap, so it cannot open the editor. Tapping a closed day also scrolls up to that day's figures.
- **No native dialogs**: `prompt()` and `confirm()` are gone from the admin folder. `NameDialog` (text field, Enter saves, empty name gives a message) and `ConfirmDialog` (Cancel and a solid red Delete, 14px apart, 12px on a phone) are in `controls.tsx`, both built on `AdminDialog`. Errors from the server show inside the dialog.
- **`AdminDialog`** has a fixed heading, a scrolling body and a pinned footer (`footer` and `error` props). Close button 56px, footer buttons 64px with a 19px primary. At 620px and narrower it is a sheet on the bottom edge. In the item editor "Delete this item" moved out of the footer to the end of the form, behind a divider, so it is never next to Save.
- **Switches** (`AdminSwitch`): every on/off choice (printer settings, market price, option group Required / Allow several, staff Active) is a full-width row with the label, the word On or Off, and a switch. Role (Staff / Owner) stays a two-button choice at 64px.
- **Sizes** (`admin.css`, rewritten): buttons 64px, fields 60px with 17px text and 16px labels, hints 15px, custom arrow on selects, category chips and reorder arrows 64px. Business and Printer keep Save pinned to the bottom of the screen (`.admin-savebar`, `bottom: 0`). "Save and print test page" moved into the Printer connection card.
- **Menu tab, fewer rows above the list**: at 1000px and wider the category name, its tools (earlier, later, rename, delete) and Add item share one row; narrower they are two rows; on a phone the name is dropped (the chosen chip is right above) and Add item is full width. The one-line hint moved under the list. Menu and Staff no longer show the general hint under the tabs.
- One validation fix in `TaxAdmin.tsx`: an empty "Rate %" used to be read as 0 (`Number('')`) and saved a 0% rate starting today. It now shows the existing "Enter a rate…" message. Typing 0 still works.

## Contracts touched
None.

## How to verify
`npm run check` (149 tests). Then build, start a server with the seed and look at Admin at 1180x820, 1024x700, 820x1180 and 390x844:

```bash
node scripts/shot.mjs --base http://localhost:3083 --out shots --pin 1234 --size 390x844 admin
```

Checked after merging master, with `scripts/shot.mjs` scenarios at all four sizes in English and in Dutch: every tab top to bottom, the item editor (top and end), new / rename / delete category, delete item, staff editor, new tax rate, close-day dialog. I looked at the PNGs.
- `page.measure()` at every scroll step of every page and dialog: `overflowX` and `small` empty everywhere.
- Pinned tabs: after scrolling, the top of the tab bar equals the top of `main` and the bottom of the top bar (165px at 820px and wider, 220px on the phone, both with the install banner showing). `--navh` is 0 and `main` has no bottom padding; nothing in the admin folder refers to a bottom bar.
- Dialogs: at every size each dialog lies inside the screen and its last footer button is fully visible (at 1024x700 and 390x844 the footer buttons end 32px and 14px above the bottom edge).
- Behaviour through the UI against the real server, 33 checks, all passed: add / rename (Enter key) / reorder category, add item with the name and price messages, sold-out switch (item changes, editor stays closed), edit with an option group, market-price switch, add and edit staff with the PIN message, new tax rate with the empty-rate message, mark verified, close the day with a cash count, business save, printer save, bookkeeping save and CSV.

## Gotchas / decisions
- **Deleting a menu item or category fails on master, and still does.** `lib/api.ts` always sends `content-type: application/json`, and Fastify refuses a DELETE with that header and no body ("Body cannot be empty when content-type is set to 'application/json'"). Checked with curl: without the header the same request returns 200. The new confirm dialogs show that message. I did not change the calls (out of scope) or `lib/api.ts` (web-core lane). With the header left off in the test browser, both deletes work end to end, and the server's "Move or remove the items in this category first" shows in the dialog.
- Everything was seen in headless Chrome and Edge on this computer only. Not tried on a real tablet or phone, and not in Safari: the pinned tab bar and Save bar rely on `position: sticky` inside `main`.
- Phone sheets sit on the bottom edge, so the on-screen keyboard can cover their buttons while a field has focus. Enter saves in the name dialog.
- Tapping outside a dialog still closes it and drops unsaved edits (as before).
- `ScrollRow` sets the scroll position at once. A smooth scroll stopped part-way when the page scrolled to its top in the same tap.
- The two reorder buttons are arrows only below 1280px (they keep their `aria-label`); at 620px and narrower Delete category is the bin icon and Rename has no icon. This keeps the row from wrapping in Dutch.
- On a phone the switch on a menu row shows its word under the switch, and long item names wrap to two lines.
- First menu item: about 445px down at 1024x700 and 565px down at 390x844. The shell takes 165px and 220px of that (72px is the install banner).
- `copy.menu`, `copy.staff`, `copy.title`, `copy.intro`, `copy.settings` are unused strings.
- Screenshot tool: with Edge, `page.shot()` took 30 to 100 seconds each once one run had lasted about 30 seconds, and a full Admin walkthrough stalled. The page itself kept answering at once, and Chrome (`SHOT_BROWSER`) ran the same walkthrough in 33 seconds, so the final checks used Chrome.

## Follow-ups
- web-core: in `packages/web/src/lib/api.ts` only send `content-type` when there is a body, so DELETE works (see above).
- shell: on a phone the install banner plus the two-row header leave 624px of 844px for a screen until the app is installed.
