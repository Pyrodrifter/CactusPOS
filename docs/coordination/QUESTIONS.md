# Questions for Allan (humans only — agents add, Allan answers)

Format: `- [ ] Qn (lane, date) question — default if unanswered`

- [ ] Q1 (shared, 2026-10-07) How should Cactus Blue's prepared food/drinks be taxed under ABB — service 6%, producent goods 8%, or mixed with exempt items? Is she registered for ABB and what is her CRIB number? — **Default:** two configurable categories, "Prepared food" and "Drinks" both 6%, flagged "UNVERIFIED" in admin until the accountant/BCN confirms.
- [ ] Q2 (print) Which receipt printer model (and connection: USB/Ethernet/Bluetooth) and cash drawer will be used? — Default: 80mm Epson-compatible ESC/POS over Ethernet.
- [ ] Q3 (payments) Which card terminal/provider does she use today? Does it need integration, or is manual entry enough for v1? — Default: manual entry.
- [x] Q4 (ops) ANSWERED 2026-10-07: router is available; laptop hotspot is acceptable as fallback. Plan: router-first, hotspot documented. (orig:) Truck network: own router with SIM/Starlink, phone hotspot, or fixed WiFi? Will the laptop have a fixed IP? — Default: dedicated travel router, laptop at a reserved IP.
- [x] Q5 (menu) ANSWERED 2026-10-07: Allan sent https://www.cactusblue.us/ ; the 2025-2026 menu board is loaded as seed/cactus-blue.json. Current Mac POS name still unknown. (orig:) Can we get her current menu (items, prices, modifiers, categories) and her current Mac POS name? — Default: sample menu.
- [x] Q6 (staff) ANSWERED: only Allan's mom and sister use it; simple login (PIN) is enough, no complex roles needed. (orig:) How many staff/devices at once, and do they need separate logins and tip tracking? — Default: PIN per staff, tips tracked per shift.
- [x] Q7 (languages) ANSWERED: English + Dutch now; design i18n so Papiamento/Spanish can be added later. (orig:) Languages for UI/receipts: English, Dutch, Papiamento, Spanish? — Default: EN + NL.
- [ ] Q8 (data) Import history from the current POS (sales, customers)? — Default: no.
- [ ] Q9 (branding) Logo, colors, fonts for the app and receipts? — Default: cactus-blue placeholder palette.
- [x] Q10 (surprise) ANSWERED: parallel run with the old Mac system for a while to test the waters. Go-live date TBD. (orig:) Who sets this up at the truck, and when is the target go-live? Parallel-run with the old POS first? — Default: 2 weeks of parallel run.
- [x] Q11 (server/books, 2026-10-10) ANSWERED 2026-10-10: yes, the day the money moved. (orig:) When a tab is opened on one day and paid on a later day, which day's sales and cash does it belong to? Same for a refund given on a later day than the sale. Today both are counted on the day the order was opened, so the money is in the drawer on a day whose report does not show it (audit finding 1, task A01). — **Default:** the day the money moved: a sale on the day it is paid, a refund on the day it is handed back.

## Ask the sister (Allan to collect)
Q1 tax/CRIB number + how her accountant classifies food and drinks; Q2 printer + cash drawer; Q3 card terminal provider; Q5 current menu with prices and modifiers; Q8 whether to import old sales; Q9 logo/colors. Everything else has a default.

## Added 2026-10-07 (from the menu board)
- [ ] Q1b (shared) Chips (Lays/Doritos/Cheetos) and bottled drinks are resold as bought. Under ABB, reselling imported goods can be outside scope rather than taxed. How does her accountant treat them? — Default: same 6% category as food, flagged unverified.
- [ ] Q5b (menu) The website mentions a Lion Fish wrap and the "Flamingo Droppings" dessert, but they are not on the menu board. Are they sold, and at what price? What is a typical Lion Fish Burger price? — Default: not on the POS; Lion Fish Burger asks for the price each time.
- [ ] Q5c (menu) Please check the transcribed prices: Cactus Double $19.75, Kiteburger $16, Classic Cheese $14, Spicy $15, Dutchie $14, Chicken Sandwich $16, Beef Wrap $16, Chicken Wrap $17, Veg Wrap $15, Cheese Wrap $13, chips $2, soft drinks $2.75, water $4, juice $4, extras $1, salad +$3, beef patty +$5.
