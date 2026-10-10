# Task Board

Status: `todo` · `doing` · `review` · `done` · `blocked`. Claim = set `doing` + owner + date, commit immediately.
Lane names are defined in [AGENTS.md](../../AGENTS.md). "Deps" must be `done` before you start.

## M0 — Foundations
| ID | Lane | Task | Deps | Status | Owner | Done when |
|---|---|---|---|---|---|---|
| UX09 | shared / server / receipt / web-pos / web-admin | Owner-requested calm/busy routing (calm skips both screens), prominent order numbers and a versioned receipt/ticket editor with preview | - | review | codex · 2026-10-08 | New calm orders stay off both boards; busy orders flow normally; receipt/ticket design saves and prints consistently; existing records remain reproducible; checks and browser verification pass |
| T00 | ops | Monorepo scaffold: npm workspaces (`shared, server, web, receipt, printer, books-bridge`), tsconfig base, eslint, vitest, `npm run dev/typecheck/test` (done on master by claude; codex claim superseded) | - | done | claude · 2026-10-07 | `npm run typecheck && npm test` pass on empty packages; `npm run dev` starts server + web |
| T00A | ops | Complete foundation tooling on the current walking skeleton: missing workspaces, ESLint, supervised dev processes and setup docs; preserve implemented screens/server | - | done | codex · 2026-10-07 | All six workspaces typecheck; lint/tests/build pass; dev starts and stops both services; independent review |
| T01 | shared | Money (integer cents) + ABB tax engine: categories, rates with `validFrom`, tax-inclusive extraction per line and per receipt, deterministic rounding. Reuse/mirror PBK `packages/core/src/tax` | T00 | review | claude · 2026-10-07 | Unit tests: 6%/8%/exempt/mixed carts, rounding, effective-date change, inclusive price round-trip |
| T02 | shared | Domain contracts (zod): MenuItem, Modifier, TaxCategory, Order, OrderLine, Payment, Receipt, Device, Staff; HTTP route + WS event schemas; documented in `contracts/` | T00 | review | claude · 2026-10-07 | Schemas exported, contract docs written, server + web can import types |
| T03 | server | SQLite schema + migrations, append-only `order_events`, projections, gapless receipt counter, seed command with Cactus Blue sample menu | T02 | review | claude · 2026-10-07 | `npm run seed` builds a DB; tests prove no order/payment row can be deleted and numbers are gapless under concurrency |
| T04 | server | Fastify app: REST routes, WS hub with rooms per role, device registration + role, simple staff PIN login (owner + staff; manager-PIN only for void/refund) | T02,T03 | review | claude · 2026-10-07 | Contract tests pass; two WS clients receive each other's order events |
| T05 | web-core | Web shell: Vite + React PWA, router by role, WS client with reconnect + action queue, design tokens, big-touch components, dark mode for kitchen (PWA completed in T05A; safe write queue awaits R6) | T00,T02 | review | claude · 2026-10-07 | Installable PWA, works with server restart, Lighthouse PWA ok |
| T05A | web-core | Complete the missing PWA shell: install manifest/icons, versioned offline app assets, safe update prompt and server reconnection; automatic write replay needs server idempotency first | T00 | done | codex · 2026-10-07 | Production browser installs/loads shell offline, reconnects after server restart, never caches API responses or replays payments; independent review |
| T06 | ops | Local HTTPS + `cactus.local` mDNS + dev script to test from a phone on the LAN (software verified; physical phone trust/network drill pending) | T00 | review | codex · 2026-10-07 | Phone on same WiFi opens `https://cactus.local` with no warnings after one-time cert install guide |
 
| T07 | shared | i18n framework: message catalogs EN + NL, locale per device and per receipt, number/currency/date formatting, lint rule against hardcoded UI strings (minimal EN/NL dictionary exists; framework + receipt locale TODO; claim released 2026-10-10, nothing was in progress) | T00 | todo | | Switching language flips all screens + receipt; missing keys fail tests |
| T08 | web-admin | First-run setup wizard + business/brand/tax profile (Bonaire/Saba/Statia presets, template menus: food truck, restaurant, bar, shop) | T04,T05,T07 | todo | | Fresh install -> working POS for a made-up business without editing code |
| T09 | server | Seed profiles (`seed/*.json`), real Cactus Blue menu from cactusblue.us menu board, market-price (open price) items, brand colour | T20 | review | claude · 2026-10-07 | `npm run seed -- cactus-blue` loads her menu; Lion Fish Burger asks for a price at the counter |

