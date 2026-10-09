# Installing CactusPOS

One computer runs CactusPOS (the laptop in the truck). It shows the till in its own window, like any installed
program. Every other screen (kitchen tablet, a phone for taking orders, a pickup board) is a browser on the same
WiFi pointed at that laptop. Nothing needs the internet once it is installed.

## Windows 10 or 11

### A. Ready-made package (no internet needed on the till computer)

1. Get `CactusPOS-<version>-win-x64.zip` from the project's Releases page on GitHub, or on a USB stick.
2. Unzip it somewhere it can stay, for example `C:\CactusPOS`.
3. Double-click **Install CactusPOS.bat**.
   - If Windows warns about a file from the internet, choose **Run**.
   - Windows asks once for permission to change the firewall: choose **Yes**. Without it the till works on the
     laptop, but tablets and phones cannot connect.
4. The till opens. From now on use the **CactusPOS** icon on the Desktop.

The package carries its own copy of Node.js in `runtime\node`; nothing else is installed on the computer.

### B. From the source code

Needs internet during installation.

```bat
git clone <repository address> C:\CactusPOS
cd C:\CactusPOS
"Install CactusPOS.bat"
```

The installer looks for Node.js 22.13+ or 24+. When it is missing it installs Node.js LTS with `winget`
(from the OpenJS Foundation, the publisher of Node.js), then downloads the program libraries and builds the
screens. To build the ready-made package yourself: `node scripts/make-redist.mjs`.

### What the installer sets up

| What | Where |
|---|---|
| Till icon | Desktop and Start menu → CactusPOS |
| Kitchen screen and pickup board on this computer | Start menu → CactusPOS |
| Start when this Windows user signs in | Startup folder (till window opens by itself) |
| Firewall rule "CactusPOS" | incoming TCP on the till's port, from the local network only |
| Settings, sales database, logs | `%LOCALAPPDATA%\CactusPOS` (paste that into the Explorer address bar) |

Options, for example from a terminal in the program folder:

```bat
"Install CactusPOS.bat" -ServerOnlyAtSignIn
```

| Option | Effect |
|---|---|
| `-Port 3100` | Use another port (default 3000). Tablets must then use the new address |
| `-Seed <name>` | Menu loaded into an **empty** database: a file from `seed\` without `.json` |
| `-ServerOnlyAtSignIn` | At sign-in start the server only; open the till with the icon |
| `-NoAutostart` | Do not start at sign-in |
| `-SkipFirewall` | Leave Windows Firewall alone |
| `-NoStart` | Do not start CactusPOS when the installer is done |

Install it under the Windows account that runs the truck. Shortcuts and data belong to that account.

## First start

A new database has two example PINs: **1234** (owner) and **1111** (staff). Sign in as owner and change both
under **Admin → Staff** before real use. Business name, menu, tax rates and the receipt printer are under Admin too.

## Kitchen tablet, phones, pickup board

1. Connect the device to the same WiFi as the laptop.
2. Open the address the installer printed, for example `http://192.168.1.20:3000/kitchen`.
   To see the addresses again: Start menu → type `cmd`, then

   ```bat
   cd C:\CactusPOS
   runtime\node\node.exe ops\app\launch.mjs --status
   ```

   (with Node.js installed separately: `node ops\app\launch.mjs --status`)
3. Sign in with a PIN. Add the page to the home screen from the browser menu so it opens like an app.

| Screen | Address ends with |
|---|---|
| Till / taking orders | `/pos` |
| Kitchen | `/kitchen` |
| Pickup board for guests (no sign-in) | `/pickup` |

Good to know:

- **Give the laptop a fixed address.** In the router, reserve the laptop's IP address (DHCP reservation), or the
  tablets' bookmark stops working when the router hands out another address.
- **No router?** Turn on the laptop's Mobile hotspot (Windows Settings → Network → Mobile hotspot) and connect the
  tablet to it. The address is then usually `http://192.168.137.1:3000`.
- **Tablet screen goes dark.** The connection here is plain `http`, and browsers only allow a page to keep the
  screen awake over `https`. Set the tablet's screen timeout to its longest value, or "stay awake while charging".
  HTTPS on the local network is described in [lan.md](lan.md); it is a developer setup for now.
- The laptop must be on, and its Windows user signed in, for the other screens to work.

## Everyday use

- **Start:** the Desktop icon. The server keeps running when the till window is closed, so the kitchen keeps working.
- **Stop the server:** `node ops\app\launch.mjs --stop` in the program folder (or shut the computer down).
- **Back up:** copy the folder `%LOCALAPPDATA%\CactusPOS\data` to a USB stick or cloud folder, ideally while the
  server is stopped. That folder is the whole sales record.
- **Update:** replace the program folder with the new version (or `git pull`), then run **Install CactusPOS.bat**
  again. Data and settings are outside the program folder and stay as they are.
- **Log:** `%LOCALAPPDATA%\CactusPOS\logs\server.log`.

## Settings file

`%LOCALAPPDATA%\CactusPOS\config.json`. Stop and start CactusPOS after changing it.

```json
{
  "port": 3000,
  "seed": "cactus-blue",
  "screen": "pos",
  "kiosk": false,
  "silentPrint": false,
  "browser": ""
}
```

| Setting | Meaning |
|---|---|
| `port` | Port of the server. Fixed on purpose: tablets bookmark it |
| `seed` | Menu for an empty database. Ignored once the database has data |
| `screen` | What the till window opens on: `pos`, `kitchen`, `pickup`, `admin` |
| `kiosk` | `true` = full screen with no title bar. Leave with Alt+F4 |
| `silentPrint` | `true` = printing from the browser goes straight to the default printer without a dialog |
| `browser` | Full path of the browser for the till window. Empty = Edge, then Chrome |

The till window uses Edge or Chrome in "app" mode with its own profile in the data folder. It does not touch the
bookmarks, passwords or sign-ins of the normal browser, and it is started so that Edge does not sign it in to a
Microsoft account.

## Linux

```sh
git clone <repository address> ~/cactuspos
cd ~/cactuspos
sh ops/linux/install.sh
```

Needs Node.js 22.13+ or 24+ and Chromium, Chrome or Edge. It builds the program, adds **CactusPOS** to the
application menu and starts it at login. Data: `~/.local/share/cactuspos`. Options: `sh ops/linux/install.sh --help`.
If a firewall is active, allow the port from the local network, for example
`sudo ufw allow from 192.168.1.0/24 to any port 3000 proto tcp`.

This installer has been checked for syntax only; it has not yet been run on a real Linux computer.

## Remove

Windows: `powershell -ExecutionPolicy Bypass -File ops\windows\uninstall.ps1` removes the shortcuts and the firewall
rule and stops the server. Linux: `sh ops/linux/install.sh --uninstall`. Both keep the sales data; delete the data
folder yourself only when the records are no longer needed.

## When something is wrong

| What you see | What to do |
|---|---|
| "Port 3000 is used by another program" | Close that program, or install with `-Port 3100` |
| Till window says "CactusPOS did not start" | Try again; then restart the computer; then look at the log |
| Tablet cannot open the address | Same WiFi? Laptop on and signed in? Run the installer again and answer **Yes** to the firewall question. Guest WiFi often blocks devices from seeing each other: use the normal network |
| Address stopped working after a few days | The laptop got another IP address: reserve it in the router (see above) |
| Two till windows | Close one. A double-click within four seconds opens only one; later clicks open another |
