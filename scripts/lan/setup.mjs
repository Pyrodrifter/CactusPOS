import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { directory, root, settings } from './config.mjs';

export function run(binary, args, options = {}) {
  return new Promise((accept, reject) => {
    const child = spawn(binary, args, { cwd: root, stdio: 'inherit', shell: false, ...options });
    child.once('error', reject);
    child.once('exit', (code, signal) => code === 0 ? accept() : reject(new Error(`${binary} exited ${code ?? signal}`)));
  });
}

export async function setup(env = process.env) {
  const config = settings(env);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  // No -install: generating a leaf never modifies the machine trust store.
  await run(env.CACTUS_MKCERT_BIN || 'mkcert', [
    '-cert-file', resolve(directory, 'cert.pem'), '-key-file', resolve(directory, 'key.pem'),
    config.hostname, config.ip, 'localhost', '127.0.0.1', '::1',
  ], { env });
  await writeFile(resolve(directory, 'settings.json'), `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  console.log(`Leaf certificate ready for ${config.hostname} and ${config.ip}. See ops/lan.md for manual CA trust installation.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  setup().catch(error => { console.error(error.message); process.exitCode = 1; });
}
