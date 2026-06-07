/**
 * BOOTP/DHCP packet codec (RFC 2131). Decodes incoming client packets and
 * encodes server replies. Options are kept as raw buffers keyed by code.
 */
import { bytesToIp, ipToBytes } from './options';

export const MSG = {
  DISCOVER: 1,
  OFFER: 2,
  REQUEST: 3,
  DECLINE: 4,
  ACK: 5,
  NAK: 6,
  RELEASE: 7,
  INFORM: 8,
} as const;

const MAGIC = Buffer.from([99, 130, 83, 99]);
const BROADCAST_FLAG = 0x8000;

export interface DhcpPacket {
  op: number;
  htype: number;
  hlen: number;
  hops: number;
  xid: number;
  secs: number;
  flags: number;
  ciaddr: string;
  yiaddr: string;
  siaddr: string;
  giaddr: string;
  mac: string; // chaddr[0..hlen] as aa:bb:cc:dd:ee:ff
  sname: string;
  file: string;
  options: Map<number, Buffer>;
}

function macFromChaddr(buf: Buffer, hlen: number): string {
  const n = Math.min(hlen || 6, 16);
  return Array.from(buf.subarray(0, n))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join(':');
}

export function macToBytes(mac: string): number[] {
  return mac.split(/[:-]/).map((h) => parseInt(h, 16) & 0xff);
}

export function decode(buf: Buffer): DhcpPacket | null {
  if (buf.length < 240 || !buf.subarray(236, 240).equals(MAGIC)) return null;
  const pkt: DhcpPacket = {
    op: buf[0]!,
    htype: buf[1]!,
    hlen: buf[2]!,
    hops: buf[3]!,
    xid: buf.readUInt32BE(4),
    secs: buf.readUInt16BE(8),
    flags: buf.readUInt16BE(10),
    ciaddr: bytesToIp(buf, 12),
    yiaddr: bytesToIp(buf, 16),
    siaddr: bytesToIp(buf, 20),
    giaddr: bytesToIp(buf, 24),
    mac: macFromChaddr(buf.subarray(28, 44), buf[2]!),
    sname: buf.subarray(44, 108).toString('ascii').replace(/\0.*$/, ''),
    file: buf.subarray(108, 236).toString('ascii').replace(/\0.*$/, ''),
    options: new Map(),
  };
  let i = 240;
  while (i < buf.length) {
    const code = buf[i++]!;
    if (code === 255) break; // end
    if (code === 0) continue; // pad
    const len = buf[i++]!;
    pkt.options.set(code, buf.subarray(i, i + len));
    i += len;
  }
  return pkt;
}

export function messageType(pkt: DhcpPacket): number | undefined {
  const o = pkt.options.get(53);
  return o ? o[0] : undefined;
}
export function requestedIp(pkt: DhcpPacket): string | undefined {
  const o = pkt.options.get(50);
  return o && o.length === 4 ? bytesToIp(o) : undefined;
}
export function serverIdOpt(pkt: DhcpPacket): string | undefined {
  const o = pkt.options.get(54);
  return o && o.length === 4 ? bytesToIp(o) : undefined;
}
export function hostname(pkt: DhcpPacket): string | undefined {
  const o = pkt.options.get(12);
  return o ? o.toString('ascii').replace(/\0.*$/, '') || undefined : undefined;
}
export function vendorClass(pkt: DhcpPacket): string | undefined {
  const o = pkt.options.get(60);
  return o ? o.toString('ascii') : undefined;
}
export function userClass(pkt: DhcpPacket): string | undefined {
  const o = pkt.options.get(77);
  return o ? o.toString('ascii').replace(/[^\x20-\x7e]/g, '') : undefined;
}
export function paramRequestList(pkt: DhcpPacket): number[] {
  const o = pkt.options.get(55);
  return o ? Array.from(o) : [];
}

export interface BuildReply {
  xid: number;
  flags: number;
  mac: string;
  yiaddr: string; // offered/assigned address (0.0.0.0 for INFORM/NAK)
  siaddr: string; // server address
  giaddr: string; // relay (echoed)
  options: Array<{ code: number; data: Buffer }>; // 53 (msg type) MUST be first by convention
}

/** Build a 300-byte (min) DHCP reply datagram. */
export function encodeReply(r: BuildReply): Buffer {
  const head = Buffer.alloc(240);
  head[0] = 2; // op = BOOTREPLY
  head[1] = 1; // htype ethernet
  head[2] = 6; // hlen
  head[3] = 0;
  head.writeUInt32BE(r.xid >>> 0, 4);
  head.writeUInt16BE(0, 8); // secs
  head.writeUInt16BE(r.flags & 0xffff, 10);
  // ciaddr stays 0
  ipToBytes(r.yiaddr).forEach((b, i) => (head[16 + i] = b));
  ipToBytes(r.siaddr).forEach((b, i) => (head[20 + i] = b));
  ipToBytes(r.giaddr).forEach((b, i) => (head[24 + i] = b));
  macToBytes(r.mac).forEach((b, i) => (head[28 + i] = b));
  MAGIC.copy(head, 236);

  const opts: number[] = [];
  for (const o of r.options) {
    opts.push(o.code, o.data.length, ...o.data);
  }
  opts.push(255); // end
  let body = Buffer.concat([head, Buffer.from(opts)]);
  if (body.length < 300) body = Buffer.concat([body, Buffer.alloc(300 - body.length)]); // pad to BOOTP min
  return body;
}

export const isBroadcast = (pkt: DhcpPacket): boolean => (pkt.flags & BROADCAST_FLAG) !== 0;
