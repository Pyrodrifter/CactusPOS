import { dirname, join, resolve } from 'node:path';
import { homedir, networkInterfaces } from 'node:os';
import { createServer } from 'node:net';
import { openDb } from './db.js';
import { buildApp } from './app.js';
import { seedSample } from './seedData.js';
import { applyProfile } from './seedProfile.js';
import { chooseDb, dataHome, prepareDb } from './dataHome.js';
import { startLocalNetwork } from './localNetwork.js';
import { localNetworkConfig } from './localNetworkConfig.js';

// One database however the till is started; CACTUS_DB names another file (development, tests).
const choice = chooseDb(process.env, process.platform, homedir(), process.cwd());
const dbPath = resolve(choice.path);
const wanted = Number(process.env.PORT ?? 3000);
if (!Number.isInteger(wanted) || wanted < 1 || wanted > 65535) {
  console.error('PORT must be an integer between 1 and 65535.');
  process.exit(1);
}
const strictPort = process.env.CACTUS_STRICT_PORT === '1';

const isFree = (p: number) => new Promise<boolean>((done) => {
  const probe = createServer();
  probe.once('error', () => done(false));
  probe.once('listening', () => probe.close(() => done(true)));
  probe.listen(p, '0.0.0.0');
});
/** Another copy (or another program) may hold the port; step up rather than die with a stack trace. */
let port = wanted;
while (!(await isFree(port))) {
  if (strictPort) {
    console.error(`Port ${wanted} is already in use. Close the other program or set PORT (CACTUS_STRICT_PORT=1).`);
    process.exit(1);
  }
  if (port - wanted >= 10 || port === 65535) { console.error(`Ports ${wanted}-${port} are all in use. Close the other program or set PORT.`); process.exit(1); }
  port++;
}
if (port !== wanted) console.warn(`
!! Port ${wanted} is already in use (is CactusPOS already running?). Using ${port} instead.
`);
for (const line of prepareDb(choice)) console.warn(line);
const db = openDb(dbPath);
if (!db.prepare('SELECT 1 FROM tax_categories LIMIT 1').get()) {
  seedSample(db);
  const profile = process.env.CACTUS_SEED;
  if (profile) applyProfile(db, profile);
  console.log(`Empty database: loaded ${profile ? `seed/${profile}.json` : 'SAMPLE menu'}. Default PINs: owner 1234, staff 1111 — change them in Admin.`);
}
const backupDir = join(dirname(dbPath), 'backups');
const { app, backups } = buildApp(db, { backupDir, practiceDbPath: join(dirname(dbPath), 'practice', 'practice.sqlite') });
let localNetwork: Awaited<ReturnType<typeof startLocalNetwork>> | undefined;
app.addHook('onClose', async () => { await localNetwork?.stop(); });
await app.listen({ port, host: '0.0.0.0' });
try {
  const lan = localNetworkConfig(process.env, dataHome(process.env, process.platform, homedir()));
  if (lan) {
    localNetwork = await startLocalNetwork(lan.settings, port, lan.statusFile);
    const state = localNetwork.status;
    if (state.aliasPort) console.log(`  http://${state.hostname}${state.aliasPort === 80 ? '' : `:${state.aliasPort}`}/pos   (friendly LAN address)`);
    else if (state.advertised) console.log(`  http://${state.hostname}:${port}/pos   (friendly LAN address)`);
    for (const problem of state.problems) console.warn(`Friendly LAN address: ${problem}`);
  }
} catch (error) { console.warn(`Friendly LAN address unavailable; the till still works on port ${port}:`, String(error)); }
backups.start();
const ips = Object.values(networkInterfaces()).flat().filter((n) => n && n.family === 'IPv4' && !n.internal).map((n) => n!.address);
console.log(`CactusPOS running. DB: ${dbPath}`);
console.log(`Backups: ${backupDir}`);
console.log(`  http://localhost:${port}   (this computer)`);
for (const ip of ips) console.log(`  http://${ip}:${port}   (phones and tablets on the same WiFi)`);
