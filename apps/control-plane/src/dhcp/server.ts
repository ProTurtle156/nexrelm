/**
 * The DHCP server: binds UDP :67 and serves leases for the configured scopes.
 * OFF by default — only started when settings.enabled is true (it conflicts with
 * the router's DHCP). Replies are built from merged server/scope/reservation/
 * policy options, with the `useOwnDns` switch forcing option 006 to this server.
 */
import dgram from 'node:dgram';
import type { DhcpScopeDef, DhcpServerSettings, DhcpServerStatus } from '@nexrelm/types';
import {
  filtersAll,
  getFilterSettings,
  getServerOptions,
  getServerSettings,
  intToIp,
  ipToInt,
  leaseByMac,
  leaseDelete,
  leaseSetState,
  leaseUpsert,
  policiesAll,
  reservationByMac,
  scopesAll,
} from './db';
import { encodeOptionValue, ipToBytes, mergeOptions } from './options';
import { decode, encodeReply, hostname, isBroadcast, messageType, MSG, requestedIp, serverIdOpt, userClass, vendorClass, type DhcpPacket } from './packet';
import { allocate, canAssign } from './allocator';
import { pushLog } from '../core/logbus';

export interface DhcpCounters {
  discovers: number;
  offers: number;
  requests: number;
  acks: number;
  naks: number;
  declines: number;
  releases: number;
  informs: number;
}

