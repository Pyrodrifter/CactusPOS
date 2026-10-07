# Handoff: T06 / R3 — strict API port startup
- Agent: codex   Date: 2026-10-07   Branch: agent/codex/T06

## What changed
- `packages/server/src/main.ts` validates PORT as an integer from 1 through 65535 before probing or opening the database.
- `CACTUS_STRICT_PORT=1` exits with code 1 when the requested port is occupied, before opening the database. LAN tooling can rely on its configured API port.
- Default startup still searches up to ten higher ports; it now stops at 65535.

## Contracts touched
None. No API, domain, database, or business behavior changes.

## How to verify
- `npm run typecheck`: passed across all six workspaces.
- `npm test`: passed 13 tests in two files.
- An ephemeral Node TCP listener held an OS-assigned port while a child ran `node --import tsx packages/server/src/main.ts` with PORT set to that port and `CACTUS_STRICT_PORT=1`: code 1, clear occupied-port message, and temporary database file absent.
- Child startup with PORT values `0`, `-1`, `65536`, `1.5`, `NaN`, and empty string: code 1, validation message, database file absent.
- Holding an ephemeral port with strict mode disabled and `CACTUS_DB=:memory:`: child successfully started on a higher port and emitted the existing fallback warning. Test child was stopped; previews on 3000/5173 were untouched.

## Gotchas / decisions
- Strict mode is opt-in and enabled only by the exact value `1`.
- The existing preflight probe remains; an external process racing to bind after the probe can still cause Fastify listen to fail after database opening.
- No dependencies added, installs performed, or Git state changed.

## Follow-ups
None for R3. Ops owns LAN tooling integration and T06 review.
