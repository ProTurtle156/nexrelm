/**
 * Passive promiscuous sniffer — greps the network it sits on for flow + L2 intel
 * far beyond DNS. Spawns tcpdump (puts the NIC in promiscuous mode, -e for MAC
 * addresses, filter "ip or arp") and parses headers only:
 *   • IP flows  → src/dst/port/proto + packet counts (top talkers, top flows)
 *   • ARP / L2  → ip↔mac bindings (feeds ARP/MAC-spoof detection)
 *   • DHCP      → which hosts answer as DHCP servers (rogue-DHCP detection)
 *   • LLMNR/NBT-NS responses → who answers name queries (Responder/poisoning)
 * Read-only and OFF by default. Needs CAP_NET_RAW on tcpdump (setcap). With the
 * inline gateway on, it also sees every forwarded packet of the piloted device.
 */
import { spawn, execFile, type ChildProcess } from 'node:child_process';
import { pushLog } from '../core/logbus';

interface Flow {
  src: string;
  dst: string;
  dport: number;
  proto: string;
  packets: number;
  bytes: number;
}
interface Talker {
  ip: string;
  packets: number;
}

let proc: ChildProcess | null = null;
let state: { running: boolean; iface: string; startedAt?: string; packets: number; error?: string } = { running: false, iface: '', packets: 0 };
const talkers = new Map<string, number>();
const rate = new Map<number, number>(); // unix-second → packets seen (live-traffic rate graph)
const flows = new Map<string, Flow>();
const seen = new Set<string>();
// L2 / service intel
const bindings = new Map<string, Map<string, number>>(); // ip → (mac → count)
const dhcp = new Map<string, { mac?: string; count: number }>(); // dhcp-server ip → seen count
const nameResp = new Map<string, { llmnr: Set<string>; nbns: Set<string>; count: number }>(); // responder ip → requesters
const MAC = '([0-9a-f]{2}(?::[0-9a-f]{2}){5})';
const PRIVATE = /^(10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/;
const MCAST_BCAST = /^(224\.|225\.|226\.|227\.|22[89]\.|23\d\.|255\.|0\.)/; // multicast / broadcast / unspecified

export function sniffedHosts(): string[] {
  return [...seen];
}

export function snifferActive(): boolean {
  return state.running;
}

export interface SniffFlow {
  src: string;
  dst: string;
  dport: number;
  proto: string;
  packets: number;
  bytes: number;
}
export function sniffFlows(): SniffFlow[] {
  return [...flows.values()];
}
export function sniffTalkers(): Array<{ ip: string; packets: number }> {
  return [...talkers.entries()].map(([ip, packets]) => ({ ip, packets }));
}

/** ip↔mac bindings observed on the wire — fuel for ARP/MAC-spoof detection. */
export function sniffArp(): Array<{ ip: string; macs: Array<{ mac: string; count: number }> }> {
  return [...bindings.entries()].map(([ip, m]) => ({ ip, macs: [...m.entries()].map(([mac, count]) => ({ mac, count })) }));
}
/** which hosts have been seen answering as a DHCP server (src udp/67). */
export function sniffDhcpServers(): Array<{ ip: string; mac?: string; count: number }> {
  return [...dhcp.entries()].map(([ip, v]) => ({ ip, mac: v.mac, count: v.count }));
}
/** hosts answering LLMNR/NBT-NS name queries to unicast requesters (Responder-style). */
export function sniffNameResponders(): Array<{ ip: string; llmnr: number; nbns: number; requesters: number; count: number }> {
  return [...nameResp.entries()].map(([ip, v]) => ({ ip, llmnr: v.llmnr.size, nbns: v.nbns.size, requesters: new Set([...v.llmnr, ...v.nbns]).size, count: v.count }));
}

export function snifferState(): {
  running: boolean;
  iface: string;
  startedAt?: string;
  packets: number;
  error?: string;
  topTalkers: Talker[];
  topFlows: Flow[];
} {
  const topTalkers = [...talkers.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([ip, packets]) => ({ ip, packets }));
  const topFlows = [...flows.values()].sort((a, b) => b.packets - a.packets).slice(0, 15);
  return { ...state, topTalkers, topFlows };
}

function splitHostPort(s: string): { ip: string; port: number } {
  const i = s.lastIndexOf('.');
  const port = Number(s.slice(i + 1));
  return Number.isFinite(port) && i > 0 ? { ip: s.slice(0, i), port } : { ip: s, port: 0 };
}

function bind(ip: string, mac: string): void {
  if (!PRIVATE.test(ip) || mac === 'ff:ff:ff:ff:ff:ff' || mac === '00:00:00:00:00:00') return;
  const m = bindings.get(ip) ?? bindings.set(ip, new Map()).get(ip)!;
  m.set(mac, (m.get(mac) ?? 0) + 1);
}

const arpRe = new RegExp(`Reply (\\d+\\.\\d+\\.\\d+\\.\\d+) is-at ${MAC}`, 'i');
const ethRe = new RegExp(`^${MAC} > ${MAC}, ethertype (\\w+)`, 'i');
const ipRe = /(\d+\.\d+\.\d+\.\d+)\.(\d+) > (\d+\.\d+\.\d+\.\d+)\.(\d+): (\w+)/;

function parse(chunk: string): void {
  const before = state.packets;
  for (const line of chunk.split('\n')) {
    if (!line) continue;
    const eth = line.match(ethRe);
    const smac = eth?.[1]?.toLowerCase();
    const ethertype = eth?.[3]?.toUpperCase();

    // ── ARP: ip↔mac binding from replies ("is-at") and requests ("tell") ──
    if (ethertype === 'ARP') {
      const ar = line.match(arpRe);
      if (ar) {
        bind(ar[1]!, ar[2]!.toLowerCase()); // "Reply <ip> is-at <mac>"
      } else {
        const req = line.match(/\btell (\d+\.\d+\.\d+\.\d+)/i); // "Request who-has <t> tell <sender>"
        if (req && smac) bind(req[1]!, smac); // sender IP ↔ the frame's source MAC
      }
      state.packets++;
      continue;
    }

    // ── IP packet ──
    const m = line.match(ipRe);
    if (!m) {
      // line without ports (icmp etc.) — still count a packet if it's an IP line
      if (ethertype === 'IPV4') state.packets++;
      continue;
    }
    state.packets++;
    const a = { ip: m[1]!, port: Number(m[2]) };
    const b = { ip: m[3]!, port: Number(m[4]) };
    const proto = m[5]!.toLowerCase();
    const len = Number(line.match(/, length (\d+):/)?.[1] ?? 0); // on-wire frame length (bytes)
    if (smac) bind(a.ip, smac); // L2 binding from the live frame
    talkers.set(a.ip, (talkers.get(a.ip) ?? 0) + 1);
    for (const ip of [a.ip, b.ip]) if (PRIVATE.test(ip)) seen.add(ip);
    const key = `${a.ip}>${b.ip}:${b.port}/${proto}`;
    const f = flows.get(key) ?? { src: a.ip, dst: b.ip, dport: b.port, proto, packets: 0, bytes: 0 };
    f.packets++;
    f.bytes += len;
    flows.set(key, f);

    // ── DHCP server: a host sending FROM udp/67 ──
    if (a.port === 67) {
      const d = dhcp.get(a.ip) ?? { count: 0 };
      d.count++;
      if (smac) d.mac = smac;
      dhcp.set(a.ip, d);
    }
    // ── LLMNR(5355)/NBT-NS(137) RESPONSE: src on that port to a UNICAST requester ──
    if ((a.port === 5355 || a.port === 137) && !MCAST_BCAST.test(b.ip)) {
      const r = nameResp.get(a.ip) ?? { llmnr: new Set<string>(), nbns: new Set<string>(), count: 0 };
      r.count++;
      (a.port === 5355 ? r.llmnr : r.nbns).add(b.ip);
      nameResp.set(a.ip, r);
    }
  }
  // per-second packet rate for the live-traffic graph
  const delta = state.packets - before;
  if (delta > 0) {
    const sec = Math.floor(Date.now() / 1000);
    rate.set(sec, (rate.get(sec) ?? 0) + delta);
    if (rate.size > 1200) {
      const keepAfter = sec - 900;
      for (const k of rate.keys()) if (k < keepAfter) rate.delete(k);
    }
  }
  // bound memory
  if (talkers.size > 400) for (const k of [...talkers.keys()].slice(0, 100)) talkers.delete(k);
  if (flows.size > 600) for (const k of [...flows.keys()].slice(0, 200)) flows.delete(k);
  if (bindings.size > 400) for (const k of [...bindings.keys()].slice(0, 100)) bindings.delete(k);
  if (nameResp.size > 200) for (const k of [...nameResp.keys()].slice(0, 50)) nameResp.delete(k);
}

/** Packets per time-bucket aligned to a window — feeds the live-traffic graph. */
export function sniffRateBuckets(cutoff: number, size: number, buckets: number): number[] {
  const out = new Array<number>(buckets).fill(0);
  for (const [sec, cnt] of rate) {
    const idx = Math.floor((sec * 1000 - cutoff) / size);
    if (idx >= 0 && idx < buckets) out[idx]! += cnt;
  }
  return out;
}
/** Total packets captured in the last `windowSec` seconds. */
export function sniffPacketsInWindow(windowSec: number): number {
  const after = Math.floor(Date.now() / 1000) - windowSec;
  let n = 0;
  for (const [sec, cnt] of rate) if (sec >= after) n += cnt;
  return n;
}

function pickIface(): Promise<string> {
  return new Promise((resolve) => execFile('ip', ['route', 'show', 'default'], { timeout: 3000 }, (_e, out) => resolve(out.match(/\bdev\s+(\S+)/)?.[1] ?? 'any')));
}

export async function startSniffer(): Promise<ReturnType<typeof snifferState>> {
  if (state.running) return snifferState();
  const iface = await pickIface();
  state = { running: true, iface, startedAt: new Date().toISOString(), packets: 0, error: undefined };
  // -e link-layer (MAC), -nn no resolve, -l line-buffered, -q quiet, -t no timestamp, snaplen 160, capture IP + ARP
  proc = spawn('tcpdump', ['-i', iface, '-e', '-nn', '-l', '-q', '-t', '-s', '160', 'ip', 'or', 'arp'], { timeout: 0 });
  proc.stdout?.on('data', (d: Buffer) => parse(d.toString()));
  proc.stderr?.on('data', (d: Buffer) => {
    const s = d.toString();
    if (/permission denied|operation not permitted|couldn't|no suitable device/i.test(s)) state.error = 'tcpdump lacks capture capability — run setcap on tcpdump (or it needs root).';
  });
  proc.on('error', (e) => {
    state.error = /ENOENT/.test(e.message) ? 'tcpdump not installed' : e.message;
    state.running = false;
  });
  proc.on('close', () => {
    state.running = false;
  });
  pushLog('security', 'info', `packet capture started on ${iface} (promiscuous)`);
  return snifferState();
}

export function stopSniffer(): ReturnType<typeof snifferState> {
  if (proc) {
    proc.kill('SIGTERM');
    proc = null;
  }
  state.running = false;
  pushLog('security', 'info', 'packet capture stopped');
  return snifferState();
}
