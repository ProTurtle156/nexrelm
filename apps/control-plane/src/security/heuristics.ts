/**
 * Heuristic threat detection over ALL observed traffic — not just DNS. Two
 * independent sources feed the same detector set:
 *   1. the live DNS query stream (floods, NXDOMAIN, recon, DGA, tunneling), and
 *   2. the passive promiscuous sniffer / inline-gateway flows (port scans,
 *      outbound host sweeps, lateral movement, C2-port contact, data egress,
 *      known-bad IP contact).
 * Either source alone is enough to raise alerts — a quiet-DNS-but-busy-wire
 * network is still fully inspected. No external service required; gated by the
 * pause/flags. Every detector requires a concrete, reason-backed threshold so
 * the engine is sensitive without being gullible.
 */
import type { DnsQuery, SecSeverity, SecurityAlert, ThreatKind } from '@nexrelm/types';
import { queriesRecent } from '../dns';
import { isAcked, monitoringActive } from './state';
import { maliciousIndicators } from './autointel';
import { sniffFlows, sniffTalkers, snifferActive, sniffArp, sniffDhcpServers, sniffNameResponders } from './sniffer';
import { badDomains, badIps } from './intel-feeds';
import { firewallState } from './firewall';
import { baselineFor } from './baseline';
import { sensitivityFactor, isTrustedHost } from './tuning';
import { arpFlipAlerts } from './arp-monitor';
import { lastProbe } from '../dhcp/probe';

// ports whose fan-out is normal for busy/infra hosts — discounted from scan counts
const COMMON_PORTS = new Set([53, 80, 443, 123, 853, 5353]);
// CDN / OS-telemetry / infra domains that legitimately get polled — excluded from beaconing
const INFRA_RE = /(akamai|google|gstatic|cloudflare|amazonaws|azure|microsoft|windows|office|apple|icloud|fbcdn|akadns|edgekey|cloudfront|gvt\d|doubleclick|in-addr\.arpa|\bntp\b|pool\.ntp|sentry|segment|firebase|crashlytics)/i;

