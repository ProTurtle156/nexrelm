/**
 * World — the in-memory model of the network the control plane manages.
 *
 * In this scaffold the World is driven by a SIMULATOR that produces believable
 * live telemetry so the entire GUI is alive end-to-end with zero hardware.
 *
 * To go live, each getter is replaced by a real adapter (CoreDNS/Kea/libvirt/
 * Samba/nftables/Suricata) behind the same shape. The REST + WS surface never
 * changes — only the data source does. See docs/ARCHITECTURE.md.
 */
import { EventEmitter } from 'node:events';
import type {
  DashboardSummary,
  DhcpLease,
  DhcpState,
  DirectoryState,
  DnsState,
  Kpi,
  LeaseState,
  LiveEvent,
  LogLevel,
  LogLine,
  LogStream,
  ModuleStatus,
  SecurityEvent,
  SecurityState,
  Severity,
  Topology,
  VirtState,
  VmState,
} from '@nexrelm/types';

// ───────────────────────────── tiny helpers ─────────────────────────────

const rid = (p: string): string => `${p}_${Math.random().toString(36).slice(2, 9)}`;
const rint = (min: number, max: number): number =>
  Math.floor(Math.random() * (max - min + 1)) + min;
const rfloat = (min: number, max: number): number => Math.random() * (max - min) + min;
const pick = <T>(arr: readonly T[]): T => arr[rint(0, arr.length - 1)]!;
const chance = (p: number): boolean => Math.random() < p;
const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n));
const round = (n: number, d = 0): number => {
  const f = 10 ** d;
  return Math.round(n * f) / f;
};
const iso = (): string => new Date().toISOString();
const mac = (): string =>
  Array.from({ length: 6 }, () => rint(0, 255).toString(16).padStart(2, '0')).join(':');

/** Seed a smooth-ish series of `len` samples wandering around `base`. */
function series(len: number, base: number, jitter: number, floor = 0): number[] {
  const out: number[] = [];
  let v = base;
  for (let i = 0; i < len; i++) {
    v = clamp(v + rfloat(-jitter, jitter), floor, base * 2.5);
    out.push(round(v, 1));
  }
  return out;
}

const SERIES_LEN = 48;
const MAX_EVENTS = 60;
const MAX_LEASES = 64;

// ───────────────────────────── world state ─────────────────────────────

interface WorldState {
  startedAt: number;
  topology: Topology;
  dns: DnsState;
  dhcp: DhcpState;
  directory: DirectoryState;
  virt: VirtState;
  security: SecurityState;
}

function seedTopology(): Topology {
  const nodes: Topology['nodes'] = [
    { id: 'gw', label: 'edge-gateway', kind: 'gateway', ip: '203.0.113.1', status: 'online', load: 0.42, vlan: 1 },
    { id: 'fw', label: 'nexrelm-fw', kind: 'firewall', ip: '10.20.0.1', status: 'online', load: 0.55, vlan: 1 },
    { id: 'core', label: 'core-sw-01', kind: 'switch', ip: '10.20.0.2', status: 'online', load: 0.48, vlan: 1 },
    { id: 'sw1', label: 'access-sw-01', kind: 'switch', ip: '10.20.0.3', status: 'online', load: 0.31, vlan: 10 },
    { id: 'sw2', label: 'access-sw-02', kind: 'switch', ip: '10.20.0.4', status: 'online', load: 0.27, vlan: 40 },
    { id: 'srv-dns', label: 'dns-resolver', kind: 'server', ip: '10.20.0.10', status: 'online', load: 0.6, vlan: 10 },
    { id: 'srv-dc', label: 'dc-01', kind: 'server', ip: '10.20.0.11', status: 'online', load: 0.5, vlan: 10 },
    { id: 'host1', label: 'kvm-host-01', kind: 'host', ip: '10.20.0.20', status: 'online', load: 0.66, vlan: 10 },
    { id: 'host2', label: 'kvm-host-02', kind: 'host', ip: '10.20.0.21', status: 'online', load: 0.44, vlan: 10 },
    { id: 'vm1', label: 'web-edge', kind: 'vm', ip: '10.20.0.30', status: 'online', load: 0.38, vlan: 10 },
    { id: 'vm2', label: 'app-api', kind: 'vm', ip: '10.20.0.31', status: 'online', load: 0.52, vlan: 10 },
    { id: 'vm3', label: 'db-primary', kind: 'vm', ip: '10.20.0.32', status: 'online', load: 0.71, vlan: 10 },
    { id: 'ap1', label: 'ap-floor-2', kind: 'ap', ip: '10.20.0.40', status: 'online', load: 0.34, vlan: 40 },
    { id: 'iot1', label: 'cam-lobby', kind: 'iot', ip: '10.20.40.51', status: 'online', load: 0.18, vlan: 40 },
    { id: 'iot2', label: 'sensor-hvac', kind: 'iot', ip: '10.20.40.52', status: 'degraded', load: 0.12, vlan: 40 },
  ];
  const link = (source: string, target: string, mbps: number): Topology['links'][number] => ({
    id: `${source}-${target}`,
    source,
    target,
    state: 'up',
    throughputMbps: mbps,
  });
  const links: Topology['links'] = [
    link('gw', 'fw', 940),
    link('fw', 'core', 880),
    link('core', 'sw1', 420),
    link('core', 'sw2', 180),
    link('core', 'srv-dns', 120),
    link('core', 'srv-dc', 90),
    link('sw1', 'host1', 610),
    link('sw1', 'host2', 380),
    link('host1', 'vm1', 140),
    link('host1', 'vm2', 220),
    link('host2', 'vm3', 310),
    link('sw2', 'ap1', 160),
    link('ap1', 'iot1', 12),
    link('ap1', 'iot2', 4),
  ];
  for (const n of nodes) n.mac = mac();
  return { nodes, links, updatedAt: iso() };
}

