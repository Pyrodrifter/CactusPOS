// Supervise both process trees on Windows and Unix, including Ctrl+C cleanup.
import concurrently from 'concurrently';

const { result } = concurrently(
  [
    { name: 'server', command: 'npm run dev --workspace @cactus/server', prefixColor: 'cyan' },
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
