# Service routing and receipt designs (UX09)

Authoritative schemas: `packages/shared/src/receiptDesign.ts`, and additive Order/event fields in `domain.ts`.

- Signed-in staff `GET /api/service-mode` and `PUT /api/service-mode` use `{mode: "counter" | "board"}`. A PUT is audited and broadcasts `service-mode.changed` to staff. Default is `board`, preserving existing operation.
- Every new order snapshots the current mode. Counter orders skip kitchen display, public pickup projection and automatic kitchen printing; they remain normal payable sales in POS history. Their existing fulfilment status is not interpreted as proof of physical handover. POS labels them Counter service. Switching modes affects future orders only; it never discards existing board tickets. Added tab rounds retain the order's mode. Idempotent retries retain the original mode.
- Order `templateVersion` snapshots the active immutable receipt/ticket design at creation (absent/zero means built-in). Each version contains separate `receipt` and `kitchen` designs. Issued orders keep using that version on reprint.
- New orders also snapshot `printBusiness` at creation; later business settings do not rewrite their printed identity. Legacy orders without a snapshot retain the previous current-business fallback.
- Owner `GET /api/admin/receipt-templates` returns `TemplateState` (current design and up to 30 previous version summaries). `PUT` accepts `SaveTemplateBody`. `POST .../restore` accepts `RestoreTemplateBody` and publishes the selected historical design as a new version. Stale `baseVersion` returns 409 without changing anything. Saves/restores are audited.
- Owner `POST /api/admin/receipt-templates/preview` accepts `PreviewTemplateBody`, returns printable `text/html` with fixed sample data. `POST .../test-print` accepts the same body and queues a labelled sample on the configured printer; 409 without a printer. It never allocates sale/receipt numbers or opens the drawer.
- Mandatory receipt business identity, receipt number/date, order number, item amounts, totals/tax and payment information cannot be hidden. Custom text is escaped; variables are limited to `{{business}}`, `{{order}}`, `{{receipt}}`. No raw markup, URLs, scripts or ESC/POS commands are accepted.
- Logos are bounded, validated monochrome bitmaps, shared by browser SVG rendering and thermal raster printing. Width is at most 256 dots and height 160 dots. Editor conversion happens locally and requires no cloud.
- Physical printer paper configuration is authoritative for thermal column width; editor paper width controls browser/preview printing. The editor makes this distinction visible. Printed output uses the same structured blocks in both renderers.

Storage: new append-only `receipt_templates(version, data, created_at, staff_id)` table. Each save/restore inserts a full design; update/delete/replace are blocked. Current version is the maximum version. Zero is permanent built-in fallback.
