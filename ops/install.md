# Installing CactusPOS

One computer runs CactusPOS (the laptop in the truck). It shows the till in its own window, like any installed
program. Every other screen (kitchen tablet, a phone for taking orders, a pickup board) is a browser on the same
WiFi pointed at that laptop. Nothing needs the internet once it is installed.

The person at the till has a manual of their own, with pictures, in English and Dutch: it is installed with the
program (Start menu → CactusPOS) and attached to every release as a PDF. This page is the technical companion.

## Windows 10 or 11

### A. Setup program (the easy way; no internet needed on the till computer)

1. Get `CactusPOS-Setup-<version>.exe` from <https://github.com/Pyrodrifter/CactusPOS/releases> (the repository is
   private: sign in to GitHub first), or carry it over on a USB stick.
2. Double-click it. Choose the language (English or Nederlands), **Next**, **Next**, and answer **Yes** when Windows
   asks for permission; **Finish**. The till opens.
   - The file is not signed, so Windows may first show "Windows protected your PC": **More info**, then
     **Run anyway**. A browser may want **Keep** before it saves the download. A file copied from a USB stick
     does not get these warnings.
   - The permission question is for the firewall rule. Without it the till works on the laptop, but tablets and
     phones cannot connect; running the setup again asks again.

The setup carries everything: the program, its libraries, the screens, its own Node.js and the manual. It installs
for the signed-in Windows user into `%LOCALAPPDATA%\Programs\CactusPOS`, needs no administrator rights apart
from the firewall question, and adds **CactusPOS** to *Settings → Apps* for removing it. It needs Windows 10
version 1809 or newer, 64-bit, and says so on anything older. When neither Edge nor Chrome is on the computer it
says that too; the till then opens in the default browser.

Running a newer setup over an older one is the update: it stops the running till, replaces the program and
leaves the data alone.

For an unattended install: `CactusPOS-Setup-<version>.exe /VERYSILENT /LANG=en`. A silent install does not ask
for the firewall rule and does not start the till.

### B. Ready-made folder (zip)

The same program as a folder, for whoever wants to choose where it lives.

1. Unzip `CactusPOS-<version>-win-x64.zip` somewhere it can stay, for example `C:\CactusPOS`.
2. Double-click **Install CactusPOS.bat**. If Windows warns about a file from the internet, choose **Run**; answer
   **Yes** to the firewall question.
3. The till opens. From now on use the **CactusPOS** icon on the Desktop.

The folder carries its own copy of Node.js in `runtime\node`; nothing else is installed on the computer.

### C. From the source code

Needs internet during installation, and Git signed in to GitHub (the repository is private).

```bat
git clone https://github.com/Pyrodrifter/CactusPOS.git C:\CactusPOS
cd C:\CactusPOS
"Install CactusPOS.bat"
```

