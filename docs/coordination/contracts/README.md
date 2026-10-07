# Contracts

One markdown file per boundary; the zod schemas in `packages/shared/src/contracts` are authoritative, these docs explain intent and examples.

Planned files (created by the owning task):
- `http.md` — REST routes (T02/T04)
- `events.md` — WebSocket events & rooms (T02/T04)
- `receipt-template.md` — block schema & variables (T13/T30)
- `printer.md` — print job format, profiles (T14)
- `books.md` — Z-report shape, PBK mapping (T32/T34)
- `beeper.md` — ESP32 protocol (T40)

Rule: breaking change = bump a `contractVersion`, add a note to the next handoff, and open a REQUESTS entry for every consuming lane.
