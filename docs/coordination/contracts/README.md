# Contracts

One markdown file per boundary; the zod schemas in `packages/shared/src/domain.ts` and `tax.ts` are authoritative, these docs explain intent and examples.

Planned files (created by the owning task):
- [`http.md`](http.md) — REST routes (written)
- [`events.md`](events.md) — WebSocket events and rooms (written)
- [`database.md`](database.md) — tables, migrations, what the database itself refuses (written)
- [`money-and-tax.md`](money-and-tax.md) — cents, rounding policy, rate dates (written)
- `receipt-template.md` — block schema & variables (T13/T30)
- `printer.md` — print job format, profiles (T14)
- `books.md` — Z-report shape, PBK mapping (T32/T34)
- `beeper.md` — ESP32 protocol (T40)

Rule: breaking change = bump a `contractVersion`, add a note to the next handoff, and open a REQUESTS entry for every consuming lane.
