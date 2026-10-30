declare module 'multicast-dns' {
  import { EventEmitter } from 'node:events';
  export interface Record { name: string; type: string; ttl?: number; flush?: boolean; data?: unknown }
  export interface Packet { questions?: Record[]; answers?: Record[]; additionals?: Record[] }
  interface Responder extends EventEmitter {
    query(packet: Packet): void;
    respond(packet: Packet): void;
    destroy(): void;
  }
  export default function multicastDns(options: { interface: string; bind?: string }): Responder;
}
