#!/usr/bin/env sh
# Installs CactusPOS for the current Linux user: builds it, adds it to the application menu and starts it at login.
# Safe to run again after an update. Sales data lives in ~/.local/share/cactuspos and is never touched.
# See ops/install.md.
set -eu

ROOT=$(CDPATH='' cd -- "$(dirname -- "$0")/../.." && pwd)
LAUNCHER="$ROOT/ops/app/launch.mjs"
APPS="${XDG_DATA_HOME:-$HOME/.local/share}/applications"
AUTOSTART_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/autostart"
PORT=''
SEED=''
AUTOSTART=1
SERVER_ONLY=0
START=1
UNINSTALL=0

usage() {
  cat <<'EOF'
Usage: sh ops/linux/install.sh [options]
  --port N                 use another port (default 3000); tablets must then use the new address
  --seed NAME              menu for an EMPTY database: a file from seed/ without .json
  --server-only-at-login   at login start the server only; open the till from the application menu
  --no-autostart           do not start at login
  --no-start               do not start CactusPOS when the installer is done
  --uninstall              remove the menu entries and stop the server (sales data is kept)
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --port) [ $# -ge 2 ] || { echo '--port needs a number' >&2; exit 1; }; PORT=$2; shift 2 ;;
    --seed) [ $# -ge 2 ] || { echo '--seed needs a name' >&2; exit 1; }; SEED=$2; shift 2 ;;
    --server-only-at-login) SERVER_ONLY=1; shift ;;
    --no-autostart) AUTOSTART=0; shift ;;
    --no-start) START=0; shift ;;
    --uninstall) UNINSTALL=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option $1" >&2; usage >&2; exit 1 ;;
  esac
done

if ! command -v node >/dev/null 2>&1; then
  echo 'CactusPOS needs Node.js 22.13 or newer (24 recommended), and it is not installed.' >&2
  echo 'Install it with your package manager or from https://nodejs.org/en/download, then run this again.' >&2
  exit 1
fi
NODE=$(command -v node)

if [ "$UNINSTALL" -eq 1 ]; then
  "$NODE" "$LAUNCHER" --stop || true
  rm -f "$APPS/cactuspos.desktop" "$APPS/cactuspos-kitchen.desktop" "$AUTOSTART_DIR/cactuspos.desktop"
  echo 'CactusPOS menu entries are removed. Sales data and settings were kept in:'
  echo "  ${CACTUS_HOME:-${XDG_DATA_HOME:-$HOME/.local/share}/cactuspos}"
  exit 0
fi

if ! "$NODE" -e 'const [a, b] = process.versions.node.split(".").map(Number); process.exit((a === 22 && b >= 13) || a >= 24 ? 0 : 1)'; then
  echo "CactusPOS needs Node.js 22.13 or newer (24 recommended). This computer has $("$NODE" -v)." >&2
  exit 1
fi
command -v npm >/dev/null 2>&1 || { echo 'npm was not found. Install it together with Node.js.' >&2; exit 1; }

cd "$ROOT"
echo '== Getting the program libraries and building the screens (needs internet, takes a few minutes)'
"$NODE" "$LAUNCHER" --stop >/dev/null 2>&1 || true
npm ci
npm run build

echo '== Settings'
if [ -f "$ROOT/seed/cactus-blue.json" ]; then
  "$NODE" "$LAUNCHER" --configure --if-new --seed cactus-blue
else
  "$NODE" "$LAUNCHER" --configure --if-new
fi
if [ -n "$PORT" ] && [ -n "$SEED" ]; then "$NODE" "$LAUNCHER" --configure --port "$PORT" --seed "$SEED"
elif [ -n "$PORT" ]; then "$NODE" "$LAUNCHER" --configure --port "$PORT"
elif [ -n "$SEED" ]; then "$NODE" "$LAUNCHER" --configure --seed "$SEED"
fi

echo '== Menu entries'
# $1 file, $2 name, $3 extra launcher arguments
entry() {
  mkdir -p "$(dirname -- "$1")"
  cat > "$1" <<EOF
[Desktop Entry]
Type=Application
Name=$2
Comment=Point of sale
Exec="$NODE" "$LAUNCHER" --gui $3
Icon=$ROOT/ops/linux/cactuspos.png
Terminal=false
Categories=Office;Finance;
StartupNotify=false
EOF
  chmod +x "$1"
  echo "  $1"
}
entry "$APPS/cactuspos.desktop" 'CactusPOS' ''
entry "$APPS/cactuspos-kitchen.desktop" 'CactusPOS kitchen screen' '--screen kitchen'
if [ "$AUTOSTART" -eq 0 ]; then
  rm -f "$AUTOSTART_DIR/cactuspos.desktop"
elif [ "$SERVER_ONLY" -eq 1 ]; then
  entry "$AUTOSTART_DIR/cactuspos.desktop" 'CactusPOS' '--server-only'
else
  entry "$AUTOSTART_DIR/cactuspos.desktop" 'CactusPOS' ''
fi

if [ "$START" -eq 1 ]; then
  echo '== Starting CactusPOS'
  if [ -n "${DISPLAY:-}${WAYLAND_DISPLAY:-}" ]; then "$NODE" "$LAUNCHER" || true; else "$NODE" "$LAUNCHER" --server-only || true; fi
fi

echo '== Done'
"$NODE" "$LAUNCHER" --status
echo
echo 'A new database starts with the example PINs 1234 (owner) and 1111 (staff).'
echo 'Change them before real use: sign in as owner, Admin, Staff.'
echo 'If a firewall is active, allow the port from the local network (see ops/install.md).'
