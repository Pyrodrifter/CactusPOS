# ADR-0003: native Android LAN client, shared web application

Status: implemented for review (2026-10-29), owner requested Android APK connected to the Surface.

Use a small Java/platform WebView app under `ops/android`, without an additional UI framework or runtime
dependency. The existing web screens, auth, idempotency and server remain authoritative. The app adds
connection/screen selection, native keep-awake, local service discovery and native printing of the existing
HTML receipt when requested. Existing server-side receipt printing remains unchanged.

Publish a signed sideload APK; keep its signing key/password outside the repository and preserve it for
updates. No Play Store submission or native iOS distribution is part of this change. Compile/target SDK 36
uses the installed toolchain; before raising target SDK to 37, adopt Android's explicit LAN permission flow.

Installed server starts mDNS and an optional port-80 HTTP alias alongside the existing listener. Name/alias
failure must never interrupt checkout. HTTPS provisioning remains the separate installed HTTPS task T26c.

Owner requested no further commits/release installer builds while working on the app. Contract, code and
handoff are left in the working tree for review; building the requested Android APK is authorized.
