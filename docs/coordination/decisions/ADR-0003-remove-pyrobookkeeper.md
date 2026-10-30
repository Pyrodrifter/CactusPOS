# ADR-0003: Remove the PyroBookKeeper link

Status: accepted (2026-10-30, Claude, at the owner's request). Supersedes the PyroBookKeeper part of ADR-0002.

## Context
ADR-0002 added an optional link that posted closed days into a PyroBookKeeper data folder. Several Bonaire businesses
besides Cactus Blue now want the till, none of them use PyroBookKeeper, and the owner (Allan) asked on 2026-10-30 to
remove PyroBookKeeper from CactusPOS entirely.

## Decision
- Remove the link: `packages/books-bridge/src/pbk.ts`, `POST /api/books/pbk/post`, the `pbkFolder` setting and the
  PyroBookKeeper section of Admin > Bookkeeping.
- Keep the CSV exports (daily sales and journal entries) and the day booking they are made from. They work for any
  accountant or accounting program.

## Consequences
+ One less file format to keep in step with another program; no writing outside the till's own data folder.
- A till that had a folder set keeps the old journal file it wrote; nothing removes it. The saved `pbkFolder` and
  `books.pbkDeviceId` values stay in the database unused (nothing is deleted); settings parsing drops `pbkFolder`.
- Bringing it back would need a new ADR.
