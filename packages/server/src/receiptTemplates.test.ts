import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_RECEIPT_TEMPLATE, ReceiptLogo, ReceiptTemplate, TemplateState, Order as OrderSchema, ServerEventSchema } from '@cactus/shared';
import { buildReceipt, buildKitchenTicket, renderEscPos, renderHtml, renderText } from '@cactus/receipt';
import { openDb, setKv } from './db.js';
import { seedSample } from './seedData.js';
import { PosService } from './service.js';
import { ReceiptTemplates, sampleReceiptOrder } from './receiptTemplates.js';
import { Printing } from './printing.js';
import { buildApp } from './app.js';
import { renderReceiptHtml } from './receipt.js';

let db: ReturnType<typeof openDb>, svc: PosService, templates: ReceiptTemplates;
const staff = { id: 'staff1', name: 'Sample staff', role: 'staff' as const };
const orderBody = { source: 'pos' as const, lines: [{ itemId: 'burger', qty: 1, modifierOptionIds: [] }] };
beforeEach(() => { db = openDb(':memory:'); seedSample(db); svc = new PosService(db); templates = new ReceiptTemplates(db); });
afterEach(() => db.close());

describe('calm and busy service', () => {
  it('skips both boards without dropping sales, and mode changes leave existing tickets alone', () => {
    const busy = svc.createOrder(orderBody, staff);
    svc.setServiceMode('counter', staff);
    const calm = svc.createOrder(orderBody, staff, 'calm-order-0001');
    expect(OrderSchema.parse(calm).serviceMode).toBe('counter');
    expect(svc.activeOrders().map((o) => o.id)).toEqual([busy.id]);
    expect(svc.pickupBoard().preparing).toEqual([busy.ticketNumber]);
    expect(svc.todaysOrders()).toHaveLength(2);
    const paid = svc.pay(calm.id, { method: 'cash', tipCents: 0 }, staff);
    expect(paid.receiptNumber).toBe(1); expect(paid.paid).toBe(true);
    svc.setServiceMode('board', staff);
    expect(svc.createOrder(orderBody, staff, 'calm-order-0001').serviceMode).toBe('counter');
    const next = svc.createOrder(orderBody, staff);
    expect(next.ticketNumber).toBe(3);
    expect(svc.pickupBoard().preparing).toEqual([busy.ticketNumber, next.ticketNumber]);
    expect(svc.verifyLedger()).toEqual([]);
  });
  it('calm tab additions stay off the board and automatic kitchen print is skipped', () => {
    svc.setServiceMode('counter', staff);
    const calm = svc.createOrder(orderBody, staff);
    svc.setServiceMode('board', staff);
    const updated = svc.addLines(calm.id, { lines: orderBody.lines }, staff);
    expect(updated.serviceMode).toBe('counter'); expect(svc.pickupBoard().preparing).toEqual([]);
    const printing = new Printing(db, () => svc.business(), () => null);
    printing.save({ enabled: true, host: 'sample', port: 9100, columns: 48, cutter: true, drawer: false, autoKitchen: true, autoReceipt: true });
    printing.onSent(calm); printing.onAdded(updated);
    expect(printing.queue.list()).toHaveLength(0);
    printing.onSent(svc.createOrder(orderBody, staff));
    expect(printing.queue.list()).toHaveLength(1);
    printing.queue.stop();
    expect(ServerEventSchema.parse({ type: 'service-mode.changed', mode: 'counter' })).toBeTruthy();
  });
});

