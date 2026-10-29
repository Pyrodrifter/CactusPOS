# Sunday tryout and Monday deployment

Target: Sunday **November 1, 2026** for the tryout; Monday **November 2, 2026** for live use.
The software release drill is automated. The truck laptop, printer, WiFi and operator acceptance must be
checked at the truck before live sales. Keep the old till available during the transition.

Confirmed by the owner on October 29: **Surface Pro 7** is the till laptop; the printer has not been chosen.
Business details, CRIB and tax configuration will be entered in the POS during setup. Each company uses its
own installation/data and configures its own details; Cactus Blue is the first customer and a seed profile.

## Surface Pro 7 preparation

- Use the existing Windows x64 installer. Microsoft lists Windows 11 support for
  [Surface Pro 7](https://learn.microsoft.com/en-us/surface/surface-supported-operating-systems).
  Check the actual Windows version under Settings → System → About and install pending updates before the tryout.
- Connect its charger and use the stand in landscape orientation. Test the till with touch and the on-screen
  keyboard, including PIN entry, item search, cash tender and the Admin forms, at its normal display scaling.
- Set plugged-in sleep to **Never** during service; set display timeout to suit the till. Windows 11 puts these
  options under Settings → System → Power & battery → screen/sleep timeouts; see
  [Microsoft's power settings guide](https://support.microsoft.com/en-gb/windows/experience/power-battery/power-settings-in-windows-11).
  Keep the screen/keyboard cover open during service and test that other screens remain connected after idle time.
- Leave the printer off in Admin until the hardware is chosen. Test paper output and any required cable/dock
  with that model before relying on it. Orders, payments and the kitchen screen can be rehearsed meanwhile.

## Before Sunday

- [ ] Confirm the Surface's Windows version, the Windows account that will operate it, the kitchen device and
  receipt printer model/connection once chosen. Automatic printing currently supports network ESC/POS (TCP); a Windows
  printer uses the explicit Receipt button and browser printing. Direct USB/Bluetooth transports are pending
  T14b. Verify the actual connection before promising automatic receipts.
- [ ] Decide whether Sunday is practice or real sales. For practice, use a **separate Windows account** on the
  laptop, install the same setup there, and leave all practice records in that account. CactusPOS has no training
  switch. On Monday install/open it under the designated live Windows account. Do not delete test orders or
  restore an empty database over any real sales. If Sunday records real sales, retain that database on Monday.
- [ ] During setup, enter the company's name, CRIB, contact details, timezone and branding in **Admin → Business**.
  Set the applicable rates/effective dates and verification flags in **Admin → Tax**, then assign each menu item's
  category in **Admin → Menu**. Check prices and a receipt before real sales. The owner will fill these in later
  in the app; they are not build-time constants and do not need to be sent to the developer. Leave the shipped
  tax categories unverified until that company's owner has confirmed them (QUESTIONS Q1/Q1b/Q5c).
- [ ] Have the owner confirm manual card recording is acceptable: the separate terminal processes the charge;
  CactusPOS records it after approval. Split tender and partial payments remain pending T22/T23.
- [ ] Bring the setup file, the English/Dutch PDFs and a USB stick for backup copies. The private GitHub
  repository requires access; handing over these files works offline.

## Install and prepare (about 20 minutes)

1. On the chosen Windows account, run `CactusPOS-Setup-0.2.1.exe`. Allow the firewall request for the truck's
   private network. Start the till and sign in using the example owner PIN from the manual.
2. Under Admin, verify Business, Menu and Tax; change **both** example PINs under Staff. Sign out and prove
   each person's new PIN works. Do not leave 1234 or 1111 active for live use.
3. Under Admin → Printer, set up the actual network printer if applicable and print a test page. For a Windows
   printer, select the correct paper/printer in the browser dialog and print a real receipt using Receipt.
   An unplugged printer must not stop orders. Print jobs are held in memory: after restarting the server,
   reprint any missing receipt from Orders. Reconcile paper against Orders rather than taking payment again.
4. Under Admin → Backups, choose a second folder on the USB stick and use **Back up now**. Check that a copy
   exists on the stick. A backup stored only on the laptop does not cover laptop loss.
5. Plug the laptop into power. Set Windows not to sleep while plugged in; leave its lid open. Connect all
   devices to the same private truck WiFi. Reserve the laptop's IP in the router.
6. Start menu → CactusPOS → **Connect a tablet or phone** shows the addresses. Open `/kitchen` on the kitchen
   device, `/pos` on any second till, and `/pickup` only if wanted. Installed copies currently use HTTP;
   automatic screen wake/PWA installation on LAN devices needs the separate HTTPS work (T26c).
   Set the kitchen device's screen timeout manually for this release.

## Sunday acceptance drill (30–45 minutes)

Use the practice Windows account for sample sales. If using the live account, record only genuine transactions.

- [ ] Each operator rings a burger with modifiers, a drink, a quantity change and an open-price Lion Fish item.
  Confirm the total and receipt prices against the approved menu.
- [ ] Make a cash sale with change, then a card sale with a tip/reference. Check cash change and the terminal
  approval. The card button does not charge a terminal.
- [ ] In busy mode, the kitchen receives the order once, marks it ready and then collected; the pickup board
  follows. In calm mode, new orders skip both boards as intended.
- [ ] Open a named tab, add another round from the other screen and pay once. Kitchen sees the rounds.
- [ ] Correct a paid order and void another with a reason and manager PIN. Compare the retained original,
  replacement receipt and day totals. Confirm the accountant accepts this correction workflow (Q30).
- [ ] Print a receipt, unplug the printer, take another order, reconnect, and recover/reprint it. Check paper
  width, readable logo/ABB details, cutter and drawer (if used). Verify there is no blocked print dialog.
- [ ] Disconnect **internet/WAN** while leaving the private truck WiFi on. Sell, cook, pay and print normally.
- [ ] Briefly disconnect one tablet's WiFi, reconnect and verify it catches up without duplicate orders.
- [ ] Stop/reopen CactusPOS, then reboot the laptop and sign in to Windows. The till must start, the same orders
  must remain, and the kitchen must reconnect. Autostart is **at Windows sign-in**, not before sign-in.
- [ ] Close the practice day: counted cash excludes the opening float. Check cash/card/tips/refunds and export
  the report. Verify the new backup is copied to the USB stick.
- [ ] On a spare Windows account/computer, restore the USB backup using Start menu → CactusPOS → **Restore a
  backup**. Check order count, last receipt and report totals. Do not run a restore over a till taking sales.

Write failures with the action, time, device and order number. Keep real receipts/customer information out of
the repository. An unresolved checkout, total, kitchen, print or recovery failure stops live rollout.

## Monday opening and closing

- [ ] Open the designated live account and confirm it shows the expected records (fresh for practice-only
  Sunday, or including all real Sunday sales). Verify menu, confirmed tax/business details and staff PINs.
- [ ] Check laptop power/sleep, WiFi, kitchen connection, printer paper and USB backup location.
- [ ] Record the opening float separately; agree who handles corrections and calls for fallback.
- [ ] Run alongside the old till until the operators accept the flow. Ensure each real payment is charged
  once; agree which system is the accounting source during the parallel run.
- [ ] At close, count cash excluding float, close the day, export the report and verify the off-laptop backup.

If checkout, kitchen or printing fails during service, continue with the old till. Keep CactusPOS sales records,
take a backup when possible and record the last receipt number. Do not uninstall/reseed/reset the database to
troubleshoot. Restore only when the till is stopped and the selected backup's contents have been checked.

## Repeatable release checks (build computer)

```powershell
npm ci
npm run release:check
npm run package
```

`release:check` runs typecheck, lint, unit tests, all browser scenarios, a disposable real-server drill and the
production dependency audit. `package` builds the self-contained Windows folder/zip and PDFs, relocates a copy
outside the checkout and runs the same drill with **its bundled Node**, then compiles the setup, silently tests
an English install, Dutch update over a running till and uninstall, and hashes all release files. Installer
tests use their own data/shortcut folders and skip the firewall/Apps registry entry. These drills never read
the operator's database or settings. The runtime drill exercises 32 concurrent sales,
eight live connections, retry keys, sequential receipts, TCP printer transport, force-stop recovery, external
backup, restore into a fresh data home, receipt 33 and a balanced day close. This is a burst/recovery check,
not a sustained service-load or physical hardware test.

Release files are in `dist/redist/`; `RELEASE-VERIFICATION.json` records the packaged drill result,
`INSTALLER-VERIFICATION.json` records install/update/uninstall acceptance, and
`SHA256SUMS.txt` identifies the files to hand over. `VERSION.txt` inside the package names the source commit.
Tests and release builds use sample fixtures. No cloud connection is needed on the till after installation.
