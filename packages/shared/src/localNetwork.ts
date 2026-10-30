import { z } from 'zod';

export const LocalNetworkSettings = z.object({
  enabled: z.boolean().default(true),
  hostname: z.string().regex(/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.local$/).default('cactus.local'),
  port: z.number().int().min(0).max(65535).default(80),
});
export type LocalNetworkSettings = z.infer<typeof LocalNetworkSettings>;
export const LocalNetworkStatus = z.object({
  pid: z.number().int().positive(), hostname: z.string(), primaryPort: z.number().int(),
  aliasPort: z.number().int().nullable(), advertised: z.boolean(), addresses: z.array(z.string()),
  problems: z.array(z.string()),
});
export type LocalNetworkStatus = z.infer<typeof LocalNetworkStatus>;
