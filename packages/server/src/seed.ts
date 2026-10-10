import { homedir } from 'node:os';
import { openDb } from './db.js';
import { seedSample } from './seedData.js';
import { applyProfile } from './seedProfile.js';
import { chooseDb, prepareDb } from './dataHome.js';

// Usage: npm run seed            -> generic SAMPLE menu + default PINs (only adds what is missing)
//        npm run seed -- <name>  -> replace menu and business details with seed/<name>.json
const profile = process.argv[2];
const choice = chooseDb(process.env, process.platform, homedir(), process.cwd());
for (const line of prepareDb(choice)) console.warn(line);
console.log(`Database: ${choice.path}`);
const db = openDb(choice.path);
if (!db.prepare('SELECT 1 FROM staff LIMIT 1').get()) seedSample(db);
if (profile) console.log(`Loaded ${applyProfile(db, profile)} menu items from seed/${profile}.json. Restart or refresh the POS screens.`);
else { seedSample(db); console.log('Sample data loaded.'); }
