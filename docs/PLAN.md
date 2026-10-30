# CactusPOS — Plan

A surprise gift: a custom POS for the Cactus Blue food truck, Bonaire. Replaces the Mac-based system they use today.

## 1. Goals
- Runs on **one laptop** (Windows or Linux) in the truck; staff and guests use **phones, tablets, any browser**.
- Fast counter ordering, a kitchen screen, a customer-facing pickup board, and phone ordering (staff roaming the queue, or guests via QR).
- Correct for **Bonaire / Caribisch Nederland**: USD, **ABB** (not VAT), tax-inclusive consumer prices, sequential receipts, 7-year records.
- Beautiful, editable **receipts** (WiFi QR, giveaways, promos) with a real editor.
- **Bookkeeping**: closed days export as CSV for any accountant or accounting program.
- Later: **ESP32 order beepers** that buzz when an order is ready.
- Works with no internet. Easy for non-technical staff. Hard to break during a lunch rush.

## 1b. Universal for Bonaire (design principle)
Cactus Blue is customer #1, not hardcoded. Anything business-specific is configuration:
- **Business profile**: name, CRIB number, address, logo, colors, receipt text, currency (USD default).
- **Tax profile**: island (Bonaire / Saba / Sint Eustatius rates), ABB categories with `validFrom`, exempt grounds, price-includes-tax. Ships with Bonaire defaults and a "verify with your accountant" flag.
- **Setup wizard** on first run: business details, tax profile, pick a template menu (food truck / restaurant / bar / shop), printer, staff PINs.
- **i18n from day one**: English + Dutch now, string catalogs so Papiamento/Spanish are a translation file, not a code change. Receipts can print in a chosen language.
- **Business types**: food truck is first, but order flow modes (counter, table, tab, retail) are toggles so other Bonaire shops and restaurants could use it.
- **One install = one business** (simple, offline); no multi-tenant cloud. Packaging should let someone else install from a release zip and the wizard.
- No Cactus Blue assets in the code; branding lives in a `brand/` config the wizard writes.

## 2. Architecture

```
 phones / tablets / any browser  (PWA, role-based screens)
        |  HTTPS + WebSocket over the truck's WiFi/router
        v
 +-------------------- laptop (the "truck server") --------------------+
 |  packages/server   Fastify REST + WS hub, SQLite (WAL), auth (PINs) |
 |  packages/shared   zod contracts, money, ABB tax engine             |
 |  packages/receipt  template model -> HTML / PDF / ESC-POS bytes     |
 |  packages/printer  print agent: TCP 9100 / USB / BT, cash drawer    |
 |  packages/books-bridge  Z-report + sales -> CSV for the bookkeeper   |
 +---------------------------------------------------------------------+
        |                         |                       |
   receipt printer         ESP32 beepers (later)    nightly backup
   (+ cash drawer)         over WiFi (WS/MQTT)      (USB / cloud folder)
```

### Screens (all one web app, chosen by URL / device role)
| Route | Device | Purpose |
|---|---|---|
| `/pos` | counter tablet | Take orders, modifiers, discounts, take payment, print receipt |
| `/kitchen` | screen in the truck | Live ticket queue, bump, per-station filtering, timers |
| `/pickup` | customer-facing screen | "Now preparing / Ready" board by order number or beeper |
| `/order` | staff phone **and** guest QR | Phone ordering, sent to the POS queue (guest orders need staff confirm/pay) |
| `/admin` | owner laptop/tablet | Menu, tax categories, staff, receipt editor, reports, devices, settings |

Devices register once and get a **role** (counter, kitchen, pickup, mobile-order, admin) stored server-side; a custom headless/kiosk browser app is just a browser pointed at its role URL.

### Core domain
`Order` -> `OrderLine` (+ modifiers, notes, course/station) -> `Payment[]` (cash, card-manual, split, tip) -> `Receipt`.
Statuses: `open -> sent -> preparing -> ready -> collected` plus `void`. All state changes are rows in an append-only `order_events` table; current state is a projection. Voids/refunds are new records with reason + staff id.

