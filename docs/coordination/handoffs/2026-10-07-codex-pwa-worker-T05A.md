# Handoff: T05A — production PWA worker and install assets
- Agent: codex (worker subtask)   Date: 2026-10-07   Branch: agent/codex/T05A

## What changed
- `packages/web/src/lib/pwa-build.ts` adds a dependency-free, build-only Vite plugin; `vite.config.ts` includes it and preserves existing API/WS proxy settings.
- The plugin emits `/sw.js` with a deterministic content-derived cache version and exact inventory of generated HTML/chunks/CSS plus manifest/icons. Development builds have no worker plugin. Deployment base must be `/`.
- `packages/web/src/lib/pwa-worker.ts` precaches the public shell/static assets with credentials omitted. Navigations try the network and fall back to that shell on connectivity errors or 5xx; online pages and query data are never saved.
- API and WS paths (including address-bar navigations), all non-GET, cross-origin, Authorization, and Range requests bypass the worker. There are no runtime response writes, transaction queues, background sync handlers, or write replay.
- The worker waits normally until old clients close; `{type: 'ACTIVATE_UPDATE'}` is the sole explicit activation message. It never reloads a client. Older app caches/chunks remain available while any windows are open; cleanup touches only `cactuspos-app-` caches when activation finds zero windows.
- `packages/web/public/manifest.webmanifest` declares neutral CactusPOS name, standalone mode, `/pos` start URL, `/` scope, 192/512 any and maskable PNGs; the public icon folder also contains a 180px Apple PNG. Original geometric cactus mark was drawn using Windows System.Drawing; no dependencies or external artwork.

## Contracts touched
No package-boundary contracts. Browser-local update message: `{type: 'ACTIVATE_UPDATE'}` invokes `skipWaiting()`; activation claims clients so registration clients can observe `controllerchange`. Worker path `/sw.js`, manifest `/manifest.webmanifest`, Apple icon `/icons/apple-touch-icon.png`.

## How to verify
- `npm run typecheck`: all six workspaces passed.
- `npm test`: 7 files, 99 tests passed at verification time, including 24 worker/build tests.
- `npx eslint packages/web/vite.config.ts packages/web/src/lib/pwa-worker.ts packages/web/src/lib/pwa-worker.test.ts packages/web/src/lib/pwa-build.ts`: passed.
- `npm run build`: passed; production output included `/sw.js` and the generated static inventory. PNG IHDR dimensions matched every manifest size and Apple 180x180; maskable icon was visually inspected with all foreground inside the mask safe area.
- `pwa-worker.test.ts` executes transformed worker code in a VM with CacheStorage/event mocks. It tests offline deep links, 503 shell fallback, preserving online/403 pages, network-only bypasses, exact precaching, explicit activation, old chunk availability, unrelated cache isolation, and safe cleanup. A temporary Vite project verifies emitted worker installation includes lazy chunks and all icons, repeat builds keep the same version, and manifest changes alter it.

## Gotchas / decisions
- Parent owns registration/UI/router/index.html/main.tsx and browser verification; this subtask does not edit them, the board, package manifests, or lockfile, and makes no commit.
- Old caches are deliberately retained conservatively whenever any windows exist. This avoids breaking old running bundles in other tills after one tab approves an update; cleanup happens on a subsequent activation with no windows.
- Static resources are never added at runtime. Only exact current inventory entries or exact matching entries in an older app-owned cache can be served; unknown `/assets/` paths go to the network without being saved.
- First successful production visit needs the local server available to complete installation. Serving production over LAN requires HTTPS/browser trust; localhost is also a secure context.
- Primary documentation consulted: [Vite plugin API](https://vite.dev/guide/api-plugin.html), [MDN skipWaiting](https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerGlobalScope/skipWaiting), [MDN manifest icons](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Manifest/Reference/icons).

## Follow-ups
Parent to complete browser install/offline/update checks, finish its aggregate handoff, and move T05A to review after full checks. No additional BOARD rows or REQUESTS created for this subtask.
