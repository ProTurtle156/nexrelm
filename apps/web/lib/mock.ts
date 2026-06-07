/**
 * Client-side simulator — powers DEMO mode so the entire GUI is alive with
 * zero backend. When NEXT_PUBLIC_API_URL is set, the real control plane takes
 * over and none of this runs. Shapes are guaranteed by @nexrelm/types.
 */
import type {
  DhcpLease,
  DhcpState,
  DirectoryState,
  DnsState,
  LeaseState,
  LiveEvent,
  LogLevel,
  LogLine,
  LogStream,
  SecurityEvent,
  SecurityState,
  Severity,
  Topology,
  VirtState,
} from '@nexrelm/types';
import type { Snapshot } from './api';

const rint = (a: number, b: number): number => Math.floor(Math.random() * (b - a + 1)) + a;
const rfloat = (a: number, b: number): number => Math.random() * (b - a) + a;
const pick = <T>(arr: readonly T[]): T => arr[rint(0, arr.length - 1)]!;
const chance = (p: number): boolean => Math.random() < p;
const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n));
const round = (n: number, d = 0): number => Math.round(n * 10 ** d) / 10 ** d;
const rid = (p: string): string => `${p}_${Math.random().toString(36).slice(2, 9)}`;
const iso = (): string => new Date().toISOString();
const mac = (): string =>
  Array.from({ length: 6 }, () => rint(0, 255).toString(16).padStart(2, '0')).join(':');

function series(len: number, base: number, jitter: number, floor = 0): number[] {
  const out: number[] = [];
  let v = base;
  for (let i = 0; i < len; i++) {
    v = clamp(v + rfloat(-jitter, jitter), floor, base * 2.4);
    out.push(round(v, 1));
  }
  return out;
}

function topology(): Topology {
  const defs: Array<[string, string, Topology['nodes'][number]['kind'], string, number, number]> = [
    ['gw', 'edge-gateway', 'gateway', '203.0.113.1', 0.42, 1],
    ['fw', 'nexrelm-fw', 'firewall', '10.20.0.1', 0.55, 1],
    ['core', 'core-sw-01', 'switch', '10.20.0.2', 0.48, 1],
    ['sw1', 'access-sw-01', 'switch', '10.20.0.3', 0.31, 10],
    ['sw2', 'access-sw-02', 'switch', '10.20.0.4', 0.27, 40],
    ['srv-dns', 'dns-resolver', 'server', '10.20.0.10', 0.6, 10],
    ['srv-dc', 'dc-01', 'server', '10.20.0.11', 0.5, 10],
    ['host1', 'kvm-host-01', 'host', '10.20.0.20', 0.66, 10],
    ['host2', 'kvm-host-02', 'host', '10.20.0.21', 0.44, 10],
    ['vm1', 'web-edge', 'vm', '10.20.0.30', 0.38, 10],
    ['vm2', 'app-api', 'vm', '10.20.0.31', 0.52, 10],
    ['vm3', 'db-primary', 'vm', '10.20.0.32', 0.71, 10],
    ['ap1', 'ap-floor-2', 'ap', '10.20.0.40', 0.34, 40],
    ['iot1', 'cam-lobby', 'iot', '10.20.40.51', 0.18, 40],
    ['iot2', 'sensor-hvac', 'iot', '10.20.40.52', 0.12, 40],
  ];
  const nodes: Topology['nodes'] = defs.map(([id, label, kind, ip, load, vlan]) => ({
    id,
    label,
    kind,
    ip,
    mac: mac(),
    status: id === 'iot2' ? 'degraded' : 'online',
    load,
    vlan,
  }));
  const edges: Array<[string, string, number]> = [
    ['gw', 'fw', 940], ['fw', 'core', 880], ['core', 'sw1', 420], ['core', 'sw2', 180],
    ['core', 'srv-dns', 120], ['core', 'srv-dc', 90], ['sw1', 'host1', 610], ['sw1', 'host2', 380],
    ['host1', 'vm1', 140], ['host1', 'vm2', 220], ['host2', 'vm3', 310], ['sw2', 'ap1', 160],
    ['ap1', 'iot1', 12], ['ap1', 'iot2', 4],
  ];
  return {
    nodes,
    links: edges.map(([source, target, mbps]) => ({ id: `${source}-${target}`, source, target, state: 'up', throughputMbps: mbps })),
    updatedAt: iso(),
  };
}

