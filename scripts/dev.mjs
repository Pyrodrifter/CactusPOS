// Supervise both process trees on Windows and Unix, including Ctrl+C cleanup.
import { resolve } from 'node:path';
import concurrently from 'concurrently';

// Development has its own database inside the checkout. Without CACTUS_DB the server opens the installed
// till's sales data (see packages/server/src/dataHome.ts), which is not where test orders belong.
const devDb = process.env.CACTUS_DB ?? resolve(import.meta.dirname, '../packages/server/data/cactus.sqlite');

const { result } = concurrently(
  [
    { name: 'server', command: 'npm run dev --workspace @cactus/server', prefixColor: 'cyan', env: { CACTUS_DB: devDb } },
    // A busy port must fail instead of opening a second UI against another server.
    { name: 'web', command: 'npm run dev --workspace @cactus/web -- --strictPort', prefixColor: 'green' },
  ],
  { killOthersOn: ['success', 'failure'] },
);

console.log('API http://localhost:3000   UI (hot reload) http://localhost:5173');

try {
  await result;
} catch {
  process.exitCode = 1;
}
