# Handoff: T54 — UI polish and touch optimisation
- Agent: claude   Date: 2026-10-07   Branch: agent/claude/ui-polish   (requested directly by Allan)

## What changed (web only; no API or contract changes)
- `ui/styles.css` rewritten as a small design system: tokens, 48px+ targets, press feedback instead of hover, tabular numbers, safe-area insets, `100dvh`, no pull-to-refresh, reduced-motion support.
- `ui/touch.tsx` (new): `Sheet` (dialog on tablets, bottom sheet on phones), `MoneyPad` (type cents like a card terminal), `Stepper`, `toast()`/`Toasts`, inline SVG `Icon`s, `haptic()`.
- POS: colour-coded categories and item cards with an in-cart count badge; cart with steppers and one big "Pay $x" button; on phones/portrait tablets the cart becomes a bottom bar + full-screen panel; option sheet has quantity and a running price; market price uses the keypad.
- Payment: cash keypad for any amount, quick notes, live change / shortfall, and a "Paid" screen that shows the change due until the cashier taps Next order (before, the sheet closed and the change was gone). Card: reminder to take payment on the terminal first.
- "Sent to kitchen: order #n" toast after Send.
- Phones: main navigation is a bottom tab bar.
- Login: PIN dots, round keypad, shake on wrong PIN, keyboard support, shows the lockout message.
- Kitchen: coloured column headers, ticket age colour (5 / 10 min), new-ticket flash, "No ..." options in red, buttons disabled while a tap is in flight.
- Pickup board: business name, clock, pop/glow on new ready numbers.

## How to verify
`npm run check` (75 tests, lint, build). Looked at in a browser at 1280x720: login, POS, option sheet, cash payment through to the Paid screen, kitchen, pickup.
At 375x812: measured rather than eyeballed (the screenshot tool garbles 2x captures) — no horizontal overflow, no button/link under 44px, sheet full-width from the bottom, tab bar and cart bar at the bottom.

## Gotchas
- Not tried on a real phone or tablet yet.
- `main.tsx` nav markup changed (icons + labels) and `<Toasts />` is mounted in `App`; Codex's T05A PWA work touches the same file — merge with care.
- A dark brand colour is swapped for bright blue on dark screens (kitchen) so buttons stay visible.
- Admin screens inherit the new styles but were not redesigned.
