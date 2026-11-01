# Simple stock (UX22)

Owner request after the tryout: keep count of what was prepared for the day and of the general stock. Schemas:
`packages/shared/src/stock.ts`. Any signed-in staff may use it; the screen is the Stock view on the till.

- **Kinds:** `prepared` (made for today; counts only today's moves, so it starts at zero each business day),
  `processed` and `whole` (general stock; carry over).
- **Quantities** are whole numbers in the unit the owner names. They never go below zero (`409`).
- **Moves:** every count change is a row in append-only `stock_moves`; a count is the sum of its moves. Setting an
  exact count on the screen sends the difference.
- **Sold:** a prepared item may list menu items (`menuItemIds`). `sold` is read from today's non-void orders, one per
  item sold, so voids and corrections put themselves right. Sales never write stock, and nothing in the
  order -> kitchen -> pay -> print path depends on it. `left = qty - sold`, and can go below zero when more was sold
  than was counted as prepared. General stock does not count down by itself.
- **Removing** archives the item (`stock_items.archived_at`); its moves stay. Saving the same id brings it back.

| Route | Body | Reply |
|---|---|---|
| `GET /api/stock` | | `StockList { date, items: StockRow[] }` |
| `PUT /api/stock/items/:id` | `StockItem` | `StockList`, audited `stock.item_saved` |
| `DELETE /api/stock/items/:id` | | `StockList`, audited `stock.item_removed` |
| `POST /api/stock/items/:id/adjust` | `{ delta }` (non-zero integer) | `StockList` |

Each write broadcasts `stock.changed` (no payload) to staff screens. Practice mode has its own stock, which starts empty.
