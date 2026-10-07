# AGENTS.md — read this first (Codex, Claude Code, any agent)

CactusPOS is a self-hosted point of sale for **Cactus Blue**, a food truck on Bonaire.
A small server runs on a laptop in the truck; phones, tablets and any browser are the screens.
Full vision and architecture: [docs/PLAN.md](docs/PLAN.md). Task list: [docs/coordination/BOARD.md](docs/coordination/BOARD.md).

## How agents work together

Several agents (Claude Code and Codex) work in this repo at the same time, possibly in separate
git worktrees. They never talk directly. They communicate through **files in `docs/coordination/`**.

### Workflow for every task
1. Open `docs/coordination/BOARD.md`. Pick a task with status `todo` whose dependencies are `done`.
2. **Claim it**: set status `doing`, owner `<agent-name>`, date. Commit that one-line change first
   (small, fast, so others see it). If the row is already `doing`, pick another.
3. Work on branch `agent/<agent-name>/<task-id>` (ideally in its own worktree).
4. **Stay inside your lane** (file ownership below). Need a change outside your lane? Don't make it.
   Add an entry to `docs/coordination/REQUESTS.md` addressed to the owning lane and carry on or pick another task.
5. **Contract first.** Anything crossing a package boundary (HTTP routes, WebSocket events, DB shape,
   receipt template schema, printer commands, beeper protocol) lives in `packages/shared` (zod schemas)
   and is described in `docs/coordination/contracts/`. Change a contract in its own small commit and
   note it in the handoff so consumers can react.
6. **Finish** with a handoff note: copy `docs/coordination/handoffs/_TEMPLATE.md` to
   `handoffs/<YYYY-MM-DD>-<agent>-<task-id>.md`. Set the BOARD row to `review` (never `done` yourself
   unless the task says "self-merge").
7. Reviewing: a *different* agent verifies against the task's **Done when** list, then sets `done`.

### Lanes (who may edit what)
| Lane | Owns | Notes |
|---|---|---|
| shared | `packages/shared/**` | Contracts, money, tax engine, domain types. Changes need a handoff note. |
| server | `packages/server/**` | API, DB, WebSocket hub, auth, order lifecycle. |
| web-pos | `packages/web/src/apps/pos/**` | Counter/ordering UI. |
| web-screens | `packages/web/src/apps/{kitchen,pickup,order}/**` | Kitchen, customer pickup board, phone ordering. |
| web-admin | `packages/web/src/apps/admin/**` | Menu, settings, reports, staff. |
| web-core | `packages/web/src/{ui,lib}/**` | Design system, WS client, PWA shell. Small, shared; coordinate via REQUESTS. |
| receipt | `packages/receipt/**`, `packages/web/src/apps/admin/receipt-editor/**` | Template model, renderers, editor. |
| print | `packages/printer/**` | Print agent, ESC/POS transport, cash drawer. |
| books | `packages/books-bridge/**` | PyroBookKeeper integration, Z-reports. |
| ops | `ops/**`, `scripts/**`, root configs | Install, services, backups, kiosk, HTTPS. |
| firmware | `firmware/**` | ESP32 beepers. |
| qa | `e2e/**`, `**/*.test.ts` in cooperation | Playwright, fixtures, seed data. |

### Rules of the road
- **Money is integer cents (USD).** Never floats. Rounding rules live only in `packages/shared/src/money` and `tax`.
- **Prices shown to consumers include tax** (ABB law). Tax is data-driven (category + rate + `validFrom`), never hardcoded in UI.
- **Nothing is deleted.** Orders, payments, receipts are append-only; void/refund creates a new record with a reason and staff id.
- **Receipt numbers are gapless and sequential** per device-independent counter owned by the server.
- **Offline first.** The truck may have no internet. Nothing in the order -> kitchen -> pay -> print path may need the cloud.
- Touch first: min 48px targets, works one-handed on a phone, no hover-only UI.
- Strict TypeScript, ESM, Node >= 20, Vitest for unit tests, Playwright for e2e. `npm run typecheck && npm test` must pass before `review`.
- Match existing style. No new dependency without a line in your handoff saying why.
- Don't commit secrets, customer data, or real sales data. Use `seed/` fixtures.
- When you are unsure of a **business or tax rule**, do not guess: add it to `docs/coordination/QUESTIONS.md` for the owner (Allan).

### Messages and files
- `BOARD.md` — task status (the single source of truth for "who is doing what").
- `REQUESTS.md` — cross-lane asks ("server: need a /orders/:id/hold route"). Close with `[x]` and a link.
- `QUESTIONS.md` — questions for the humans.
- `contracts/` — human-readable API/event/protocol docs, mirrored by zod code in `packages/shared`.
- `decisions/` — ADRs. Changing the stack or a core rule requires a new ADR, not a quiet edit.
- `handoffs/` — one note per finished task: what changed, how to test, gotchas, follow-ups.
