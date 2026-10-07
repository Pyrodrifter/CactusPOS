import multicastDns from 'multicast-dns';
import { networkInterfaces } from 'node:os';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { settings } from './config.mjs';

const canonicalName = name => name.toLowerCase().replace(/\.$/, '');

export async function announceHost(config) {
  const addresses = Object.values(networkInterfaces()).flat();
  if (!addresses.some(address => address?.family === 'IPv4' && address.address === config.ip)) {
    throw new Error('CACTUS_LAN_IP is not assigned to this laptop. Select the interface used by the phone WiFi.');
  }

  const dns = multicastDns({ interface: config.ip });
  const record = { name: config.hostname, type: 'A', ttl: 120, flush: true, data: config.ip };
  let stopped = false;
  let announced = false;
  let refresh;
  let conflict;
  let failure;

  const stop = () => {
    if (stopped) return;
    stopped = true;
    clearInterval(refresh);
    if (announced) dns.respond({ answers: [{ ...record, ttl: 0 }] });
    dns.destroy();
  };
  dns.on('error', error => {
    failure = error;
    if (announced) { console.error(`mDNS failed: ${error.message}`); process.exitCode = 1; stop(); }
  });
  dns.on('response', packet => {
    const answers = [...(packet.answers ?? []), ...(packet.additionals ?? [])];
    const other = answers.find(answer => canonicalName(answer.name) === config.hostname
      && answer.type === 'A' && answer.ttl !== 0 && answer.data !== config.ip);
    if (other) {
      conflict = new Error(`${config.hostname} already resolves to ${other.data}. Choose another CACTUS_HOSTNAME and rerun lan:setup.`);
      if (announced) { console.error(conflict.message); process.exitCode = 1; stop(); }
    }
  });
  dns.on('query', packet => {
    if (announced && packet.questions.some(question => canonicalName(question.name) === config.hostname
      && (question.type === 'A' || question.type === 'ANY'))) {
      dns.respond({ answers: [record] });
    }
  });

  // Look for an existing owner before advertising the selected address.
  for (let attempt = 0; attempt < 3; attempt++) {
    dns.query({ questions: [{ name: config.hostname, type: 'A' }] });
    await new Promise(accept => setTimeout(accept, 250));
    if (conflict || failure) { stop(); throw conflict ?? failure; }
  }
  announced = true;
  dns.respond({ answers: [record] });
  refresh = setInterval(() => dns.respond({ answers: [record] }), 60000);
  console.log(`mDNS: ${config.hostname} -> ${config.ip} on the selected LAN interface`);
  return stop;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const stop = await announceHost(settings()).catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
  if (stop) for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, stop);
}