## M1 — Walking skeleton (order -> kitchen -> pay -> print)
| ID | Lane | Task | Deps | Status | Owner | Done when |
|---|---|---|---|---|---|---|
| T10 | web-pos | Counter UI: category grid, cart, modifiers/notes, quantity, tax-inclusive totals, send to kitchen | T04,T05 | review | claude · 2026-10-07 | Order placed in <10 taps for a typical meal; totals match shared engine |
| T11 | web-pos | Payment flow: cash (tendered/change), mark paid, receipt number assigned | T10 | review | claude · 2026-10-07 | Cash payment closes the order, change correct, event log complete |
| T12 | web-screens | Kitchen display: live tickets, elapsed timers, bump to ready/recall, station filter, sound alert on new ticket | T04,T05 | review | claude · 2026-10-07 | New order shows within 1s on a second device; bump updates pickup state |
| T13 | receipt | Receipt model v1 + HTML renderer + ESC/POS renderer for fixed default template (58/80mm, logo, lines, ABB table, CRIB number) | T01,T02 | review | claude · 2026-10-07 | Golden-file tests for HTML and ESC/POS bytes; visually verified in browser |
| T14 | print | Print agent: network ESC/POS (TCP 9100), print queue with retry, cash-drawer kick, printer profiles, "print test page", on-screen fallback if printer offline | T13 | review | claude · 2026-10-07 | Prints real receipt on target printer; offline printer queues and reprints |
| T14b | print | USB and Bluetooth printer transports; one printer per station; verify on the real printer once chosen (Q2) Also: a printer installed in Windows (through the browser) as a real printer type with automatic printing; since 2026-10-09 nothing prints through the browser unasked | T14 | todo | | Real receipt printed on her printer |
| T15 | qa | Playwright e2e of M1 flow across 3 browser contexts (pos, kitchen, pickup mock) + seed fixtures | T11,T12 | todo | | CI-style `npm run e2e` green |

## M2 — Truck-ready
| ID | Lane | Task | Deps | Status | Owner | Done when |
|---|---|---|---|---|---|---|
| T20 | web-admin | Menu admin: items, categories, modifiers, tax category per item, availability toggle ("86"), photos, ordering, import/export CSV (photos + CSV split off as T20b) | T04,T05 | review | claude · 2026-10-07 | Owner edits menu on a phone; POS updates live |
| T20b | web-admin | Item photos; menu CSV import/export | T20 | todo | | Round-trip export/import keeps prices and options |
| T21 | web-admin | Settings: business details (name, CRIB, address), tax config view, currency, devices & roles, staff PINs, printer setup (devices/printer split off as T21b) | T04,T05 | review | claude · 2026-10-07 | Changing business details reflects on next receipt |
| T21b | web-admin | Settings: devices and roles, printer setup | T21,T14 | todo | | Test page prints from the settings screen |
| T22 | server | Payments v2: card (manual ref + tip), split tender, partial pay, void/refund with manager PIN + reason, comps/discounts with audit trail | T11 | todo | | All flows covered by tests; drawer reconciliation numbers add up |
| T23 | web-pos | UI for payments v2, discounts, open tabs / hold orders, reprint receipt, order search | T22 | todo | | Cashier can do each flow without leaving the main screen |
| T24 | web-screens | Pickup board (customer-facing): "Preparing / Ready" by order number, big type, auto-scroll, optional sound | T12 | todo | | Looks good from 3 m on a TV browser |
| T25 | web-screens | Phone ordering `/order`: staff mode (roaming order taker) and guest mode (QR, order -> pending until staff confirms/pays) | T10 | todo | | Guest order shows on POS "pending" tray; staff accepts in one tap |
| T26 | ops | Installers: Windows service (NSSM) and Linux systemd unit, auto-start, health page, update script, kiosk browser launcher — owner request 2026-10-09: start as an app window on the laptop (no browser chrome), one-step install with prerequisites, redistributable folder, GitHub. Services (NSSM/systemd) only if the simple autostart proves insufficient | T06 | review | claude · 2026-10-09 | Reboot laptop -> system is up with no login |
| T26b | ops + web-admin | "Connect a device" screen on the laptop: QR codes for the kitchen, till and pickup addresses so a tablet joins by scanning. Needs a QR encoder that draws to the screen (receipt lane has none yet; the printer draws its own) | T26 | todo | | Tablet opens the kitchen screen by scanning; nobody types an IP address |
| T26c | ops | HTTPS for installed copies (local CA + Caddy as in ops/lan.md, set up by the installer) so tablets may keep the screen awake and install the app properly | T26, T06 | todo | | Kitchen tablet stays awake by itself over https on the truck network |
| T27 | ops | Backups: nightly SQLite snapshot + journal copy to USB/cloud folder, one-click restore, restore drill documented (owner asked for it on 2026-10-10 with the audit fixes, so it starts although T03 is still in review) | T03 | review | claude · 2026-10-10 | Restore on a clean machine reproduces all orders |
| T29 | server | Tabs: name an unpaid order, add rounds of items to it later, pay at the end; kitchen sees each round; tab list on the counter (owner request) | T22 | review | claude · 2026-10-09 | Guest opens a tab, orders twice more, pays once; kitchen got three rounds; one receipt |
| T28 | qa | Load/chaos tests: 8 devices, 100 orders/hour, WiFi drop, server restart mid-order | T25 | todo | | No lost or duplicated orders; recovery documented |

