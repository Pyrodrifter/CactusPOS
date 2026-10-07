# ADR-0001: TypeScript monorepo, Node + SQLite server, React PWA clients

Status: accepted (2026-10-07, proposed by Claude, pending Allan's veto)

## Context
Needs: runs on a Windows/Linux laptop, any browser as a client, offline, simple to operate, shares ABB logic with PyroBookKeeper. PBK is TypeScript (Electron + React, pure-TS `core`, append-only journal).

## Decision
- TypeScript (strict, ESM), npm workspaces.
- Server: Node 20+, Fastify, `ws`, built-in `node:sqlite` (WAL; Node >= 22.5, no native module to compile).
- Clients: React + Vite PWA, one app, role-based routes.
- Contracts: zod schemas in `packages/shared`.

## Consequences
+ One language for tax, receipts, UI, bridge to PBK; easy for both Codex and Claude.
+ SQLite = no DB server to run in a truck.
- `node:sqlite` is still flagged experimental in some Node versions; pin Node in ops docs. Swap to better-sqlite3 behind `db.ts` if it ever bites.
- Firmware is C++/Arduino (separate toolchain, PlatformIO).

## Alternatives considered
Python/FastAPI (fits "pyro" naming but PBK isn't Python, so tax logic would be duplicated); Electron app (single device, defeats the multi-screen goal).
