import { resolve } from 'node:path';
import { networkInterfaces } from 'node:os';
import { openDb } from './db.js';
import { buildApp } from './app.js';
import { seedSample } from './seedData.js';

const dbPath = process.env.CACTUS_DB ?? resolve(process.cwd(), 'data/cactus.sqlite');
const port = Number(process.env.PORT ?? 3000);
const db = openDb(dbPath);
if (!db.prepare('SELECT 1 FROM tax_categories LIMIT 1').get()) {
  seedSample(db);
  console.log('Empty database: loaded SAMPLE menu. Default PINs: owner 1234, staff 1111 — change them in Admin.');
}
const { app } = buildApp(db);
await app.listen({ port, host: '0.0.0.0' });
const ips = Object.values(networkInterfaces()).flat().filter((n) => n && n.family === 'IPv4' && !n.internal).map((n) => n!.address);
console.log(`CactusPOS running. DB: ${dbPath}`);
for (const ip of ips) console.log(`  http://${ip}:${port}`);
