# Local HTTPS and phone testing

Use the truck's router and reserve the laptop's IPv4 address in DHCP. Connect the
laptop and phones to the same network. A laptop hotspot is a fallback; use its
interface address and regenerate the leaf certificate when the address changes.
Guest WiFi/client isolation and VPN adapters can prevent devices reaching each
other.

This is a development launcher. The production service/install flow is T26.

## One-time tools

Install Node 22.13+ or 24+, then run `npm ci` in the repo. Install the standard
[Caddy release](https://github.com/caddyserver/caddy/releases) and
[mkcert release](https://github.com/FiloSottile/mkcert/releases), or use the
installation methods in their official documentation. Put the executables on
PATH. Portable executables also work via `CACTUS_CADDY_BIN` and
`CACTUS_MKCERT_BIN`, which accept executable paths, not shell commands.

The scripts do not install tools, change firewall rules, install certificate
trust, or create services. Caddy uses the supplied local certificate, forwards
WebSocket upgrades, and requires no public certificate service or internet once
the tools are installed. See [Caddy TLS](https://caddyserver.com/docs/caddyfile/directives/tls)
and [reverse proxy](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy).

## Select the LAN and generate the certificate

Find the IPv4 address of the interface connected to the phone's router. On
Windows, run `Get-NetIPConfiguration`; on Linux, run `ip -4 address`. Ignore
loopback and disconnected/VPN adapters. The example below uses a made-up address;
replace it with the laptop's actual address.

PowerShell, from the repository root:

```powershell
$env:CACTUS_LAN_IP = '192.168.1.20'
npm run lan:setup
```

Linux/macOS:

```sh
export CACTUS_LAN_IP=192.168.1.20
npm run lan:setup
```

Setup creates `.local/lan/cert.pem`, `key.pem`, and a small settings record. This
directory is ignored by Git. The leaf covers `cactus.local`, the selected IP,
localhost and loopback. Keep the same environment settings when starting the
launcher. Rerun setup after changing the hostname or LAN IP, or when the leaf
expires. Setup does not install trust automatically.

## Trust this laptop's local CA once per device

On the laptop, explicitly run `mkcert -install` if you want its browser to trust
the local CA. Then run `mkcert -CAROOT` to locate the CA files used for generation.
If you used a custom `CAROOT`, keep that value for both commands.

Transfer **only `rootCA.pem`** to each test phone, using a local file transfer or
USB. Never transfer `rootCA-key.pem` or the server's `key.pem`. The CA certificate
is the trust anchor; the leaf certificate is not what the phone should install.
These steps follow [mkcert's mobile guidance](https://github.com/FiloSottile/mkcert#mobile-devices).

- **iPhone/iPad:** open `rootCA.pem`, install the downloaded profile in Settings,
  then enable it under General → About → Certificate Trust Settings. Reopen Safari.
  [Apple's current trust instructions](https://support.apple.com/en-us/102390).
- **Android:** install `rootCA.pem` as a CA certificate under the device's security
  credentials settings, then reopen the browser. Menu names and browser support
  vary; verify the browser used by the till. This guide targets browser screens,
  not native Android apps, which have separate user-CA policies.
  [Google's certificate installation guide](https://support.google.com/pixelphone/answer/2844832?hl=en).

Replacing the local CA requires installing the new public root certificate on
the devices again. Renewing a leaf with the same CA does not require a new root.

## Start and test

Stop other CactusPOS/dev copies first, then in the configured terminal:

```sh
npm run dev:lan
```

The launcher checks the certificate/key and all required ports, validates Caddy,
then starts the API, Vite, HTTPS proxy and an mDNS responder on the selected
interface. It enables strict API port 3000 and strict Vite port 5173 so an occupied
port cannot silently connect the phone to another copy. Only the selected
`.local` hostname is added to Vite's allowed hosts. Ctrl+C stops the process trees.

On the phone, open **https://cactus.local/pos**. If the network/browser does not
resolve mDNS, open **https://192.168.1.20/pos** with the actual selected address.
Both names are included in the leaf certificate. The IP URL is a supported
fallback, not a different server. A second laptop advertising the same hostname
causes the responder to fail; choose a unique `CACTUS_HOSTNAME` and regenerate.

Check each item on the real device:

1. The browser opens the page without a certificate warning.
2. Sample PIN 1111 signs in on a sample database.
3. A sample order sent from the phone appears on a second kitchen screen.
4. Marking it ready updates the pickup screen without refreshing.
5. Stopping the launcher closes its ports; starting it again reconnects screens.

Use sample data for this drill. For an isolated development run, set `CACTUS_DB`
to an absolute path for a disposable database before starting; `:memory:` is also
supported and resets when the server exits.

## Options and troubleshooting

| Variable | Default | Purpose |
|---|---|---|
| `CACTUS_LAN_IP` | Required | IPv4 assigned to the laptop's chosen LAN interface |
| `CACTUS_HOSTNAME` | `cactus.local` | One lowercase hostname label ending in `.local` |
| `CACTUS_HTTPS_PORT` | `443` | HTTPS listener port |
| `CACTUS_MKCERT_BIN` | `mkcert` | Optional portable executable path |
| `CACTUS_CADDY_BIN` | `caddy` | Optional portable executable path |

For unprivileged Linux development, use `CACTUS_HTTPS_PORT=8443` and append
`:8443` to both URLs. Port 443 permission/service setup belongs to the install
guide; do not run the entire development toolchain as root just for that port.

If the phone cannot connect, check same WiFi, client isolation, the selected IP,
and the laptop's firewall. A local firewall must admit TCP 443 (or the selected
HTTPS port) and UDP 5353 on the private truck network. Apply rules using the OS
firewall UI/admin workflow; the launcher never changes them. Do not forward these
ports on the router to the public internet.

If only the hostname fails, use the IP URL and check whether the router or OS
blocks multicast. If HTTPS warns, verify the root certificate was trusted and
the address is covered by the current leaf. Do not bypass warnings to complete
the device acceptance check. If a port is busy, stop the other copy. Any Caddy,
API, Vite or mDNS process failure stops its siblings and reports an error.