The installer looks for Node.js 22.13+ or 24+. When it is missing it installs Node.js LTS with `winget`
(from the OpenJS Foundation, the publisher of Node.js), then downloads the program libraries and builds the
screens. To build the setup program and the zip yourself, see [Building a release](#building-a-release).

### What the installer sets up

| What | Where |
|---|---|
| Till icon | Desktop and Start menu → CactusPOS |
| Kitchen screen and pickup board on this computer | Start menu → CactusPOS |
| **Connect a tablet or phone**: a window with the addresses to type on the other device | Start menu → CactusPOS |
| **Restore a backup**: the newest one, or a file you choose | Start menu → CactusPOS |
| The manual, English and Dutch (PDF) | Start menu → CactusPOS, and `Manual\` in the program folder |
| Start when this Windows user signs in | Startup folder (till window opens by itself) |
| Firewall rule "CactusPOS" | incoming TCP on the till's port, from the local network only |
| Settings, sales database, backups, logs | `%LOCALAPPDATA%\CactusPOS` (paste that into the Explorer address bar) |

Options of **Install CactusPOS.bat** (routes B and C), for example from a terminal in the program folder:

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
2. On the laptop: Start menu → CactusPOS → **Connect a tablet or phone**. It shows the address to type, for
   example `http://192.168.1.20:3000/kitchen`. (From a terminal in the program folder:
   `runtime\node\node.exe ops\app\launch.mjs --status`.)
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
- **Back up:** CactusPOS does it by itself, see [Backups](#backups) below.
- **Update:** run the newer `CactusPOS-Setup-<version>.exe`. With the zip or a checkout: replace the program
  folder with the new version (or `git pull`), then run **Install CactusPOS.bat** again. Data and settings are
  outside the program folder and stay as they are.
- **Log:** `%LOCALAPPDATA%\CactusPOS\logs\server.log`.

## Backups

CactusPOS copies the whole sales record by itself: when it starts, when you close the day, and every half hour
while there is something new. Each copy is checked after it is written. They are in
`%LOCALAPPDATA%\CactusPOS\data\backups` (Linux: `~/.local/share/cactuspos/data/backups`), one file per backup,
named by date and time. The newest 30 are kept, and the last one of each day for 90 days.

**Set up a second copy.** A backup on the same laptop does not help when the laptop is stolen or dies. Under
**Admin → Backups**, name a folder on a USB stick, or a folder that OneDrive, Dropbox or Google Drive keeps in
sync. Every backup is then copied there too, and the page says so when the folder cannot be reached.

Do not make backups by copying `cactus.sqlite` yourself while CactusPOS runs: the newest sales are not in that
file yet. Use **Admin → Backups → Back up now** and take the file it makes.

**Put a backup back** (the laptop was replaced, or the data got damaged):

1. On a new computer, install CactusPOS first.
2. Start menu → CactusPOS → **Restore a backup**. Type `1` for the newest backup on this computer, or `2` to
   choose a file (a USB stick). The same without the Start menu: double-click **Restore CactusPOS backup.bat** in
   the program folder for the newest backup, or drag a backup file onto it.
3. It shows how many orders the backup holds and how many are on the computer now, and warns when the backup is
   older. Type `yes` to go ahead.
4. CactusPOS is stopped, the backup is put in place, and CactusPOS starts again. Reload the open screens.

The data that was replaced is not deleted. It is moved to a folder named `replaced-<date>-<time>` inside
`%LOCALAPPDATA%\CactusPOS\data`; restoring `cactus.sqlite` from that folder undoes the restore.
On Linux, or from a terminal: `node ops/app/launch.mjs --restore [file]`.

Restoring an older backup takes the till back to that moment: sales made after it are no longer in the till, and
their receipt numbers will be given out again. Keep the `replaced-...` folder; it is the record of those sales.

**Try it once before you need it:** make a backup, restore it, and check that today's orders are still there.

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
git clone https://github.com/Pyrodrifter/CactusPOS.git ~/cactuspos
cd ~/cactuspos
sh ops/linux/install.sh
```

Needs Node.js 22.13+ or 24+ and Chromium, Chrome or Edge. It builds the program, adds **CactusPOS** to the
application menu and starts it at login. Data: `~/.local/share/cactuspos`. Options: `sh ops/linux/install.sh --help`.
If a firewall is active, allow the port from the local network, for example
`sudo ufw allow from 192.168.1.0/24 to any port 3000 proto tcp`.

This installer has been checked for syntax only; it has not yet been run on a real Linux computer.

## Remove

Windows, installed with the setup program: *Settings → Apps → Installed apps → CactusPOS → Uninstall*. Installed
from the zip or a checkout: `powershell -ExecutionPolicy Bypass -File ops\windows\uninstall.ps1` removes the
shortcuts and the firewall rule and stops the server; then delete the program folder. Linux: `sh ops/linux/install.sh --uninstall`. Both keep the sales data; delete the data
folder yourself only when the records are no longer needed.

## Building a release

On Windows x64, with the Node.js version to ship (the package gets a copy of the `node.exe` that runs the build)
and [Inno Setup 6](https://jrsoftware.org/isinfo.php) (`winget install --id JRSoftware.InnoSetup -e`):

```bat
npm ci
npm run release:check
npm run package
```

That runs `scripts/make-setup.mjs` and leaves in `dist\redist`: `CactusPOS-Setup-<version>.exe`
(from `ops/windows/setup.iss`), `CactusPOS-<version>-win-x64.zip`, the manual in both languages as PDF, and
`SHA256SUMS.txt`. Build from a clean checkout of the release commit: `VERSION.txt` in the package records it.
The package build also runs a relocated copy with its bundled Node.js through the sales/restart/restore
drill before compiling the setup. Its result and the truck [deployment checklist](deployment.md) travel
beside the installer as `RELEASE-VERIFICATION.json` and `DEPLOYMENT-CHECKLIST.md`. After compiling, a silent
English install, Dutch update over a running copy and uninstall run in isolated folders; their result is
`INSTALLER-VERIFICATION.json`. They skip the real firewall/Apps registration and keep all fixture sales outside
the operator's data folder.

The manual is `docs/manual/manual.en.html` and `manual.nl.html`, printed to PDF by `scripts/make-manual.mjs` with
the Edge or Chrome on the build computer. Its pictures are in `docs/manual/img` and are retaken on purpose, not
with every build:

| Pictures of | Command | Needs |
|---|---|---|
| The screens of the till | `npm run build`, then `node scripts/make-manual.mjs --shots` | Nothing running on port 3061; it starts a throwaway till |
| The windows of the setup program | `powershell -ExecutionPolicy Bypass -File docs\manual\setup-shots.ps1 -Setup dist\redist\CactusPOS-Setup-<version>.exe -Lang en` (and `-Lang nl`) | A built setup. It installs a test copy, clicks through it and removes it again |

`setup-shots.ps1` is also the check of the setup program: with `-Finish click` it presses Finish as a person
would and verifies that the till comes up, and it always verifies the shortcuts, the uninstaller and that the
data folder survives removal. A test copy keeps away from the real till of this Windows user: its own folders
(`CACTUS_HOME`, `/DIR=`, `/SHORTCUTROOT=`), its own port (`/PORT=`), no firewall question, no entry under Apps.
What it cannot check is the Windows permission question itself.

The setup program is not code-signed. Until it is, Windows shows the "protected your PC" warning for a downloaded
copy.

## When something is wrong

| What you see | What to do |
|---|---|
| "Port 3000 is used by another program" | Close that program, or install with `-Port 3100` |
| Till window says "CactusPOS did not start" | Try again; then restart the computer; then look at the log |
| The setup stops with "could not be made" | The program was copied but `install.ps1` failed. The message names `install.log` in the program folder (`%LOCALAPPDATA%\Programs\CactusPOS`); the setup's own log is `Setup Log <date>.txt` in `%TEMP%` |
| Tablet cannot open the address | Same WiFi? Laptop on and signed in? Run the installer again and answer **Yes** to the firewall question. Guest WiFi often blocks devices from seeing each other: use the normal network |
| Address stopped working after a few days | The laptop got another IP address: reserve it in the router (see above) |
| Two till windows | Close one. A double-click within four seconds opens only one; later clicks open another |
| The till is empty after starting it another way | CactusPOS started by hand (`start.bat`, `npm start`) now opens the same data as the installed app. A database from an earlier hand-started run is copied over once; when both places already hold data the server names both files when it starts and uses the one in `%LOCALAPPDATA%\CactusPOS\data` |
| Kitchen screen shows "Reconnecting" for a moment now and then | It noticed a dead connection and made a new one; nothing was lost. If it stays that way, check the WiFi and that the laptop is on |
