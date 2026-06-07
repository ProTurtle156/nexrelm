/**
 * The resolver: a real forwarding DNS server. Decodes each query, decides
 * allow/block/forward (group-scoped), relays the raw datagram to the chosen
 * upstream for full fidelity, null-blocks listed domains, caches by TTL,
 * rate-limits per client, and logs every query. UDP + TCP.
 */
import dgram from 'node:dgram';
import net from 'node:net';
import dnsPacket from 'dns-packet';
import type { BlockingState, CondForwardRule, DnsResolverSettings, DnsResolverStatus, QueryStatus } from '@nexrelm/types';
import { clientTouch, db, getBlocking, groupsForClientIp, queryInsert, domainHit, queriesPrune } from './db';
import { lookup } from './lists';
import { enrichClient } from './clients';
import { localAnswer } from './hosts';
import { sinkholeMatch, noteSinkholeBlock } from './sinkhole';
import { pushLog } from '../core/logbus';

/** Is an IPv4 address inside a CIDR like 192.168.1.0/24? */
function ipv4InCidr(ip: string, cidr: string): boolean {
  const [netAddr, bitsRaw] = cidr.split('/');
  const bits = Number(bitsRaw ?? 32);
  const toInt = (a: string): number => a.split('.').reduce((acc, o) => (acc << 8) + (Number(o) & 255), 0) >>> 0;
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(ip) || !netAddr || !/^\d+\.\d+\.\d+\.\d+$/.test(netAddr)) return false;
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return (toInt(ip) & mask) === (toInt(netAddr) & mask);
}

const PRIVATE_RANGES = ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', '127.0.0.0/8', '169.254.0.0/16'];
const isLocalClient = (ip: string): boolean =>
  ip === '::1' || ip.startsWith('fe80') || PRIVATE_RANGES.some((r) => ipv4InCidr(ip.replace(/^::ffff:/, ''), r));

/** Reverse-DNS name → the IPv4 it asks about (or null). */
function reverseIp(name: string): string | null {
  const m = name.toLowerCase().match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)\.in-addr\.arpa\.?$/);
  return m ? `${m[4]}.${m[3]}.${m[2]}.${m[1]}` : null;
}

interface Upstream {
  host: string;
  port: number;
  healthy: boolean;
  latencyMs: number;
}

interface CacheEntry {
  buf: Buffer; // raw upstream response
  expiry: number;
}

function parseUpstreams(list: string[]): Upstream[] {
  return list
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const [host, port] = s.split('#');
      return { host: host!, port: Number(port ?? 53), healthy: true, latencyMs: 0 };
    });
}

const PRIVATE_REV = /\.(in-addr|ip6)\.arpa$/i;
const isPrivateReverse = (name: string): boolean =>
  /(^|\.)(10|168\.192|1[6-9]\.172|2[0-9]\.172|3[01]\.172)\..*\.in-addr\.arpa$/i.test(name) ||
  /\.in-addr\.arpa$/i.test(name); // conservative: treat all reverse as candidate when the flag is on

export class Resolver {
  private udp: dgram.Socket | null = null;
  private udp6: dgram.Socket | null = null;
  private tcp: net.Server | null = null;
  private upstreams: Upstream[] = [];
  private cache = new Map<string, CacheEntry>();
  private rate = new Map<string, { n: number; start: number }>();
  private settings!: DnsResolverSettings;
  private startedAt = 0;
  private bound = { address: '', port: 0, privileged: false, message: '' as string | undefined };
  private rr = 0;
  private pruneTick = 0;
  private blocking: BlockingState = { enabled: true, disabledUntil: null };

  configure(settings: DnsResolverSettings): void {
    this.settings = settings;
    this.upstreams = parseUpstreams(settings.upstreams);
    this.blocking = getBlocking();
    this.cache.clear();
  }

  setBlocking(state: BlockingState): void {
    this.blocking = state;
  }

  /** True when blocking should be enforced right now (auto-resumes timed pauses). */
  private blockingActive(): boolean {
    if (this.blocking.enabled) return true;
    if (this.blocking.disabledUntil && new Date(this.blocking.disabledUntil).getTime() <= Date.now()) {
      this.blocking = { enabled: true, disabledUntil: null };
      return true;
    }
    return false;
  }