const PRIVATE_IP = /^(10\.|127\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/;

/** External = routable public IP: excludes private, link-local, multicast, broadcast, reserved. */
function isExternal(ip: string): boolean {
  if (PRIVATE_IP.test(ip)) return false;
  if (/^(169\.254\.|224\.|225\.|226\.|227\.|22[89]\.|23\d\.|24\d\.|25[0-5]\.|0\.)/.test(ip)) return false;
  return /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(ip);
}

const MITRE: Record<ThreatKind, { id: string; name: string }> = {
  port_scan: { id: 'T1046', name: 'Network Service Discovery' },
  dns_recon: { id: 'T1590', name: 'Gather Victim Network Information' },
  nxdomain_flood: { id: 'T1568', name: 'Dynamic Resolution' },
  query_flood: { id: 'T1498', name: 'Network Denial of Service' },
  dga: { id: 'T1568.002', name: 'Domain Generation Algorithms' },
  spoofing: { id: 'T1557', name: 'Adversary-in-the-Middle' },
  ddos: { id: 'T1498', name: 'Network Denial of Service' },
  malware_domain: { id: 'T1071', name: 'Application Layer Protocol' },
  data_exfil: { id: 'T1048', name: 'Exfiltration Over Alternative Protocol' },
  anomaly: { id: 'T1071', name: 'Application Layer Protocol' },
  arp_spoof: { id: 'T1557.002', name: 'ARP Cache Poisoning' },
  mac_spoof: { id: 'T1557', name: 'Adversary-in-the-Middle' },
  rogue_dhcp: { id: 'T1557.003', name: 'DHCP Spoofing' },
  llmnr_poison: { id: 'T1557.001', name: 'LLMNR/NBT-NS Poisoning and SMB Relay' },
  ad_attack: { id: 'T1187', name: 'Forced Authentication' },
  suspicious_domain: { id: 'T1568', name: 'Dynamic Resolution' },
  beaconing: { id: 'T1071.004', name: 'Application Layer Protocol: DNS (C2 Beaconing)' },
  lateral_movement: { id: 'T1021', name: 'Remote Services' },
  new_device: { id: 'T1200', name: 'Hardware Additions' },
  baseline_anomaly: { id: 'T1071', name: 'Application Layer Protocol' },
  geo_anomaly: { id: 'T1071', name: 'Application Layer Protocol' },
};

/** Shannon entropy (bits/char) of a string — high for random/DGA labels. */
function entropy(s: string): number {
  if (!s) return 0;
  const freq = new Map<string, number>();
  for (const ch of s) freq.set(ch, (freq.get(ch) ?? 0) + 1);
  let h = 0;
  for (const c of freq.values()) {
    const p = c / s.length;
    h -= p * Math.log2(p);
  }
  return h;
}

function secondLevel(domain: string): string {
  const parts = domain.replace(/\.$/, '').split('.');
  return parts.length >= 2 ? parts[parts.length - 2]! : parts[0] ?? '';
}
function maxLabelLen(domain: string): number {
  return Math.max(0, ...domain.split('.').map((l) => l.length));
}

function alert(kind: ThreatKind, severity: SecSeverity, source: string, title: string, detail: string, count: number, evidence?: string, idKey?: string): SecurityAlert {
  const id = `${kind}:${idKey ?? source}`;
  return { id, ts: new Date().toISOString(), severity, kind, source, title, detail, count, evidence, mitre: MITRE[kind], acknowledged: isAcked(id) };
}

// risky/uncommon destination ports for an internal host to reach OUTBOUND on the
// public internet — backdoors, C2, and remote-admin that should never face WAN.
const C2_PORTS = new Map<number, string>([
  [1337, 'common backdoor'],
  [4444, 'Metasploit / backdoor'],
  [4445, 'backdoor'],
  [5555, 'ADB / backdoor'],
  [6667, 'IRC (classic C2)'],
  [6697, 'IRC over TLS (C2)'],
  [9001, 'Tor / C2'],
  [31337, 'elite backdoor'],
  [3333, 'crypto-mining pool'],
  [4028, 'crypto-mining (cgminer)'],
  [14444, 'crypto-mining pool'],
]);
const ADMIN_PORTS = new Map<number, string>([
  [23, 'Telnet'],
  [445, 'SMB'],
  [3389, 'RDP'],
  [135, 'MS-RPC'],
  [5900, 'VNC'],
]);

export function detectThreats(windowSec = 120): SecurityAlert[] {
  if (!monitoringActive()) return [];
  const alerts: SecurityAlert[] = [];
  // sensitivity scales every count threshold: low ⇒ bigger (fewer alerts), high ⇒ smaller
  const F = sensitivityFactor();
  const T = (base: number): number => Math.max(1, Math.round(base * F));
  const cutoff = Date.now() - windowSec * 1000;
  const recent = queriesRecent({ limit: 12_000 }).filter((r) => new Date(r.ts).getTime() >= cutoff);

  // intel sets shared by both the DNS and wire detectors
  const mal = maliciousIndicators();
  const fbDom = badDomains();
  const fbIp = badIps();

  // ════════════════════════ DNS-stream detectors ════════════════════════
  if (recent.length) {
    const byClient = new Map<string, DnsQuery[]>();
    for (const r of recent) {
      const arr = byClient.get(r.client);
      if (arr) arr.push(r);
      else byClient.set(r.client, [r]);
    }

    // ── aggregate DDoS: overall query rate spike ──
    const totalQps = recent.length / windowSec;
    if (totalQps > 80 * F) {
      alerts.push(alert('ddos', totalQps > 250 * F ? 'critical' : 'high', 'multiple', 'Possible DNS flood / DDoS', `Aggregate query rate ${Math.round(totalQps)} q/s across ${byClient.size} clients — well above this network's normal load.`, Math.round(totalQps)));
    }

    for (const [client, qs] of byClient) {
      const n = qs.length;
      const qps = n / windowSec;
      const nx = qs.filter((q) => q.status === 'nxdomain').length;
      const uniq = new Set(qs.map((q) => q.domain.toLowerCase()));
      const labels = [...uniq].map(secondLevel).filter((s) => s.length > 4);
      const meanEntropy = labels.length ? labels.reduce((a, l) => a + entropy(l), 0) / labels.length : 0;
      const meanLen = labels.length ? labels.reduce((a, l) => a + l.length, 0) / labels.length : 0;
      const longTunnel = qs.filter((q) => maxLabelLen(q.domain) >= 40).length;
      const txtish = qs.filter((q) => /TXT|NULL|CNAME/i.test(q.type)).length;

      // query flood (per client) — sensitive but reason-backed (rate AND volume)
      if (qps > 8 * F && n > T(100)) {
        alerts.push(alert('query_flood', qps > 25 * F ? 'critical' : 'high', client, 'Query flood from a single client', `${client} issued ${n} queries at ${Math.round(qps)} q/s over ${windowSec}s — far above a normal device's resolver rate.`, n));
      }
      // NXDOMAIN flood → recon / DGA / misconfig (needs both volume and ratio)
      if (nx > T(12) && nx / n > 0.3) {
        alerts.push(alert('nxdomain_flood', nx > T(60) ? 'high' : 'medium', client, 'NXDOMAIN flood', `${client} produced ${nx} failed lookups (${Math.round((nx / n) * 100)}% of its traffic) — domain probing, a typo-loop, or a DGA reaching dead C2.`, nx));
      }
      // recon: large unique-domain fanout
      if (uniq.size > T(80)) {
        alerts.push(alert('dns_recon', uniq.size > T(250) ? 'high' : 'medium', client, 'DNS reconnaissance / fanout', `${client} resolved ${uniq.size} distinct domains in ${windowSec}s — far more breadth than a person browsing; looks like scanning or scraping.`, uniq.size));
      }
      // DGA: many high-entropy algorithmic labels (entropy + length + count together)
      if (uniq.size > T(22) && meanEntropy > 3.5 && meanLen > 11) {
        alerts.push(alert('dga', 'high', client, 'Algorithmically-generated domains (DGA)', `${client} queried ${uniq.size} random-looking domains (entropy ${meanEntropy.toFixed(2)} bits/char, avg label ${Math.round(meanLen)} chars) — the hallmark of malware reaching C2 via a domain-generation algorithm.`, uniq.size, [...uniq].slice(0, 3).join(', ')));
      }
      // DNS tunneling / exfiltration: long labels or heavy TXT to few bases
      if (longTunnel > 3 || (txtish > 25 && uniq.size < 12)) {
        alerts.push(alert('data_exfil', 'high', client, 'Possible DNS tunneling / exfiltration', `${client} shows ${longTunnel} oversized sub-labels and ${txtish} TXT/NULL queries to few domains — the encoding pattern of data tunneled over DNS.`, Math.max(longTunnel, txtish)));
      }
      // lighter tiers so the feed spans low/info — still with a concrete reason
      if (uniq.size > T(35) && uniq.size <= T(80)) {
        alerts.push(alert('dns_recon', 'low', client, 'Light domain fanout', `${client} resolved ${uniq.size} distinct domains — more than typical idle browsing; worth watching.`, uniq.size));
      }
      if (qps > 3 && qps <= 8 && n > 40) {
        alerts.push(alert('anomaly', 'info', client, 'Elevated query activity', `${client} is resolving at ${Math.round(qps)} q/s (${n} in ${windowSec}s) — above its usual baseline.`, n));
      }
      // suspicious domains: high-abuse TLDs or punycode/IDN homograph at volume
      const susp = [...uniq].filter((d) => /\.(tk|top|xyz|gq|ml|cf|ga|work|zip|mov|click|country|kim|loan|men|rest|cyou|sbs|buzz)$/i.test(d.replace(/\.$/, '')) || /(^|\.)xn--/i.test(d));
      if (susp.length > 5) {
        alerts.push(alert('suspicious_domain', susp.length > 20 ? 'high' : 'medium', client, 'Suspicious domains queried', `${client} resolved ${susp.length} domains on high-abuse TLDs or punycode/IDN (${susp.slice(0, 3).join(', ')}) — the TLDs and homograph tricks favoured by phishing and malware.`, susp.length, susp[0]));
      }
      // (C2 beaconing is detected in a dedicated timing pass below, not by volume)
      // adaptive baseline: this client deviating sharply from its own learned normal
      const bl = baselineFor(client, { qps, unique_domains: uniq.size, nxdomain: nx });
      if (bl.anomalous) {
        const worst = bl.metrics.filter((m) => m.samples >= 15).sort((a, b) => b.deviation - a.deviation)[0];
        if (worst) alerts.push(alert('baseline_anomaly', worst.deviation > 6 ? 'high' : 'medium', client, 'Behavioural anomaly vs learned baseline', `${client}'s ${worst.metric.replace(/_/g, ' ')} is ${worst.current.toFixed(1)}, ${worst.deviation.toFixed(1)}σ above its learned normal of ${worst.mean.toFixed(1)} — a sharp deviation from this device's own established pattern.`, Math.round(worst.deviation), undefined, `baseline:${client}`));
      }
    }

    // ── C2 beaconing: REGULAR-INTERVAL callbacks (timing analysis, not volume) ──
    // Use a longer 30-min lookback so slower beacons have enough callbacks to judge.
    const beaconCut = Date.now() - 1800 * 1000;
    const byPair = new Map<string, number[]>(); // "client|domain" → query timestamps (ms)
    for (const q of queriesRecent({ limit: 12_000 })) {
      const ts = new Date(q.ts).getTime();
      if (ts < beaconCut) continue;
      const d = q.domain.toLowerCase().replace(/\.$/, '');
      if (!d.includes('.') || INFRA_RE.test(d)) continue;
      const key = `${q.client}|${d}`;
      (byPair.get(key) ?? byPair.set(key, []).get(key)!).push(ts);
    }
    for (const [key, tsList] of byPair) {
      if (tsList.length < 6) continue; // need enough callbacks to judge regularity
      tsList.sort((a, b) => a - b);
      const gaps: number[] = [];
      for (let i = 1; i < tsList.length; i++) gaps.push((tsList[i]! - tsList[i - 1]!) / 1000);
      const mean = gaps.reduce((a, g) => a + g, 0) / gaps.length;
      if (mean < 2 || mean > 900) continue; // beacon band: 2s … 15min
      const sd = Math.sqrt(gaps.reduce((a, g) => a + (g - mean) ** 2, 0) / gaps.length);
      const cv = sd / mean; // coefficient of variation — low = metronomic
      if (cv < 0.25 * (2 - F)) {
        const [bClient, bDom] = key.split('|');
        alerts.push(alert('beaconing', cv < 0.12 ? 'high' : 'medium', bClient!, 'Possible C2 beaconing', `${bClient} queried ${bDom} ${tsList.length} times at a near-constant ~${Math.round(mean)}s interval (jitter ${Math.round(cv * 100)}%) — the metronomic callback cadence of C2 beaconing, not human browsing.`, tsList.length, bDom, `beacon:${key}`));
      }
    }

    // ── automated VirusTotal correlation: contact with known-bad infra ──
    if (mal.length) {
      const malBy = new Map(mal.map((m) => [m.indicator.toLowerCase(), m]));
      const hits = new Map<string, { inds: Set<string>; worst: boolean }>();
      for (const q of recent) {
        const m = malBy.get(q.domain.toLowerCase()) ?? (q.reply ? malBy.get(q.reply.trim().toLowerCase()) : undefined);
        if (!m) continue;
        const h = hits.get(q.client) ?? { inds: new Set<string>(), worst: false };
        h.inds.add(m.indicator);
        if (m.verdict === 'malicious') h.worst = true;
        hits.set(q.client, h);
      }
      for (const [client, h] of hits) {
        alerts.push(alert('malware_domain', h.worst ? 'critical' : 'high', client, 'Contact with known-bad infrastructure', `${client} resolved ${h.inds.size} indicator(s) flagged by VirusTotal: ${[...h.inds].slice(0, 3).join(', ')}.`, h.inds.size, [...h.inds][0]));
      }
    }

    // ── threat-intel feed correlation (known-bad domains/IPs touched) ──
    if (fbDom.size || fbIp.size) {
      const fhit = new Map<string, Set<string>>();
      for (const q of recent) {
        const d = q.domain.toLowerCase().replace(/\.$/, '');
        if (fbDom.has(d)) (fhit.get(q.client) ?? fhit.set(q.client, new Set()).get(q.client)!).add(d);
        else if (q.reply && fbIp.has(q.reply.trim())) (fhit.get(q.client) ?? fhit.set(q.client, new Set()).get(q.client)!).add(q.reply.trim());
      }
      for (const [client, inds] of fhit) alerts.push(alert('malware_domain', 'high', client, 'Contact with a threat-intel listed indicator', `${client} touched ${inds.size} indicator(s) on threat-intel feeds: ${[...inds].slice(0, 3).join(', ')}.`, inds.size, [...inds][0]));
    }
  }

  // ════════════════ wire-level detectors (all traffic, DNS-independent) ════════════════
  // Runs whenever the sniffer is capturing — passively on this segment, or, with
  // the inline gateway on, across ALL of the piloted device's forwarded traffic.
  if (snifferActive()) {
    const flows = sniffFlows();
    const talkers = sniffTalkers();
    const totalPkts = talkers.reduce((a, t) => a + t.packets, 0) || 1;
    const totalBytes = flows.reduce((a, f) => a + f.bytes, 0) || 1;
    const malIpSet = new Set<string>([...mal.filter((m) => m.kind === 'ip').map((m) => m.indicator), ...fbIp]);

    const horiz = new Map<string, Set<string>>(); // src → {dst:port}  (recon breadth)
    const vert = new Map<string, Set<number>>(); // src>dst → {ports}
    const extFan = new Map<string, Set<string>>(); // internal src → {external dst}  (sweep/spread)
    const lateral = new Map<string, Set<string>>(); // internal src → {internal dst on admin ports}
    const egress = new Map<string, number>(); // src>dst (external) → packets  (volume)
    const c2 = new Map<string, Set<string>>(); // src → {dst:port(name)} on C2/admin ports
    const malHit = new Map<string, Set<string>>(); // internal host → {known-bad IP touched}

    const addTo = (m: Map<string, Set<string>>, k: string, v: string) => (m.get(k) ?? m.set(k, new Set()).get(k)!).add(v);

    for (const f of flows) {
      const srcPriv = PRIVATE_IP.test(f.src);
      const dstExt = isExternal(f.dst);
      // scan/sweep accumulation: skip trusted + this host's own IPs (resolvers/gateways
      // legitimately fan out) and discount normal service ports so busy web/DNS hosts
      // don't look like a scan. Known-bad-IP contact below is NOT skipped.
      if (srcPriv && !isTrustedHost(f.src)) {
        const oddPort = !COMMON_PORTS.has(f.dport);
        if (oddPort) addTo(horiz, f.src, `${f.dst}:${f.dport}`);
        (vert.get(`${f.src}>${f.dst}`) ?? vert.set(`${f.src}>${f.dst}`, new Set()).get(`${f.src}>${f.dst}`)!).add(f.dport);
        if (dstExt) {
          if (oddPort) addTo(extFan, f.src, f.dst);
          const ek = `${f.src}>${f.dst}`;
          egress.set(ek, (egress.get(ek) ?? 0) + f.bytes); // bytes, not packets, for exfil volume
          const c2name = C2_PORTS.get(f.dport) ?? ADMIN_PORTS.get(f.dport);
          if (c2name) addTo(c2, f.src, `${f.dst}:${f.dport} (${c2name})`);
        } else if (PRIVATE_IP.test(f.dst) && f.dst !== f.src && (ADMIN_PORTS.has(f.dport) || f.dport === 22)) {
          addTo(lateral, f.src, f.dst);
        }
      }
      if (malIpSet.has(f.dst) && srcPriv) addTo(malHit, f.src, f.dst);
      if (malIpSet.has(f.src) && PRIVATE_IP.test(f.dst)) addTo(malHit, f.dst, f.src);
    }

    // horizontal port scan: one host probing many host:port combos (odd ports only)
    for (const [src, set] of horiz) if (set.size > T(40)) alerts.push(alert('port_scan', set.size > T(150) ? 'critical' : 'high', src, 'Port scan detected on the wire', `${src} probed ${set.size} distinct host:port combinations on non-standard ports — clear network reconnaissance.`, set.size));
    // vertical port scan: one host hitting many ports on a single target
    for (const [k, ports] of vert) if (ports.size > T(15)) alerts.push(alert('port_scan', 'high', k.split('>')[0]!, 'Vertical port scan', `${k.split('>')[0]} hit ${ports.size} distinct ports on ${k.split('>')[1]} — probing that host for open services.`, ports.size, k.split('>')[1]));
    // outbound host sweep: one internal host contacting a large fan of external IPs (odd ports)
    for (const [src, dsts] of extFan) if (dsts.size > T(60)) alerts.push(alert('port_scan', dsts.size > T(200) ? 'critical' : 'high', src, 'Outbound host sweep', `${src} connected out to ${dsts.size} distinct external IPs on non-standard ports — worm-like spreading, mass scanning, or a botnet, not normal browsing.`, dsts.size, [...dsts].slice(0, 3).join(', ')));
    // lateral movement: internal host reaching admin ports across several peers
    for (const [src, dsts] of lateral) if (dsts.size > T(5)) alerts.push(alert('lateral_movement', dsts.size > T(15) ? 'critical' : 'high', src, 'Possible lateral movement', `${src} reached SMB/RDP/SSH/VNC on ${dsts.size} internal hosts — the spread pattern of ransomware or an attacker pivoting inside the LAN.`, dsts.size, [...dsts].slice(0, 3).join(', ')));
    // C2 / backdoor / mining port contact to the public internet
    for (const [src, set] of c2) alerts.push(alert('malware_domain', 'high', src, 'Suspicious outbound service / C2 port', `${src} opened ${set.size} connection(s) to the internet on backdoor/admin/mining ports: ${[...set].slice(0, 3).join(', ')} — these should never face the WAN.`, set.size, [...set][0]));
    // data egress: heavy upload (by BYTES) concentrated to a single external destination
    for (const [k, bytes] of egress) {
      const frac = bytes / totalBytes;
      if (bytes > T(20_000_000) && frac > 0.25) {
        const mb = (bytes / 1e6).toFixed(1);
        alerts.push(alert('data_exfil', frac > 0.5 ? 'high' : 'medium', k.split('>')[0]!, 'Large data egress to one host', `${k.split('>')[0]} sent ${mb} MB to ${k.split('>')[1]} (${Math.round(frac * 100)}% of all captured bytes) — a possible bulk upload or exfiltration channel.`, Math.round(bytes / 1e6), k.split('>')[1]));
      }
    }
    // known-bad IP contact seen directly on the wire
    for (const [host, ips] of malHit) alerts.push(alert('malware_domain', 'critical', host, 'Connection to known-bad IP (on the wire)', `${host} is exchanging traffic with ${ips.size} IP(s) flagged by VirusTotal / threat-intel feeds: ${[...ips].slice(0, 3).join(', ')}.`, ips.size, [...ips][0]));

    // ═══════════ L2 / adversary-in-the-middle / poisoning (from ARP + service capture) ═══════════
    const arp = sniffArp();
    // ARP cache poisoning: one IP claimed by multiple MACs (its L2 identity is forged)
    for (const { ip, macs } of arp) {
      if (macs.length > 1) {
        const sorted = [...macs].sort((a, b) => b.count - a.count);
        const gatewayish = /\.(1|254)$/.test(ip);
        alerts.push(alert('arp_spoof', gatewayish ? 'critical' : 'high', ip, gatewayish ? 'Gateway ARP spoofing (MITM)' : 'ARP spoofing / cache poisoning', `${ip} is being claimed by ${macs.length} different MAC addresses (${sorted.slice(0, 3).map((m) => m.mac).join(', ')}) — someone is forging this host's L2 identity to sit in the middle of its traffic.`, macs.length, sorted.map((m) => m.mac).join(','), `arpspoof:${ip}`));
      }
    }
    // MAC impersonation: one MAC presenting many internal IPs (spoofing / rogue bridge)
    const macToIps = new Map<string, Set<string>>();
    for (const { ip, macs } of arp) for (const { mac } of macs) addTo(macToIps, mac, ip);
    for (const [mac, ips] of macToIps) if (ips.size > 3) alerts.push(alert('mac_spoof', ips.size > 8 ? 'high' : 'medium', [...ips][0]!, 'One MAC impersonating multiple hosts', `MAC ${mac} is presenting ${ips.size} different internal IPs (${[...ips].slice(0, 4).join(', ')}) — MAC spoofing or an unauthorized bridge/relay on the LAN.`, ips.size, mac, `macspoof:${mac}`));

    // rogue DHCP: more than one host answering as a DHCP server → poisoned gateway/DNS
    const dh = sniffDhcpServers();
    if (dh.length > 1) {
      const list = [...dh].sort((a, b) => b.count - a.count);
      alerts.push(alert('rogue_dhcp', 'critical', list[0]!.ip, 'Rogue DHCP server detected', `${dh.length} hosts are answering as DHCP servers (${list.slice(0, 3).map((d) => d.ip).join(', ')}) — a rogue server hands clients a poisoned gateway/DNS for a full MITM. Only one DHCP server should exist on a LAN.`, dh.length, list.map((d) => d.ip).join(','), 'roguedhcp'));
    }

    // LLMNR / NBT-NS poisoning (Responder): a host answering name queries for many requesters
    const responders = sniffNameResponders();
    for (const r of responders) {
      const total = r.llmnr + r.nbns;
      if (r.requesters >= 3 && total >= 3) {
        alerts.push(alert('llmnr_poison', r.requesters > 8 ? 'critical' : 'high', r.ip, 'LLMNR / NBT-NS poisoning (Responder)', `${r.ip} answered ${total} LLMNR/NBT-NS name queries to ${r.requesters} different hosts — one machine impersonating every name on the LAN to harvest credentials (Responder-style poisoning).`, r.requesters, undefined, `llmnr:${r.ip}`));
      }
    }
    // AD credential-relay chain: a Responder that ALSO opens SMB/LDAP/Kerberos to internal targets
    const responderIps = new Set(responders.filter((r) => r.llmnr + r.nbns >= 2).map((r) => r.ip));
    if (responderIps.size) {
      const relayPorts = new Set([445, 389, 636, 88, 3268]);
      const relay = new Map<string, Set<string>>();
      for (const f of flows) if (responderIps.has(f.src) && PRIVATE_IP.test(f.dst) && relayPorts.has(f.dport)) addTo(relay, f.src, `${f.dst}:${f.dport}`);
      for (const [src, tg] of relay) alerts.push(alert('ad_attack', 'critical', src, 'Credential relay chain (Responder → AD)', `${src} is poisoning name resolution AND opening SMB/LDAP/Kerberos sessions to ${tg.size} internal target(s) — the Responder → NTLM-relay chain used to take over Active Directory.`, tg.size, [...tg].slice(0, 3).join(', '), `adrelay:${src}`));
    }
  }

  // ══════════════ ARP spoofing from the kernel neighbour table (no sniffer needed) ══════════════
  for (const a of arpFlipAlerts()) alerts.push(a);

  // ══════════════ rogue DHCP from the active discovery probe (reliable, no sniffer) ══════════════
  const probe = lastProbe();
  if (probe && Date.now() - new Date(probe.ranAt).getTime() < 10 * 60_000 && probe.servers.length > 1) {
    const ips = probe.servers.map((s) => s.server).join(', ');
    alerts.push(alert('rogue_dhcp', 'critical', probe.servers[0]!.server, 'Multiple DHCP servers (rogue present)', `${probe.servers.length} DHCP servers answered a discovery probe: ${ips} — only one should serve a LAN. A rogue server can hand clients a poisoned gateway/DNS for a full MITM.`, probe.servers.length, ips, 'roguedhcp-probe'));
  }

  // ══════════════ firewall correlation (policy actually being violated) ══════════════
  // A source you explicitly blocked that's still generating traffic — anywhere we observe it.
  const blockRules = firewallState().rules.filter((r) => r.enabled && (r.action === 'deny' || r.action === 'drop') && r.source && r.source !== 'any' && !r.source.includes('/'));
  if (blockRules.length) {
    const blocked = new Set(blockRules.map((r) => r.source));
    const observed = new Set<string>();
    for (const r of recent) observed.add(r.client);
    if (snifferActive()) for (const f of sniffFlows()) { observed.add(f.src); observed.add(f.dst); }
    for (const ip of observed) if (blocked.has(ip)) alerts.push(alert('anomaly', 'high', ip, 'Firewall-blocked source still active', `${ip} is on your firewall block list but is still generating traffic — Nexrelm only drops its own services, so push the rule to your router (Firewall → Apply to router) or route the device through the inline gateway to actually enforce it.`, 0, undefined, `fwblocked:${ip}`));
  }

  const order: Record<SecSeverity, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
  // dedupe by alert id (same id from two passes) keeping the most severe
  const best = new Map<string, SecurityAlert>();
  for (const a of alerts) {
    const prev = best.get(a.id);
    if (!prev || order[a.severity] < order[prev.severity]) best.set(a.id, a);
  }
  return [...best.values()].sort((a, b) => order[a.severity] - order[b.severity] || (b.count ?? 0) - (a.count ?? 0));
}
