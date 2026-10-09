# Handoff: fix — till stuck on the "Paid" screen (receipt popup)
- Agent: claude   Date: 2026-10-09   Branch: agent/claude/fix-receipt-popup   Version: 0.1.1

## What the owner saw
After a few test payments the till showed "Paid · #1, Change $0.00" and neither **Receipt** nor **Next order**
did anything. They were running the UX09 working tree with `start.bat`, in Chrome, with no receipt printer set up.

## Cause
After a payment without a receipt printer, `Pos.tsx` called `browserPrintReceipt()`, which opened the receipt in
a popup window (`window.open`) and called `print()` in it. A popup opened that way shares the browser process
and script thread of the page that opened it, and `print()` stops that thread until the dialog is closed. So the
till was frozen for as long as the dialog was open. On the owner's screen the popup ("Receipt 3", 376x713 at the
top left corner) was **behind** the maximized till window: I found it by listing the browser's windows. Nothing
on the till said why it did not respond. Headless browsers ignore `print()`, which is why no automated run saw it.

## What changed
- `packages/web/src/lib/print.ts` (new): `printHtml(html)` prints from a hidden frame inside the page. The dialog
  now sits on top of the till and cannot get lost. The frame is sandboxed (`allow-same-origin allow-modals`), so
  receipt text can never run script in the till.
- `lib/api.ts`: `browserPrintReceipt()` uses it and reports a failed download instead of printing an error page.
  `printReceipt(order, { original })` lets the first browser print be the original and later ones copies.
- `apps/pos/Pos.tsx`: no automatic browser print after paying. With a receipt printer the server still prints on
  payment as before. Without one, the paid screen's **Receipt** button prints on request.
- `apps/admin/ReportsAdmin.tsx`: the day report used the same popup; it uses `printHtml()` too.
- `scripts/shot.mjs`: `SHOT_HEADED=1` runs the scenario in a visible window (needed for anything the browser itself
  draws, such as the print dialog); when a browser exits at once the next installed one is tried. Edge did that
  here whenever another Edge was already running, which matches what Codex and the admin subagent reported.
- Version 0.1.1 (root and server), so the installed copy can be told apart.

## Contracts touched
None.

## How I verified
- `npm run check`: 171 tests, lint, typecheck, build.
- Headless Chrome, paying through the screen (`scn_pay_receipt.mjs` in my scratch folder): after paying, the paid
  screen shows, `window.open` was called 0 times and no print frame exists; **Next order** closes the screen;
  **Receipt** creates one frame holding the receipt, not marked as a copy; a second tap prints one marked COPY.
- Visible Chrome (`SHOT_HEADED=1`): tapped **Receipt** and captured the window. The print dialog with the receipt
  preview is inside the till's own tab; the list of browser windows shows no new receipt window. I did not press
  Print.
- Launcher app window with another Edge already running: one window, profile not signed in.

## Not checked
- That the till responds again after the dialog is cancelled in a visible browser (I closed the test browser
  instead of pressing Cancel). This is how a print dialog in the same page behaves in Chrome and Edge.
- Safari and Firefox, and phones (their print sheets work differently).
- Printing on real paper.

## Decision to confirm with the owner
A truck that prints through a printer installed in Windows (not a network receipt printer) now needs one tap on
**Receipt** per sale. Automatic printing for that setup belongs with T14b (a "printer of this computer" type);
`silentPrint` in the launcher settings already removes the dialog.
