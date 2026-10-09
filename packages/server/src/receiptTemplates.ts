import { DEFAULT_RECEIPT_TEMPLATE, ReceiptTemplate, type TemplateVersion, type TemplateState, type Business, type Order } from '@cactus/shared';
import { buildKitchenTicket, buildReceipt, renderHtml } from '@cactus/receipt';
import { tx, type DB } from './db.js';

export class ReceiptTemplates {
  constructor(private db: DB) {}
  version(): number { return (this.db.prepare('SELECT coalesce(max(version), 0) AS version FROM receipt_templates').get() as { version: number }).version; }
  get(version = this.version()): TemplateVersion {
    if (!version) return { version: 0, template: structuredClone(DEFAULT_RECEIPT_TEMPLATE), createdAt: '', createdBy: '' };
    const row = this.db.prepare('SELECT * FROM receipt_templates WHERE version=?').get(version) as { version: number; data: string; created_at: string; staff_id: string } | undefined;
    if (!row) throw Object.assign(new Error('Receipt design version not found'), { statusCode: 404 });
    return { version, template: ReceiptTemplate.parse(JSON.parse(row.data)), createdAt: row.created_at, createdBy: row.staff_id };
  }
  state(): TemplateState {
    const rows = this.db.prepare('SELECT version, created_at AS createdAt, staff_id AS createdBy FROM receipt_templates ORDER BY version DESC LIMIT 30').all() as unknown as TemplateState['history'];
    return { current: this.get(), history: [...rows, { version: 0, createdAt: '', createdBy: '' }] };
  }
  save(template: ReceiptTemplate, baseVersion: number, staffId: string): TemplateState {
    return tx(this.db, () => {
      const current = this.version();
      if (current !== baseVersion) throw Object.assign(new Error('Another screen saved a design. Reload the saved design before publishing.'), { statusCode: 409 });
      const version = current + 1, at = new Date().toISOString();
      this.db.prepare('INSERT INTO receipt_templates(version,data,created_at,staff_id) VALUES(?,?,?,?)').run(version, JSON.stringify(ReceiptTemplate.parse(template)), at, staffId);
      this.db.prepare('INSERT INTO audit_log(type,payload,staff_id,at) VALUES(?,?,?,?)').run('receipt-template.saved', JSON.stringify({ version, baseVersion }), staffId, at);
      return this.state();
    });
  }
}

/** Synthetic values only. Preview/test printing never consumes a ticket or receipt counter. */
export function sampleReceiptOrder(): Order {
  return {
    id: 'preview', ticketNumber: 42, receiptNumber: 123, status: 'sent', paid: true, source: 'pos',
    lines: [{ id: 'sample-line', itemId: 'sample', name: 'House burger', qty: 2, unitPriceCents: 1400, lineTotalCents: 2800, taxCategoryId: 'sample', station: 'kitchen', modifiers: [{ id: 'sample-mod', name: 'Extra cheese', priceDeltaCents: 0 }], note: 'No onions' },
      { id: 'sample-drink', itemId: 'sample-drink', name: 'Fresh juice', qty: 1, unitPriceCents: 400, lineTotalCents: 400, taxCategoryId: 'sample', station: 'bar', modifiers: [] }],
    payments: [{ id: 'sample-pay', method: 'cash', amountCents: 3200, tenderedCents: 4000, changeCents: 800, tipCents: 0, at: '2026-10-08T16:30:00.000Z' }],
    totalCents: 3200, taxCents: 0, breakdown: [], note: 'SAMPLE · Not a sale', createdBy: 'sample', createdAt: '2026-10-08T16:30:00.000Z', updatedAt: '2026-10-08T16:30:00.000Z',
  };
}
export function previewBlocks(template: ReceiptTemplate, kind: 'receipt' | 'kitchen', business: Business) {
  const order = sampleReceiptOrder();
  return [{ t: 'text' as const, text: 'SAMPLE / VOORBEELD', bold: true, align: 'center' as const }, ...(kind === 'receipt' ? buildReceipt(order, business, { design: template.receipt }) : buildKitchenTicket(order, business, { design: template.kitchen }))];
}
export function previewHtml(template: ReceiptTemplate, kind: 'receipt' | 'kitchen', business: Business): string {
  return renderHtml(previewBlocks(template, kind, business), { title: 'Sample receipt design', widthMm: template[kind].widthMm });
}
