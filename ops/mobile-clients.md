# Android, iPhone/iPad and cactus.local

The Surface is the till server. Phones and tablets connect over the same WiFi. Internet is not needed for
selling, kitchen updates or network receipt printing. `cactus.local` uses **mDNS/local discovery**, not public
DDNS; it is available on that local network while the Surface is on and CactusPOS is running.

## Working-tree status

REL05 implements this in the source and builds the Android APK. On October 30 the owner authorized committing
and pushing REL05/REL06 to GitHub. The Windows release build remains deferred. **The earlier 0.2.1 setup file does not
contain this new server feature.** Until the next Windows build, start the current source through the installed
launcher (`node ops/app/launch.mjs --server-only`, with an intentional data home), or use the existing server's
IP address in the APK. Development `npm run dev` retains its separate development database and does not
advertise the installed name. Do not launch a second copy against a till taking sales.

## Friendly address on the Surface

With the updated installed server:

- Taking orders: **http://cactus.local/pos**
- Kitchen: **http://cactus.local/kitchen**
- Pickup: **http://cactus.local/pickup**
- Owner settings: **http://cactus.local/admin**

The normal server keeps port 3000. A second local HTTP listener on port 80 makes the short address possible
without changing existing bookmarks or the Surface's saved sign-in. If port 80 is already used, use
`http://cactus.local:3000/pos`; if multicast is blocked, use the IP address shown under Start → CactusPOS →
**Connect a tablet or phone**, for example `http://192.168.1.20:3000/pos`.

The Windows installer/firewall script now includes UDP 5353 and the friendly HTTP port, restricted to the
local subnet. Existing installations need the updated setup/firewall step; no firewall changes were applied
on the development computer. Guest WiFi isolation/VPNs can prevent local connections. Reserve the Surface's
IP in the router for the IP fallback.

Each installation may use a different name. From its program folder:

```powershell
node ops/app/launch.mjs --stop
node ops/app/launch.mjs --configure --hostname another-shop.local
node ops/app/launch.mjs --server-only
```

`--lan-port 8080` changes the alias port; `--lan-port 0` disables just the additional HTTP listener;
`--no-lan` disables both discovery and alias. Configuration changes take effect on the next server start.
The connection window shows failures and IP fallbacks. Two servers on one WiFi must use different names.

This is **HTTP**, matching the existing installed POS. It does not install HTTPS certificates or bypass
certificate warnings. Secure-context browser features such as service-worker caching and browser wake lock
still need installed HTTPS (T26c). Keep the truck network private; do not forward the till to the internet.

## Install the Android APK

1. Copy `dist/android/CactusPOS-Android-0.2.0.apk` to the Android device and open it. If prompted, allow
   installation from the file app/browser used for this file. This is a signed sideload app, not a Play Store
   listing. Android 8.0/API 26 or newer and a current Android System WebView/Chrome provider are required.
2. Connect to the truck WiFi. Open **CactusPOS**.
3. Leave the address as `http://cactus.local`, or tap **Find a till on this WiFi**. Discovery uses the updated
   server's `_cactuspos._tcp` service. If neither works, enter the Surface's IP and port (also works with the
   existing 0.2.1 server).
4. Choose **Till / taking orders**, **Kitchen**, **Pickup board**, or **Admin**, then **Connect**. The app checks
   that the address is a CactusPOS server. Sign in with the ordinary staff/owner PIN where required.

The app remembers the server/screen, keeps the display awake while open, preserves web storage on that
origin and stays in its own window. The existing POS handles live reconnection and retry keys. It does not
take payments on its own or maintain a second sales database. The Surface and WiFi are still required.

Android 0.2.0 remembers **Practice mode** across reopening, reconnecting and choosing another screen on the
same server. Its native title says **PRACTICE** and the web screen has a yellow banner. Enter through
**Screen tools → Practice mode**; leave through **Return to live till** and confirm. Other practice devices
must use `/practice/pos`, `/practice/kitchen` or `/practice/pickup` and sign in separately. Practice requires
the REL06 server; the old Windows installer does not offer it. Android 0.1.0 is blocked from practice because
it cannot preserve the mode safely. Install 0.2.0 over it using the same signing key; it retains connection
settings and web storage. Choosing a different server deliberately starts at that server's live screen.

Use **Connection** to change settings after finishing the current sale. **Back to current screen** returns
without destroying the current WebView/draft. If a payment's result was interrupted, check Orders before
retrying. Errors do not trigger automatic resubmission.

Network receipt printing runs on the Surface as before. For a printer installed on Android, the explicit
Receipt action opens Android's print service with the receipt HTML. Available printers depend on the
device's installed print service; native paper/cutter/drawer behavior must be checked with the actual hardware.
The app's connection controls are English; the POS itself retains its English/Dutch screen setting.

## iPhone and iPad

Open the matching address in **Safari**, then Share → **Add to Home Screen**. Where offered, enable **Open as
Web App**. The icon opens the existing POS in an app-style window. Keep it on the same WiFi with the Surface
running. If `cactus.local` fails, use the IP fallback. On HTTP this does not provide service-worker offline
installation or automatic browser wake lock; configure the screen timeout on a dedicated kitchen device.

A native iOS client is possible, but an installable signed iOS binary needs Mac/Xcode and Apple signing and
distribution setup. No IPA or App Store/TestFlight app was built on this Windows computer. References:
[Apple Home Screen web apps](https://support.apple.com/guide/iphone/turn-a-website-into-an-app-iph42ab2f3a7/ios),
[Xcode system requirements](https://developer.apple.com/xcode/system-requirements).

## Build and test (developer)

```powershell
npm ci
npm run check
npm run lan:check
npm run android:build
```

Android needs JDK 17+ (tested with 21), Android SDK platform/build tools 36 and the included Gradle wrapper.
`ANDROID_HOME` can select the SDK. The build runs native URL/origin tests and release lint, creates a signed
APK and verifies its signature. `dist/android/BUILD-INFO.json` includes its source fingerprint and checksum.

The signing key/password live outside the repo in `%LOCALAPPDATA%\CactusPOSBuild\android` (override with
`CACTUS_ANDROID_SIGNING_HOME`). Back up that private folder securely: updates must use the same signing key.
Do not commit or distribute it with the APK. There is no extra Android runtime dependency; JUnit is test-only.
Target SDK is 36; before moving to 37, implement the explicit Android local-network permission/picker flow
described in [Android's local-network guidance](https://developer.android.com/privacy-and-security/local-network-permission).

`lan:check` uses disposable data and a unique temporary hostname, verifies the installed launcher, API/WS
forwarding, retry keys and actual multicast A/DNS-SD responses where a LAN interface is available. It never
changes the operator's configuration or sales. Release/installer smoke tests explicitly disable discovery.
Real Surface/tablet/WiFi/printer acceptance remains part of the Sunday drill.
