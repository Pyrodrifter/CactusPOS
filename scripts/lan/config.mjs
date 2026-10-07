import { isIPv4 } from 'node:net';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export const root = fileURLToPath(new URL('../../', import.meta.url));
export const directory = resolve(root, '.local/lan');

export function settings(env = process.env) {
  const ip = env.CACTUS_LAN_IP;
  if (!ip || !isIPv4(ip) || ip.startsWith('127.') || ip === '0.0.0.0' || Number(ip.split('.')[0]) >= 224) {
    throw new Error('Set CACTUS_LAN_IP to the laptop IPv4 address on the phone WiFi (for example 192.168.1.20).');
  }
  const hostname = env.CACTUS_HOSTNAME || 'cactus.local';
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.local$/.test(hostname)) {
    throw new Error('CACTUS_HOSTNAME must be one lowercase label followed by .local.');
  }
  const portText = env.CACTUS_HTTPS_PORT || '443';
  if (!/^\d+$/.test(portText) || Number(portText) < 1 || Number(portText) > 65535) {
    throw new Error('CACTUS_HTTPS_PORT must be an integer from 1 through 65535.');
  }
  return { ip, hostname, port: Number(portText) };
}

export function caddyEnvironment(config, env = process.env) {
  return {
    ...env,
    CACTUS_LAN_IP: config.ip,
    CACTUS_HOSTNAME: config.hostname,
    CACTUS_HTTPS_PORT: String(config.port),
    CACTUS_TLS_CERT: resolve(directory, 'cert.pem').replaceAll('\\', '/'),
    CACTUS_TLS_KEY: resolve(directory, 'key.pem').replaceAll('\\', '/'),
  };
}
