# Handoff: UX07 (kitchen) — touch pass for the kitchen screen
- Agent: claude   Date: 2026-10-08   Branch: agent/claude-kitchen/UX07

## What changed
Only `packages/web/src/apps/kitchen/Kitchen.tsx` and `kitchen.css` (the stylesheet was rewritten, not appended to).
- **Sizes** (spec: `contracts/touch-ui.md`): Start preparing / Mark ready / Collected are 76px (`--tap-xl`) with 20px text; Recall is 64px (`--tap-lg`) with a 14px gap to Collected. Item names 23px, quantity in its own badge (solid lime from 2× up), options 18px, "No ..." exclusions in a red pill with a cross, line notes 17px, order note in an amber box with a border. Ticket number 34px, paid/unpaid 15px, age 17px.
- **Whole ticket tappable** for New and Preparing (the button stays, and stays the keyboard and screen-reader control). Ready tickets react to their two buttons only. The in-flight lock and the offline check are unchanged and cover the ticket tap too.
- **Undo**: after Mark ready or Collected, an amber Undo button (64px, 20px text, "#12 · Ready") sits in the kitchen header for 8 seconds with a bar that runs out. It sends the ticket back one step through the same status route. Only the latest move can be undone. A failed undo turns red, says so, and stays for another 8 seconds.
- **Header is sticky** and its row is always 64px high, so Undo is in view when the list is scrolled and nothing moves when it appears.
- **900px and narrower**: a New / Preparing / Ready switcher (64px, with counts) shows one column at a time. Tickets fill the width; on a portrait tablet they sit two across. Wide screens keep three columns.
- New UI text (`undo`, `undoFailed`, `show`) is in the local `copy` object, English and Dutch.

## Contracts touched
None. Same `POST /api/orders/:id/status` calls and bodies as before; Undo uses that route with `preparing` or `ready`.

## How to verify
`npm run check` passes (typecheck, lint, 137 tests, build).

Seen with `scripts/shot.mjs` (headless Edge, seeded menu, own server and throwaway database) at 1180x820, 1024x700, 820x1180 and 390x844. `page.measure()` returned empty `overflowX` and `small` in every state below:
- at all four sizes: empty board; board with 3-4 tickets per column; each column on the two narrow sizes; Undo showing after Mark ready and after Collected, in English and Dutch, with the list scrolled; the offline state (server stopped) with Undo up; three-digit ticket numbers, a paid ticket, a 12× line, long order and line notes, ages past 5 and 10 minutes, in English and Dutch;
- at 1180x820, 820x1180 and 390x844 only: a failed Undo and a failed ticket action;
- a spot check of the three-column layout at 920x700.

Behaviour checked by script at 1180x820: body tap on a New ticket starts it (no Undo); a double tap does not start the ticket that slides into its place; body tap on a Preparing ticket marks it ready and offers Undo; body tap on a Ready ticket does nothing; Undo after ready and after collected puts the ticket back; Recall on the ticket Undo was for removes the Undo; Undo goes away after 8 seconds; while offline no tap does anything and all buttons are disabled.

To look yourself: start a server with `CACTUS_SEED=cactus-blue`, create a few orders at the counter, open `/kitchen`.

## Gotchas / decisions
- **Not tried with fingers.** Everything was checked in a headless browser with scripted clicks. Pressed states, scrolling by dragging on a ticket, and reading distance on a real tablet are untested.
- **Start cannot be undone** (the API has no way back to `sent`), and a stray tap on a New ticket now starts it. See follow-ups.
- **Tap guard, not asked for:** after the board changes (a ticket moves, a column is switched, the connection flips) all ticket taps are ignored for 350ms. Reason: with whole-ticket tapping, a double tap would otherwise start the ticket that slides up under the finger. Cost: a deliberate tap inside that window is dropped without feedback. `SETTLE_MS` in `Kitchen.tsx`; set it to 0 to switch it off.
- **Order note moved** from below the items to directly under the ticket number, so it is read before the food.
- **Narrow default column:** opens on the first column that has tickets, then stays where the cook put it. It does not follow tickets automatically (that would swap the list under a finger). It starts over when the board is empty.
- **Sticky chrome costs height:** 76px on wide screens; about 150px (header plus switcher) on narrow ones, which leaves roughly 550px of tickets on a 390x844 phone. On a phone held sideways (under 560px tall) the header is not sticky, so Undo can be scrolled out of view there.
- **Small landscape tablets (three columns under 1280px):** Recall is a compact button with its label under the icon. Under 1100px the Collected, paid/unpaid and age icons are hidden to save width. With Dutch labels or three-digit ticket numbers the paid/unpaid badge drops under the ticket number; the age keeps the top right corner.
- On phones, Undo replaces the kitchen title and the connection pill for its 8 seconds (the offline banner still shows below).
- Undo's clock is paused while offline, so a mis-tap made just before a connection drop can still be undone afterwards.
- The pressed state of a tappable ticket is a colour change only, no scale, so a ticket does not jump when a scroll starts on it.
- Screenshot tool: headless Edge captures CSS animations at their first frame. A ticket younger than 20 seconds shows mid-flash (tinted), and Undo may sit a few pixels high. Not how it looks live.
- `copy.subtitle` was already unused and still is.

## Follow-ups
Nothing was changed outside the lane and no REQUESTS or BOARD rows were added. Wishes for other lanes:
- **web-core:** an `undo` icon in `ui/Icon.tsx` (Kitchen draws its own for now); a toast with an action button, so other screens can offer Undo the same way; the old `.kitchen`, `.kcols`, `.ticket` rules in `ui/styles.css` (including the 860px column rule) are all overridden by `kitchen.css` and could go.
- **server + shared:** if Start should be undoable, the status route has to accept `sent` (contract change). A question for Allan first: is a ticket that was started by mistake a real problem in the truck?
- **web-core (`lib/live.ts`):** `useOrders` has no "loaded" flag, so the kitchen shows "Nothing in the queue" for a moment before the first fetch returns (as before this change).
- **qa:** no automated test covers the kitchen screen; the behaviour list above would make a Playwright spec.
