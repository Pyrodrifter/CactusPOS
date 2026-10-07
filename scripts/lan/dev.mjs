import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { X509Certificate } from 'node:crypto';
import { createSecureContext } from 'node:tls';
import { createServer } from 'node:net';
import { directory, root, settings, caddyEnvironment } from './config.mjs';
import { run } from './setup.mjs';

export async function validateCertificate(config) {
  const cert = await readFile(resolve(directory, 'cert.pem'));
  const key = await readFile(resolve(directory, 'key.pem'));
  const x509 = new X509Certificate(cert);
  if (!x509.checkHost(config.hostname) || !x509.checkIP(config.ip)
      || Date.parse(x509.validTo) <= Date.now() || Date.parse(x509.validFrom) > Date.now()) {
    throw new Error('LAN certificate does not cover the current hostname/IP or has expired. Run npm run lan:setup again.');
  }
  createSecureContext({ cert, key });
}

export function assertPortFree(port) {
  return new Promise((accept, reject) => {
    const server = createServer();
    server.once('error', error => reject(new Error(`Port ${port} is unavailable: ${error.message}`)));
    server.listen({ port, host: '0.0.0.0', exclusive: true }, () => server.close(accept));
  });
}

export async function dev(env = process.env) {
  const config = settings(env);
  await validateCertificate(config);
  if (config.port === 3000 || config.port === 5173) throw new Error('HTTPS port must differ from API 3000 and Vite 5173.');
  for (const port of [3000, 5173, config.port]) await assertPortFree(port);
  const childEnv = {
    ...caddyEnvironment(config, env),
    PORT: '3000',
    CACTUS_STRICT_PORT: '1',
    // Vite only admits this configured development hostname, not arbitrary hosts.
    __VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS: config.hostname,
  };
  const caddy = env.CACTUS_CADDY_BIN || 'caddy';
  const caddyfile = resolve(root, 'ops/https/Caddyfile');
  await run(caddy, ['validate', '--config', caddyfile, '--adapter', 'caddyfile'], { env: childEnv });

  const children = [];
  let stopping = false;
  async function stop(code) {
    if (stopping) return;
    stopping = true;
    process.exitCode = code;
    await Promise.all(children.map(child => new Promise(accept => {
      if (!child.pid || child.exitCode !== null || child.signalCode !== null) return accept();
      if (process.platform === 'win32') {
        const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { shell: false, stdio: 'ignore' });
        killer.once('exit', accept);
        killer.once('error', () => { child.kill(); accept(); });
      } else {
        try { process.kill(-child.pid, 'SIGTERM'); } catch { /* Already exited. */ }
        const timer = setTimeout(() => {
          try { process.kill(-child.pid, 'SIGKILL'); } catch { /* Already exited. */ }
          accept();
        }, 3000);
        child.once('exit', () => { clearTimeout(timer); accept(); });
      }
    })));
  }
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { void stop(signal === 'SIGINT' ? 130 : 143); });
  const commands = [
    [process.execPath, [resolve(root, 'scripts/dev.mjs')]],
    [caddy, ['run', '--config', caddyfile, '--adapter', 'caddyfile']],
    [process.execPath, [resolve(root, 'scripts/lan/mdns.mjs')]],
  ];
  for (const [binary, args] of commands) {
    const child = spawn(binary, args, { cwd: root, env: childEnv, shell: false, stdio: 'inherit', detached: process.platform !== 'win32' });
    children.push(child);
    child.once('error', error => { console.error(error.message); void stop(1); });
    child.once('exit', code => { if (!stopping) void stop(code === 0 ? 0 : 1); });
  }
  const suffix = config.port === 443 ? '' : `:${config.port}`;
  console.log(`LAN: https://${config.hostname}${suffix}/pos (IP fallback: https://${config.ip}${suffix}/pos)`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  dev().catch(error => { console.error(error.message); process.exitCode = 1; });
}
