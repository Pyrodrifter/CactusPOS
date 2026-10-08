# ADR-0002: Bookkeeping export is CSV first; PyroBookKeeper is an optional link that appends its own journal file

Status: accepted (2026-10-08, Claude; closes spike T32)

## Context
The owner does not expect Cactus Blue to keep its books in PyroBookKeeper, but wants the option for other Bonaire businesses. PyroBookKeeper stores its books as append-only JSONL journals, one file per device in `<data folder>/journal/`, merged deterministically on load. Its design rule is that each device appends only to its own file.

## Options considered
1. **Import file the user loads inside PyroBookKeeper.** Needs an importer on the PyroBookKeeper side that does not exist for journal entries.
2. **Append to the desktop's journal file.** Breaks PyroBookKeeper's one-writer-per-file rule and risks its sequence numbers.
3. **Act as another device: write our own `<deviceId>.jsonl`.** Uses PyroBookKeeper exactly as designed; no change to PyroBookKeeper; works through whatever folder sync the user already has.
4. **CSV only.**

## Decision
- CSV (daily summary + journal lines) is the universal export and the default.
- The PyroBookKeeper link uses option 3, posting one summarised `journal.posted` entry per closed day, on demand.
- State is derived from the journal file itself, not from a POS table, so the file is the single truth and re-running is safe.

## Evidence
A script posted a day, re-closed and re-posted it, then read the folder with PyroBookKeeper's own `decodeJournal`, `mergeJournals`, `replay`, `accountBalances`, `trialBalance` and `profitAndLoss`: 0 corrupt lines, 0 anomalies, 0 sequence gaps, exactly one journal entry left for the day, balances summing to zero and matching the sales (cash 1950, bank 1500, ABB 184, tips 200, revenue 3066 cents), an existing desktop journal in the same folder untouched.

## Consequences
+ No PyroBookKeeper change needed; nothing in its files is modified.
- Postings are ledger entries, not invoices, so they are absent from PyroBookKeeper's ABB return (see contracts/books.md). Making POS sales count there would need PyroBookKeeper to support a "counter sales" document; out of scope.
- The format is coupled to PyroBookKeeper schema version 1.