function seedDns(): DnsState {
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
      series: series(SERIES_LEN, 1200, 140, 200),
    },
  };
}

function seedDhcp(): DhcpState {
  const scopes: DhcpState['scopes'] = [
    {
      id: 's_lan', name: 'LAN', cidr: '10.20.0.0/24', rangeStart: '10.20.0.100', rangeEnd: '10.20.0.250',
      gateway: '10.20.0.1', leaseSeconds: 86400, used: 138, total: 151,
    },
    {
      id: 's_iot', name: 'IOT', cidr: '10.20.40.0/24', rangeStart: '10.20.40.50', rangeEnd: '10.20.40.250',
      gateway: '10.20.40.1', leaseSeconds: 43200, used: 64, total: 201,
    },
  ];
  const hostnames = ['mbp-aly', 'thinkpad-ops', 'pixel-9', 'cam-lobby', 'printer-hp', 'roku-tv', 'sonos-kitchen', 'tablet-recep'];
  const leases: DhcpLease[] = Array.from({ length: 22 }, () => {
    const iot = chance(0.4);
    return {
      id: rid('lease'),
      scopeId: iot ? 's_iot' : 's_lan',
      ip: iot ? `10.20.40.${rint(50, 250)}` : `10.20.0.${rint(100, 250)}`,
      mac: mac(),
      hostname: pick(hostnames),
      state: pick<LeaseState>(['active', 'active', 'active', 'reserved', 'offered']),
      expiresAt: new Date(Date.now() + rint(1, 22) * 3600_000).toISOString(),
    };
  });
  return {
    scopes,
    leases,
    stats: {
      scopes: scopes.length,
      activeLeases: leases.filter((l) => l.state === 'active').length + 180,
      utilization: 0.67,
      series: series(SERIES_LEN, 200, 12, 120),
    },
  };
}

function seedDirectory(): DirectoryState {
  return {
    realm: {
      id: 'realm_1', name: 'NEXRELM.LAN', dns: 'nexrelm.lan', mode: 'samba-addc',
      functionalLevel: '2016', dcs: 2, health: 'operational',
    },
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
      { id: rid('g'), name: 'Guests', scope: 'domain-local', members: 1 },
    ],
    ous: [
      { id: rid('ou'), dn: 'OU=Servers,DC=nexrelm,DC=lan', name: 'Servers', objects: 11 },
      { id: rid('ou'), dn: 'OU=Workstations,DC=nexrelm,DC=lan', name: 'Workstations', objects: 38 },
      { id: rid('ou'), dn: 'OU=People,DC=nexrelm,DC=lan', name: 'People', objects: 24 },
    ],
  };
}

