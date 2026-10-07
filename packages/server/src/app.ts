import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import websocket from '@fastify/websocket';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { ZodError } from 'zod';
import {
  AvailabilityBody, BusinessSchema, CreateOrderBody, LoginBody, MenuCategory, MenuItem, PayBody, StaffInput, StatusBody,
  TaxCategorySchema, VoidBody, type Order, type ServerEvent,
} from '@cactus/shared';
import { AdminService } from './admin.js';
import { LoginThrottle } from './auth.js';
import { HttpError, PosService, type Staff } from './service.js';
import { renderReceiptHtml } from './receipt.js';
import type { DB } from './db.js';

interface Client { send(data: string): void; kind: 'staff' | 'pickup' }

export function buildApp(db: DB, opts: { webDist?: string } = {}): { app: FastifyInstance; svc: PosService; admin: AdminService } {
  const svc = new PosService(db);
  const app = Fastify({ logger: false });
  const admin = new AdminService(db, svc, svc.auth);
  const throttle = new LoginThrottle();
  const clients = new Set<Client>();

  const broadcast = (ev: ServerEvent) => {
    const msg = JSON.stringify(ev);
    for (const c of clients) if (c.kind === 'staff') c.send(msg);
  };
  const broadcastOrder = (order: Order) => {
    broadcast({ type: 'order.changed', order });
    const board = JSON.stringify({ type: 'pickup.changed', ...svc.pickupBoard() });
    for (const c of clients) if (c.kind === 'pickup') c.send(board);
  };

  app.setErrorHandler((err: unknown, _req, reply) => {
    if (err instanceof HttpError) return reply.code(err.status).send({ error: err.message });
    if (err instanceof ZodError) return reply.code(400).send({ error: 'Invalid request', issues: err.issues });
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
  const idOf = (req: FastifyRequest) => (req.params as { id: string }).id;
  const menuChanged = () => broadcast({ type: 'menu.changed' });

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
      if (pickup) socket.send(JSON.stringify({ type: 'pickup.changed', ...svc.pickupBoard() }));
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
    return { ok: true };
  });

  app.get('/api/menu', async (req) => { authOf(req); return svc.menu(); });
  app.get('/api/orders', async (req) => {
    authOf(req);
    const q = req.query as { scope?: string };
    return q.scope === 'today' ? svc.todaysOrders() : svc.activeOrders();
  });
  app.get('/api/orders/:id', async (req) => { authOf(req); return svc.getOrder((req.params as { id: string }).id); });

  app.post('/api/orders', async (req, reply) => {
    const staff = authOf(req);
    const order = svc.createOrder(CreateOrderBody.parse(req.body), staff);
    broadcastOrder(order);
    return reply.code(201).send(order);
  });
  app.post('/api/orders/:id/pay', async (req) => {
    const staff = authOf(req);
    const order = svc.pay((req.params as { id: string }).id, PayBody.parse(req.body), staff);
    broadcastOrder(order);
    return order;
  });
  app.post('/api/orders/:id/status', async (req) => {
    const staff = authOf(req);
    const order = svc.setStatus((req.params as { id: string }).id, StatusBody.parse(req.body).status, staff);
    broadcastOrder(order);
    return order;
  });
  app.post('/api/orders/:id/void', async (req) => {
    const staff = authOf(req);
    const b = VoidBody.parse(req.body);
    const order = svc.voidOrder((req.params as { id: string }).id, b.reason, b.managerPin, staff);
    broadcastOrder(order);
    return order;
  });
  app.get('/api/orders/:id/receipt', async (req, reply) => {
    authOf(req);
    const order = svc.getOrder((req.params as { id: string }).id);
    return reply.type('text/html').send(renderReceiptHtml(order, svc.business()));
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
  app.delete('/api/admin/menu/categories/:id', async (req) => { admin.deleteCategory(idOf(req), ownerOf(req)); menuChanged(); return { ok: true }; });
  app.put('/api/admin/menu/items/:id', async (req) => {
    const by = ownerOf(req);
    const item = admin.upsertItem(MenuItem.parse({ ...(req.body as object), id: idOf(req) }), by);
    menuChanged();
    return item;
  });
  app.delete('/api/admin/menu/items/:id', async (req) => { admin.deleteItem(idOf(req), ownerOf(req)); menuChanged(); return { ok: true }; });

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
  return { app, svc, admin };
}
