/**
 * DHCP option catalog + value (de)serialization. The catalog drives the GUI's
 * option pickers; the encoders turn a stored string value into option bytes.
 */
import type { DhcpOptionDef, DhcpOptionValue } from '@nexrelm/types';

export const OPTION_CATALOG: DhcpOptionDef[] = [
  { code: 1, name: 'Subnet Mask', kind: 'ip', common: true },
  { code: 3, name: 'Router (Default Gateway)', kind: 'ips', common: true },
  { code: 6, name: 'DNS Servers', kind: 'ips', common: true },
  { code: 15, name: 'DNS Domain Name', kind: 'string', common: true },
  { code: 28, name: 'Broadcast Address', kind: 'ip', common: false },
  { code: 42, name: 'NTP Servers', kind: 'ips', common: true },
  { code: 44, name: 'WINS/NBNS Servers', kind: 'ips', common: true },
  { code: 46, name: 'WINS/NBT Node Type', kind: 'number', common: true, hint: '1=B 2=P 4=M 8=H' },
  { code: 47, name: 'NetBIOS Scope ID', kind: 'string', common: false },
  { code: 51, name: 'Lease Time (s)', kind: 'number', common: false, hint: 'set on the scope instead' },
  { code: 66, name: 'TFTP Server (Boot Host)', kind: 'string', common: false },
  { code: 67, name: 'Bootfile Name', kind: 'string', common: false },
  { code: 119, name: 'Domain Search List', kind: 'string', common: false },
  { code: 121, name: 'Classless Static Route', kind: 'hex', common: false },
  { code: 252, name: 'WPAD / Proxy URL', kind: 'string', common: false },
];

const KIND_BY_CODE = new Map(OPTION_CATALOG.map((o) => [o.code, o.kind] as const));

export function optionKind(code: number): DhcpOptionDef['kind'] {
  return KIND_BY_CODE.get(code) ?? 'string';
}

export function ipToBytes(ip: string): number[] {
  return ip.trim().split('.').map((o) => Number(o) & 0xff);
}
export function bytesToIp(b: Buffer, off = 0): string {
  return `${b[off]}.${b[off + 1]}.${b[off + 2]}.${b[off + 3]}`;
}

/** Encode a stored option value into its on-wire bytes. */
export function encodeOptionValue(opt: DhcpOptionValue): Buffer {
  const kind = optionKind(opt.code);
  const v = opt.value?.trim() ?? '';
  switch (kind) {
    case 'ip':
      return Buffer.from(ipToBytes(v));
    case 'ips':
      return Buffer.from(v.split(',').flatMap((ip) => ipToBytes(ip)));
    case 'number': {
      const n = Number(v) || 0;
      // node type (46) is one byte; everything else 4 bytes
      return opt.code === 46 ? Buffer.from([n & 0xff]) : Buffer.from([(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]);
    }
    case 'hex':
      return Buffer.from(v.replace(/[^0-9a-f]/gi, ''), 'hex');
    case 'bool':
      return Buffer.from([v === 'true' || v === '1' ? 1 : 0]);
    case 'string':
    default:
      return Buffer.from(v, 'ascii');
  }
}

/** Decode option bytes back to a display string (best-effort, by catalog kind). */
export function decodeOptionValue(code: number, data: Buffer): string {
  const kind = optionKind(code);
  switch (kind) {
    case 'ip':
      return bytesToIp(data);
    case 'ips': {
      const ips: string[] = [];
      for (let i = 0; i + 4 <= data.length; i += 4) ips.push(bytesToIp(data, i));
      return ips.join(',');
    }
    case 'number':
      return data.length === 1 ? String(data[0]) : String(data.readUInt32BE(0));
    case 'hex':
      return data.toString('hex');
    default:
      return data.toString('ascii');
  }
}

/** Merge option lists with later sources overriding earlier ones (by code). */
export function mergeOptions(...lists: DhcpOptionValue[][]): DhcpOptionValue[] {
  const byCode = new Map<number, DhcpOptionValue>();
  for (const list of lists) for (const o of list) byCode.set(o.code, o);
  return [...byCode.values()];
}
