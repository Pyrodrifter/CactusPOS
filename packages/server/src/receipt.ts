import type { Business, Order, DocumentDesign } from '@cactus/shared';
import { buildReceipt, renderHtml } from '@cactus/receipt';

/** Browser-printable receipt: the fallback when no receipt printer is set up. */
export function renderReceiptHtml(o: Order, b: Business, copy = false, design?: DocumentDesign): string {
  return renderHtml(buildReceipt(o, o.printBusiness ?? b, { copy, design }), { title: `Receipt ${o.receiptNumber ?? ''}`, widthMm: design?.widthMm });
}
