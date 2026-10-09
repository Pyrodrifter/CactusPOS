# Handoff: T26 — app window, installer, ready-made package
- Agent: claude   Date: 2026-10-09   Branch: agent/claude/T26-app-install

Owner request (2026-10-09): the laptop should run CactusPOS like a native program so their mother can use it as the
till while the kitchen tablet connects to it; then put it on GitHub with whatever is needed to install it easily.

## What changed
- **`ops/app/launch.mjs`** (+ `lib.mjs`, tests): the launcher. Starts the server detached and hidden when it is not
  running, then opens the till in an Edge/Chrome **app window** (no tabs, no address bar, own profile). Commands:
  `--screen`, `--kiosk`, `--server-only`, `--status`, `--stop`, `--configure`. Settings in `config.json` in the data
  folder. Errors are shown in a message box, because shortcuts have no console.
- **`ops/app/starting.html`**: the page shown in the window while the server starts; it switches to the till by itself.
- **`ops/windows/install.ps1`**, `uninstall.ps1`, `firewall.ps1`, `cactuspos.ico`, root **`Install CactusPOS.bat`**:
  finds Node.js (bundled, installed, or winget), `npm ci` + build for a checkout, settings, shortcuts (Desktop,
  Start menu, Startup), one firewall rule (TCP port, local subnet), start.
- **`ops/linux/install.sh`**, `cactuspos.png`: the same for Linux with desktop and autostart entries.
- **`scripts/make-redist.mjs`**: builds `dist/redist/CactusPOS/` and a zip: program, production libraries, built
  screens and a copy of `node.exe` with its licence. Installs with no internet and no Node.js on the target.
- **Data moved out of the program folder** for installed copies: `%LOCALAPPDATA%\CactusPOS` / `~/.local/share/cactuspos`
  (`CACTUS_HOME` overrides). `start.bat` and `npm start` are unchanged and keep using `packages/server/data`.
- `ops/install.md` (guide), README section, `.gitattributes` (line endings for .bat/.ps1/.sh), vitest now includes
  `ops/**/*.test.mjs`, `scripts/make-icons.py` also writes the .ico and the Linux .png.

## Contracts touched
- `GET /api/health` now also returns `app: 'cactuspos'`, `version`, `startedAt` (`HealthResponse` in shared, own
  commit `8fa5d2f`). Additive. The launcher uses `app` to tell CactusPOS from another program on the port, and
  `startedAt` to make sure `--stop` only ever stops the server it started.
- `tsx` moved into `@cactus/server` dependencies: it is what runs the server, and `npm ci --omit=dev` must keep it.
  No new package; the lock file only lost the `dev` marks.

## How to verify
- `npm run check`: 171 tests (22 new in `ops/app/lib.test.mjs`).
- Launcher without touching the real data folder:
  `CACTUS_HOME=<temp> node ops/app/launch.mjs --configure --port 3075 --seed cactus-blue`, then `--server-only`,
  `--status`, `--stop`.
- Package: `node scripts/make-redist.mjs`, copy `dist/redist/CactusPOS` elsewhere, then
  `powershell -ExecutionPolicy Bypass -File ops\windows\install.ps1 -Port 3076 -SkipFirewall -ShortcutRoot <temp>`
  with `CACTUS_HOME` set.

## What I ran, on Windows 11 (26200) with Edge 154 and Node 24.16
- Launcher: configure, start, status, stop, stop when not running, refusing to stop a server it did not start,
  broken settings file, unknown option.
- Package copied to a path with spaces; installer from there with the bundled Node.js; app window opened through the
  `conhost --headless` shortcut; one window, title "CactusPOS", no browser bars, starting page handed over to the
  sign-in screen. Two launches within a second gave one window; the kitchen shortcut opened `/kitchen`.
- The packaged server passed my screenshot scenario at four sizes and took orders, a tab round and a payment.
- Closing the window left the server running. Uninstall removed the shortcuts, stopped the server, kept the database.

## Not run
- The firewall step and its administrator prompt (it changes a system setting; I only read the script).
- The winget path for a computer without Node.js.
- `ops/linux/install.sh` on a Linux computer (`sh -n` syntax check only).
- A real second device connecting over WiFi, and Windows 10.

## Gotchas / decisions
- **Edge signs a new profile in by itself.** With a fresh `--user-data-dir`, Edge signed the till profile in with the
  Microsoft account of the Windows user, started syncing their browser data into it, put a sync notice over the till
  and opened their start pages in a second window. `--disable-features=msImplicitSignin --disable-sync
  --allow-browser-signin=false` stops it (checked: profile stays "not signed in", one window). The flags are in
  `browserArgs()` with a test, and I added them to `scripts/shot.mjs` too. I did not isolate which of the three is
  the one that matters.
- No VBScript wrapper (Microsoft is retiring it) and no compiled launcher (unsigned exe, antivirus risk).
  `conhost.exe --headless` starts the launcher without a console window.
- The port is strict for installed copies (no stepping to 3001): tablets bookmark it. A busy port is an error message.
- Workspace packages are junctions in `node_modules`, and junctions hold absolute paths. The package replaces them
  with real copies under `node_modules/@cactus/`, so it works wherever it is unzipped.
- Clicking the icon while a till window is open opens a second window (after the 4 s double-click guard).
- Tablets use plain `http` on the LAN, so the browser will not let the page keep the screen awake. Documented in
  `ops/install.md`; HTTPS for installed copies is still open.

## Follow-ups
- REQUESTS R14 (web-core): hide the "Install app" offer inside the app window.
- HTTPS for installed copies (Caddy + local CA from `ops/lan.md`), so tablets get keep-awake and a real install.
- T27 backups: the data folder is now one known place per platform.
- A service that runs without anyone signed in (NSSM / systemd), if starting at sign-in turns out not to be enough.
