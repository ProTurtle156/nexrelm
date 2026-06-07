/**
 * Isolated DHCP self-test: starts the server on a non-privileged TEST port and
 * drives a real DISCOVER→OFFER→REQUEST→ACK exchange over a loopback client,
 * verifying allocation + lease commit. Never binds :67 / touches the LAN config.
 *   cd apps/control-plane && NODE_OPTIONS=--experimental-sqlite npx tsx dhcp-selftest.ts
 */
import dgram from 'node:dgram';
import { dhcpServer } from './src/dhcp/server';
import { getServerSettings, leasesAll, saveServerSettings, scopesAll } from './src/dhcp/db';

const PORT = 6767;
const MAC = 'aa:bb:cc:11:22:33';
const cookie = Buffer.from([99, 130, 83, 99]);
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function base(xid: number): Buffer {
  const b = Buffer.alloc(300);
  b[0] = 1; b[1] = 1; b[2] = 6;
  b.writeUInt32BE(xid >>> 0, 4);
  MAC.split(':').forEach((h, i) => (b[28 + i] = parseInt(h, 16)));
  cookie.copy(b, 236);
  return b;
}
function discover(xid: number): Buffer {
  const b = base(xid);
  let o = 240;
  b[o++] = 53; b[o++] = 1; b[o++] = 1; // DHCPDISCOVER
  b[o++] = 55; b[o++] = 3; b[o++] = 1; b[o++] = 3; b[o++] = 6; // param request: mask, router, dns
  const hn = Buffer.from('test-pc');
  b[o++] = 12; b[o++] = hn.length; hn.copy(b, o); o += hn.length;
  b[o++] = 255;
  return b;
}
function request(xid: number, ip: string, sid: string): Buffer {
  const b = base(xid);
  let o = 240;
  b[o++] = 53; b[o++] = 1; b[o++] = 3; // DHCPREQUEST
  b[o++] = 50; b[o++] = 4; ip.split('.').forEach((x) => (b[o++] = Number(x)));
  b[o++] = 54; b[o++] = 4; sid.split('.').forEach((x) => (b[o++] = Number(x)));
  b[o++] = 255;
  return b;
}

const s = saveServerSettings({ enabled: true, port: PORT });
console.log('serverIp:', s.serverIp, '| useOwnDns:', s.useOwnDns);
console.log('scopes:', scopesAll().map((x) => `${x.name} ${x.rangeStart}-${x.rangeEnd}/${x.mask}`).join(', '));
const status = await dhcpServer.start(s);
console.log('server:', status.running ? 'running' : 'down', status.bind);

const client = dgram.createSocket('udp4');
await new Promise<void>((r) => client.bind(0, () => { client.setBroadcast(true); r(); }));
const send = (buf: Buffer): Promise<void> => new Promise((r) => client.send(buf, PORT, '127.0.0.1', () => r()));

await send(discover(0x1234));
await sleep(400);
const offered = leasesAll().find((l) => l.mac === MAC);
console.log('after DISCOVER → offered:', offered ? `${offered.ip} (${offered.state})` : 'NONE');

if (offered) {
  await send(request(0x1234, offered.ip, getServerSettings().serverIp));
  await sleep(400);
}
const fin = leasesAll().find((l) => l.mac === MAC);
console.log('after REQUEST  → lease:   ', fin ? `${fin.ip} (${fin.state}) host=${fin.hostname ?? '-'}` : 'NONE');
console.log('counters:', JSON.stringify(dhcpServer.counters));

await dhcpServer.stop();
saveServerSettings({ enabled: false, port: 67 });
client.close();
console.log(fin && fin.state === 'active' ? 'PASS ✓' : 'FAIL ✗');
process.exit(0);
