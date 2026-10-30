import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import websocket from '@fastify/websocket';
import fastifyStatic from '@fastify/static';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { ZodError } from 'zod';
import {
  type Ack, AddLinesBody, AvailabilityBody, CorrectOrderBody, BusinessSchema, CloseDayBody, CreateOrderBody, TabNameBody, ReportQuery, RequestId, IdParams, LoginBody, MenuCategory, MenuItem, MoneyError, OrdersQuery, PayBody,
  StaffInput, StatusBody, TaxCategorySchema, TaxConfigError, TaxExemption, VoidBody, type Order, type ServerEvent,
} from '@cactus/shared';
import { AdminService } from './admin.js';
import { LoginThrottle } from './auth.js';
import { PrinterSettings, Printing } from './printing.js';
import { Reports, reportRevision } from './reports.js';
import { Books, BooksSettings, ExportQuery } from './books.js';
import { buildDayReport, renderHtml } from '@cactus/receipt';
import type { Transport } from '@cactus/printer';
import { HttpError, PosService, type Staff } from './service.js';
import { renderReceiptHtml } from './receipt.js';
import { ReceiptTemplates, previewHtml } from './receiptTemplates.js';
import { Backups, BackupSettings } from './backup.js';
import { ServiceSettings, SaveTemplateBody, RestoreTemplateBody, PreviewTemplateBody } from '@cactus/shared';
import { getKv, openDb, setKv, type DB } from './db.js';
import { seedPractice } from './practice.js';
import { openingChecks } from './readiness.js';
import { CashMovementBody, AutoCollect } from '@cactus/shared';

interface ClientSocket { send(data: string): void; close(code?: number, reason?: string): void; ping(): void; terminate(): void; on(event: string, listener: () => void): unknown }
interface SocketQuery { token?: string; room?: string; screen?: string }

interface Client {
  send(data: string): void; kind: 'staff' | 'pickup';
  /** Answered the last heartbeat. A screen that stops answering is dropped, see the heartbeat below. */
  alive: boolean; ping(): void; drop(): void;
  screen: string;
}

const VERSION = (JSON.parse(readFileSync(resolve(import.meta.dirname, '../package.json'), 'utf8')) as { version: string }).version;
/** Constant for one run of the server process; see `GET /api/health`. */
const STARTED_AT = new Date().toISOString();

export interface AppOptions {
  webDist?: string;
  printerTransport?: (s: PrinterSettings) => Transport | null;
  /** Folder for database backups. Left out = no backups (in-memory databases in tests). */
  backupDir?: string;
  /** How often every live connection gets a sign of life. Tests shorten it. */
  heartbeatMs?: number;
  /** How often ready orders are checked for automatic pick-up; tests make it short. */
  autoCollectMs?: number;
  mode?: 'live' | 'practice';
  practiceDbPath?: string;
  disableStatic?: boolean;
  printerProbe?: (host: string, port: number) => Promise<boolean>;
}

