# Touch UI spec (v1, UX07)

This is a till used with fingers, often in a hurry, sometimes with wet or greasy hands, on a tablet in a food truck. Every screen follows these rules so the app feels like one thing.

## Sizes (CSS variables in `packages/web/src/ui/styles.css`)
| Token | Value | Use for |
|---|---|---|
| `--tap` | 56px | The minimum height **and** width of anything tappable. Nothing interactive is smaller, on any screen size. |
| `--tap-lg` | 64px | The working controls of a screen: category tabs, list-row actions, Save, Add, steppers in the cart, filters. |
| `--tap-xl` | 76px | The one main action of a screen or sheet (Pay, Confirm payment, Start / Ready on a ticket, Add to order) and keypad keys. |
| `--rail` | 112px | Width of the navigation rail on wide screens. |

- At least **10px** between neighbouring tap targets; 12px where a wrong tap costs something (Void next to Pay).
- Text: body 17px. Button labels 17px or more; the main action 19-20px. Nothing a person must read to choose is under 15px. Prices and totals use tabular numbers.
- Icons inside buttons 24px; navigation icons 28-30px.
- Inputs and selects are at least `--tap` tall with 17px text (16px or more also stops iOS zooming the page).

## Behaviour
- **Whole card, whole row.** Where a card or row has one obvious action (add this item, edit this row, advance this ticket), the entire card is the button. Small buttons inside are for secondary actions only.
- **One main action per screen or sheet**, full width or clearly the largest, at the bottom where a thumb is. Destructive actions (Void, Delete, Clear) are never next to it without a gap and never look like it.
- **No hover.** Everything shows a pressed state (`:active`), and nothing appears only on hover.
- **Feedback for every tap**: a pressed state immediately, and a toast or visible change when something was saved or sent. Buttons are disabled while their request is in flight.
- **Few rows of chrome.** Count the rows above the content a person came for. On a landscape tablet the menu grid should start within about 150px of the top.
- **Scrolling**: one scroll area per screen where possible; horizontal scrollers (category tabs) must not let their children shrink (`flex: none`) and should show that more exists.
- Sheets: on phones they rise from the bottom edge; the main action stays visible without scrolling at 390x844 and 1024x700.
- Respect `prefers-reduced-motion`; keep animations under 250ms.

## Navigation (done in the shell; screens do not add their own top-level navigation)
- **901px and wider** (landscape tablets, desktops): a rail of large buttons on the left edge (`.topbar` restyled), with language and sign-out at the bottom. There is no top bar, so screens get the full height.
- **900px and narrower** (phones, portrait tablets): a slim header and a tab bar fixed to the bottom, 72px buttons. `main` already reserves the space (`--navh`).
- The "Install app" offer only shows on the sign-in screen and in Admin.

## Sizes to check
1180x820 (landscape tablet), 1024x700 (small landscape tablet in a browser), 820x1180 (portrait tablet), 390x844 (phone).

## Checking your work: `scripts/shot.mjs`
Takes real screenshots with the Edge or Chrome on this computer (headless, throwaway profile, no dependencies).

```bash
node scripts/shot.mjs --base http://localhost:3081 --out shots --pin 1234 --size 1180x820 pos kitchen admin
```

For flows, write a scenario module and pass `--scenario file.mjs`:

```js
export default async (page) => {
  await page.size(1180, 820);
  await page.login('1234');            // seed PINs: owner 1234, staff 1111
  await page.goto('/pos');
  await page.click({ text: 'Classic Cheese Burger' });
  await page.shot('option-sheet');
  console.log(await page.measure());   // { overflowX: [...], small: [...] } -> both must be empty
};
```

`page.measure()` lists visible controls smaller than 48px and anything overflowing sideways. Aim for `--tap`; 48px is the hard floor the tool enforces. Look at the PNGs: measurements do not catch overlap, clipping or ugliness.
In Git Bash write paths without the leading slash (`pos`, not `/pos`).