## M3 — Receipt editor + books
| ID | Lane | Task | Deps | Status | Owner | Done when |
|---|---|---|---|---|---|---|
| T30 | receipt | Template model v2: blocks, variables, conditionals, versioning, WiFi-QR and generic QR/barcode blocks, image dithering for thermal | T13 | todo | | Schema documented; renderers handle all blocks |
| T31 | receipt | **Receipt editor** UI (drag blocks, edit text/variables, upload logo, WiFi QR wizard, giveaway/promo block with date range, live 58/80mm preview, test print, publish/rollback versions) | T30,T21 | todo | | Non-technical user changes the footer + adds WiFi QR and prints it |
| T32 | books | Spike: read PBK journal schema and `docs/bonaire-tax.md`; write ADR on direct-append vs import-file; prototype one day's entry | T01 | review | claude · 2026-10-08 | ADR merged; prototype entry accepted by PBK `npm run doctor` |
| T33 | books | Z-report (end of day): sales by tax category, tender totals, tips, voids, drawer variance; printable and stored | T22 | review | claude · 2026-10-08 | Numbers reconcile with order events in tests |
| T34 | books | PBK bridge: post daily summarized entry, backfill, idempotent re-run, mapping of tax categories -> PBK accounts | T32,T33 | review | claude · 2026-10-08 | Re-running a day never duplicates; PBK ABB report matches POS Z-reports |
| T35 | web-admin | Reports: daily/weekly sales, top items, hourly heatmap, ABB summary per quarter (15th-of-month deadline reminder) | T33 | todo | | Matches Z-reports |

## M4 — Beepers (ESP32)
| ID | Lane | Task | Deps | Status | Owner | Done when |
|---|---|---|---|---|---|---|
| T40 | firmware | Protocol spec in `contracts/beeper.md` (pairing, buzz/flash patterns, heartbeat, battery); server-side beeper registry + assign/release API | T04 | todo | | Spec reviewed by server + firmware lanes |
| T41 | firmware | ESP32 firmware (PlatformIO): WiFi provisioning, WS/MQTT client, buzzer + LED patterns, deep-sleep friendly, OTA | T40 | todo | | Beeper buzzes within 1s of "ready"; survives WiFi drop |
| T42 | web-pos | Assign beeper at checkout (type number or scan), release on collect; fallback to pickup board | T40 | todo | | |
| T43 | firmware | Hardware notes: BOM, enclosure, charging, range test | T41 | todo | | |