export function buildApp(db: DB, opts: AppOptions = {}): { app: FastifyInstance; svc: PosService; admin: AdminService; printing: Printing; reports: Reports; books: Books; backups: Backups; connectSocket: (socket: ClientSocket, query: SocketQuery) => void } {
  const practiceMode = opts.mode === 'practice';
  const instanceId = getKv<string>(db, 'instance.id', '') || randomUUID();
  setKv(db, 'instance.id', instanceId);
  const runtime = { instanceId, mode: practiceMode ? 'practice' as const : 'live' as const };
  const svc = new PosService(db);
  const templates = new ReceiptTemplates(db);
  const app = Fastify({ logger: false });
  const admin = new AdminService(db, svc, svc.auth);
  const throttle = new LoginThrottle();
  const printing = new Printing(db, () => svc.business(), opts.printerTransport, practiceMode);
  app.addHook('onClose', async () => printing.queue.stop());
  const reports = new Reports(db, svc);
  const books = new Books(db, svc);
  const backups = new Backups(db, opts.backupDir ?? null);
  app.addHook('onClose', async () => backups.stop());
  const clients = new Set<Client>();
  let sandbox: ReturnType<typeof buildApp> | undefined;
  let sandboxDb: DB | undefined;
  const practice = async () => {
    if (practiceMode || !opts.practiceDbPath) throw new HttpError(409, 'Practice mode is not configured on this server');
    if (!sandbox) {
      sandboxDb = openDb(opts.practiceDbPath);
      seedPractice(db, sandboxDb);
      sandbox = buildApp(sandboxDb, { mode: 'practice', disableStatic: true,
        backupDir: opts.practiceDbPath === ':memory:' ? undefined : join(dirname(opts.practiceDbPath), 'backups') });
      await sandbox.app.ready(); sandbox.backups.start();
    }
    return sandbox;
  };
  app.addHook('onClose', async () => { await sandbox?.app.close(); sandboxDb?.close(); });
  if (practiceMode) app.addHook('onSend', async (_req, reply, payload) => {
    if (typeof payload === 'string' && String(reply.getHeader('content-type') ?? '').includes('text/html')) {
      const stamp = '<div style="font: bold 18px sans-serif;text-align:center;border:3px solid;padding:8px">PRACTICE / OEFENEN<br>Not a sales receipt / Geen verkoopbon</div>';
      return /<body/i.test(payload) ? payload.replace(/<body([^>]*)>/i, `<body$1>${stamp}`) : /<\/style>/i.test(payload) ? payload.replace(/<\/style>/i, `$&${stamp}`) : `${stamp}${payload}`;
    }
    return payload;
  });

  const broadcast = (ev: ServerEvent) => {
    const msg = JSON.stringify(ev);
    for (const c of clients) if (c.kind === 'staff') c.send(msg);
  };
  const broadcastOrder = (order: Order) => {
    broadcast({ type: 'order.changed', order });
    const board = JSON.stringify({ type: 'pickup.changed', ...svc.pickupBoard() } satisfies ServerEvent);
    for (const c of clients) if (c.kind === 'pickup') c.send(board);
  };

  app.setErrorHandler((err: unknown, req, reply) => {
    if (err instanceof HttpError) return reply.code(err.status).send({ error: err.message });
    if (err instanceof ZodError) return reply.code(400).send({ error: 'Invalid request', issues: err.issues });
    if (err instanceof MoneyError) return reply.code(400).send({ error: err.message });
    // Another program holds the database (a backup, a second copy). Nothing was written; the screen can retry.
    if ((err as { code?: string; errstr?: string })?.errstr === 'database is locked' || /database is locked/.test(String((err as Error)?.message))) {
      return reply.code(503).send({ error: 'The till is busy for a moment. Please try again.' });
    }
    // A sale the tax setup cannot price must stop loudly rather than go through untaxed.
    if (err instanceof TaxConfigError) return reply.code(409).send({ error: `Tax setup problem: ${err.message}` });
    // Fastify's own refusals (unreadable JSON, a body that is too large) and the 404/409 raised with a status
    // carry a message meant for the screen.
    const e = err as { statusCode?: number; message?: string };
    if (e.statusCode && e.statusCode >= 400 && e.statusCode < 500) return reply.code(e.statusCode).send({ error: e.message ?? 'Request refused' });
    // Anything else is a fault in the till itself. The details belong in the server log, not on a screen.
    console.error(`[${new Date().toISOString()}] ${req.method} ${req.url.split('?')[0]} failed:`, err);
    return reply.code(500).send({ error: 'Something went wrong on the till. Please try again.' });
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

  const connectSocket = (socket: ClientSocket, q: SocketQuery) => {
      const pickup = q.room === 'pickup';
      if (!pickup && !svc.auth.staffFor(q.token)) { socket.close(4401, 'login required'); return; }
      const client: Client = {
        send: (d) => socket.send(d), kind: pickup ? 'pickup' : 'staff', alive: true,
        screen: pickup ? 'pickup' : ['pos', 'kitchen', 'admin', 'menu-board'].includes(q.screen ?? '') ? q.screen! : 'pos',
        ping: () => { try { socket.ping(); } catch { /* closing; the next round drops it */ } },
        drop: () => socket.terminate(),
      };
      clients.add(client);
      socket.on('pong', () => { client.alive = true; });
      socket.on('close', () => clients.delete(client));
      socket.send(JSON.stringify({ type: 'hello', serverTime: new Date().toISOString() } satisfies ServerEvent));
      if (pickup) socket.send(JSON.stringify({ type: 'pickup.changed', ...svc.pickupBoard() } satisfies ServerEvent));
  };
  app.register(websocket);
  app.register(async (f) => {
    f.get('/ws', { websocket: true }, (socket, req) => connectSocket(socket, req.query as SocketQuery));
    if (!practiceMode) f.get('/practice/ws', { websocket: true }, (socket, req) => {
      void practice().then((context) => context.connectSocket(socket, req.query as SocketQuery)).catch(() => socket.close(1011, 'practice unavailable'));
    });
  });

  /**
   * Heartbeat. A connection can die without a goodbye (laptop restarted while a tablet slept, a WiFi gap), and
   * neither side would notice by itself. So every `heartbeatMs` each screen is sent a `hello`: a screen that hears
   * nothing for a while knows to reconnect and reload. Each screen is also pinged, and one that did not answer the
   * previous ping is dropped here, so dead connections do not pile up.
   */
  const heartbeat = setInterval(() => {
    const hello = JSON.stringify({ type: 'hello', serverTime: new Date().toISOString() } satisfies ServerEvent);
    for (const c of clients) {
      if (!c.alive) { clients.delete(c); c.drop(); continue; }
      c.alive = false;
      c.ping();
      c.send(hello);
    }
  }, opts.heartbeatMs ?? 15_000);
  heartbeat.unref();
  app.addHook('onClose', async () => clearInterval(heartbeat));
  // A ready order is picked up by itself after the set time (Screen tools → Kitchen screen), so nobody has to tap it.
  const collector = setInterval(() => { try { for (const order of svc.autoCollect()) broadcastOrder(order); } catch { /* next round */ } }, opts.autoCollectMs ?? 5_000);
  collector.unref();
  app.addHook('onClose', async () => clearInterval(collector));

  app.get('/api/health', async () => ({ ok: true, app: 'cactuspos', version: VERSION, startedAt: STARTED_AT, business: svc.business().name, time: new Date().toISOString(), ...runtime }));
  app.get('/api/pickup', async () => svc.pickupBoard());

  app.post('/api/login', async (req) => {
    const { pin } = LoginBody.parse(req.body);
    if (throttle.blocked(req.ip)) throw new HttpError(429, 'Too many wrong PINs. Wait 30 seconds.');
    const session = svc.auth.login(pin);
    if (!session) { throttle.fail(req.ip); throw new HttpError(401, 'Wrong PIN'); }
    throttle.ok(req.ip);
    return { ...session, business: svc.business(), ...runtime };
  });
  if (!practiceMode) {
    app.post('/api/practice/start', async (req) => {
      const staff = authOf(req);
      const context = await practice();
      const active = sandboxDb!.prepare('SELECT id,name,role FROM staff WHERE id=? AND active=1').get(staff.id) as Staff | undefined;
      if (!active) throw new HttpError(409, 'This staff member is disabled in the practice till');
      const health = (await context.app.inject({ method: 'GET', url: '/api/health' })).json() as { instanceId: string };
      return { session: { ...context.svc.auth.sessionFor(active), business: context.svc.business(), instanceId: health.instanceId, mode: 'practice' }, path: '/practice/pos' };
    });
    app.all('/api/practice/*', async (req, reply) => {
      const context = await practice();
      const headers = { ...req.headers };
      delete headers['content-length']; delete headers['transfer-encoding']; delete headers.connection;
      const response = await context.app.inject({ method: req.method as 'GET', url: req.url.replace(/^\/api\/practice/, '/api'), headers, payload: req.body as object | undefined });
      reply.code(response.statusCode);
      for (const [key, value] of Object.entries(response.headers)) if (value !== undefined && !['content-length', 'connection', 'transfer-encoding'].includes(key)) reply.header(key, value);
      return reply.send(response.rawPayload);
    });
  }
  if (practiceMode) app.addHook('onRequest', async (req) => {
    const path = req.url.split('?')[0];
    if ((path?.startsWith('/api/books') && (req.method !== 'GET' || path.endsWith('.csv'))) || path === '/api/admin/backups/settings' ||
        (path === '/api/admin/printer' && req.method === 'PUT')) {
      authOf(req); throw new HttpError(409, 'External printers, bookkeeping and backup copies are disabled in practice mode');
    }
  });
  app.get('/api/request-status/:id', async (req) => {
    authOf(req);
    const id = RequestId.parse((req.params as { id: string }).id);
    const kind = (req.query as { kind?: string }).kind ?? 'create';
    if (!['create', 'add'].includes(kind)) throw new HttpError(400, 'Invalid request kind');
    const found = db.prepare('SELECT order_id FROM requests WHERE key=?').get(`${kind}:${id}`) as { order_id: string } | undefined;
    return { order: found ? svc.getOrder(found.order_id) : null };
  });
  app.get('/api/admin/readiness', async (req, reply) => {
    ownerOf(req); reply.header('cache-control', 'no-store');
    return openingChecks(svc, printing, backups, [...clients].filter((client) => client.screen === 'kitchen').length, practiceMode, opts.printerProbe);
  });
  app.post('/api/logout', async (req) => {
    const h = req.headers['x-token'];
    const token = Array.isArray(h) ? h[0] : h;
    if (token) svc.auth.logout(token);
    return ok;
  });

  app.get('/api/menu', async (req) => { authOf(req); return svc.menu(); });
  app.get('/api/service-mode', async (req) => { authOf(req); return { mode: svc.serviceMode() }; });
  app.get('/api/auto-collect', async (req) => { authOf(req); return { seconds: svc.autoCollectSeconds() }; });
  app.put('/api/auto-collect', async (req) => {
    const state = svc.setAutoCollect(AutoCollect.parse(req.body).seconds, ownerOf(req));
    broadcast({ type: 'auto-collect.changed', ...state });
    return state;
  });
  app.put('/api/service-mode', async (req) => {
    const state = svc.setServiceMode(ServiceSettings.parse(req.body).mode, authOf(req));
    broadcast({ type: 'service-mode.changed', ...state });
    return state;
  });
  app.get('/api/admin/receipt-templates', async (req) => { ownerOf(req); return templates.state(); });
  app.put('/api/admin/receipt-templates', async (req) => {
    const staff = ownerOf(req), body = SaveTemplateBody.parse(req.body);
    return templates.save(body.template, body.baseVersion, staff.id);
  });
  app.post('/api/admin/receipt-templates/restore', async (req) => {
    const staff = ownerOf(req), body = RestoreTemplateBody.parse(req.body);
    return templates.save(templates.get(body.version).template, body.baseVersion, staff.id);
  });
  app.post('/api/admin/receipt-templates/preview', async (req, reply) => {
    ownerOf(req);
    const body = PreviewTemplateBody.parse(req.body);
    return reply.type('text/html').send(previewHtml(body.template, body.kind, svc.business()));
  });
  app.post('/api/admin/receipt-templates/test-print', async (req) => {
    ownerOf(req);
    const body = PreviewTemplateBody.parse(req.body);
    if (!printing.active) throw new HttpError(409, 'No receipt printer is set up');
    return printing.designTest(body.template, body.kind);
  });
  app.get('/api/orders', async (req) => {
    authOf(req);
    const scope = OrdersQuery.parse(req.query).scope;
    return scope === 'today' ? svc.todaysOrders() : scope === 'open' ? svc.openTabs() : svc.activeOrders();
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
  app.post('/api/orders/:id/lines', async (req) => {
    const staff = authOf(req);
    const requestId = requestIdOf(req);
    const known = requestId ? db.prepare('SELECT 1 FROM requests WHERE key = ?').get(`add:${requestId}`) : undefined;
    const order = svc.addLines(idOf(req), AddLinesBody.parse(req.body), staff, requestId);
    if (!known) { broadcastOrder(order); printing.onAdded(order); }
    return order;
  });
  app.post('/api/orders/:id/tab', async (req) => {
    const staff = authOf(req);
    const order = svc.setTabName(idOf(req), TabNameBody.parse(req.body).tabName, staff);
    broadcastOrder(order);
    return order;
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
    // The manager PIN is the owner's sign-in PIN, so guessing it here is limited the way sign-in is.
    const guesses = `manager-pin:${staff.id}`;
    if (b.managerPin && throttle.blocked(guesses)) throw new HttpError(429, 'Too many wrong manager PINs. Wait 30 seconds.');
    let order: Order;
    try { order = svc.voidOrder(idOf(req), b.reason, b.managerPin, staff); } catch (e) {
      if (b.managerPin && e instanceof HttpError && e.status === 403) {
        throttle.fail(guesses);
        admin.log('void.manager_pin_refused', { orderId: idOf(req) }, staff);
      }
      throw e;
    }
    broadcastOrder(order);
    return order;
  });
  // Fixes a paid order in one step; see PosService.correctOrder for why nothing is rewritten.
  app.post('/api/orders/:id/correct', async (req) => {
    const staff = authOf(req);
    const b = CorrectOrderBody.parse(req.body);
    const requestId = requestIdOf(req);
    const known = requestId ? db.prepare('SELECT 1 FROM requests WHERE key = ?').get(`correct:${requestId}`) : undefined;
    const guesses = `manager-pin:${staff.id}`; // shared with void: one allowance of wrong PINs, not two
    if (b.managerPin && throttle.blocked(guesses)) throw new HttpError(429, 'Too many wrong manager PINs. Wait 30 seconds.');
    let result: { order: Order; replaced: Order };
    try { result = svc.correctOrder(idOf(req), b, staff, requestId); } catch (e) {
      if (b.managerPin && e instanceof HttpError && e.status === 403) {
        throttle.fail(guesses);
        admin.log('correct.manager_pin_refused', { orderId: idOf(req) }, staff);
      }
      throw e;
    }
    // A repeat returns the first result without announcing or printing it a second time.
    if (!known) { broadcastOrder(result.replaced); broadcastOrder(result.order); printing.onPaid(result.order); }
    return result;
  });
  app.get('/api/orders/:id/receipt', async (req, reply) => {
    authOf(req);
    const order = svc.getOrder(idOf(req));
    return reply.type('text/html').send(renderReceiptHtml(order, svc.business(), (req.query as { copy?: string }).copy === '1', templates.get(order.templateVersion ?? 0).template.receipt));
  });

  /* ----- day reports: owner only ----- */
  app.get('/api/cash/movements', async (req) => { ownerOf(req); return reports.cash.list(ReportQuery.parse(req.query).date ?? svc.businessDate()); });
  app.get('/api/cash/movements/request/:id', async (req) => { ownerOf(req); return { movement: reports.cash.request(RequestId.parse((req.params as { id: string }).id)) }; });
  app.post('/api/cash/movements', async (req, reply) => {
    const by = ownerOf(req), body = CashMovementBody.parse(req.body), key = requestIdOf(req);
    if (!key) throw new HttpError(400, 'An Idempotency-Key is required for a cash entry');
    const entry = reports.cash.add(body, by, key);
    backups.runIfChanged();
    return reply.code(201).send(entry);
  });
  app.get('/api/reports/day/orders', async (req) => { ownerOf(req); return reports.orders(ReportQuery.parse(req.query).date ?? svc.businessDate()); });
  app.get('/api/reports/day', async (req) => {
    ownerOf(req);
    const date = ReportQuery.parse(req.query).date ?? svc.businessDate();
    const report = reports.day(date), closed = reports.latestFor(date), revision = reportRevision(report);
    return { report, closed, today: svc.businessDate(), revision, changedSinceClose: !!closed && reportRevision(closed.report) !== revision };
  });
  app.post('/api/reports/day/close', async (req, reply) => {
    const z = reports.close(CloseDayBody.parse(req.body), ownerOf(req));
    backups.runIfChanged(); // a closed day is worth a copy straight away; a failed backup never fails the close
    return reply.code(201).send(z);
  });
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
  app.get('/api/books', async (req) => { ownerOf(req); return { settings: books.settings(), today: svc.businessDate() }; });
  app.put('/api/books/settings', async (req) => {
    const by = ownerOf(req);
    const saved = books.save(BooksSettings.parse(req.body));
    admin.log('books.saved', saved, by);
    return saved;
  });
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
  app.put('/api/admin/printer', async (req) => {
    const by = ownerOf(req);
    const saved = printing.save(PrinterSettings.parse(req.body));
    admin.log('printer.saved', saved, by);
    return saved;
  });
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
  app.get('/api/admin/tax', async (req) => { ownerOf(req); return svc.taxSetup(); });
  app.put('/api/admin/tax-exemption', async (req) => {
    const by = ownerOf(req);
    const saved = admin.setTaxExemption(TaxExemption.parse(req.body), by);
    menuChanged();
    return saved;
  });

  app.get('/api/admin/staff', async (req) => { ownerOf(req); return admin.listStaff(); });
  app.post('/api/admin/staff', async (req, reply) => reply.code(201).send(admin.saveStaff(undefined, StaffInput.parse(req.body), ownerOf(req))));
  app.put('/api/admin/staff/:id', async (req) => admin.saveStaff(idOf(req), StaffInput.parse(req.body), ownerOf(req)));
  // Who can still sign in with a PIN every new database starts with (1234, 1111). Admin shows a reminder.
  app.get('/api/admin/staff/example-pins', async (req) => { ownerOf(req); return { staff: svc.auth.withExamplePin() }; });
  app.get('/api/admin/audit', async (req) => { ownerOf(req); return admin.auditLog(); });

  /* ----- backups: owner only ----- */
  app.get('/api/admin/backups', async (req) => { ownerOf(req); return backups.state(); });
  app.put('/api/admin/backups/settings', async (req) => {
    const by = ownerOf(req);
    admin.log('backup.settings', backups.save(BackupSettings.parse(req.body)), by);
    return backups.state();
  });
  app.post('/api/admin/backups/run', async (req) => { ownerOf(req); backups.run(); return backups.state(); });

  const dist = opts.webDist ?? resolve(import.meta.dirname, '../../web/dist');
  if (!opts.disableStatic && existsSync(dist)) {
    app.register(fastifyStatic, { root: dist });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api')) return reply.code(404).send({ error: 'Not found' });
      return reply.sendFile('index.html');
    });
  }
  return { app, svc, admin, printing, reports, books, backups, connectSocket };
}