function seedVirt(): VirtState {
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

function seedSecurity(): SecurityState {
  const cats = ['IDS', 'Firewall', 'Auth', 'DNS-Filter', 'Anomaly'] as const;
  const events: SecurityEvent[] = Array.from({ length: 16 }, () => makeSecurityEvent(pick(cats)));
  return {
    posture: {
      score: 87,
      threatsBlockedToday: 1342,
      activeAlerts: events.filter((e) => e.severity === 'critical' || e.severity === 'high').length,
      idsRulesLoaded: 38211,
      series: series(SERIES_LEN, 40, 18, 0),
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

const THREAT_MESSAGES: Record<string, string[]> = {
  IDS: ['ET SCAN Nmap -sS window 1024', 'ET EXPLOIT possible CVE-2024-3094 attempt', 'ET MALWARE cobalt strike beacon pattern'],
  Firewall: ['inbound drop tcp/23 telnet', 'rate-limit exceeded from edge', 'blocked egress to known C2'],
  Auth: ['kerberos pre-auth failure (x9)', 'NTLM brute-force throttled', 'admin login from new asn'],
  'DNS-Filter': ['blocked: ads.doubleclick.net', 'blocked: malware-c2.example', 'sinkholed: phishing domain'],
  Anomaly: ['unusual east-west traffic spike', 'new device on IOT vlan', 'DNS tunneling heuristic tripped'],
};

function makeSecurityEvent(category: string): SecurityEvent {
  const sev: Severity = pick<Severity>(['info', 'low', 'low', 'medium', 'medium', 'high', 'critical']);
  const action = sev === 'critical' || sev === 'high' ? pick(['blocked', 'quarantined'] as const) : pick(['blocked', 'flagged', 'allowed'] as const);
  return {
    id: rid('sec'),
    ts: iso(),
    severity: sev,
    category,
    source: `10.20.${rint(0, 40)}.${rint(2, 250)}`,
    message: pick(THREAT_MESSAGES[category] ?? ['suspicious activity']),
    action,
  };
}

const LOG_TEMPLATES: Record<LogStream, string[]> = {
  system: ['module health check passed', 'config reloaded', 'adapter heartbeat ok'],
  dns: ['cache flush completed', 'zone transfer ok lan.nexrelm.io', 'upstream 9.9.9.9 latency 11ms'],
  dhcp: ['DHCPACK to {mac}', 'lease renewed for {host}', 'scope LAN 91% utilized'],
  directory: ['replication cycle complete dc-01 -> dc-02', 'kerberos tgt issued for arivera', 'group policy refreshed'],
  virt: ['domain app-api cpu steal 0.3%', 'live migration check passed', 'snapshot pruned on db-primary'],
  security: ['suricata ruleset updated', 'firewall counters synced', 'posture recalculated: 87'],
};

function makeLog(): LogLine {
  const stream = pick<LogStream>(['system', 'dns', 'dhcp', 'directory', 'virt', 'security']);
  const level = pick<LogLevel>(['info', 'info', 'info', 'debug', 'warn']);
  const tmpl = pick(LOG_TEMPLATES[stream]);
  return {
    id: rid('log'),
    ts: iso(),
    stream,
    level,
    msg: tmpl.replace('{mac}', mac()).replace('{host}', pick(['mbp-aly', 'pixel-9', 'cam-lobby'])),
  };
}

// ───────────────────────────── World ─────────────────────────────

export class World {
  private readonly bus = new EventEmitter();
  private timer: NodeJS.Timeout | null = null;
  private readonly state: WorldState;

  constructor() {
    this.bus.setMaxListeners(0);
    this.state = {
      startedAt: Date.now(),
      topology: seedTopology(),
      dns: seedDns(),
      dhcp: seedDhcp(),
      directory: seedDirectory(),
      virt: seedVirt(),
      security: seedSecurity(),
    };
  }

  start(tickMs: number): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), tickMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Subscribe to the live event stream. Returns an unsubscribe function. */
  subscribe(fn: (e: LiveEvent) => void): () => void {
    this.bus.on('event', fn);
    return () => this.bus.off('event', fn);
  }

  private emit(e: LiveEvent): void {
    this.bus.emit('event', e);
  }

  // ── getters (REST surface) ──────────────────────────────────────────────
  getTopology(): Topology {
    return this.state.topology;
  }
  getDns(): DnsState {
    return this.state.dns;
  }
  getDhcp(): DhcpState {
    return this.state.dhcp;
  }
  getDirectory(): DirectoryState {
    return this.state.directory;
  }
  getVirt(): VirtState {
    return this.state.virt;
  }
  getSecurity(): SecurityState {
    return this.state.security;
  }

  getModules(): ModuleStatus[] {
    const s = this.state;
    const onlineNodes = s.topology.nodes.filter((n) => n.status === 'online').length;
    return [
      { key: 'topology', label: 'Topology', health: 'operational', backend: 'simulator', summary: `${onlineNodes}/${s.topology.nodes.length} nodes online` },
      { key: 'dns', label: 'DNS', health: 'operational', backend: 'simulator', summary: `${Math.round(s.dns.stats.qps)} q/s · ${Math.round(s.dns.stats.cacheHitRate * 100)}% cache` },
      { key: 'dhcp', label: 'DHCP', health: 'operational', backend: 'simulator', summary: `${s.dhcp.stats.activeLeases} leases · ${Math.round(s.dhcp.stats.utilization * 100)}% used` },
      { key: 'directory', label: 'Directory', health: s.directory.realm.health, backend: 'simulator', summary: `${s.directory.realm.name} · ${s.directory.users.length} users` },
      { key: 'virtualization', label: 'Virtualization', health: 'operational', backend: 'simulator', summary: `${s.virt.vms.filter((v) => v.state === 'running').length}/${s.virt.vms.length} VMs running` },
      { key: 'security', label: 'Security', health: s.security.posture.score > 80 ? 'operational' : 'degraded', backend: 'simulator', summary: `posture ${s.security.posture.score} · ${s.security.posture.activeAlerts} alerts` },
    ];
  }

  getDashboard(): DashboardSummary {
    const s = this.state;
    const devicesOnline = s.topology.nodes.filter((n) => n.status === 'online').length;
    const throughput = round(s.topology.links.reduce((a, l) => a + l.throughputMbps, 0) / 1000, 2);
    const kpis: Kpi[] = [
      { key: 'devices', label: 'Devices Online', value: devicesOnline, unit: '', tone: 'accent', series: s.topology.nodes.map((n) => round(n.load * 100)) },
      { key: 'dns', label: 'DNS Queries', value: Math.round(s.dns.stats.qps), unit: '/s', delta: 3.4, tone: 'violet', series: s.dns.stats.series },
      { key: 'leases', label: 'DHCP Leases', value: s.dhcp.stats.activeLeases, unit: '', delta: 1.1, tone: 'good', series: s.dhcp.stats.series },
      { key: 'vms', label: 'VMs Running', value: s.virt.vms.filter((v) => v.state === 'running').length, unit: `/${s.virt.vms.length}`, tone: 'accent' },
      { key: 'throughput', label: 'Throughput', value: throughput, unit: 'Gbps', delta: -0.8, tone: 'good', series: s.dns.stats.series.map((v) => round(v / 200, 2)) },
      { key: 'threats', label: 'Threats Blocked', value: s.security.posture.threatsBlockedToday, unit: '', delta: 12.5, tone: 'danger', series: s.security.posture.series },
    ];
    return {
      modules: this.getModules(),
      kpis,
      uptimeSec: Math.floor((Date.now() - s.startedAt) / 1000),
      generatedAt: iso(),
    };
  }

  // ── mutations (POST surface — make the GUI buttons real) ─────────────────
  setVmState(id: string, next: VmState): boolean {
    const vm = this.state.virt.vms.find((v) => v.id === id);
    if (!vm) return false;
    vm.state = next;
    if (next === 'running') {
      vm.cpuPct = rint(8, 30);
      vm.memPct = rint(30, 60);
    } else if (next === 'stopped') {
      vm.cpuPct = 0;
      vm.memPct = 0;
      vm.uptimeSec = 0;
    }
    this.emit({ kind: 'log', line: { id: rid('log'), ts: iso(), stream: 'virt', level: 'info', msg: `domain ${vm.name} -> ${next}` } });
    return true;
  }

  toggleFirewallRule(id: string): boolean {
    const rule = this.state.security.rules.find((r) => r.id === id);
    if (!rule) return false;
    rule.enabled = !rule.enabled;
    this.emit({ kind: 'log', line: { id: rid('log'), ts: iso(), stream: 'security', level: 'warn', msg: `firewall rule #${rule.order} ${rule.enabled ? 'enabled' : 'disabled'}` } });
    return true;
  }

  // ── the simulation tick ──────────────────────────────────────────────────
  private tick(): void {
    const s = this.state;

    // DNS query rate wanders
    s.dns.stats.qps = clamp(s.dns.stats.qps + rfloat(-90, 95), 240, 3200);
    s.dns.stats.cacheHitRate = clamp(s.dns.stats.cacheHitRate + rfloat(-0.01, 0.01), 0.86, 0.995);
    pushSeries(s.dns.stats.series, round(s.dns.stats.qps, 1));
    this.emit({ kind: 'metric', key: 'dns.qps', point: { t: Date.now(), v: round(s.dns.stats.qps) } });

    // throughput + node loads
    let total = 0;
    for (const l of s.topology.links) {
      l.throughputMbps = clamp(l.throughputMbps + rfloat(-40, 40), 0, 1000);
      total += l.throughputMbps;
      if (chance(0.02)) l.state = pick(['up', 'up', 'degraded']);
    }
    for (const n of s.topology.nodes) {
      n.load = clamp(n.load + rfloat(-0.06, 0.06), 0.02, 0.98);
    }
    s.topology.updatedAt = iso();
    this.emit({ kind: 'metric', key: 'net.throughput', point: { t: Date.now(), v: round(total / 1000, 2) } });
    if (chance(0.25)) this.emit({ kind: 'topology', topology: s.topology });

    // DHCP utilization drifts
    s.dhcp.stats.utilization = clamp(s.dhcp.stats.utilization + rfloat(-0.015, 0.015), 0.2, 0.97);
    s.dhcp.stats.activeLeases = clamp(s.dhcp.stats.activeLeases + rint(-2, 3), 80, 360);
    pushSeries(s.dhcp.stats.series, s.dhcp.stats.activeLeases);
    this.emit({ kind: 'metric', key: 'dhcp.leases', point: { t: Date.now(), v: s.dhcp.stats.activeLeases } });

    // occasional new lease
    if (chance(0.3)) {
      const lease: DhcpLease = {
        id: rid('lease'),
        scopeId: chance(0.4) ? 's_iot' : 's_lan',
        ip: chance(0.4) ? `10.20.40.${rint(50, 250)}` : `10.20.0.${rint(100, 250)}`,
        mac: mac(),
        hostname: pick(['mbp-aly', 'pixel-9', 'thinkpad-ops', 'tablet-recep', 'cam-east']),
        state: 'active',
        expiresAt: new Date(Date.now() + rint(1, 22) * 3600_000).toISOString(),
      };
      s.dhcp.leases.unshift(lease);
      if (s.dhcp.leases.length > MAX_LEASES) s.dhcp.leases.pop();
      this.emit({ kind: 'lease', lease });
    }

    // VM telemetry
    for (const vm of s.virt.vms) {
      if (vm.state !== 'running') continue;
      vm.cpuPct = clamp(vm.cpuPct + rint(-6, 6), 1, 99);
      vm.memPct = clamp(vm.memPct + rint(-3, 3), 5, 97);
      vm.uptimeSec += Math.round((this.timer ? 2 : 2));
    }
    const cpuAvg = round(avg(s.virt.vms.filter((v) => v.state === 'running').map((v) => v.cpuPct)));
    this.emit({ kind: 'metric', key: 'cpu.avg', point: { t: Date.now(), v: cpuAvg } });

    // security: threats + occasional event/alert
    const threatRate = clamp(s.security.posture.series.at(-1)! + rfloat(-10, 12), 0, 140);
    pushSeries(s.security.posture.series, round(threatRate));
    s.security.posture.threatsBlockedToday += rint(0, 9);
    this.emit({ kind: 'metric', key: 'sec.threats', point: { t: Date.now(), v: round(threatRate) } });

    if (chance(0.4)) {
      const ev = makeSecurityEvent(pick(['IDS', 'Firewall', 'Auth', 'DNS-Filter', 'Anomaly']));
      s.security.events.unshift(ev);
      if (s.security.events.length > MAX_EVENTS) s.security.events.pop();
      s.security.posture.activeAlerts = s.security.events.filter((e) => e.severity === 'critical' || e.severity === 'high').length;
      this.emit({ kind: 'alert', event: ev });
    }
    s.security.posture.score = clamp(s.security.posture.score + rfloat(-0.6, 0.5), 62, 98);

    // (logs now come from the real logbus, not simulated here)

    // refresh a module summary occasionally
    if (chance(0.2)) this.emit({ kind: 'module', status: pick(this.getModules()) });
  }
}

function pushSeries(arr: number[], v: number): void {
  arr.push(v);
  if (arr.length > SERIES_LEN) arr.shift();
}

function avg(arr: number[]): number {
  return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
}

/** Singleton world for the process. */
export const world = new World();
