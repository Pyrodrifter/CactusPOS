import { z } from 'zod';
import { LoginResponse, Order } from './domain.js';

export const RuntimeInfo = z.object({ instanceId: z.string().min(8), mode: z.enum(['live', 'practice']) });
export type RuntimeInfo = z.infer<typeof RuntimeInfo>;
export const PracticeLaunch = z.object({ session: LoginResponse, path: z.literal('/practice/pos') });
export type PracticeLaunch = z.infer<typeof PracticeLaunch>;
export const RequestStatus = z.object({ order: Order.nullable() });
export type RequestStatus = z.infer<typeof RequestStatus>;
export const ReadinessCheck = z.object({
  id: z.enum(['server', 'kitchen', 'printer', 'backup', 'business', 'tax', 'pins']),
  state: z.enum(['ok', 'warn', 'info']), code: z.string(), count: z.number().optional(), at: z.string().nullable().optional(),
});
export const ServiceReadiness = z.object({ mode: z.enum(['live', 'practice']), checkedAt: z.string(), checks: z.array(ReadinessCheck) });
export type ServiceReadiness = z.infer<typeof ServiceReadiness>;
