import type { Business, Order } from '@cactus/shared';
import { buildReceipt, renderHtml } from '@cactus/receipt';

/** Browser-printable receipt: the fallback when no receipt printer is set up. */
export function renderReceiptHtml(o: Order, b: Business, copy = false): string {
  return renderHtml(buildReceipt(o, b, { copy }), { title: `Receipt ${o.receiptNumber ?? ''}` });
}
