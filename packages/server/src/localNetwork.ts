import { createServer, request, type Server } from 'node:http';
import { networkInterfaces, type NetworkInterfaceInfo } from 'node:os';
import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Duplex } from 'node:stream';
import multicastDns, { type Packet, type Record as DnsRecord } from 'multicast-dns';
import { LocalNetworkSettings, type LocalNetworkStatus } from '@cactus/shared';

/** Fixed loopback destination: never a general-purpose proxy. Primary port and browser origin stay intact. */
export async function startHttpAlias(primaryPort: number, aliasPort: number): Promise<Server> {
  const proxy = createServer((incoming, outgoing) => {
    const upstream = request({ host: '127.0.0.1', port: primaryPort, path: incoming.url, method: incoming.method, headers: incoming.headers }, (response) => {
      outgoing.writeHead(response.statusCode ?? 502, response.headers);
      response.pipe(outgoing);
    });
    upstream.on('error', () => { if (!outgoing.headersSent) outgoing.writeHead(502); outgoing.end('The till is reconnecting. Please try again.'); });
    upstream.setTimeout(30_000, () => upstream.destroy());
    incoming.on('aborted', () => upstream.destroy());
    outgoing.on('close', () => { if (!outgoing.writableEnded) upstream.destroy(); });
    incoming.pipe(upstream);
  });
  const upgraded = new Set<Duplex>();
  proxy.on('upgrade', (incoming, downstream, head) => {
    if (!['/ws', '/practice/ws'].includes(incoming.url?.split('?')[0] ?? '')) { downstream.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n'); return; }
    const upstream = request({ host: '127.0.0.1', port: primaryPort, path: incoming.url, method: 'GET', headers: incoming.headers });
    downstream.on('error', () => upstream.destroy());
    downstream.on('close', () => upstream.destroy());
    upstream.on('error', () => downstream.destroy());
    upstream.on('response', (response) => { response.resume(); downstream.end(`HTTP/1.1 ${response.statusCode ?? 502} Refused\r\nConnection: close\r\n\r\n`); });
    upstream.on('upgrade', (response, socket, upstreamHead) => {
      upgraded.add(downstream); upgraded.add(socket);
      socket.on('error', () => downstream.destroy());
      socket.on('close', () => { upgraded.delete(socket); downstream.destroy(); });
      downstream.on('close', () => { upgraded.delete(downstream); socket.destroy(); });
      downstream.write(`HTTP/1.1 101 Switching Protocols\r\n${response.rawHeaders.map((part, index) => index % 2 ? `${part}\r\n` : `${part}: `).join('')}\r\n`);
      if (upstreamHead.length) downstream.write(upstreamHead);
      if (head.length) socket.write(head);
      socket.pipe(downstream); downstream.pipe(socket);
    });
    upstream.end();
  });
  proxy.on('close', () => { for (const socket of upgraded) socket.destroy(); });
  // close() alone does not end upgraded sockets.
  const close = proxy.close.bind(proxy);
  proxy.close = ((callback?: (error?: Error) => void) => { for (const socket of upgraded) socket.destroy(); return close(callback); }) as Server['close'];
  await new Promise<void>((done, reject) => {
    proxy.once('error', reject);
    proxy.listen(aliasPort, '0.0.0.0', () => { proxy.removeListener('error', reject); done(); });
  });
  proxy.on('error', (error) => console.warn(`Friendly HTTP listener: ${error.message}`));
  return proxy;
}

export function lanAddresses(interfaces: NodeJS.Dict<NetworkInterfaceInfo[]>): string[] {
  return [...new Set(Object.entries(interfaces).filter(([name]) => !/loopback|docker|vethernet|virtual|vpn|tailscale|zerotier/i.test(name))
    .flatMap(([, entries]) => entries ?? []).filter((entry) => entry.family === 'IPv4' && !entry.internal &&
      /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(entry.address)).map((entry) => entry.address))];
}

const canonical = (name: string) => name.toLowerCase().replace(/\.$/, '');
export function nameConflict(packet: Packet, hostname: string, addresses: readonly string[]): string | undefined {
  return [...packet.answers ?? [], ...packet.additionals ?? []].find((record) =>
    canonical(record.name) === hostname && ['A', 'AAAA', 'CNAME'].includes(record.type) && record.ttl !== 0 &&
    typeof record.data === 'string' && !addresses.includes(record.data))?.data as string | undefined;
}

export async function startLocalNetwork(raw: unknown, primaryPort: number, statusFile?: string) {
  const settings = LocalNetworkSettings.parse(raw);
  const status: LocalNetworkStatus = { pid: process.pid, hostname: settings.hostname, primaryPort, aliasPort: null, advertised: false, addresses: [], problems: [] };
  let alias: Server | undefined, stopped = false, refreshing = false;
  let responders: Array<ReturnType<typeof multicastDns>> = [];
  let generation = 0, lastProbe = 0;
  const publish = () => {
    if (!statusFile) return;
    try { mkdirSync(dirname(statusFile), { recursive: true }); writeFileSync(`${statusFile}.tmp`, JSON.stringify(status)); renameSync(`${statusFile}.tmp`, statusFile); }
    catch (error) { console.warn(`LAN status: ${String(error)}`); }
  };
  if (!settings.enabled) { publish(); return { status, stop: async () => {} }; }
  if (settings.port && settings.port !== primaryPort) {
    try { alias = await startHttpAlias(primaryPort, settings.port); status.aliasPort = settings.port; }
    catch (error) { status.problems.push(`Friendly HTTP port ${settings.port} is unavailable (${(error as Error).message}); use port ${primaryPort}.`); }
  } else if (settings.port === primaryPort) status.aliasPort = primaryPort;
  const baseProblems = [...status.problems];
  const refresh = async () => {
    if (stopped || refreshing) return;
    const addresses = lanAddresses(networkInterfaces());
    const ownedAddresses = Object.values(networkInterfaces()).flatMap((entries) => entries ?? []).map((entry) => entry.address);
    if (JSON.stringify(addresses) === JSON.stringify(status.addresses) && responders.length && Date.now() - lastProbe < 60_000) return;
    lastProbe = Date.now();
    refreshing = true;
    const currentGeneration = ++generation;
    for (const responder of responders) responder.destroy();
    responders = [];
    status.addresses = addresses; status.advertised = false; status.problems = [...baseProblems];
    let conflict = false;
    try {
      await Promise.all(addresses.map(async (ip) => {
        const dns = multicastDns({ interface: ip, bind: '0.0.0.0' });
        responders.push(dns);
        let ready = false, failed = false;
        const instance = `${settings.hostname.split('.')[0]}._cactuspos._tcp.local`;
        const records: DnsRecord[] = [
          { name: settings.hostname, type: 'A', ttl: 60, flush: true, data: ip },
          { name: '_cactuspos._tcp.local', type: 'PTR', ttl: 60, data: instance },
          { name: instance, type: 'SRV', ttl: 60, flush: true, data: { priority: 0, weight: 0, port: status.aliasPort ?? primaryPort, target: settings.hostname } },
          { name: instance, type: 'TXT', ttl: 60, flush: true, data: [Buffer.from('app=cactuspos')] },
        ];
        dns.on('error', (error: Error) => {
          failed = true;
          status.problems.push(`Local name on ${ip}: ${error.message}. Use the IP address.`);
          status.advertised = false; publish();
        });
        dns.on('response', (packet: Packet) => {
          const other = nameConflict(packet, settings.hostname, ownedAddresses);
          if (!other || stopped || currentGeneration !== generation || conflict) return;
          conflict = true; status.advertised = false;
          status.problems.push(`${settings.hostname} is already used by ${other}. Choose another hostname or use the IP address.`);
          for (const responder of responders) responder.destroy();
          publish();
        });
        dns.on('query', (packet: Packet) => {
          if (ready && !failed && !conflict && !stopped && packet.questions?.some((question) =>
            [settings.hostname, '_cactuspos._tcp.local', instance, '_services._dns-sd._udp.local'].includes(canonical(question.name)))) {
            dns.respond({ answers: records });
          }
        });
        for (let attempt = 0; attempt < 3 && !failed && !conflict; attempt++) {
          dns.query({ questions: [{ name: settings.hostname, type: 'ANY' }] });
          await new Promise((done) => setTimeout(done, 250));
        }
        if (!failed && !conflict && !stopped && currentGeneration === generation) {
          ready = true; dns.respond({ answers: records }); status.advertised = true;
        }
      }));
    } finally { refreshing = false; publish(); }
  };
  // Run probes off the critical startup/checkout path. Changes in WiFi/hotspot addresses are picked up here.
  publish(); void refresh().catch((error) => { status.problems.push(String(error)); publish(); });
  const timer = setInterval(() => { void refresh().catch((error) => { status.problems.push(String(error)); publish(); }); }, 10_000);
  timer.unref();
  return { status, stop: async () => {
    stopped = true; generation++; clearInterval(timer);
    for (const responder of responders) responder.destroy();
    if (alias) await new Promise<void>((done) => alias!.close(() => done()));
    status.advertised = false; status.aliasPort = null; publish();
  } };
}