function dns(): DnsState {
  return {
    zones: [
      { id: 'z_lan', name: 'lan.nexrelm.io', kind: 'primary', records: 47, dnssec: true, serial: 2026060301 },
      { id: 'z_rev', name: '20.10.in-addr.arpa', kind: 'primary', records: 31, dnssec: false, serial: 2026060301 },
      { id: 'z_fwd', name: '.', kind: 'forward', records: 0, dnssec: true, serial: 0 },
    ],
    records: [
      { id: rid('rec'), zoneId: 'z_lan', name: 'dc-01', type: 'A', value: '10.20.0.11', ttl: 3600 },
      { id: rid('rec'), zoneId: 'z_lan', name: 'web-edge', type: 'A', value: '10.20.0.30', ttl: 300 },
      { id: rid('rec'), zoneId: 'z_lan', name: 'app-api', type: 'A', value: '10.20.0.31', ttl: 300 },
      { id: rid('rec'), zoneId: 'z_lan', name: 'db-primary', type: 'A', value: '10.20.0.32', ttl: 300 },
      { id: rid('rec'), zoneId: 'z_lan', name: '_ldap._tcp', type: 'SRV', value: '0 100 389 dc-01', ttl: 3600 },
      { id: rid('rec'), zoneId: 'z_lan', name: '@', type: 'MX', value: '10 mail.lan.nexrelm.io', ttl: 3600 },
    ],
    stats: {
      qps: 1284,
      cacheHitRate: 0.96,
      blockedToday: 18234,
      upstreams: [
        { addr: '9.9.9.9', healthy: true, latencyMs: 11 },
        { addr: '1.1.1.1', healthy: true, latencyMs: 9 },
      ],
      series: series(48, 1200, 140, 200),
    },
  };
}

function dhcp(): DhcpState {
  const hostnames = ['mbp-aly', 'thinkpad-ops', 'pixel-9', 'cam-lobby', 'printer-hp', 'roku-tv', 'sonos-kitchen', 'tablet-recep'];
  const leases: DhcpLease[] = Array.from({ length: 22 }, () => {
    const isIot = chance(0.4);
    return {
      id: rid('lease'),
      scopeId: isIot ? 's_iot' : 's_lan',
      ip: isIot ? `10.20.40.${rint(50, 250)}` : `10.20.0.${rint(100, 250)}`,
      mac: mac(),
      hostname: pick(hostnames),
      state: pick<LeaseState>(['active', 'active', 'active', 'reserved', 'offered']),
      expiresAt: new Date(Date.now() + rint(1, 22) * 3600_000).toISOString(),
    };
  });
  return {
    scopes: [
      { id: 's_lan', name: 'LAN', cidr: '10.20.0.0/24', rangeStart: '10.20.0.100', rangeEnd: '10.20.0.250', gateway: '10.20.0.1', leaseSeconds: 86400, used: 138, total: 151 },
      { id: 's_iot', name: 'IOT', cidr: '10.20.40.0/24', rangeStart: '10.20.40.50', rangeEnd: '10.20.40.250', gateway: '10.20.40.1', leaseSeconds: 43200, used: 64, total: 201 },
    ],
    leases,
    stats: { scopes: 2, activeLeases: 204, utilization: 0.67, series: series(48, 200, 12, 120) },
  };
}

function directory(): DirectoryState {
  return {
    realm: { id: 'realm_1', name: 'NEXRELM.LAN', dns: 'nexrelm.lan', mode: 'samba-addc', functionalLevel: '2016', dcs: 2, health: 'operational' },
    users: [
      { id: rid('u'), username: 'administrator', displayName: 'Administrator', groups: ['Domain Admins'], enabled: true, admin: true, lastLogon: iso() },
      { id: rid('u'), username: 'arivera', displayName: 'Alex Rivera', email: 'arivera@nexrelm.lan', groups: ['Domain Admins', 'Engineering'], enabled: true, admin: true, lastLogon: iso() },
      { id: rid('u'), username: 'svc-backup', displayName: 'Backup Service', groups: ['Service Accounts'], enabled: true, admin: false },
      { id: rid('u'), username: 'jdoe', displayName: 'Jane Doe', email: 'jdoe@nexrelm.lan', groups: ['Engineering'], enabled: true, admin: false, lastLogon: iso() },
      { id: rid('u'), username: 'mchen', displayName: 'Ming Chen', email: 'mchen@nexrelm.lan', groups: ['Finance'], enabled: true, admin: false },
      { id: rid('u'), username: 'guest', displayName: 'Guest', groups: ['Guests'], enabled: false, admin: false },
    ],
    groups: [
      { id: rid('g'), name: 'Domain Admins', scope: 'global', members: 2 },
      { id: rid('g'), name: 'Engineering', scope: 'global', members: 14 },
      { id: rid('g'), name: 'Finance', scope: 'global', members: 6 },
      { id: rid('g'), name: 'Service Accounts', scope: 'domain-local', members: 9 },
    ],
    ous: [
      { id: rid('ou'), dn: 'OU=Servers,DC=nexrelm,DC=lan', name: 'Servers', objects: 11 },
      { id: rid('ou'), dn: 'OU=Workstations,DC=nexrelm,DC=lan', name: 'Workstations', objects: 38 },
      { id: rid('ou'), dn: 'OU=People,DC=nexrelm,DC=lan', name: 'People', objects: 24 },
    ],
  };
}

