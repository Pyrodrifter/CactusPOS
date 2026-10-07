// Runs the API server (watch mode) and the Vite dev server together.
import { spawn } from 'node:child_process';
const run = (name, args) => {
  const p = spawn('npm', args, { stdio: 'inherit', shell: true });
  p.on('exit', (c) => { console.log(`[${name}] exited ${c}`); process.exit(c ?? 0); });
  return p;
};
run('server', ['run', 'dev', '--workspace', '@cactus/server']);
run('web', ['run', 'dev', '--workspace', '@cactus/web']);
console.log('API http://localhost:3000   UI (hot reload) http://localhost:5173');