## M5 — Polish
| ID | Lane | Task | Deps | Status | Owner | Done when |
|---|---|---|---|---|---|---|
| UX12 | shared / receipt / web-admin | Owner-requested receipt personalisation: lettering in any font of the device (saved as a picture, so every printer prints it), printer text styles (small, tall, wide, large, huge, underline, inverse) for name, title, messages and footer, messages above or below the items, more divider styles, bigger logo and a closing picture; clearer editor | UX09 | review | claude · 2026-10-10 | Owner picks a font for the business name and a message, sees it in the preview and gets the same on the receipt printer; designs saved before this still print exactly as they did; checks and browser verification pass |
| UX11 | web-screens / web-core | Owner-requested digital menu board with live menu prices, category rotation, fullscreen and light/dark display | - | review | codex · 2026-10-09 | Readable customer display on TV/tablet; menu edits and availability refresh; no checkout controls; checks and browser verification pass |
| UX10 | web-core | Owner-requested icon fit/alignment polish and persistent light/dark theme across staff screens, login and dialogs | UX01 | review | codex · 2026-10-09 | Icons fit their controls on phone/tablet/desktop; dark theme persists and covers dialogs; typecheck/tests pass; browser visuals verified |
| UX08 | web-core / web-pos | Restore top navigation; bold shell/sign-in and counter polish; menu search, undo, touch display tools (owner authorized all UI lanes; leave pickup board unchanged) (reviewed and accepted by claude 2026-10-09, see handoffs/2026-10-09-claude-review-UX08.md) | UX01 | done | codex · 2026-10-08 | Top navigation at phone/tablet/desktop sizes; search/undo and display tools work; pickup files and appearance unchanged; typecheck/tests pass and browser screenshots verified |
| UX01 | web-core | Shared visual refresh: local SVG icon system, app navigation, PIN login, design tokens, accessible touch/focus styles and responsive shell | T00 | done | codex · 2026-10-07 | Consistent polished shell at phone/tablet widths; controls at least 48px; icons have accessible labels; existing flows preserved |
| UX02 | web-pos | Polish POS menu/cart/modifier/payment/order views with icons, clear hierarchy and phone/tablet touch layouts | T00 | done | codex-pos · 2026-10-07 | Existing order/payment flows work; quantity/actions at least 48px; no horizontal overflow at 390px; visual browser verification |
| UX03 | web-screens | Polish kitchen/pickup with consistent icons, readable status hierarchy, large touch actions and responsive boards | T00 | done | codex-screens · 2026-10-07 | Live ready/recall/pickup behavior preserved; kitchen actions at least 48px; phone/tablet/TV screenshots verified |
| UX04 | web-admin | Polish menu/business/staff/tax/printer settings with icons, accessible forms, generous touch spacing and responsive navigation | T00 | done | codex-admin · 2026-10-07 | Existing saves/roles/settings preserved; controls at least 48px; admin forms fit a 390px phone; visual browser verification |
| T50 | web-pos | Training mode (separate DB), quick-keys, dark/light themes, language NL/EN/PAP/ES | T23 | todo | | |
| T51 | server | Inventory-lite: stock counts per item, low alerts, auto-86 | T20 | todo | | |
| T52 | web-screens | Customer-facing order status page via QR on receipt | T24 | todo | | |
| T53 | books | Card-terminal reconciliation import; tip payout tracking | T34 | todo | | |
| UX07 | web-core | Touch pass, shell: touch size tokens + spec (`contracts/touch-ui.md`), left navigation rail on tablets, taller bottom bar on phones, bigger login keypad, install offer off the till screens, `scripts/shot.mjs` screenshot tool (owner request) (rail and bottom bar superseded by UX08 top bar; tokens, spec and shot tool stay) | UX06 | review | claude · 2026-10-08 | Screens follow the touch spec at the four check sizes |
| UX07-pos | web-pos | Touch pass, counter: bigger controls per touch spec, fix squashed category chips, cart survives navigation, phone cart bar (stalled on session limit; UX08 covers it; WIP kept on agent/claude-pos/UX07, not to be merged) | UX07 | superseded | claude-pos · 2026-10-08 | `page.measure()` clean at the four check sizes; screenshots reviewed |
| UX07-kitchen | web-screens | Touch pass, kitchen: bigger controls per touch spec, whole ticket tappable | UX07 | review | claude-kitchen · 2026-10-08 | Same |
| UX07-admin | web-admin | Touch pass, admin: bigger controls per touch spec, whole-row editing, no native prompt/confirm dialogs (merged 2026-10-09 after review by claude, see handoffs/2026-10-09-claude-review-UX07-admin.md) | UX07 | review | claude-admin · 2026-10-08 | Same |
| UX06 | web-core | Third UI pass: content-first admin, slimmer kitchen header and tickets, orders filter (owner request) | UX05 | review | claude · 2026-10-08 | Owner likes it on her tablet and a phone |
| UX05 | web-core | Cactus logo (app mark, favicon, PWA icons) and second UI pass: POS category colours, compact menu, payment sheet layout (owner request) | UX01,UX02 | review | claude · 2026-10-08 | Owner likes it on her tablet and a phone |
| T54 | web-core | UI polish + touch optimisation across login, POS, payment, kitchen, pickup (owner request) | T10,T12 | review | claude · 2026-10-07 | Looks and feels right on her tablet and a phone |

