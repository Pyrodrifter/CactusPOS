# CactusPOS
Self-hosted point of sale for Cactus Blue (Bonaire). Start with [AGENTS.md](AGENTS.md), then [docs/PLAN.md](docs/PLAN.md) and [docs/coordination/BOARD.md](docs/coordination/BOARD.md).

## Run locally

Use Node **22.13+ or 24+**, with npm 10 or newer. The server uses Node's built-in
SQLite API. Install dependencies from the repository root:

```sh
npm ci
npm run dev
```

Open <http://localhost:5173>. The API runs at <http://localhost:3000>; Vite proxies
`/api` and `/ws` to it. The root command supervises both services. **Ctrl+C** stops
both process trees, and either service exiting stops its sibling. Port 5173 must
be available; the launcher fails instead of silently moving the web app to
another port.

The current skeleton includes counter, kitchen and pickup screens with sample
menu data. A fresh database seeds demonstration PINs: **1111** for staff and
**1234** for owner. These are sample credentials, not production configuration.
The board and handoffs track outstanding acceptance criteria, including PWA,
contracts, printer support, administrative setup and tax verification.

For a built web app served by the local server:

```sh
npm start
```

Then open <http://localhost:3000>. `npm start` builds the web app before starting
the API. `start.bat` is the Windows convenience launcher. Development and local
service operation require no cloud account; the initial dependency installation
requires access to npm.

To test HTTPS from a phone on the same WiFi, follow the [LAN setup guide](ops/lan.md).
It covers `npm run lan:setup`, `npm run dev:lan`, `cactus.local`, the IP fallback,
and one-time local CA installation on each device.

## Data and configuration

`CACTUS_DB` sets the SQLite file path. Use an absolute path when configuring it.
Without it, the server uses `data/cactus.sqlite` relative to the server process's
working directory (`packages/server` when launched by the npm workspace scripts).
An empty database loads the sample menu automatically. `npm run seed` explicitly
loads sample fixtures into the selected database; use it only with development
data.

`PORT` sets the API port (default 3000). The existing Vite proxy targets port 3000;
keep that default for the combined development command. Local HTTPS, mDNS and
phone certificate setup are tracked in T06. Don't commit `.env` files, databases,
secrets, real sales or customer records.

## Verify changes

```sh
npm run typecheck
npm run lint
npm test
npm run build
```

`npm run check` runs these four commands in order. `npm run test:watch` runs Vitest
in watch mode. Tests use in-memory SQLite/sample fixtures, not the local till DB.
All six packages must provide and pass their own strict TypeScript check.

## Workspaces

| Package | Responsibility |
|---|---|
| `@cactus/shared` | Contracts, money and tax rules |
| `@cactus/server` | Local API, database, order lifecycle and live events |
| `@cactus/web` | Browser screens |
| `@cactus/receipt` | Receipt template/rendering package, scaffolded for T13 |
| `@cactus/printer` | Local print agent package, scaffolded for T14 |
| `@cactus/books-bridge` | Bookkeeping bridge package, scaffolded for T32/T33 |

The final three workspaces intentionally export nothing until their owning tasks
define the contracts and implementation. The current server's HTML receipt is
the earlier walking-skeleton implementation.

Claim work on the [board](docs/coordination/BOARD.md), respect file lanes, and use
[requests](docs/coordination/REQUESTS.md) to coordinate across packages.
