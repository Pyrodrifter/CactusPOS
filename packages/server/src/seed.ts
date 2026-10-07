import { resolve } from 'node:path';
import { openDb } from './db.js';
import { seedSample } from './seedData.js';

const db = openDb(process.env.CACTUS_DB ?? resolve(process.cwd(), 'data/cactus.sqlite'));
seedSample(db);
console.log('Sample data loaded.');
