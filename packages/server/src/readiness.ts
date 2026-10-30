import { connect } from 'node:net';
import type { ServiceReadiness } from '@cactus/shared';
import type { PosService } from './service.js';
import type { Printing } from './printing.js';
import type { Backups } from './backup.js';

export function printerReachable(host: string, port: number): Promise<boolean> {
  return new Promise((done) => {
    const socket = connect({ host, port });
    let settled = false;
    const finish = (ok: boolean) => { if (!settled) { settled = true; socket.destroy(); done(ok); } };
    socket.once('connect', () => finish(true)); socket.once('error', () => finish(false));
    socket.setTimeout(1200, () => finish(false));
  });
}

export async function openingChecks(svc: PosService, printing: Printing, backups: Backups, kitchen: number, practice: boolean,
  probe = printerReachable): Promise<ServiceReadiness> {
  const checks: ServiceReadiness['checks'] = [{ id: 'server', state: 'ok', code: 'server-online' }];
  checks.push({ id: 'kitchen', state: svc.serviceMode() === 'counter' ? 'info' : kitchen ? 'ok' : 'warn',
    code: svc.serviceMode() === 'counter' ? 'calm-mode' : kitchen ? 'kitchen-online' : 'kitchen-missing', count: kitchen });
  const printer = printing.settings();
  if (practice) checks.push({ id: 'printer', state: 'info', code: 'practice-no-printer' });
  else if (!printing.active) checks.push({ id: 'printer', state: 'info', code: 'browser-printing' });
  else {
    const reachable = await probe(printer.host, printer.port);
    checks.push({ id: 'printer', state: reachable ? 'ok' : 'warn', code: reachable ? 'printer-reachable' : 'printer-unreachable' });
  }
  const backup = backups.state();
  const at = backup.last?.at ?? backup.files[0]?.at ?? null;
  checks.push({ id: 'backup', state: practice ? 'info' : !at || Date.now() - Date.parse(at) > 86400_000 || backup.problem || !backup.last?.copied ? 'warn' : 'ok',
    code: practice ? 'practice-local-backup' : backup.problem ? 'backup-problem' : !at ? 'backup-missing' : Date.now() - Date.parse(at) > 86400_000 ? 'backup-old' : !backup.last?.copied ? 'backup-local-only' : 'backup-current', at });
  const business = svc.business();
  checks.push({ id: 'business', state: business.name.trim() && business.crib.trim() ? 'ok' : 'warn', code: business.name.trim() && business.crib.trim() ? 'business-ready' : 'business-incomplete' });
  const menu = svc.menu();
  const used = new Set(menu.items.filter((item) => item.available).map((item) => item.taxCategoryId));
  const unverified = menu.taxCategories.filter((category) => used.has(category.id) && category.unverified).length;
  checks.push({ id: 'tax', state: unverified ? 'warn' : 'ok', code: unverified ? 'tax-unverified' : 'tax-verified', count: unverified });
  const examples = svc.auth.withExamplePin().length;
  checks.push({ id: 'pins', state: examples ? 'warn' : 'ok', code: examples ? 'example-pins' : 'pins-changed', count: examples });
  return { mode: practice ? 'practice' : 'live', checkedAt: new Date().toISOString(), checks };
}