describe('receipt template lifecycle', () => {
  it('publishes immutable versions, detects stale edits and retains original print content', () => {
    const one = structuredClone(DEFAULT_RECEIPT_TEMPLATE); one.receipt.footer = 'FIRST {{order}}';
    templates.save(one, 0, staff.id);
    const created = svc.createOrder(orderBody, staff);
    const paid = svc.pay(created.id, { method: 'cash', tipCents: 0 }, staff);
    const old = renderReceiptHtml(paid, svc.business(), true, templates.get(paid.templateVersion).template.receipt);
    const two = structuredClone(one); two.receipt.footer = 'SECOND'; templates.save(two, 1, staff.id);
    setKv(db, 'business', { ...svc.business(), name: 'Changed after sale' });
    expect(renderReceiptHtml(paid, svc.business(), true, templates.get(paid.templateVersion).template.receipt)).toBe(old);
    expect(old).toContain(`ORDER #${paid.ticketNumber}`); expect(old).toContain(`FIRST ${paid.ticketNumber}`);
    expect(() => templates.save(one, 1, staff.id)).toThrow(/Another screen/);
    expect(templates.state().current.version).toBe(2);
    const restored = templates.save(templates.get(1).template, 2, staff.id);
    expect(restored.current.version).toBe(3); expect(restored.current.template.receipt.footer).toBe('FIRST {{order}}');
    expect(() => db.exec('DELETE FROM receipt_templates')).toThrow(/append-only/);
    expect(() => db.exec("UPDATE receipt_templates SET data='{}'")).toThrow(/append-only/);
    expect(() => db.exec("INSERT OR REPLACE INTO receipt_templates VALUES(1,'{}','now','someone')")).toThrow(/append-only/);
  });
  it('validates raster lengths and rejects raw printer controls', () => {
    expect(ReceiptLogo.safeParse({ width: 16, height: 2, hex: 'ff' }).success).toBe(false);
    expect(ReceiptLogo.safeParse({ width: 256, height: 161, hex: 'ff' }).success).toBe(false);
    const template = structuredClone(DEFAULT_RECEIPT_TEMPLATE); template.receipt.footer = '\u001b@';
    expect(ReceiptTemplate.safeParse(template).success).toBe(false);
  });
  it('keeps identifiers and totals, escapes HTML and renders the same logo/text on thermal paper', () => {
    const template = structuredClone(DEFAULT_RECEIPT_TEMPLATE);
    template.receipt.logo = { width: 8, height: 2, hex: 'ff81' };
    template.receipt.subtitle = '<script>alert(1)</script>';
    template.receipt.messages = [{ text: 'Enjoy, {{business}} · {{order}}', bold: true, align: 'center' }];
    const order = sampleReceiptOrder(), business = svc.business();
    const blocks = buildReceipt(order, business, { design: template.receipt });
    for (const width of [32, 48] as const) {
      const text = renderText(blocks, width);
      expect(text).toContain('ORDER #42'); expect(text).toContain('Receipt #123'); expect(text).toContain('$32.00'); expect(text).toContain('[LOGO]');
      expect(text).toContain('Enjoy, Cactus Blue');
    }
    const html = renderHtml(blocks, { widthMm: 58 });
    expect(html).toContain('&lt;script&gt;'); expect(html).not.toContain('<script>'); expect(html).toContain('viewBox="0 0 8 2"');
    const bytes = Buffer.from(renderEscPos(blocks));
    expect(bytes.includes(Buffer.from([0x1d, 0x76, 0x30, 0, 1, 0, 2, 0, 0xff, 0x81]))).toBe(true);
    expect(bytes.toString()).toContain('ORDER #42');
    template.kitchen.showModifiers = false; template.kitchen.showNotes = false;
    const kitchen = renderText(buildKitchenTicket(order, business, { design: template.kitchen }));
    expect(kitchen).toContain('Extra cheese'); expect(kitchen).toContain('No onions'); expect(kitchen).not.toContain('$32.00');
  });
  it('protects owner endpoints and previews without consuming numbers', async () => {
    const { app } = buildApp(db);
    const owner = (await app.inject({ method: 'POST', url: '/api/login', payload: { pin: '1234' } })).json().token as string;
    const staffToken = (await app.inject({ method: 'POST', url: '/api/login', payload: { pin: '1111' } })).json().token as string;
    const headers = { 'x-token': owner };
    expect((await app.inject({ url: '/api/admin/receipt-templates', headers: { 'x-token': staffToken } })).statusCode).toBe(403);
    const result = await app.inject({ method: 'PUT', url: '/api/admin/receipt-templates', headers, payload: { baseVersion: 0, template: DEFAULT_RECEIPT_TEMPLATE } });
    expect(result.statusCode).toBe(200); expect(TemplateState.parse(result.json()).current.version).toBe(1);
    const preview = await app.inject({ method: 'POST', url: '/api/admin/receipt-templates/preview', headers, payload: { kind: 'receipt', template: DEFAULT_RECEIPT_TEMPLATE } });
    expect(preview.headers['content-type']).toContain('text/html'); expect(preview.body).toContain('SAMPLE');
    expect((await app.inject({ method: 'POST', url: '/api/admin/receipt-templates/test-print', headers, payload: { kind: 'receipt', template: DEFAULT_RECEIPT_TEMPLATE } })).statusCode).toBe(409);
    expect(svc.createOrder(orderBody, staff).ticketNumber).toBe(1);
    expect((await app.inject({ method: 'PUT', url: '/api/service-mode', headers: { 'x-token': staffToken }, payload: { mode: 'counter' } })).statusCode).toBe(200);
    expect(svc.serviceMode()).toBe('counter');
    await app.close();
  });
});