### Stack decision (see decisions/ADR-0001)
TypeScript everywhere, because PyroBookKeeper's `core` is pure TypeScript with a native ABB model and an append-only journal we can reuse instead of re-implementing tax in another language.
- Server: Node 20+, Fastify, `ws`, SQLite via `better-sqlite3`, Drizzle or hand-written migrations.
- Web: React + Vite + PWA (installable, offline shell), Tailwind. No heavy UI framework; big touch targets.
- Monorepo: npm workspaces. Tests: Vitest + Playwright.
- Linux/Windows install: runs as a service (NSSM/Task Scheduler on Windows, systemd on Linux). mDNS name like `pos.local` (configurable). Network: dedicated travel router with a reserved laptop IP (preferred), laptop hotspot as documented fallback; local HTTPS via mkcert/Caddy (needed for PWA install and camera/QR scanning).

### Tax (Bonaire) — design rules
Source of truth for the rules: `C:\Users\Pyro\Documents\PyroBookKeeper\docs\bonaire-tax.md` (checked vs Handboek ABB 2026). Summary that matters for a till:
- ABB is a single-stage tax, not VAT. Consumer prices **must include** the tax.
- Rates are data with `validFrom`: services 6%, goods by a producent 8% (Bonaire); some necessities exempt. Each menu item has a **tax category**; the receipt shows the ABB portion per rate.
- **Open question (needs Allan/her accountant/BCN):** how prepared food and drinks sold from a truck are classified (service 6% vs producent goods 8%, and any exempt items). The engine supports all; the *default* config is decided in QUESTIONS.md Q1 before launch.
- Receipts carry business name, CRIB number, sequential number, date, lines, ABB per rate, total.
- Rounding: whole dollars/cents rules for returns are the bookkeeper's job; the till rounds each receipt to cents deterministically (rule in `shared/tax`).

### Receipts
Template = ordered **blocks** (logo, text, order lines, totals, tax table, barcode/QR, footer, conditional blocks like "if total > $X show giveaway QR"), with variables (`{{order.number}}`, `{{wifi.qr}}`). One template model, three renderers: **ESC/POS bytes** (thermal), **HTML** (screen/WhatsApp/email), **PDF**. The editor is a visual drag-and-drop block editor with live preview at 58mm/80mm. Templates are versioned; every printed receipt records the template version.

### Payments (v1)
Cash (change calc, cash drawer kick), Card (recorded manually after the terminal approves; reference + optional tip), Split, Void/Refund with PIN. Direct terminal integration is a later task once we know the provider.

### Bookkeeping
Daily **Z-report** closes the day: sales by tax category, cash vs card, tips, voids, cash drawer variance. Closed days export as CSV (daily sales, and one summarized journal entry per day, not per order). The PyroBookKeeper link was removed on 2026-10-30 (ADR-0003).

### ESP32 beepers (later phase)
Guests get a numbered beeper. Counter assigns it to an order; when kitchen marks ready, server tells that beeper to buzz/flash. Transport: WebSocket or MQTT over the truck WiFi; pairing by number; battery/low-signal reporting; fallback is the pickup board. Firmware in `firmware/` (PlatformIO).

## 3. Milestones
| M | Name | Outcome |
|---|---|---|
| M0 | Foundations | Monorepo, contracts, DB, CI-style scripts, agent protocol live |
| M1 | Walking skeleton | Order on `/pos` -> appears on `/kitchen` -> pay cash -> receipt prints. Real ABB math. |
| M2 | Truck-ready | Card/split/void, menu admin, pickup board, phone ordering, offline PWA, backup, installer |
| M3 | Receipt editor + books | Full editor, Z-report, CSV export, ABB report |
| M4 | Beepers | ESP32 firmware + pairing + server integration |
| M5 | Polish | Reports, inventory-lite (86 items), customer QR order, training mode |

## 4. Risks
- Tax classification wrong -> mitigated by data-driven config + accountant sign-off (QUESTIONS.md Q1).
- WiFi in the truck -> own router/hotspot; devices cache the app shell; server is single source, clients queue actions and retry.
- Rush-hour reliability -> SQLite WAL, optimistic UI with server ack, e2e tests, a "training mode" with a separate DB.
- Printer variety -> ESC/POS standard + a printer profile layer.
- Laptop failure -> nightly backup, one-click restore, documented second laptop procedure.
