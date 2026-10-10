# Backups and restore (v1)

Code: `packages/server/src/backup.ts` (making them), `ops/app/restore.mjs` and `launch.mjs --restore` (putting one back).
For people: `ops/install.md`, "Backups".

## What a backup is
One file, `cactus-YYYYMMDD-HHMMSS.sqlite` (UTC, so names sort by time): the whole database at that moment, written with
SQLite's `VACUUM INTO` while the till keeps running. Before it counts it is opened read-only, must pass
`PRAGMA integrity_check` and must hold as many orders as the live database. A copy that fails is removed and reported.

Copying `cactus.sqlite` by hand is **not** a backup while the server runs: recent sales are still in `cactus.sqlite-wal`.

## When and where
- When the server starts, after `POST /api/reports/day/close`, and every 30 minutes; each time only if something changed
  since the last good backup (order events, audit log, Z reports, receipt designs) or that file is gone.
- Folder: `backups/` beside the database, so `%LOCALAPPDATA%\CactusPOS\data\backups` on an installed Windows till.
- Optional second folder (a USB stick, a cloud-synced folder): every backup is copied there too. If it is missing the
  first copy still counts and the problem is shown in Admin.
- Kept: the newest 30, and the last one of each day for 90 days. Only files with our name pattern are ever removed.
- A failed backup never fails a sale or a day close.

## Routes (owner only)
| Route | Body | Returns |
|---|---|---|
| `GET /api/admin/backups` | | `BackupState` |
| `PUT /api/admin/backups/settings` | `{ folder }` (second folder; `""` = none; must exist and differ from the main one, else `400`) | `BackupState`. Written to the audit log (`backup.settings`) |
| `POST /api/admin/backups/run` | | `BackupState` after a backup made now. `409` for a database without a folder (in-memory, tests) |

```ts
BackupState = {
  enabled: boolean, folder: string, settings: { folder: string },
  files: { name: string, at: string, bytes: number }[],            // newest first, at most 30
  last: { name, at, orders, lastReceipt, copied: boolean } | null,   // copied = also in the second folder
  problem: string | null,                                            // why the latest attempt or second copy failed
}
```
`buildApp(db, { backupDir })` switches backups on; `main.ts` passes the folder and calls `backups.start()`.

## Restore
`node ops/app/launch.mjs --restore [file] [--yes]` (Windows: double-click `Restore CactusPOS backup.bat`, or drag a backup
file onto it).
1. Takes the file named, or the newest in the backup folder. Checks it: readable, intact, a CactusPOS database.
2. Shows what the backup holds and what is on the computer now, warns when the backup is older, and asks (`--yes` skips).
3. Stops the server if this launcher started it; refuses when another copy is running. Starts it again afterwards.
4. Moves the current `cactus.sqlite`, `-wal` and `-shm` to `data/replaced-<time>/`. **Nothing is deleted.**
5. Copies the backup into place. On the next start the server migrates it if it came from an older version.

Restoring an older backup rewinds the receipt counter with everything else: numbers issued after that backup are issued
again. The `replaced-<time>` folder is then the only record of those sales, which is one reason it is never deleted.

A new computer: install CactusPOS, copy a backup file onto it, restore that file. Covered by tests: a backup opened on
its own passes `verifyLedger()` and matches the original orders, payments, events and Z reports row for row.