  /** A conditional-forwarding target for this query, if a rule matches. */
  private condTarget(name: string, type: string): { host: string; port: number } | null {
    for (const rule of this.settings.condForwarding ?? []) {
      if (!rule.enabled) continue;
      const [host, port] = rule.target.split('#');
      const up = { host: host!, port: Number(port ?? 53) };
      if (type === 'PTR') {
        const ip = reverseIp(name);
        if (ip && ipv4InCidr(ip, rule.cidr)) return up;
      }
      if (rule.domain && (name.toLowerCase() === rule.domain.toLowerCase() || name.toLowerCase().endsWith('.' + rule.domain.toLowerCase()))) {
        return up;
      }
    }
    return null;
  }

  /** Bind UDP + TCP, falling back from a privileged port to :5335 if needed. */
  async start(settings: DnsResolverSettings): Promise<DnsResolverStatus> {
    this.configure(settings);
    await this.stop();

    const wantAddr = settings.bindAddress || '0.0.0.0';
    const wantPort = settings.port || 53;

    const tryBind = (addr: string, port: number): Promise<void> =>
      new Promise((resolve, reject) => {
        const sock = dgram.createSocket('udp4');
        sock.once('error', (err) => {
          sock.close();
          reject(err);
        });
        sock.bind(port, addr === '0.0.0.0' ? undefined : addr, () => {
          sock.removeAllListeners('error');
          this.udp = sock;
          resolve();
        });
      });

    let addr = wantAddr;
    let port = wantPort;
    let message: string | undefined;
    try {
      await tryBind(addr, port);
    } catch (e1) {
      const code = (e1 as NodeJS.ErrnoException).code;
      const fbPort = port < 1024 ? 5335 : port + 1;
      message = `:${port} on ${addr} failed (${code}); fell back to :${fbPort}` + (port < 1024 ? ' — grant CAP_NET_BIND_SERVICE for :53' : '');
      try {
        await tryBind(addr, fbPort);
        port = fbPort;
      } catch {
        await tryBind('0.0.0.0', fbPort);
        addr = '0.0.0.0';
        port = fbPort;
        message = `bound 0.0.0.0:${fbPort} (requested ${wantAddr}:${wantPort} unavailable: ${code})`;
      }
    }

    this.udp!.on('message', (msg, rinfo) => {
      this.handle(msg, rinfo.address, (buf) => this.udp?.send(buf, rinfo.port, rinfo.address));
    });
    this.udp!.on('error', () => undefined);

    // TCP listener (length-prefixed framing) on the same addr:port
    try {
      this.tcp = net.createServer((sock) => this.handleTcp(sock));
      await new Promise<void>((resolve) => this.tcp!.listen(port, addr === '0.0.0.0' ? undefined : addr, resolve));
    } catch {
      this.tcp = null; // TCP is best-effort; UDP is the primary path
    }

    // IPv6 UDP listener (best-effort; a v6 bind failure never blocks the v4 path)
    try {
      const sock6 = dgram.createSocket({ type: 'udp6', ipv6Only: true });
      await new Promise<void>((resolve, reject) => {
        sock6.once('error', reject);
        sock6.bind(port, '::', () => {
          sock6.removeAllListeners('error');
          resolve();
        });
      });
      this.udp6 = sock6;
      sock6.on('message', (m, rinfo) => this.handle(m, rinfo.address.replace(/^::ffff:/, ''), (buf) => this.udp6?.send(buf, rinfo.port, rinfo.address)));
      sock6.on('error', () => undefined);
    } catch {
      this.udp6 = null;
    }

    this.startedAt = Date.now();
    this.bound = { address: addr, port, privileged: port < 1024, message };
    return this.status();
  }

  async stop(): Promise<void> {
    if (this.udp) {
      await new Promise<void>((r) => this.udp!.close(() => r()));
      this.udp = null;
    }
    if (this.udp6) {
      await new Promise<void>((r) => this.udp6!.close(() => r()));
      this.udp6 = null;
    }
    if (this.tcp) {
      await new Promise<void>((r) => this.tcp!.close(() => r()));
      this.tcp = null;
    }
  }

