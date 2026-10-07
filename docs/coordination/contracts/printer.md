# Receipts and printing (v1)

Code: `packages/receipt` (what goes on paper), `packages/printer` (getting bytes to a printer), `packages/server/src/printing.ts` (settings, when to print).

## Receipt blocks
A receipt is a `Block[]` (`packages/receipt/src/blocks.ts`): `text`, `row` (left + right-aligned value), `sub` (indented detail), `rule`, `feed`, `qr`, `cut`, `drawer`.
Builders make blocks once; three renderers lay the **same** blocks out:

| Renderer | Use |
|---|---|
| `renderText(blocks, columns)` | previews, logs, golden tests |
| `renderHtml(blocks)` | browser print fallback, `GET /api/orders/:id/receipt` |
| `renderEscPos(blocks, { columns, cutter, drawerPin })` | bytes for a thermal printer |

Builders: `buildReceipt(order, business, { lang, copy, extra, openDrawer })`, `buildKitchenTicket(order, business, { station })`, `buildTestPage`, `wifiQr(ssid, password)`.
`extra` is where the receipt editor (T30/T31) will insert its blocks (WiFi QR, promos); nothing else in the builder needs to change for that.

Receipt content: business name, address, phone, CRIB number, receipt number, ticket number, date and time in the business time zone, lines with options, total, "prices include ABB", ABB per rate with the net it applies to, exempt/outside-scope amounts, payments, change, tip, footer. Reprints say `COPY`; void and unpaid are marked. Languages: `en`, `nl` (from `business.locale`).

## ESC/POS
- Only widely supported commands: init `ESC @`, code page `ESC t 19` (CP858), align `ESC a`, bold `ESC E`, double size `GS ! 0x11`, feed `ESC d`, cut `GS V 66 0`, drawer `ESC p`, QR `GS ( k`.
- Columns: 48 (80mm), 42 (80mm narrow font), 32 (58mm). Large text is double width, so half the columns.
- Text is encoded to CP858; characters outside it are reduced to ASCII, never sent as raw unicode.
- Unverified on real hardware: no printer has been chosen yet (QUESTIONS Q2). Likely per-model differences: the code page number, QR support, drawer pin.

## Transport and queue
- `NetworkTransport(host, port = 9100)`: raw TCP, one connection per job, 4 s timeout.
- `PrintQueue`: one job at a time, in order; retries with backoff (1s, 2s, 4s ... max 15s), 5 attempts, then `failed` with the reason. In memory only: after a server restart, reprint from Orders.
- USB and Bluetooth printers are not supported yet (follow-up T14b).

## Server behaviour
Settings (`PrinterSettings`, owner only): `enabled`, `host`, `port`, `columns`, `cutter`, `drawer`, `autoReceipt`, `autoKitchen`.

| Route | Who | Notes |
|---|---|---|
| `GET /api/print/status` | staff | `{ active, pending, jobs }`. `active = enabled && host` |
| `POST /api/orders/:id/print` `{ kind: 'receipt' \\| 'kitchen' }` | staff | reprint; receipts are marked COPY. `409` when no printer |
| `POST /api/print/drawer` | staff | open the drawer without a sale |
| `POST /api/print/retry` | staff | retry failed jobs |
| `GET` / `PUT /api/admin/printer` | owner | settings |
| `POST /api/admin/printer/test` | owner | test page |

- On pay: prints the receipt if `autoReceipt`; a cash payment pulses the drawer if `drawer` (with the receipt, or alone if receipts are not auto-printed).
- On send: prints a kitchen ticket if `autoKitchen`.
- **A printer problem never fails or delays a sale.** Printing happens after the order is saved.
- Web: when `active` is false the POS opens the HTML receipt in the browser print dialog instead.