function virt(): VirtState {
  return {
    hosts: [
      { id: 'host1', name: 'kvm-host-01', hypervisor: 'kvm', cpuCores: 16, cpuPct: 38, memTotalMb: 65536, memUsedMb: 41200, vms: 2, health: 'operational' },
      { id: 'host2', name: 'kvm-host-02', hypervisor: 'kvm', cpuCores: 16, cpuPct: 24, memTotalMb: 65536, memUsedMb: 22800, vms: 1, health: 'operational' },
    ],
    vms: [
      { id: 'vm1', name: 'web-edge', state: 'running', vcpus: 2, memMb: 4096, diskGb: 40, os: 'Debian 12', hostId: 'host1', ip: '10.20.0.30', cpuPct: 18, memPct: 44, uptimeSec: 1_209_600 },
      { id: 'vm2', name: 'app-api', state: 'running', vcpus: 4, memMb: 8192, diskGb: 80, os: 'Ubuntu 24.04', hostId: 'host1', ip: '10.20.0.31', cpuPct: 41, memPct: 63, uptimeSec: 864_000 },
      { id: 'vm3', name: 'db-primary', state: 'running', vcpus: 8, memMb: 16384, diskGb: 320, os: 'Rocky Linux 9', hostId: 'host2', ip: '10.20.0.32', cpuPct: 57, memPct: 72, uptimeSec: 2_592_000 },
      { id: 'vm4', name: 'win-bench', state: 'stopped', vcpus: 4, memMb: 8192, diskGb: 120, os: 'Windows Server 2022', hostId: 'host2', cpuPct: 0, memPct: 0, uptimeSec: 0 },
    ],
  };
}

const THREATS = ['ET SCAN Nmap -sS', 'blocked egress to known C2', 'kerberos pre-auth failure (x9)', 'blocked: ads.doubleclick.net', 'DNS tunneling heuristic tripped', 'inbound drop tcp/23 telnet', 'NTLM brute-force throttled'];
const CATS = ['IDS', 'Firewall', 'Auth', 'DNS-Filter', 'Anomaly'] as const;

function makeEvent(): SecurityEvent {
  const sev = pick<Severity>(['info', 'low', 'low', 'medium', 'medium', 'high', 'critical']);
  return {
    id: rid('sec'),
    ts: iso(),
    severity: sev,
    category: pick(CATS),
    source: `10.20.${rint(0, 40)}.${rint(2, 250)}`,
    message: pick(THREATS),
    action: sev === 'critical' || sev === 'high' ? pick(['blocked', 'quarantined'] as const) : pick(['blocked', 'flagged', 'allowed'] as const),
  };
}

function security(): SecurityState {
  const events = Array.from({ length: 16 }, makeEvent);
  return {
    posture: {
      score: 87,
      threatsBlockedToday: 1342,
      activeAlerts: events.filter((e) => e.severity === 'high' || e.severity === 'critical').length,
      idsRulesLoaded: 38211,
      series: series(48, 40, 18, 0),
    },
    events,
    rules: [
      { id: rid('fw'), order: 1, action: 'allow', proto: 'tcp', source: '10.20.0.0/24', dest: 'any', port: '443', hits: 184223, enabled: true },
      { id: rid('fw'), order: 2, action: 'allow', proto: 'udp', source: '10.20.0.0/24', dest: '10.20.0.10', port: '53', hits: 992012, enabled: true },
      { id: rid('fw'), order: 3, action: 'deny', proto: 'any', source: '10.20.40.0/24', dest: '10.20.0.0/24', port: 'any', hits: 4821, enabled: true },
      { id: rid('fw'), order: 4, action: 'drop', proto: 'tcp', source: 'any', dest: 'any', port: '23', hits: 19233, enabled: true },
      { id: rid('fw'), order: 5, action: 'deny', proto: 'tcp', source: 'any', dest: 'any', port: '445', hits: 7740, enabled: true },
    ],
  };
}