  status(): DnsResolverStatus {
    return {
      running: !!this.udp,
      bind: this.bound.address,
      port: this.bound.port,
      privileged: this.bound.privileged,
      startedAt: this.startedAt ? new Date(this.startedAt).toISOString() : undefined,
      message: this.bound.message,
      upstreams: this.upstreams.map((u) => ({ addr: u.port === 53 ? u.host : `${u.host}#${u.port}`, healthy: u.healthy, latencyMs: u.latencyMs })),
      blocking: getBlocking(),
    };
  }

  // ── TCP framing ────────────────────────────────────────────────────────────
  private handleTcp(sock: net.Socket): void {
    let buf = Buffer.alloc(0);
    sock.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      while (buf.length >= 2) {
        const len = buf.readUInt16BE(0);
        if (buf.length < 2 + len) break;
        const msg = buf.subarray(2, 2 + len);
        buf = buf.subarray(2 + len);
        this.handle(Buffer.from(msg), sock.remoteAddress?.replace(/^::ffff:/, '') ?? '0.0.0.0', (out) => {
          const framed = Buffer.alloc(2 + out.length);
          framed.writeUInt16BE(out.length, 0);
          out.copy(framed, 2);
          sock.write(framed);
        });
      }
    });
    sock.on('error', () => sock.destroy());
    sock.setTimeout(10_000, () => sock.destroy());
  }

  // ── core query handler ───────────────────────────────────────────────────────
  private handle(msg: Buffer, clientIp: string, respond: (buf: Buffer) => void): void {
    const t0 = Date.now();
    let decoded: dnsPacket.Packet;
    try {
      decoded = dnsPacket.decode(msg);
    } catch {
      return; // malformed — drop
    }
    const q = decoded.questions?.[0];
    if (!q) return;
    const name = String(q.name);
    const type = String(q.type);

    // interface mode: ignore non-local clients when "allow only local requests"
    if (this.settings.listenMode === 'local' && !isLocalClient(clientIp)) return;

    // rate limiting
    if (this.isRateLimited(clientIp)) {
      respond(this.refuse(decoded));
      this.log({ ts: new Date().toISOString(), client: clientIp, domain: name, type, status: 'refused', replyMs: 0 });
      return;
    }

    // client enrichment + accounting
    const enr = enrichClient(clientIp, (lateName) => {
      db.prepare('UPDATE clients SET name = COALESCE(name, ?) WHERE ip = ?').run(lateName, clientIp);
    });
    clientTouch(clientIp, enr);
    const groups = groupsForClientIp(clientIp);

    // local names from /etc/hosts — answered authoritatively, never forwarded
    const local = localAnswer(name, type);
    if (local) {
      respond(this.localA(decoded, local.type, local.value));
      this.log({ ts: new Date().toISOString(), client: clientIp, clientName: enr.name, domain: name, type, status: 'local', replyMs: Date.now() - t0, reply: local.value });
      return;
    }

    // conditional forwarding — send matching reverse/local-domain queries to the
    // configured rev server (usually the router) so device names resolve.
    const cond = this.condTarget(name, type);
    if (cond) {
      void this.forwardVia(cond, msg).then((res) => {
        respond(res ?? this.servfail(decoded));
        this.log({ ts: new Date().toISOString(), client: clientIp, clientName: enr.name, domain: name, type, status: 'forwarded', upstream: `${cond.host}#${cond.port}`, replyMs: Date.now() - t0, reply: res ? this.firstAnswer(res) : 'SERVFAIL' });
      });
      return;
    }

    // advanced short-circuits
    if (this.settings.neverForwardNonFqdn && !name.includes('.')) {
      respond(this.nxdomain(decoded));
      this.log({ ts: new Date().toISOString(), client: clientIp, clientName: enr.name, domain: name, type, status: 'local', replyMs: Date.now() - t0, reply: 'NXDOMAIN' });
      return;
    }
    if (this.settings.neverForwardReversePrivate && type === 'PTR' && PRIVATE_REV.test(name) && isPrivateReverse(name)) {
      respond(this.nxdomain(decoded));
      this.log({ ts: new Date().toISOString(), client: clientIp, clientName: enr.name, domain: name, type, status: 'local', replyMs: Date.now() - t0, reply: 'NXDOMAIN' });
      return;
    }

    // list decision (skipped while blocking is paused via "disable blocking")
    const verdict = lookup(name, groups);
    if (verdict.action === 'block' && this.blockingActive()) {
      respond(this.block(decoded, type));
      if (verdict.listId > 0) domainHit(verdict.listId);
      this.log({ ts: new Date().toISOString(), client: clientIp, clientName: enr.name, domain: name, type, status: 'blocked', replyMs: Date.now() - t0, reply: this.settings.blockingMode === 'null' ? '0.0.0.0' : this.settings.blockingMode.toUpperCase(), listId: verdict.listId > 0 ? verdict.listId : undefined });
      pushLog('dns', 'info', `blocked ${name} for ${clientIp}`);
      return;
    }
    // threat-intel sinkhole: block known-bad domains unless explicitly allowlisted
    if (verdict.action !== 'allow' && this.blockingActive() && sinkholeMatch(name)) {
      respond(this.block(decoded, type));
      noteSinkholeBlock();
      this.log({ ts: new Date().toISOString(), client: clientIp, clientName: enr.name, domain: name, type, status: 'blocked', replyMs: Date.now() - t0, reply: this.settings.blockingMode === 'null' ? '0.0.0.0' : this.settings.blockingMode.toUpperCase() });
      pushLog('dns', 'warn', `sinkholed known-bad domain ${name} for ${clientIp}`);
      return;
    }
    const allowedListId = verdict.action === 'allow' ? verdict.listId : undefined;

    // cache
    const key = `${name.toLowerCase()}|${type}`;
    const hit = this.cache.get(key);
    if (hit && hit.expiry > Date.now()) {
      const out = Buffer.from(hit.buf);
      out.writeUInt16BE(decoded.id ?? 0, 0); // rewrite transaction id
      respond(out);
      this.log({ ts: new Date().toISOString(), client: clientIp, clientName: enr.name, domain: name, type, status: 'cached', replyMs: Date.now() - t0, reply: this.firstAnswer(hit.buf), listId: allowedListId });
      return;
    }

    // forward — raw by default; prepareForward only rewrites EDNS when DNSSEC/ECS are on
    void this.forward(this.prepareForward(msg, clientIp)).then((res) => {
      if (!res) {
        respond(this.servfail(decoded));
        this.log({ ts: new Date().toISOString(), client: clientIp, clientName: enr.name, domain: name, type, status: 'forwarded', upstream: 'none', replyMs: Date.now() - t0, reply: 'SERVFAIL' });
        pushLog('dns', 'error', `SERVFAIL resolving ${name} (no upstream answered)`);
        return;
      }
      respond(res.buf);
      this.cacheResponse(key, res.buf);
      this.log({
        ts: new Date().toISOString(),
        client: clientIp,
        clientName: enr.name,
        domain: name,
        type,
        status: allowedListId !== undefined ? 'allowed' : 'forwarded',
        upstream: res.upstream,
        replyMs: Date.now() - t0,
        reply: this.firstAnswer(res.buf),
        listId: allowedListId,
      });
    });
  }

  // ── forwarding ──────────────────────────────────────────────────────────────
  private forward(msg: Buffer): Promise<{ buf: Buffer; upstream: string } | null> {
    const order = this.upstreams.length ? [...this.upstreams.slice(this.rr % this.upstreams.length), ...this.upstreams.slice(0, this.rr % this.upstreams.length)] : [];
    this.rr++;
    const attempt = (idx: number): Promise<{ buf: Buffer; upstream: string } | null> => {
      if (idx >= order.length) return Promise.resolve(null);
      const up = order[idx]!;
      return this.forwardTo(up, msg).then(
        (buf) => {
          up.healthy = true;
          return { buf, upstream: up.port === 53 ? up.host : `${up.host}#${up.port}` };
        },
        () => {
          up.healthy = false;
          return attempt(idx + 1);
        },
      );
    };
    return attempt(0);
  }

  private forwardTo(up: Upstream, msg: Buffer): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const sock = dgram.createSocket(up.host.includes(':') ? 'udp6' : 'udp4');
      const started = Date.now();
      const timer = setTimeout(() => {
        sock.close();
        reject(new Error('timeout'));
      }, 3000);
      sock.once('message', (resp) => {
        clearTimeout(timer);
        up.latencyMs = Date.now() - started;
        sock.close();
        resolve(resp);
      });
      sock.once('error', (e) => {
        clearTimeout(timer);
        sock.close();
        reject(e);
      });
      sock.send(msg, up.port, up.host);
    });
  }

  /** Forward to one explicit target (conditional forwarding). */
  private forwardVia(target: { host: string; port: number }, msg: Buffer): Promise<Buffer | null> {
    const up: Upstream = { ...target, healthy: true, latencyMs: 0 };
    return this.forwardTo(up, msg).then(
      (b) => b,
      () => null,
    );
  }

  /**
   * Add EDNS to the outgoing query when DNSSEC/ECS are enabled: set the DO bit so
   * the (validating) upstream returns DNSSEC records, and/or attach the client's
   * subnet as ECS. When neither is on, the query is forwarded byte-for-byte.
   */
  private prepareForward(msg: Buffer, clientIp: string): Buffer {
    if (!this.settings.dnssec && !this.settings.ecs) return msg;
    let pkt: dnsPacket.Packet;
    try {
      pkt = dnsPacket.decode(msg);
    } catch {
      return msg;
    }
    const existing = (pkt.additionals ?? []).find((a) => a.type === 'OPT') as
      | { udpPayloadSize?: number; flags?: number; options?: Array<Record<string, unknown>> }
      | undefined;
    const opt: Record<string, unknown> = {
      type: 'OPT',
      name: '.',
      udpPayloadSize: existing?.udpPayloadSize ?? 4096,
      flags: existing?.flags ?? 0,
      options: [...(existing?.options ?? [])].filter((o) => o.code !== 8 && o.type !== 'CLIENT_SUBNET'),
    };
    if (this.settings.dnssec) opt.flags = ((opt.flags as number) | dnsPacket.DNSSEC_OK) >>> 0;
    if (this.settings.ecs) {
      const ip4 = clientIp.replace(/^::ffff:/, '');
      if (/^\d+\.\d+\.\d+\.\d+$/.test(ip4)) {
        const subnet = ip4.split('.').slice(0, 3).join('.') + '.0';
        (opt.options as Array<Record<string, unknown>>).push({ code: 8, family: 1, sourcePrefixLength: 24, scopePrefixLength: 0, ip: subnet });
      }
    }
    const additionals = [...(pkt.additionals ?? []).filter((a) => a.type !== 'OPT'), opt as unknown as dnsPacket.Answer];
    try {
      return dnsPacket.encode({ ...pkt, additionals });
    } catch {
      return msg;
    }
  }

  private cacheResponse(key: string, buf: Buffer): void {
    try {
      const dec = dnsPacket.decode(buf);
      const rcode = (dec as { rcode?: string }).rcode;
      if ((rcode && rcode !== 'NOERROR') || !dec.answers?.length) {
        this.cache.set(key, { buf: Buffer.from(buf), expiry: Date.now() + 15_000 });
      } else {
        const ttl = Math.max(5, Math.min(3600, Math.min(...dec.answers.map((a) => (a as { ttl?: number }).ttl ?? 300))));
        this.cache.set(key, { buf: Buffer.from(buf), expiry: Date.now() + ttl * 1000 });
      }
    } catch {
      /* don't cache undecodable */
    }
    if (this.cache.size > 5000) {
      const cutoff = Date.now();
      for (const [k, v] of this.cache) if (v.expiry < cutoff) this.cache.delete(k);
    }
  }

  private firstAnswer(buf: Buffer): string | undefined {
    try {
      const dec = dnsPacket.decode(buf);
      const a = dec.answers?.find((x) => ['A', 'AAAA', 'CNAME'].includes(x.type));
      const rcode = (dec as { rcode?: string }).rcode;
      return a ? String((a as { data: unknown }).data) : rcode && rcode !== 'NOERROR' ? rcode : undefined;
    } catch {
      return undefined;
    }
  }

  // ── synthetic responses ───────────────────────────────────────────────────────
  /** Authoritative local answer (A/AAAA/PTR) from /etc/hosts. */
  private localA(req: dnsPacket.Packet, type: 'A' | 'AAAA' | 'PTR', value: string): Buffer {
    const name = String(req.questions![0]!.name);
    return dnsPacket.encode({
      id: req.id,
      type: 'response',
      flags: dnsPacket.RECURSION_DESIRED | dnsPacket.RECURSION_AVAILABLE,
      questions: req.questions,
      answers: [{ type, name, ttl: 60, data: value } as dnsPacket.Answer],
    });
  }

  private block(req: dnsPacket.Packet, type: string): Buffer {
    if (this.settings.blockingMode === 'nxdomain') return this.nxdomain(req);
    if (this.settings.blockingMode === 'refused') return this.refuse(req);
    // null mode: 0.0.0.0 / :: for A/AAAA, NODATA for everything else
    const answers: dnsPacket.Answer[] = [];
    const name = String(req.questions![0]!.name);
    if (type === 'A') answers.push({ type: 'A', name, ttl: 2, data: '0.0.0.0' } as dnsPacket.Answer);
    else if (type === 'AAAA') answers.push({ type: 'AAAA', name, ttl: 2, data: '::' } as dnsPacket.Answer);
    return dnsPacket.encode({
      id: req.id,
      type: 'response',
      flags: dnsPacket.RECURSION_DESIRED | dnsPacket.RECURSION_AVAILABLE,
      questions: req.questions,
      answers,
    });
  }

  private nxdomain(req: dnsPacket.Packet): Buffer {
    return dnsPacket.encode({
      id: req.id,
      type: 'response',
      flags: dnsPacket.RECURSION_DESIRED | dnsPacket.RECURSION_AVAILABLE | 3, // RCODE 3 = NXDOMAIN
      questions: req.questions,
      answers: [],
    });
  }
  private refuse(req: dnsPacket.Packet): Buffer {
    return dnsPacket.encode({
      id: req.id,
      type: 'response',
      flags: dnsPacket.RECURSION_DESIRED | dnsPacket.RECURSION_AVAILABLE | 5, // RCODE 5 = REFUSED
      questions: req.questions,
      answers: [],
    });
  }
  private servfail(req: dnsPacket.Packet): Buffer {
    return dnsPacket.encode({
      id: req.id,
      type: 'response',
      flags: dnsPacket.RECURSION_DESIRED | dnsPacket.RECURSION_AVAILABLE | 2, // RCODE 2 = SERVFAIL
      questions: req.questions,
      answers: [],
    });
  }

  // ── rate limiting ─────────────────────────────────────────────────────────────
  private isRateLimited(ip: string): boolean {
    const { rateLimitCount, rateLimitWindow } = this.settings;
    if (!rateLimitCount || !rateLimitWindow) return false;
    const now = Date.now();
    const rec = this.rate.get(ip);
    if (!rec || now - rec.start > rateLimitWindow * 1000) {
      this.rate.set(ip, { n: 1, start: now });
      return false;
    }
    rec.n++;
    return rec.n > rateLimitCount;
  }

  // ── logging ───────────────────────────────────────────────────────────────────
  private log(q: Parameters<typeof queryInsert>[0]): void {
    const s = this.settings;
    // privacy level 3 (anonymous) or logging off → keep no history
    if (!s.logQueries || s.privacyLevel >= 3) return;
    let entry = q;
    if (s.privacyLevel >= 1) entry = { ...entry, domain: 'hidden', reply: undefined }; // hide domains
    if (s.privacyLevel >= 2) entry = { ...entry, client: '0.0.0.0', clientName: undefined }; // hide clients
    try {
      queryInsert(entry);
    } catch {
      /* never let logging break resolution */
    }
    if (++this.pruneTick % 5000 === 0) queriesPrune();
  }
}

export const resolver = new Resolver();
