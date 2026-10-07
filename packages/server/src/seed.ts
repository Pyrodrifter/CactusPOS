import { resolve } from 'node:path';
import { openDb } from './db.js';
import { seedSample } from './seedData.js';
import { applyProfile } from './seedProfile.js';

// Usage: npm run seed            -> generic SAMPLE menu + default PINs (only adds what is missing)
//        npm run seed -- <name>  -> replace menu and business details with seed/<name>.json
const profile = process.argv[2];
const db = openDb(process.env.CACTUS_DB ?? resolve(process.cwd(), 'data/cactus.sqlite'));
if (!db.prepare('SELECT 1 FROM staff LIMIT 1').get()) seedSample(db);
if (profile) console.log(`Loaded ${applyProfile(db, profile)} menu items from seed/${profile}.json. Restart or refresh the POS screens.`);
else { seedSample(db); console.log('Sample data loaded.'); }
