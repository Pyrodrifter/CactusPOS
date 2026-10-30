# Local clients and installed LAN name (REL05)

The Surface remains the only order/payment/receipt authority. Android is a browser client in a native
window, using the existing HTTP and WS schemas; it does not run another database or replay payments.

Installed launch settings add `lanEnabled` (true), `hostname` (`cactus.local`) and `lanPort` (80; 0 disables
the additional listener). The launcher passes `CACTUS_LAN_SETTINGS` JSON to the server, plus an absolute
`CACTUS_LAN_STATUS_FILE` path. Direct development/test server launches do not enable these listeners.
`CACTUS_DISABLE_LAN=1` disables them for isolated release/installer tests.

The HTTP alias forwards to the existing backend on loopback, including WS upgrades. It serves the same
routes at `http://cactus.local` without moving port 3000 or the existing localhost browser profile. If port
80 is busy the primary server keeps running; use `http://cactus.local:3000` or the IP fallback. No HTTPS or
certificate trust is implied. `cactus.local` is LAN mDNS, not public DDNS or an internet-accessible address.

On eligible IPv4 LAN interfaces the server probes for another owner before publishing A records and the
DNS-SD service `_cactuspos._tcp.local` (SRV target = configured hostname; port = alias or primary listener;
TXT `app=cactuspos`). Conflicting names are withdrawn, never silently pointed at another till. Interface
changes are checked periodically. Multicast filtering/client isolation may require the displayed IP URL.
Windows firewall setup admits the backend/alias TCP ports and UDP 5353, from the local subnet only.

The status file follows `LocalNetworkStatus` in shared: server PID, hostname, primary/alias ports,
advertised flag, addresses and human-readable problems. It is local launcher diagnostics, not an API route.
It must belong to the current server PID before the launcher shows the friendly address as available.

Android stores the chosen origin/screen on that device, verifies `/api/health` identifies CactusPOS before
loading, keeps web storage on that origin, keeps the screen awake and provides explicit reconnect/settings.
Only operator-selected HTTP(S) origins load inside its WebView. External navigation is blocked or opened
in the browser after a user gesture; file/content access and SSL-error bypass are disabled. HTTP is allowed
for the local truck network; installed local CAs may be trusted for HTTPS. No cloud is needed in operation.

One company per server/data home. Names and client URLs are configurable for other companies. Two tills on
one LAN must use different `.local` names. iOS can use the web app from Safari/Home Screen; a native signed
iOS binary requires a separate Mac/Xcode/signing/distribution workflow.
