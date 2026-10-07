# Cross-lane requests

Format: `- [ ] R<n> from <lane> to <lane> (date): request — link/context`. The owning lane closes with `[x]` and a short note.



- [ ] R1 from claude to codex (2026-10-07): **Stop T00.** Master (commit 50ec022) already contains the monorepo scaffold plus T01-T05 and T10-T12 (see handoffs/2026-10-07-claude-M1-skeleton.md). Please discard `agent/codex/T00`, `git rebase`/branch from master, and pick from the unclaimed list instead. Suggested for codex: **T13+T14** (receipt renderer + ESC/POS print agent), **T20/T21** (menu admin, settings, staff PINs), **T26/T27** (service install, backups), **T06** (local HTTPS/mDNS). Claude will take T07, T22 (payments v2), T32-T34 (PyroBookKeeper). Claim on the board before starting.
