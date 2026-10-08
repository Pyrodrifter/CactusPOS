# Task Board

Status: `todo` · `doing` · `review` · `done` · `blocked`. Claim = set `doing` + owner + date, commit immediately.
Lane names are defined in [AGENTS.md](../../AGENTS.md). "Deps" must be `done` before you start.

## M0 — Foundations
| ID | Lane | Task | Deps | Status | Owner | Done when |
|---|---|---|---|---|---|---|
| T00 | ops | Monorepo scaffold: npm workspaces (`shared, server, web, receipt, printer, books-bridge`), tsconfig base, eslint, vitest, `npm run dev/typecheck/test` (done on master by claude; codex claim superseded) | - | done | claude · 2026-10-07 | `npm run typecheck && npm test` pass on empty packages; `npm run dev` starts server + web |
| T00A | ops | Complete foundation tooling on the current walking skeleton: missing workspaces, ESLint, supervised dev processes and setup docs; preserve implemented screens/server | - | done | codex · 2026-10-07 | All six workspaces typecheck; lint/tests/build pass; dev starts and stops both services; independent review |
| T01 | shared | Money (integer cents) + ABB tax engine: categories, rates with `validFrom`, tax-inclusive extraction per line and per receipt, deterministic rounding. Reuse/mirror PBK `packages/core/src/tax` | T00 | review | claude · 2026-10-07 | Unit tests: 6%/8%/exempt/mixed carts, rounding, effective-date change, inclusive price round-trip |
| T02 | shared | Domain contracts (zod): MenuItem, Modifier, TaxCategory, Order, OrderLine, Payment, Receipt, Device, Staff; HTTP route + WS event schemas; documented in `contracts/` | T00 | review | claude · 2026-10-07 | Schemas exported, contract docs written, server + web can import types |
| T03 | server | SQLite schema + migrations, append-only `order_events`, projections, gapless receipt counter, seed command with Cactus Blue sample menu | T02 | review | claude · 2026-10-07 | `npm run seed` builds a DB; tests prove no order/payment row can be deleted and numbers are gapless under concurrency |
| T04 | server | Fastify app: REST routes, WS hub with rooms per role, device registration + role, simple staff PIN login (owner + staff; manager-PIN only for void/refund) | T02,T03 | review | claude · 2026-10-07 | Contract tests pass; two WS clients receive each other's order events |
| T05 | web-core | Web shell: Vite + React PWA, router by role, WS client with reconnect + action queue, design tokens, big-touch components, dark mode for kitchen (PWA manifest/service worker still TODO) | T00,T02 | review | claude · 2026-10-07 | Installable PWA, works with server restart, Lighthouse PWA ok |
| T05A | web-core | Complete the missing PWA shell: install manifest/icons, versioned offline app assets, safe update prompt and server reconnection; automatic write replay needs server idempotency first | T00 | doing | codex · 2026-10-07 | Production browser installs/loads shell offline, reconnects after server restart, never caches API responses or replays payments; independent review |
| T06 | ops | Local HTTPS + `cactus.local` mDNS + dev script to test from a phone on the LAN (software verified; physical phone trust/network drill pending) | T00 | review | codex · 2026-10-07 | Phone on same WiFi opens `https://cactus.local` with no warnings after one-time cert install guide |
 
| T07 | shared | i18n framework: message catalogs EN + NL, locale per device and per receipt, number/currency/date formatting, lint rule against hardcoded UI strings (minimal EN/NL dictionary exists; framework + receipt locale TODO) | T00 | doing | claude · 2026-10-07 | Switching language flips all screens + receipt; missing keys fail tests |
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
| T14b | print | USB and Bluetooth printer transports; one printer per station; verify on the real printer once chosen (Q2) | T14 | todo | | Real receipt printed on her printer |
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
| T26 | ops | Installers: Windows service (NSSM) and Linux systemd unit, auto-start, health page, update script, kiosk browser launcher | T06 | todo | | Reboot laptop -> system is up with no login |
| T27 | ops | Backups: nightly SQLite snapshot + journal copy to USB/cloud folder, one-click restore, restore drill documented | T03 | todo | | Restore on a clean machine reproduces all orders |
| T28 | qa | Load/chaos tests: 8 devices, 100 orders/hour, WiFi drop, server restart mid-order | T25 | todo | | No lost or duplicated orders; recovery documented |

## M3 — Receipt editor + books
| ID | Lane | Task | Deps | Status | Owner | Done when |
|---|---|---|---|---|---|---|
| T30 | receipt | Template model v2: blocks, variables, conditionals, versioning, WiFi-QR and generic QR/barcode blocks, image dithering for thermal | T13 | todo | | Schema documented; renderers handle all blocks |
| T31 | receipt | **Receipt editor** UI (drag blocks, edit text/variables, upload logo, WiFi QR wizard, giveaway/promo block with date range, live 58/80mm preview, test print, publish/rollback versions) | T30,T21 | todo | | Non-technical user changes the footer + adds WiFi QR and prints it |
| T32 | books | Spike: read PBK journal schema and `docs/bonaire-tax.md`; write ADR on direct-append vs import-file; prototype one day's entry | T01 | todo | | ADR merged; prototype entry accepted by PBK `npm run doctor` |
| T33 | books | Z-report (end of day): sales by tax category, tender totals, tips, voids, drawer variance; printable and stored | T22 | todo | | Numbers reconcile with order events in tests |
| T34 | books | PBK bridge: post daily summarized entry, backfill, idempotent re-run, mapping of tax categories -> PBK accounts | T32,T33 | todo | | Re-running a day never duplicates; PBK ABB report matches POS Z-reports |
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
| UX01 | web-core | Shared visual refresh: local SVG icon system, app navigation, PIN login, design tokens, accessible touch/focus styles and responsive shell | T00 | doing | codex · 2026-10-07 | Consistent polished shell at phone/tablet widths; controls at least 48px; icons have accessible labels; existing flows preserved |
| UX02 | web-pos | Polish POS menu/cart/modifier/payment/order views with icons, clear hierarchy and phone/tablet touch layouts | T00 | doing | codex-pos · 2026-10-07 | Existing order/payment flows work; quantity/actions at least 48px; no horizontal overflow at 390px; visual browser verification |
| T50 | web-pos | Training mode (separate DB), quick-keys, dark/light themes, language NL/EN/PAP/ES | T23 | todo | | |
| T51 | server | Inventory-lite: stock counts per item, low alerts, auto-86 | T20 | todo | | |
| T52 | web-screens | Customer-facing order status page via QR on receipt | T24 | todo | | |
| T53 | books | Card-terminal reconciliation import; tip payout tracking | T34 | todo | | |

## Parallelization at a glance
- **Wave 1 (parallel after T00):** T01, T02, T06
- **Wave 2:** T03, T04, T05, T13
- **Wave 3:** T10, T12, T14, T20, T21, T32 (spike)
- Suggested split: **Claude** takes shared/server/books (T01-T04, T32-T34) and architecture review; **Codex** takes web UI/ops/firmware (T05, T10-T12, T20-T26, T40-T43). Swap freely, but claim on the board.

