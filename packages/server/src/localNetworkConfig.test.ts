import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { localNetworkConfig } from './localNetworkConfig.js';

describe('friendly LAN address startup configuration', () => {
  it('enables standard production startup without needing launcher environment variables', () => {
    const missing = () => { throw Object.assign(new Error('missing'), { code: 'ENOENT' }); };
    expect(localNetworkConfig({}, '/till', missing)).toEqual({
      settings: { enabled: true, hostname: 'cactus.local', port: 80 }, statusFile: join('/till', 'lan.json'),
    });
  });
  it('uses the same custom LAN name/port and disabled setting as the installed launcher', () => {
    const result = localNetworkConfig({}, '/till', (file) => {
      expect(file).toBe(join('/till', 'config.json'));
      return '\uFEFF{"hostname":"shop.local","lanPort":8080,"lanEnabled":false,"seed":"cactus-blue"}';
    });
    expect(result?.settings).toEqual({ enabled: false, hostname: 'shop.local', port: 8080 });
  });
  it('does not advertise from explicit development/test databases or when LAN is disabled', () => {
    const unread = () => { throw new Error('must not read installed config'); };
    expect(localNetworkConfig({ CACTUS_DB: 'test.sqlite' }, '/till', unread)).toBeUndefined();
    expect(localNetworkConfig({ CACTUS_DISABLE_LAN: '1', CACTUS_LAN_SETTINGS: '{}' }, '/till', unread)).toBeUndefined();
  });
  it('honors explicit launcher settings/status even with a selected database', () => {
    expect(localNetworkConfig({ CACTUS_DB: 'test.sqlite', CACTUS_LAN_SETTINGS: '{"hostname":"test.local","port":0}', CACTUS_LAN_STATUS_FILE: '/test/lan.json' }, '/till')).toEqual({
      settings: { enabled: true, hostname: 'test.local', port: 0 }, statusFile: '/test/lan.json',
    });
  });
  it('refuses malformed settings rather than silently advertising the wrong name', () => {
    for (const text of ['broken', '[]', 'null', '{"hostname":"bad.example"}', '{"lanPort":-1}']) {
      expect(() => localNetworkConfig({}, '/till', () => text)).toThrow();
    }
  });
});