export function mockSnapshot(): Snapshot {
  const t = topology();
  const d = dns();
  const dh = dhcp();
  const v = virt();
  const s = security();
  const running = v.vms.filter((vm) => vm.state === 'running').length;
  const online = t.nodes.filter((n) => n.status === 'online').length;
  const throughput = round(t.links.reduce((a, l) => a + l.throughputMbps, 0) / 1000, 2);
  return {
    dashboard: {
      modules: [
        { key: 'topology', label: 'Topology', health: 'operational', backend: 'simulator', summary: `${online}/${t.nodes.length} nodes online` },
        { key: 'dns', label: 'DNS', health: 'operational', backend: 'simulator', summary: `${Math.round(d.stats.qps)} q/s · 96% cache` },
        { key: 'dhcp', label: 'DHCP', health: 'operational', backend: 'simulator', summary: `${dh.stats.activeLeases} leases · 67% used` },
        { key: 'directory', label: 'Directory', health: 'operational', backend: 'simulator', summary: 'NEXRELM.LAN · 6 users' },
        { key: 'virtualization', label: 'Virtualization', health: 'operational', backend: 'simulator', summary: `${running}/${v.vms.length} VMs running` },
        { key: 'security', label: 'Security', health: 'operational', backend: 'simulator', summary: `posture ${s.posture.score} · ${s.posture.activeAlerts} alerts` },
      ],
      kpis: [
        { key: 'devices', label: 'Devices Online', value: online, tone: 'accent', series: t.nodes.map((n) => round(n.load * 100)) },
        { key: 'dns', label: 'DNS Queries', value: Math.round(d.stats.qps), unit: '/s', delta: 3.4, tone: 'violet', series: d.stats.series },
        { key: 'leases', label: 'DHCP Leases', value: dh.stats.activeLeases, delta: 1.1, tone: 'good', series: dh.stats.series },
        { key: 'vms', label: 'VMs Running', value: running, unit: `/${v.vms.length}`, tone: 'accent' },
        { key: 'throughput', label: 'Throughput', value: throughput, unit: 'Gbps', delta: -0.8, tone: 'good', series: d.stats.series.map((x) => round(x / 200, 2)) },
        { key: 'threats', label: 'Threats Blocked', value: s.posture.threatsBlockedToday, delta: 12.5, tone: 'danger', series: s.posture.series },
      ],
      uptimeSec: 4_233_600,
      generatedAt: iso(),
    },
    topology: t,
    dns: d,
    dhcp: dh,
    directory: directory(),
    virt: v,
    security: s,
  };
}

const LOG_LINES: Array<[LogStream, string]> = [
  ['dns', 'cache flush completed'],
  ['dns', 'upstream 9.9.9.9 latency 11ms'],
  ['dhcp', 'DHCPACK to client'],
  ['directory', 'kerberos tgt issued for arivera'],
  ['virt', 'live migration check passed'],
  ['security', 'suricata ruleset updated'],
  ['system', 'module health check passed'],
];

export function mockSubscribe(onEvent: (e: LiveEvent) => void): () => void {
  const timer = setInterval(() => {
    onEvent({ kind: 'metric', key: 'dns.qps', point: { t: Date.now(), v: round(rfloat(900, 2200)) } });
    onEvent({ kind: 'metric', key: 'dhcp.leases', point: { t: Date.now(), v: rint(180, 240) } });
    onEvent({ kind: 'metric', key: 'net.throughput', point: { t: Date.now(), v: round(rfloat(2.4, 4.6), 2) } });
    onEvent({ kind: 'metric', key: 'sec.threats', point: { t: Date.now(), v: rint(0, 90) } });
    if (chance(0.6)) {
      const [stream, msg] = pick(LOG_LINES);
      const line: LogLine = { id: rid('log'), ts: iso(), stream, level: pick<LogLevel>(['info', 'info', 'debug', 'warn']), msg };
      onEvent({ kind: 'log', line });
    }
    if (chance(0.4)) onEvent({ kind: 'alert', event: makeEvent() });
    if (chance(0.3)) {
      const isIot = chance(0.4);
      onEvent({
        kind: 'lease',
        lease: { id: rid('lease'), scopeId: isIot ? 's_iot' : 's_lan', ip: isIot ? `10.20.40.${rint(50, 250)}` : `10.20.0.${rint(100, 250)}`, mac: mac(), hostname: pick(['mbp-aly', 'pixel-9', 'cam-east', 'tablet-recep']), state: 'active', expiresAt: new Date(Date.now() + rint(1, 22) * 3600_000).toISOString() },
      });
    }
  }, 1800);
  return () => clearInterval(timer);
}
