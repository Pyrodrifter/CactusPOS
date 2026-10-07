import { describe, expect, it } from 'vitest';
import { createServer } from 'node:net';
import { settings, caddyEnvironment } from './config.mjs';
import { assertPortFree } from './dev.mjs';

describe('LAN setup', () => {
  it('uses one chosen address and the default HTTPS hostname/port', () => {
    expect(settings({ CACTUS_LAN_IP: '192.168.1.20' })).toEqual({
      ip: '192.168.1.20', hostname: 'cactus.local', port: 443,
    });
  });

  it.each([undefined, '127.0.0.1', '0.0.0.0', '224.0.0.251', '192.168.1.999', '192.168.1.20\n'])('refuses an invalid LAN destination %j', ip => {
    expect(() => settings({ CACTUS_LAN_IP: ip })).toThrow('CACTUS_LAN_IP');
  });

  it('refuses a hostname containing Caddy configuration characters', () => {
    expect(() => settings({ CACTUS_LAN_IP: '192.168.1.20', CACTUS_HOSTNAME: 'cactus.local\nrespond 200' }))
      .toThrow('CACTUS_HOSTNAME');
  });

  it('passes a custom unprivileged port and only the configured LAN names to Caddy', () => {
    const config = settings({ CACTUS_LAN_IP: '192.168.1.20', CACTUS_HOSTNAME: 'test-pos.local', CACTUS_HTTPS_PORT: '8443' });
    const env = caddyEnvironment(config, {});
    expect(env.CACTUS_HOSTNAME).toBe('test-pos.local');
    expect(env.CACTUS_LAN_IP).toBe('192.168.1.20');
    expect(env.CACTUS_HTTPS_PORT).toBe('8443');
    expect(env.CACTUS_TLS_CERT).toMatch(/\.local\/lan\/cert\.pem$/);
    expect(env.CACTUS_TLS_KEY).toMatch(/\.local\/lan\/key\.pem$/);
  });

  it('refuses an out-of-range HTTPS port', () => {
    expect(() => settings({ CACTUS_LAN_IP: '192.168.1.20', CACTUS_HTTPS_PORT: '65536' }))
      .toThrow('CACTUS_HTTPS_PORT');
  });
});

it('fails before spawning services when a required listener is occupied', async () => {
  const listener = createServer();
  await new Promise((accept, reject) => {
    listener.once('error', reject);
    listener.listen(0, '0.0.0.0', accept);
  });
  try {
    await expect(assertPortFree(listener.address().port)).rejects.toThrow('unavailable');
  } finally {
    await new Promise((accept, reject) => listener.close(error => error ? reject(error) : accept()));
  }
});
