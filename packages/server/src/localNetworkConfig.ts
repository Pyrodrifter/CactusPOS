import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LocalNetworkSettings } from '@cactus/shared';

/** Production starts share the launcher's LAN defaults/config. Explicit test/dev databases opt in. */
export function localNetworkConfig(env: NodeJS.ProcessEnv, home: string, read = (file: string) => readFileSync(file, 'utf8')):
  { settings: LocalNetworkSettings; statusFile?: string } | undefined {
  if (env.CACTUS_DISABLE_LAN === '1') return undefined;
  if (env.CACTUS_LAN_SETTINGS) return { settings: LocalNetworkSettings.parse(JSON.parse(env.CACTUS_LAN_SETTINGS)), statusFile: env.CACTUS_LAN_STATUS_FILE };
  if (env.CACTUS_DB) return undefined;
  let config: Record<string, unknown> = {};
  try {
    const value: unknown = JSON.parse(read(join(home, 'config.json')).replace(/^\uFEFF/, '').trim() || '{}');
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('LAN settings file must contain a JSON object');
    config = value as Record<string, unknown>;
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  return {
    settings: LocalNetworkSettings.parse({ enabled: config.lanEnabled, hostname: config.hostname, port: config.lanPort }),
    statusFile: env.CACTUS_LAN_STATUS_FILE ?? join(home, 'lan.json'),
  };
}
