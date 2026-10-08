# Handoff: UX05 — cactus logo and second UI pass
- Agent: claude   Date: 2026-10-08   Branch: agent/claude/ui-pass2   (requested directly by Allan; builds on Codex UX01-UX04)

## What changed (web only; no API or contract changes)
- **Logo**: `ui/Logo.tsx` (blue cactus, pink flower, yellow sun on navy), `public/icons/logo.svg` as favicon and manifest icon, and the five PNG home-screen icons redrawn from the same geometry by `scripts/make-icons.py` (Pillow; PNGs are committed, builds do not need Python). Replaces the generic leaf mark in the top bar, login and pickup board. Theme colour is now the navy `#0f1d4a`. `icons/logo.svg` added to the PWA precache list.
- **POS**: removed the decorative "On the menu / Choose something good" header so the items start higher; per-category colours are back (dot on the tab, coloured active tab, accent stripe and options badge on each card, coloured in-cart count); category tabs stay pinned while the items scroll; the pay button reads "Pay  $19.75".
- **Payment sheet**: "Cash received" and "Change" (or "Still due") sit side by side above the quick amounts; on tablets the keypad sits beside them, so the whole sheet fits at 720px height with no scrolling (before, the keypad's last row was hidden behind the footer and change was below it). Quick amounts drop the ".00".

## How to verify
`npm run check`. Looked at in a browser at 1280x720: login, POS, payment sheet ($50 on $19.75 shows $30.25 change, sheet 495px tall, no scroll), pickup board.
At 375x812 by measurement: no horizontal overflow, no button or link under 44px, payment sheet 754px tall with no internal scroll.

## Gotchas
- Not tried on a real phone or tablet.
- The logo is original artwork for CactusPOS, not Cactus Blue's own script logo; her logo can replace it per install later (Q9).
- `copy.menu`, `copy.choose` and `copy.paymentHint` in `Pos.tsx` are now unused strings (left in place to keep the diff small).
- Kitchen and admin screens were reviewed and left as Codex built them.
