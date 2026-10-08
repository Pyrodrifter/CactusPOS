import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import websocket from '@fastify/websocket';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { ZodError } from 'zod';
import {
  type Ack, AvailabilityBody, BusinessSchema, CloseDayBody, CreateOrderBody, ReportQuery, RequestId, IdParams, LoginBody, MenuCategory, MenuItem, MoneyError, OrdersQuery, PayBody,
  StaffInput, StatusBody, TaxCategorySchema, TaxConfigError, VoidBody, type Order, type ServerEvent,
} from '@cactus/shared';
import { AdminService } from './admin.js';
import { LoginThrottle } from './auth.js';
import { PrinterSettings, Printing } from './printing.js';
import { Reports } from './reports.js';
import { Books, BooksSettings, ExportQuery } from './books.js';
import { buildDayReport, renderHtml } from '@cactus/receipt';
import type { Transport } from '@cactus/printer';
import { HttpError, PosService, type Staff } from './service.js';
import { renderReceiptHtml } from './receipt.js';
import type { DB } from './db.js';

interface Client { send(data: string): void; kind: 'staff' | 'pickup' }

export function buildApp(db: DB, opts: { webDist?: string; printerTransport?: (s: PrinterSettings) => Transport | null } = {}): { app: FastifyInstance; svc: PosService; admin: AdminService; printing: Printing; reports: Reports; books: Books } {
  const svc = new PosService(db);
  const app = Fastify({ logger: false });
  const admin = new AdminService(db, svc, svc.auth);
  const throttle = new LoginThrottle();
  const printing = new Printing(db, () => svc.business(), opts.printerTransport);
  app.addHook('onClose', async () => printing.queue.stop());
  const reports = new Reports(db, svc);
  const books = new Books(db, svc);
  const clients = new Set<Client>();

  const broadcast = (ev: ServerEvent) => {
    const msg = JSON.stringify(ev);
    for (const c of clients) if (c.kind === 'staff') c.send(msg);
  };
  const broadcastOrder = (order: Order) => {
    broadcast({ type: 'order.changed', order });
    const board = JSON.stringify({ type: 'pickup.changed', ...svc.pickupBoard() } satisfies ServerEvent);
    for (const c of clients) if (c.kind === 'pickup') c.send(board);
  };

  app.setErrorHandler((err: unknown, _req, reply) => {
    if (err instanceof HttpError) return reply.code(err.status).send({ error: err.message });
    if (err instanceof ZodError) return reply.code(400).send({ error: 'Invalid request', issues: err.issues });
    if (err instanceof MoneyError) return reply.code(400).send({ error: err.message });
    // Another program holds the database (a backup, a second copy). Nothing was written; the screen can retry.
    if ((err as { code?: string; errstr?: string })?.errstr === 'database is locked' || /database is locked/.test(String((err as Error)?.message))) {
      return reply.code(503).send({ error: 'The till is busy for a moment. Please try again.' });
    }
    // A sale the tax setup cannot price must stop loudly rather than go through untaxed.
    if (err instanceof TaxConfigError) return reply.code(409).send({ error: `Tax setup problem: ${err.message}` });
    const e = err as { statusCode?: number; message?: string };
    return reply.code(e.statusCode ?? 500).send({ error: e.message ?? 'Server error' });
  });

  const authOf = (req: FastifyRequest): Staff => {
    const h = req.headers['x-token'];
    const token = (Array.isArray(h) ? h[0] : h) ?? (req.query as { token?: string }).token;
    const s = svc.auth.staffFor(token);
    if (!s) throw new HttpError(401, 'Login required');
    return s;
  };
  const ownerOf = (req: FastifyRequest): Staff => {
    const s = authOf(req);
    if (s.role !== 'owner') throw new HttpError(403, 'Owner only');
    return s;
  };
  const idOf = (req: FastifyRequest) => IdParams.parse(req.params).id;
  const menuChanged = () => broadcast({ type: 'menu.changed' });
  const ok: Ack = { ok: true };
  /** Optional `Idempotency-Key` header; a malformed one is a client bug, so it is rejected rather than ignored. */
  const requestIdOf = (req: FastifyRequest): string | undefined => {
    const h = req.headers['idempotency-key'];
    const value = Array.isArray(h) ? h[0] : h;
    return value === undefined ? undefined : RequestId.parse(value);
  };

  app.register(websocket);
  app.register(async (f) => {
    f.get('/ws', { websocket: true }, (socket, req) => {
      const q = req.query as { token?: string; room?: string };
      const pickup = q.room === 'pickup';
      if (!pickup && !svc.auth.staffFor(q.token)) { socket.close(4401, 'login required'); return; }
      const client: Client = { send: (d) => socket.send(d), kind: pickup ? 'pickup' : 'staff' };
      clients.add(client);
      socket.on('close', () => clients.delete(client));
      socket.send(JSON.stringify({ type: 'hello', serverTime: new Date().toISOString() } satisfies ServerEvent));
      if (pickup) socket.send(JSON.stringify({ type: 'pickup.changed', ...svc.pickupBoard() } satisfies ServerEvent));
    });
  });

  app.get('/api/health', async () => ({ ok: true, business: svc.business().name, time: new Date().toISOString() }));
  app.get('/api/pickup', async () => svc.pickupBoard());

  app.post('/api/login', async (req) => {
    const { pin } = LoginBody.parse(req.body);
    if (throttle.blocked(req.ip)) throw new HttpError(429, 'Too many wrong PINs. Wait 30 seconds.');
    const session = svc.auth.login(pin);
    if (!session) { throttle.fail(req.ip); throw new HttpError(401, 'Wrong PIN'); }
    throttle.ok(req.ip);
    return { ...session, business: svc.business() };
  });
  app.post('/api/logout', async (req) => {
    const h = req.headers['x-token'];
    const token = Array.isArray(h) ? h[0] : h;
    if (token) svc.auth.logout(token);
    return ok;
  });

  app.get('/api/menu', async (req) => { authOf(req); return svc.menu(); });
  app.get('/api/orders', async (req) => {
    authOf(req);
    return OrdersQuery.parse(req.query).scope === 'today' ? svc.todaysOrders() : svc.activeOrders();
  });
  app.get('/api/orders/:id', async (req) => { authOf(req); return svc.getOrder(idOf(req)); });

  app.post('/api/orders', async (req, reply) => {
    const staff = authOf(req);
    const requestId = requestIdOf(req);
    const known = requestId ? db.prepare('SELECT 1 FROM requests WHERE key = ?').get(`create:${requestId}`) : undefined;
    const order = svc.createOrder(CreateOrderBody.parse(req.body), staff, requestId);
    // A repeat returns the first result without announcing or printing it a second time.
    if (!known) { broadcastOrder(order); printing.onSent(order); }
    return reply.code(201).send(order);
  });
  app.post('/api/orders/:id/pay', async (req) => {
    const staff = authOf(req);
    const requestId = requestIdOf(req);
    const known = requestId ? db.prepare('SELECT 1 FROM requests WHERE key = ?').get(`pay:${requestId}`) : undefined;
    const order = svc.pay(idOf(req), PayBody.parse(req.body), staff, requestId);
    if (!known) { broadcastOrder(order); printing.onPaid(order); }
    return order;
  });
  app.post('/api/orders/:id/status', async (req) => {
    const staff = authOf(req);
    const order = svc.setStatus(idOf(req), StatusBody.parse(req.body).status, staff);
    broadcastOrder(order);
    return order;
  });
  app.post('/api/orders/:id/void', async (req) => {
    const staff = authOf(req);
    const b = VoidBody.parse(req.body);
    const order = svc.voidOrder(idOf(req), b.reason, b.managerPin, staff);
    broadcastOrder(order);
    return order;
  });
  app.get('/api/orders/:id/receipt', async (req, reply) => {
    authOf(req);
    const order = svc.getOrder(idOf(req));
    return reply.type('text/html').send(renderReceiptHtml(order, svc.business(), (req.query as { copy?: string }).copy === '1'));
  });

  /* ----- day reports: owner only ----- */
  app.get('/api/reports/day', async (req) => {
    ownerOf(req);
    const date = ReportQuery.parse(req.query).date ?? svc.businessDate();
    return { report: reports.day(date), closed: reports.latestFor(date), today: svc.businessDate() };
  });
  app.post('/api/reports/day/close', async (req, reply) => reply.code(201).send(reports.close(CloseDayBody.parse(req.body), ownerOf(req))));
  app.get('/api/reports/z', async (req) => { ownerOf(req); return reports.list(); });
  // Prints the closed Z report for the date if there is one, otherwise a reading of the day so far.
  app.post('/api/reports/day/print', async (req) => {
    ownerOf(req);
    const date = ReportQuery.parse(req.body ?? {}).date ?? svc.businessDate();
    if (!printing.active) throw new HttpError(409, 'No receipt printer is set up');
    return printing.dayReport(reports.latestFor(date) ?? reports.day(date));
  });
  app.get('/api/reports/day/print.html', async (req, reply) => {
    ownerOf(req);
    const date = ReportQuery.parse(req.query).date ?? svc.businessDate();
    return reply.type('text/html').send(renderHtml(buildDayReport(reports.latestFor(date) ?? reports.day(date), svc.business()), { title: `Report ${date}` }));
  });

  /* ----- bookkeeping exports: owner only ----- */
  app.get('/api/books', async (req) => { ownerOf(req); return { settings: books.settings(), pbk: books.status(), today: svc.businessDate() }; });
  app.put('/api/books/settings', async (req) => { ownerOf(req); return books.save(BooksSettings.parse(req.body)); });
  app.post('/api/books/pbk/post', async (req) => { ownerOf(req); return books.postToPbk(); });
  const csv = (reply: import('fastify').FastifyReply, name: string, body: string) =>
    reply.header('content-type', 'text/csv; charset=utf-8').header('content-disposition', `attachment; filename="${name}"`).send(body);
  app.get('/api/books/days.csv', async (req, reply) => {
    ownerOf(req);
    const q = ExportQuery.parse(req.query);
    return csv(reply, `daily-sales_${q.from ?? 'start'}_${q.to ?? 'today'}.csv`, books.daysCsv(q.from, q.to));
  });
  app.get('/api/books/journal.csv', async (req, reply) => {
    ownerOf(req);
    const q = ExportQuery.parse(req.query);
    return csv(reply, `journal_${q.from ?? 'start'}_${q.to ?? 'today'}.csv`, books.journalCsv(q.from, q.to));
  });

  /* ----- printing ----- */
  // Tells a screen whether to send receipts to the printer or fall back to the browser's print dialog.
  app.get('/api/print/status', async (req) => { authOf(req); return { active: printing.active, pending: printing.queue.pending(), jobs: printing.queue.list().slice(0, 20) }; });
  app.post('/api/orders/:id/print', async (req) => {
    authOf(req);
    if (!printing.active) throw new HttpError(409, 'No receipt printer is set up');
    const kind = (req.body as { kind?: string } | null)?.kind === 'kitchen' ? 'kitchen' : 'receipt';
    const order = svc.getOrder(idOf(req));
    return kind === 'kitchen' ? printing.kitchen(order) : printing.receipt(order, { copy: true });
  });
  app.post('/api/print/drawer', async (req) => {
    authOf(req);
    if (!printing.active || !printing.settings().drawer) throw new HttpError(409, 'No cash drawer is set up');
    return printing.openDrawer();
  });
  app.post('/api/print/retry', async (req) => { authOf(req); printing.queue.retryFailed(); return ok; });
  app.get('/api/admin/printer', async (req) => { ownerOf(req); return printing.settings(); });
  app.put('/api/admin/printer', async (req) => { ownerOf(req); return printing.save(PrinterSettings.parse(req.body)); });
  app.post('/api/admin/printer/test', async (req) => {
    ownerOf(req);
    if (!printing.active) throw new HttpError(409, 'Turn the printer on and enter its address first');
    return printing.test();
  });

  /* ----- menu availability: any signed-in staff ----- */
  app.post('/api/menu/items/:id/available', async (req) => {
    const staff = authOf(req);
    const item = admin.setAvailable(idOf(req), AvailabilityBody.parse(req.body).available, staff);
    menuChanged();
    return item;
  });

  /* ----- admin: owner only ----- */
  app.put('/api/admin/menu/categories/:id', async (req) => {
    const by = ownerOf(req);
    const c = admin.upsertCategory(MenuCategory.parse({ ...(req.body as object), id: idOf(req) }), by);
    menuChanged();
    return c;
  });
  app.delete('/api/admin/menu/categories/:id', async (req) => { admin.deleteCategory(idOf(req), ownerOf(req)); menuChanged(); return ok; });
  app.put('/api/admin/menu/items/:id', async (req) => {
    const by = ownerOf(req);
    const item = admin.upsertItem(MenuItem.parse({ ...(req.body as object), id: idOf(req) }), by);
    menuChanged();
    return item;
  });
  app.delete('/api/admin/menu/items/:id', async (req) => { admin.deleteItem(idOf(req), ownerOf(req)); menuChanged(); return ok; });

  app.get('/api/admin/business', async (req) => { ownerOf(req); return svc.business(); });
  app.put('/api/admin/business', async (req) => admin.setBusiness(BusinessSchema.parse(req.body), ownerOf(req)));

  app.put('/api/admin/tax/:id', async (req) => {
    const by = ownerOf(req);
    const cat = admin.upsertTax(TaxCategorySchema.parse({ ...(req.body as object), id: idOf(req) }), by);
    menuChanged();
    return cat;
  });

  app.get('/api/admin/staff', async (req) => { ownerOf(req); return admin.listStaff(); });
  app.post('/api/admin/staff', async (req, reply) => reply.code(201).send(admin.saveStaff(undefined, StaffInput.parse(req.body), ownerOf(req))));
  app.put('/api/admin/staff/:id', async (req) => admin.saveStaff(idOf(req), StaffInput.parse(req.body), ownerOf(req)));
  app.get('/api/admin/audit', async (req) => { ownerOf(req); return admin.auditLog(); });

  const dist = opts.webDist ?? resolve(import.meta.dirname, '../../web/dist');
  if (existsSync(dist)) {
    app.register(fastifyStatic, { root: dist });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api')) return reply.code(404).send({ error: 'Not found' });
      return reply.sendFile('index.html');
    });
  }
  return { app, svc, admin, printing, reports, books };
}
