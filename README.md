# CactusPOS
Self-hosted point of sale for Cactus Blue (Bonaire). Start with [AGENTS.md](AGENTS.md), then [docs/PLAN.md](docs/PLAN.md) and [docs/coordination/BOARD.md](docs/coordination/BOARD.md).

## Install on the till computer

For the November 1 tryout and November 2 deployment, follow [the deployment checklist](ops/deployment.md).
It covers practice versus live data, the truck acceptance drill, backups and the fallback plan.

The working tree also includes [local cactus.local discovery and an Android APK client](ops/mobile-clients.md).
Build it with `npm run android:build`; the existing Windows 0.2.1 installer predates these server changes.

The laptop in the truck runs the server and shows the till in its own window, like an installed program. Tablets
and phones on the same WiFi open the kitchen and ordering screens in their browser.

- **Windows, setup program:** get `CactusPOS-Setup-<version>.exe` from the
  [Releases page](https://github.com/Pyrodrifter/CactusPOS/releases) and double-click it: language, Next, Next,
  Finish. It carries everything, its own Node.js included; the computer needs no internet and nothing else
  installed. English and Dutch.
- **Windows, as a folder:** unzip `CactusPOS-<version>-win-x64.zip` from the same page and double-click
  **Install CactusPOS.bat**.
- **Windows, from this repository:** clone it and double-click **Install CactusPOS.bat**. It installs Node.js LTS
  with winget when missing, downloads the libraries and builds the screens.
- **Linux:** `sh ops/linux/install.sh` (needs Node.js 22.13+ or 24+ and Chromium, Chrome or Edge).

The installer adds a Desktop icon, starts CactusPOS at sign-in and (Windows) asks once to open the firewall for
devices on the local network. Sales data lives outside the program folder (`%LOCALAPPDATA%\CactusPOS`,
`~/.local/share/cactuspos`), so updating never touches it. Full guide, tablet setup, backups and troubleshooting:
[ops/install.md](ops/install.md). Build the setup program, the zip and the manual yourself with `npm run package`
(needs Inno Setup 6, see [Building a release](ops/install.md#building-a-release)).

**The user manual** (installing, setting up, daily use, with pictures) is written for the people at the till, in
English and Dutch: `docs/manual/`, installed with the program under Start menu → CactusPOS, and attached to every
release as `CactusPOS-Manual-English.pdf` and `CactusPOS-Handleiding-Nederlands.pdf`.

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

`npm run release:check` runs the complete software gate, including browser checks, an isolated
sale/restart/backup/restore drill and the production dependency audit. `npm run check` runs typecheck,
lint, the unit tests and the build. `npm run e2e` builds the
screens and runs the browser checks in `e2e/` against a throwaway till (temporary database,
port 3082) in headless Edge or Chrome.

To test HTTPS from a phone on the same WiFi, follow the [LAN setup guide](ops/lan.md).
It covers `npm run lan:setup`, `npm run dev:lan`, `cactus.local`, the IP fallback,
and one-time local CA installation on each device.

## Data and configuration

The sales database is one file, in the same place however the till is started
(installed app, `start.bat`, `npm start`): `%LOCALAPPDATA%\CactusPOS\data\cactus.sqlite`
on Windows, `~/.local/share/cactuspos/data/cactus.sqlite` on Linux. `CACTUS_DB` names
another file (use an absolute path); `npm run dev` sets it to
`packages/server/data/cactus.sqlite`, so development never writes to the till's sales.
Backups are made automatically into `backups/` beside the database; see
[ops/install.md](ops/install.md#backups).
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
| `@cactus/receipt` | Versioned receipt designs, HTML and ESC/POS rendering |
| `@cactus/printer` | Network ESC/POS transport and retry queue |
| `@cactus/books-bridge` | Day reports and PyroBookKeeper export |

The board distinguishes implemented work awaiting independent review from deferred features.
Physical printer, truck-network and operator acceptance checks are in the deployment checklist.

Claim work on the [board](docs/coordination/BOARD.md), respect file lanes, and use
[requests](docs/coordination/REQUESTS.md) to coordinate across packages.
