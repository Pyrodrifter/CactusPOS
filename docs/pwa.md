# Install the app and recover a connection

CactusPOS runs on the laptop in the truck. Internet access is not needed during service;
the phone or tablet must be able to reach that laptop over the local network.

## Install on a phone or tablet

1. Follow the [local HTTPS setup](../ops/lan.md). Open the trusted `https://cactus.local`
   address while connected to the truck's WiFi. Plain HTTP on a LAN address cannot provide
   the offline app shell.
2. The production app is built with `npm run build` and served by the CactusPOS server.
   The ordinary Vite development server does not install a service worker.
3. In Chrome/Edge, use **Install app** when it appears, or the browser's install menu.
   On iPhone/iPad, use Safari's Share menu, then **Add to Home Screen**.
4. Open the installed app once while the server is reachable so its interface can finish
   downloading. Installation and the browser's offline storage policy vary by device.

The install name is CactusPOS; the business name and colour still come from the server's
business settings. Each screen keeps its normal URL (`/pos`, `/kitchen`, `/pickup`, `/admin`).

## When the connection drops

The app interface can reopen from this device's cache, and a message says the truck server
cannot be reached. **Try connection** checks the laptop directly. A phone's lack of internet
does not by itself mean the POS is offline.

Orders, payments, staff sessions and other API responses are not cached by the service
worker. Staff must reconnect to send an order or confirm a payment. Writes are never saved
for automatic replay: a lost response can hide an already committed transaction, so safe
replay needs the server request-id contract tracked in coordination request R6.

Live screens reconnect automatically when the server returns. Orders and the menu refresh
on the new connection. An unsent cart is held only in the open screen; closing or reloading
that screen clears it.

## App updates

A new release downloads its app assets in the background. Open screens keep running.
**Reload when ready** asks staff to finish or send any unsent order before reloading.
Only the screen that accepts the update reloads automatically. Other open screens can
finish their work and reload later. Closing all app screens also lets the browser activate
a waiting release naturally.

## Acceptance drill

- Build and start the production app on localhost or trusted local HTTPS.
- Open each role screen online, then switch the browser offline and reload a deep link.
  The interface should load and report that the server is unreachable.
- Check browser Cache Storage: it should contain app HTML, scripts, styles and icons;
  no `/api` responses, orders, payment records, PINs or tokens.
- Restore the connection or restart the server. The connection message should clear and
  live order/menu updates should return without reloading an active cart.
- Serve a second build while a cart is open. The update prompt should appear without
  clearing it. Cancel the reload confirmation, then finish/send the order before accepting.
- Test installation on the target phones; desktop browser checks do not verify a physical
  phone's local certificate trust, WiFi, storage policy or home-screen installation.

Implementation follows the browser's [service worker lifecycle](https://web.dev/articles/service-worker-lifecycle)
and [registration API](https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerRegistration).