const inSubnet = (ip: string, subnet: string, mask: string): boolean => (ipToInt(ip) & ipToInt(mask)) >>> 0 === ((ipToInt(subnet) & ipToInt(mask)) >>> 0);
const u32 = (n: number): Buffer => Buffer.from([(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]);
const iso = (ms: number): string => new Date(ms).toISOString();
const rid = (p: string): string => `${p}_${Math.abs((Date.now() ^ (Math.random() * 1e9)) | 0).toString(36)}`;

export class DhcpServer {
  private sock: dgram.Socket | null = null;
  private settings!: DhcpServerSettings;
  private startedAt = 0;
  private bound = '';
  private message: string | undefined;
  readonly counters: DhcpCounters = { discovers: 0, offers: 0, requests: 0, acks: 0, naks: 0, declines: 0, releases: 0, informs: 0 };

  async start(settings: DhcpServerSettings): Promise<DhcpServerStatus> {
    this.settings = settings;
    await this.stop();
    try {
      const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
      await new Promise<void>((resolve, reject) => {
        sock.once('error', reject);
        // bind 0.0.0.0:67 to receive broadcast DISCOVERs; we filter by scope subnet in software
        sock.bind(settings.port || 67, () => {
          sock.removeAllListeners('error');
          sock.setBroadcast(true);
          resolve();
        });
      });
      this.sock = sock;
      this.bound = `0.0.0.0:${settings.port || 67}`;
      this.message = undefined;
      sock.on('message', (buf, rinfo) => this.handle(buf, rinfo));
      sock.on('error', () => undefined);
    } catch (e) {
      this.message = `bind :67 failed (${(e as NodeJS.ErrnoException).code ?? 'error'}) — is another DHCP server (libvirt/dnsmasq) running?`;
      this.bound = 'error';
    }
    this.startedAt = Date.now();
    return this.status();
  }

  async stop(): Promise<void> {
    if (this.sock) {
      await new Promise<void>((r) => this.sock!.close(() => r()));
      this.sock = null;
    }
    this.bound = ''; // clear so status reflects 'disabled', not a stale bind address
  }

  status(): DhcpServerStatus {
    // read the PERSISTED enabled flag — this.settings is only refreshed on start(),
    // so it goes stale after a stop and would wrongly report 'starting…' forever.
    const enabled = getServerSettings().enabled;
    return {
      running: !!this.sock,
      enabled,
      bind: this.bound || (enabled ? 'starting' : 'disabled'),
      message: this.message,
      startedAt: this.startedAt ? new Date(this.startedAt).toISOString() : undefined,
    };
  }

  // ── scope + filter selection ───────────────────────────────────────────────────
  private pickScope(pkt: DhcpPacket): DhcpScopeDef | undefined {
    const scopes = scopesAll().filter((s) => s.state === 'active');
    if (pkt.giaddr && pkt.giaddr !== '0.0.0.0') return scopes.find((s) => inSubnet(pkt.giaddr, s.subnet, s.mask));
    return scopes.find((s) => inSubnet(this.settings.serverIp, s.subnet, s.mask)) ?? scopes[0];
  }

  private filterAllows(mac: string): boolean {
    const fs = getFilterSettings();
    if (!fs.allowEnabled && !fs.denyEnabled) return true;
    const m = mac.toLowerCase();
    const list = filtersAll();
    const matches = (f: { mac: string }): boolean => m === f.mac || m.startsWith(f.mac.toLowerCase());
    if (fs.denyEnabled && list.some((f) => f.type === 'deny' && matches(f))) return false;
    if (fs.allowEnabled && !list.some((f) => f.type === 'allow' && matches(f))) return false;
    return true;
  }

  // ── option assembly ───────────────────────────────────────────────────────────
  private buildOptions(msgType: number, scope: DhcpScopeDef, mac: string, vendor?: string, user?: string): Array<{ code: number; data: Buffer }> {
    const s = this.settings;
    const res = reservationByMac(mac);
    const matchedPolicies = policiesAll(scope.id).filter((p) => p.enabled && this.policyMatches(p, mac, vendor, user));
    const merged = mergeOptions(getServerOptions(), scope.options, res?.options ?? [], ...matchedPolicies.map((p) => p.options));

    const out: Array<{ code: number; data: Buffer }> = [];
    out.push({ code: 53, data: Buffer.from([msgType]) });
    out.push({ code: 54, data: Buffer.from(ipToBytes(s.serverIp)) });
    if (msgType !== MSG.INFORM) {
      out.push({ code: 51, data: u32(scope.leaseSeconds) });
      out.push({ code: 1, data: Buffer.from(ipToBytes(scope.mask)) });
    }
    // DNS (option 6): per-scope mode, falling back to the server-wide default
    const dnsValue =
      scope.dnsMode === 'nexrelm'
        ? s.serverIp
        : scope.dnsMode === 'custom'
          ? scope.dnsServers.join(',')
          : s.useOwnDns
            ? s.serverIp
            : merged.find((o) => o.code === 6)?.value || s.customDns.join(',');
    if (dnsValue) out.push({ code: 6, data: encodeOptionValue({ code: 6, value: dnsValue }) });
    // domain (option 15)
    const domain = merged.find((o) => o.code === 15)?.value || s.domainName;
    if (domain) out.push({ code: 15, data: Buffer.from(domain, 'ascii') });
    // remaining configured options
    const computed = new Set([1, 6, 15, 51, 53, 54]);
    for (const o of merged) {
      if (computed.has(o.code) || !o.value) continue;
      out.push({ code: o.code, data: encodeOptionValue(o) });
    }
    return out;
  }

  private policyMatches(p: { conditionType: string; conditionValue: string }, mac: string, vendor?: string, user?: string): boolean {
    const v = p.conditionValue.toLowerCase();
    if (p.conditionType === 'mac') return mac.toLowerCase().startsWith(v) || mac.toLowerCase() === v;
    if (p.conditionType === 'vendor') return (vendor ?? '').toLowerCase().includes(v);
    if (p.conditionType === 'user') return (user ?? '').toLowerCase().includes(v);
    return false;
  }

  private reply(buf: Buffer, pkt: DhcpPacket, forceBroadcast = false): void {
    if (!this.sock) return;
    if (pkt.giaddr && pkt.giaddr !== '0.0.0.0') this.sock.send(buf, 67, pkt.giaddr);
    else if (forceBroadcast || isBroadcast(pkt) || pkt.ciaddr === '0.0.0.0') this.sock.send(buf, 68, '255.255.255.255');
    else this.sock.send(buf, 68, '255.255.255.255'); // simplest reliable path on a LAN
  }

  // ── the protocol ──────────────────────────────────────────────────────────────
  private handle(buf: Buffer, _rinfo: dgram.RemoteInfo): void {
    const pkt = decode(buf);
    if (!pkt || pkt.op !== 1) return; // only BOOTREQUEST
    const mt = messageType(pkt);
    const mac = pkt.mac;
    if (!this.filterAllows(mac)) return;
    const scope = this.pickScope(pkt);
    if (!scope) return;
    const reqIp = requestedIp(pkt);
    const host = hostname(pkt);
    const vendor = vendorClass(pkt);
    const user = userClass(pkt);
    const now = Date.now();
    const leaseMs = scope.leaseSeconds * 1000;

    switch (mt) {
      case MSG.DISCOVER: {
        this.counters.discovers++;
        const offer = allocate(scope, mac, reqIp);
        if (!offer) return; // pool exhausted
        leaseUpsert({ id: rid('lease'), scopeId: scope.id, ip: offer, mac, hostname: host, vendor, state: 'offered', startedAt: iso(now), expiresAt: iso(now + leaseMs), clientId: undefined });
        this.reply(encodeReply({ xid: pkt.xid, flags: pkt.flags, mac, yiaddr: offer, siaddr: this.settings.serverIp, giaddr: pkt.giaddr, options: this.buildOptions(MSG.OFFER, scope, mac, vendor, user) }), pkt);
        this.counters.offers++;
        break;
      }
      case MSG.REQUEST: {
        this.counters.requests++;
        const sid = serverIdOpt(pkt);
        if (sid && sid !== this.settings.serverIp) {
          const l = leaseByMac(mac, scope.id);
          if (l && l.state === 'offered') leaseDelete(l.ip); // client chose another server
          return;
        }
        const wanted = reqIp ?? (pkt.ciaddr !== '0.0.0.0' ? pkt.ciaddr : undefined);
        if (wanted && canAssign(scope, mac, wanted)) {
          leaseUpsert({ id: rid('lease'), scopeId: scope.id, ip: wanted, mac, hostname: host, vendor, state: 'active', startedAt: iso(now), expiresAt: iso(now + leaseMs), clientId: undefined });
          this.reply(encodeReply({ xid: pkt.xid, flags: pkt.flags, mac, yiaddr: wanted, siaddr: this.settings.serverIp, giaddr: pkt.giaddr, options: this.buildOptions(MSG.ACK, scope, mac, vendor, user) }), pkt);
          this.counters.acks++;
          pushLog('dhcp', 'info', `DHCPACK ${wanted} → ${mac}${host ? ` (${host})` : ''}`);
        } else {
          this.reply(encodeReply({ xid: pkt.xid, flags: pkt.flags, mac, yiaddr: '0.0.0.0', siaddr: '0.0.0.0', giaddr: pkt.giaddr, options: [{ code: 53, data: Buffer.from([MSG.NAK]) }, { code: 54, data: Buffer.from(ipToBytes(this.settings.serverIp)) }] }), pkt, true);
          this.counters.naks++;
        }
        break;
      }
      case MSG.RELEASE: {
        this.counters.releases++;
        if (pkt.ciaddr !== '0.0.0.0') leaseSetState(pkt.ciaddr, 'released');
        break;
      }
      case MSG.DECLINE: {
        this.counters.declines++;
        if (reqIp) leaseSetState(reqIp, 'declined');
        break;
      }
      case MSG.INFORM: {
        this.counters.informs++;
        this.reply(encodeReply({ xid: pkt.xid, flags: pkt.flags, mac, yiaddr: '0.0.0.0', siaddr: this.settings.serverIp, giaddr: pkt.giaddr, options: this.buildOptions(MSG.ACK, scope, mac, vendor, user) }), pkt);
        break;
      }
      default:
        break;
    }
  }
}

export const dhcpServer = new DhcpServer();