## Audit 2026-10-10 — fixes
From the app audit of master at 36f2e8d: [handoffs/2026-10-10-claude-app-audit.md](handoffs/2026-10-10-claude-app-audit.md). Highest priority first. Fixed on 2026-10-10 together with T27 (backups): [handoffs/2026-10-10-claude-audit-fixes.md](handoffs/2026-10-10-claude-audit-fixes.md).
| ID | Lane | Task | Deps | Status | Owner | Done when |
|---|---|---|---|---|---|---|
| A01 | server / books | Day reports by the day the money moved: a sale counts on the day it is paid, a refund on the day it is given; Z reports, cash expected, CSV and the PyroBookKeeper link follow | Q11 | review | claude · 2026-10-10 | Tab opened day 1 and paid day 2 is in day 2's sales and cash; a day-2 sale refunded on day 3 lowers day 3's cash and leaves day 2's closed Z report true; tests |
| A02 | server | Limit wrong manager PINs on the void route the way sign-in is limited; record failed tries in the audit log | - | review | claude · 2026-10-10 | The 6th wrong manager PIN in a row answers 429; test |
| A03 | shared / server / web-pos | Pay request carries the total the cashier saw; the server refuses with 409 when the order has changed since | - | review | claude · 2026-10-10 | Tab that grew on another screen cannot be paid for the old amount by card; the pay sheet shows the new total; test |
| A04 | server / web-core | Heartbeat on the live connection (screens reconnect and reload when nothing arrived for about 40 s) and a time limit on API calls that keeps the retry key | - | review | claude · 2026-10-10 | Kitchen recovers by itself within a minute after a silently cut connection; a stalled send shows an error and the retry makes one order |
| A05 | ops | One sales database however the till is started: `start.bat` / `npm start` and the installed app must not end up with different files | - | review | claude · 2026-10-10 | Either route opens the same sales, or the second refuses with a clear message naming both files |
| A06 | server / web-admin | Warn the owner while an example PIN (1234 / 1111) still works | - | review | claude · 2026-10-10 | Fresh database shows the warning in Admin until both PINs are changed |
| A07 | server | Small server fixes from the audit: kitchen and pickup lists include open work from an earlier day; no internal error text to screens; audit-log rows for printer and bookkeeping settings; document the three missing routes | - | review | claude · 2026-10-10 | Tests for the first three; contracts list every route |
| A08 | qa | Repair `e2e/ux08-checkout.mjs` (fails since the Pay later sheet) and run the browser checks from one command (with T15) | - | review | claude · 2026-10-10 | Both ux08 scenarios pass on master from one command |
| A09 | ops | `scripts/shot.mjs` leaves a headless Edge and a temp profile behind after every run on Windows | - | review | claude · 2026-10-10 | No `msedge.exe` on a `cactus-shot-` profile and no such folder remains after a run |

## Parallelization at a glance
- **Wave 1 (parallel after T00):** T01, T02, T06
- **Wave 2:** T03, T04, T05, T13
- **Wave 3:** T10, T12, T14, T20, T21, T32 (spike)
- Suggested split: **Claude** takes shared/server/books (T01-T04, T32-T34) and architecture review; **Codex** takes web UI/ops/firmware (T05, T10-T12, T20-T26, T40-T43). Swap freely, but claim on the board.

