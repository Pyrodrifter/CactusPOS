# Practice, cart recovery and opening checks (REL06)

Contract-first change. The owner authorized source commits/push on October 30; the Windows release build remains deferred.

- `GET /api/health` and login replies add optional `instanceId` and `mode: live|practice`. The instance ID is
  persisted once per database and scopes device draft storage. A practice database has a different ID.
- Signed-in `POST /api/practice/start` initializes a separate practice SQLite database from configuration
  only (business, menu, tax, hashed staff PINs, receipt designs); no sales, counters, sessions, printer,
  backup destinations or bookkeeping settings are copied. It returns `PracticeLaunch`: a separate session
  and `/practice/pos`. A new launch creates a session for the same active staff member, never needs a PIN
  copied to the browser. Practice setup is copied on first use, not silently overwritten on each visit.
- Practice HTTP uses `/api/practice/*`, WS `/practice/ws`, and browser routes `/practice/*`. It uses the same
  contracts but a separate DB/service/hub/session namespace. Physical printer/drawer access, external backup
  destinations and bookkeeping posting/settings are disabled server-side. HTML receipts/reports are stamped
  PRACTICE / OEFENEN. No practice order can consume a live receipt number or appear on live boards/reports.
- Signed-in `GET /api/request-status/:id?kind=create|add` returns `RequestStatus` (current order or null).
  This is read-only. A missing result does not authorize a new request identity: an interrupted send stays
  frozen until explicitly retried with its original ID/body or discarded after checking Orders.
- Owner-only `GET /api/admin/readiness` returns `ServiceReadiness` with server, kitchen connections, printer
  TCP reachability/configuration, backup age/copy, business/CRIB, used tax-category verification and example
  PIN checks. TCP reachability never means paper/cutter/drawer were tested. No probe prints a receipt.
- WS clients may add `screen=pos|kitchen|pickup|admin|menu-board` for connection counts. This is diagnostic
  metadata, not authorization. All previous auth/role checks remain.

Draft storage is local to a device/origin, staff, database instance and mode. It stores cart snapshots,
notes, tab target, original create/add request identity/body and an interrupted-payment order ID. It never
automatically submits an order or payment. Recovery first reads server state; already paid means do not
charge again. A cashier must verify any separate card terminal result before completing an unconfirmed pay.
Explicitly clearing a draft removes only unsent device state, never a server sale.

Practice/live transitions are explicit. All screen links keep their mode. Android must persist the mode on
reopen; older APKs without this capability are prevented from entering practice. Leaving practice asks for
confirmation that subsequent orders are real. Live and practice server records remain append-only.
