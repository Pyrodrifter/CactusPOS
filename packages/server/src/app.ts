import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import websocket from '@fastify/websocket';
import fastifyStatic from '@fastify/static';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { ZodError } from 'zod';
import { CreateOrderBody, LoginBody, PayBody, StatusBody, VoidBody, type Order, type ServerEvent } from '@cactus/shared';
import { HttpError, PosService, type Staff } from './service.js';
import { renderReceiptHtml } from './receipt.js';
import type { DB } from './db.js';

interface Client { send(data: string): void; kind: 'staff' | 'pickup' }

export function buildApp(db: DB, opts: { webDist?: string } = {}): { app: FastifyInstance; svc: PosService } {
  const svc = new PosService(db);
  const app = Fastify({ logger: false });
  const sessions = new Map<string, Staff>();
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
    const s = token ? sessions.get(token) : undefined;
    if (!s) throw new HttpError(401, 'Login required');
    return s;
  };

  app.register(websocket);
  app.register(async (f) => {
    f.get('/ws', { websocket: true }, (socket, req) => {
      const q = req.query as { token?: string; room?: string };
      const pickup = q.room === 'pickup';
      if (!pickup && !(q.token && sessions.has(q.token))) { socket.close(4401, 'login required'); return; }
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
    const staff = svc.login(pin);
    if (!staff) throw new HttpError(401, 'Wrong PIN');
    const token = randomUUID();
    sessions.set(token, staff);
    return { token, staff, business: svc.business() };
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

  const dist = opts.webDist ?? resolve(import.meta.dirname, '../../web/dist');
  if (existsSync(dist)) {
    app.register(fastifyStatic, { root: dist });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api')) return reply.code(404).send({ error: 'Not found' });
      return reply.sendFile('index.html');
    });
  }
  return { app, svc };
}
