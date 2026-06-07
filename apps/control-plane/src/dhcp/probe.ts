/**
 * Active DHCP discovery probe — the reliable way to find every DHCP server on the
 * LAN (and spot a rogue one). Passive sniffing misses most DHCP: client RENEWs
 * are unicast to their current server, and OFFERs are often unicast too, so a
 * third-party listener rarely sees them. Instead we ACT like a client: broadcast
 * a DISCOVER with a throwaway MAC + the broadcast flag, then collect every OFFER
 * that comes back. Each distinct server-id is a DHCP server answering on the LAN;
 * more than one ⇒ a rogue server is present. Read-only — we never send a REQUEST,
 * so no lease is taken.
 */
import dgram from 'node:dgram';
import type { DhcpProbeResult, DhcpServerSeen } from '@nexrelm/types';
import { decode, messageType, serverIdOpt, MSG } from './packet';

const MAGIC = Buffer.from([99, 130, 83, 99]);

let last: DhcpProbeResult | null = null;
export function lastProbe(): DhcpProbeResult | null {
  return last;
}

function buildDiscover(xid: number, mac: number[]): Buffer {
  const buf = Buffer.alloc(300);
  buf[0] = 1; // op = BOOTREQUEST
  buf[1] = 1; // htype ethernet
  buf[2] = 6; // hlen
  buf.writeUInt32BE(xid >>> 0, 4);
  buf.writeUInt16BE(0x8000, 10); // broadcast flag → offers come back broadcast so we see them
  for (let i = 0; i < 6; i++) buf[28 + i] = mac[i]!;
  MAGIC.copy(buf, 236);
  let i = 240;
  buf[i++] = 53; buf[i++] = 1; buf[i++] = MSG.DISCOVER; // option 53 = DHCPDISCOVER
  buf[i++] = 55; buf[i++] = 4; buf[i++] = 1; buf[i++] = 3; buf[i++] = 6; buf[i++] = 51; // param request: mask, router, dns, lease
  buf[i++] = 255; // end
  return buf;
}

function firstIp(o: Buffer | undefined): string | undefined {
  return o && o.length >= 4 ? `${o[0]}.${o[1]}.${o[2]}.${o[3]}` : undefined;
}

export function probeDhcpServers(timeoutMs = 4000): Promise<DhcpProbeResult> {
  const started = Date.now();
  return new Promise((resolve) => {
    const seen = new Map<string, DhcpServerSeen>();
    const xid = (Math.floor(Math.random() * 0xffffffff) >>> 0) || 0x4e58_0001;
    const mac = [0x02, 0x4e, 0x58, (xid >>> 16) & 0xff, (xid >>> 8) & 0xff, xid & 0xff]; // locally-administered probe MAC
    const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });

    const finish = (): void => {
      try {
        sock.close();
      } catch {
        /* already closed */
      }
      const servers = [...seen.values()];
      last = { ranAt: new Date(started).toISOString(), durationMs: Date.now() - started, servers, rogue: servers.length > 1 };
      resolve(last);
    };

    sock.on('message', (buf) => {
      const pkt = decode(buf);
      if (!pkt || pkt.xid !== xid) return; // only our own transaction
      const mt = messageType(pkt);
      if (mt !== MSG.OFFER && mt !== MSG.ACK) return;
      const server = serverIdOpt(pkt) || (pkt.siaddr !== '0.0.0.0' ? pkt.siaddr : '');
      if (!server) return;
      seen.set(server, { server, offered: pkt.yiaddr, router: firstIp(pkt.options.get(3)), dns: firstIp(pkt.options.get(6)) });
    });
    sock.on('error', finish);
    try {
      sock.bind(68, () => {
        try {
          sock.setBroadcast(true);
        } catch {
          /* ignore */
        }
        sock.send(buildDiscover(xid, mac), 67, '255.255.255.255', () => undefined);
      });
    } catch {
      finish();
      return;
    }
    setTimeout(finish, timeoutMs);
  });
}
