/**
 * @nexrelm/types — the single source of truth for Nexrelm's domain models
 * and the REST + WebSocket contract shared by the control plane and the GUI.
 *
 * Everything the network knows about itself flows through these shapes.
 */

// ───────────────────────────── Modules & health ─────────────────────────────

export const MODULES = [
  'topology',
  'dns',
  'dhcp',
  'directory',
  'virtualization',
  'security',
] as const;

export type ModuleKey = (typeof MODULES)[number];

export const MODULE_LABELS: Record<ModuleKey, string> = {
  topology: 'Topology',
  dns: 'DNS',
  dhcp: 'DHCP',
  directory: 'Directory',
  virtualization: 'Virtualization',
  security: 'Security',
};

export type Health = 'operational' | 'degraded' | 'offline' | 'disabled';

/** Where a module's data comes from right now. */
export type Backend = 'simulator' | 'live';

export interface ModuleStatus {
  key: ModuleKey;
  label: string;
  health: Health;
  /** One-line human summary, e.g. "1,284 q/min · 98% cache". */
  summary: string;
  backend: Backend;
}

// ───────────────────────────── API envelope ─────────────────────────────

export interface ApiMeta {
  total?: number;
  page?: number;
  limit?: number;
  generatedAt?: string;
}

export interface ApiResponse<T> {
  ok: boolean;
  data: T | null;
  error: string | null;
  meta?: ApiMeta;
}

// ───────────────────────────── Topology ─────────────────────────────

export type NodeKind =
  | 'gateway'
  | 'firewall'
  | 'router'
  | 'switch'
  | 'ap'
  | 'server'
  | 'host'
  | 'vm'
  | 'container'
  | 'iot'
  | 'unknown';

export type LinkState = 'up' | 'degraded' | 'down';

export interface TopoNode {
  id: string;
  label: string;
  kind: NodeKind;
  ip?: string;
  mac?: string;
  status: 'online' | 'offline' | 'degraded';
  /** Normalized 0..1 load — drives glow intensity in the GUI. */
  load: number;
  vlan?: number;
  meta?: Record<string, string | number>;
}

export interface TopoLink {
  id: string;
  source: string;
  target: string;
  state: LinkState;
  /** Mbps — drives animated edge flow speed. */
  throughputMbps: number;
}

export interface Topology {
  nodes: TopoNode[];
  links: TopoLink[];
  updatedAt: string;
}

// ───────────────────────────── DNS ─────────────────────────────

export type DnsRecordType =
  | 'A'
  | 'AAAA'
  | 'CNAME'
  | 'MX'
  | 'TXT'
  | 'NS'
  | 'PTR'
  | 'SRV';

export interface DnsRecord {
  id: string;
  zoneId: string;
  name: string;
  type: DnsRecordType;
  value: string;
  ttl: number;
}

export interface DnsZone {
  id: string;
  name: string;
  kind: 'primary' | 'secondary' | 'forward' | 'stub';
  records: number;
  dnssec: boolean;
  serial: number;
}

export interface DnsUpstream {
  addr: string;
  healthy: boolean;
  latencyMs: number;
}

export interface DnsStats {
  qps: number;
  cacheHitRate: number; // 0..1
  blockedToday: number;
  upstreams: DnsUpstream[];
  series: number[];
}

export interface DnsState {
  zones: DnsZone[];
  records: DnsRecord[];
  stats: DnsStats;
}

// ───────────────────────────── DHCP ─────────────────────────────

export type LeaseState = 'active' | 'reserved' | 'offered' | 'expired';

export interface DhcpScope {
  id: string;
  name: string;
  cidr: string;
  rangeStart: string;
  rangeEnd: string;
  gateway: string;
  leaseSeconds: number;
  used: number;
  total: number;
}

export interface DhcpLease {
  id: string;
  scopeId: string;
  ip: string;
  mac: string;
  hostname: string;
  state: LeaseState;
  expiresAt: string;
}

export interface DhcpStats {
  scopes: number;
  activeLeases: number;
  utilization: number; // 0..1
  series: number[];
}

export interface DhcpState {
  scopes: DhcpScope[];
  leases: DhcpLease[];
  stats: DhcpStats;
}

// ───────────────────────────── Directory (AD / Kerberos realm) ─────────────────────────────

export interface Realm {
  id: string;
  name: string; // NEXRELM.LAN
  dns: string; // nexrelm.lan
  mode: 'samba-addc' | 'ldap' | 'freeipa' | 'none';
  functionalLevel: string;
  dcs: number;
  health: Health;
}

export interface DirUser {
  id: string;
  username: string;
  displayName: string;
  email?: string;
  groups: string[];
  enabled: boolean;
  admin: boolean;
  lastLogon?: string;
}

export interface DirGroup {
  id: string;
  name: string;
  scope: 'global' | 'domain-local' | 'universal';
  members: number;
}

export interface OrgUnit {
  id: string;
  dn: string;
  name: string;
  objects: number;
}

export interface DirectoryState {
  realm: Realm;
  users: DirUser[];
  groups: DirGroup[];
  ous: OrgUnit[];
}

// ───────────────────────────── Virtualization ─────────────────────────────

export type VmState = 'running' | 'stopped' | 'paused' | 'suspended' | 'error';

export interface Vm {
  id: string;
  name: string;
  state: VmState;
  vcpus: number;
  memMb: number;
  diskGb: number;
  os: string;
  hostId: string;
  ip?: string;
  cpuPct: number;
  memPct: number;
  uptimeSec: number;
}

export interface VmHost {
  id: string;
  name: string;
  hypervisor: 'kvm' | 'qemu' | 'lxc';
  cpuCores: number;
  cpuPct: number;
  memTotalMb: number;
  memUsedMb: number;
  vms: number;
  health: Health;
}

export interface VirtState {
  hosts: VmHost[];
  vms: Vm[];
}

// ───────────────────────────── Security ─────────────────────────────

export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export type SecurityAction =
  | 'blocked'
  | 'allowed'
  | 'flagged'
  | 'quarantined';

export interface SecurityEvent {
  id: string;
  ts: string;
  severity: Severity;
  category: string;
  source: string;
  message: string;
  action: SecurityAction;
}

export interface FirewallRule {
  id: string;
  order: number;
  action: 'allow' | 'deny' | 'drop';
  proto: 'tcp' | 'udp' | 'icmp' | 'any';
  source: string;
  dest: string;
  port: string;
  hits: number;
  enabled: boolean;
}

export interface SecurityPosture {
  score: number; // 0..100
  threatsBlockedToday: number;
  activeAlerts: number;
  idsRulesLoaded: number;
  series: number[];
}

export interface SecurityState {
  posture: SecurityPosture;
  events: SecurityEvent[];
  rules: FirewallRule[];
}

// ───────────────────────────── Metrics & dashboard ─────────────────────────────

export interface MetricPoint {
  t: number; // epoch ms
  v: number;
}

export type KpiTone = 'accent' | 'good' | 'warn' | 'danger' | 'violet';

export interface Kpi {
  key: string;
  label: string;
  value: number;
  unit?: string;
  /** Percentage change vs the previous window. */
  delta?: number;
  series?: number[];
  tone?: KpiTone;
}

export interface DashboardSummary {
  modules: ModuleStatus[];
  kpis: Kpi[];
  uptimeSec: number;
  generatedAt: string;
}

// ───────────────────────────── Logs & live events ─────────────────────────────

export type LogStream =
  | 'system'
  | 'dns'
  | 'dhcp'
  | 'directory'
  | 'virt'
  | 'security';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

// ── Onboarding — guided "put Nexrelm on the path" setup ───────────────────────
export interface OnboardingCaps {
  /** tcpdump has cap_net_raw → the promiscuous sniffer can capture. */
  capture: boolean;
  /** nmap has cap_net_raw → SYN / version / OS scans work. */
  scan: boolean;
}

export interface OnboardingState {
  lan: { ip: string; cidr: string; iface: string };
  wanIface: string;
  /** the IP to enter as the DNS server on a router/device to route DNS through Nexrelm. */
  dnsPointAt: string;
  caps: OnboardingCaps;
  /** the inline-gateway root helper is installed (LAN-gateway mode is possible). */
  gatewayAvailable: boolean;
  posture: NetworkPosture;
  /** real external traffic is visible to Nexrelm right now (DNS clients or captured packets). */
  trafficFlowing: boolean;
  trafficSignal: string;
  /** safest default integration path for this environment. */
  recommended: 'dns' | 'gateway';
}

export interface OnboardingVerify {
  flowing: boolean;
  dnsClients: number;
  packetsDelta: number;
  detail: string;
}

// ── Auth / first-run setup ────────────────────────────────────────────────────
export interface AuthStatus {
  /** False until the install wizard has created the admin account. */
  initialized: boolean;
}

/** Returned exactly once by the install wizard — the generated admin password. */
export interface AuthSetupResult {
  username: string;
  password: string;
}

export interface AuthSession {
  token: string;
  username: string;
  /** True on first login (auto-generated password) until the user changes it. */
  mustChangePassword: boolean;
}

export interface AuthMe {
  username: string;
  mustChangePassword: boolean;
}

/** Read-only account summary for the `nexrelm status` CLI. */
export interface AuthAccountInfo {
  initialized: boolean;
  username?: string;
  mustChangePassword?: boolean;
  activeSessions?: number;
  createdAt?: string;
  updatedAt?: string;
  /** True while a brute-force lockout is in effect. */
  locked?: boolean;
}

// ── System (backend) settings — data retention & maintenance ─────────────────
export interface SystemSettings {
  /** Days to keep DNS query-log rows (0 = keep forever). Mirrors the resolver's dbMaxDays. */
  dnsQueryRetentionDays: number;
  /** Days to keep idle DNS client entries (0 = keep forever). Mirrors ipMaxDays. */
  dnsClientRetentionDays: number;
  /** Days to keep security events (0 = keep forever). */
  securityEventRetentionDays: number;
  /** Days to keep expired/released DHCP leases (0 = keep forever). */
  dhcpLeaseRetentionDays: number;
  /** In-memory unified log buffer size, in lines. */
  logBufferLines: number;
}

export interface SystemStorageFile {
  file: string;
  bytes: number;
}

export interface SystemInfo {
  settings: SystemSettings;
  storage: SystemStorageFile[];
}

/** Rows actually removed by a retention prune. */
export interface SystemPruneResult {
  dnsQueries: number;
  dnsClients: number;
  securityEvents: number;
  dhcpLeases: number;
}

export interface LogLine {
  id: string;
  ts: string;
  stream: LogStream;
  level: LogLevel;
  msg: string;
}

/** Discriminated union streamed over the WebSocket channel. */
export type LiveEvent =
  | { kind: 'metric'; key: string; point: MetricPoint }
  | { kind: 'log'; line: LogLine }
  | { kind: 'alert'; event: SecurityEvent }
  | { kind: 'topology'; topology: Topology }
  | { kind: 'lease'; lease: DhcpLease }
  | { kind: 'module'; status: ModuleStatus };

// ───────────────────────────── Helpers ─────────────────────────────

export const SEVERITY_RANK: Record<Severity, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
  info: 0,
};

// ═══════════════════════════ DNS resolver (Pi-hole-style) ═══════════════════════════
// The real network resolver: forwards to chosen upstreams, blocks/allows by list,
// logs every query, and tracks LAN clients. Point your router's DHCP DNS at the
// machine running this and every device is filtered. Separate from the demo
// DnsState above (which the simulator still drives until the GUI is migrated).

export type DnsListType = 'block' | 'allow';
export type DnsDomainKind = 'exact' | 'regex';

/** A manually-managed block/allow entry (exact name or regex), scoped to groups. */
export interface DnsListDomain {
  id: number;
  type: DnsListType;
  kind: DnsDomainKind;
  domain: string;
  enabled: boolean;
  comment?: string;
  /** Group ids this entry applies to. Empty ⇒ the Default group (0). */
  groups: number[];
  /** Higher wins when a domain is on multiple lists. Manual entries default high. */
  priority: number;
  hits: number;
  dateAdded: string;
}

/** A remote list (block or allow) subscribed by URL. */
export interface DnsAdlist {
  id: number;
  url: string;
  /** Whether this subscribed list blocks or allows its domains. */
  type: DnsListType;
  enabled: boolean;
  comment?: string;
  /** Domains compiled from this list on the last update run. */
  count: number;
  status: 'ok' | 'error' | 'pending' | 'downloading';
  groups: number[];
  /** Higher wins when a domain is on multiple lists. */
  priority: number;
  updatedAt?: string;
}

/** A client group: a named bundle of lists you can apply to selected clients. */
export interface DnsGroup {
  id: number;
  name: string;
  enabled: boolean;
  comment?: string;
}

/** A tracked LAN client — the "information stream" row. */
export interface DnsClient {
  id: number;
  ip: string;
  /** Hostname, e.g. switch284508.corp.example.com */
  name?: string;
  /** MAC, e.g. 8c:84:42:28:45:08 */
  mac?: string;
  /** OUI vendor, e.g. "Cisco Systems, Inc" */
  vendor?: string;
  /** Interface the client was seen on, e.g. eth0 */
  interface?: string;
  firstSeen: string;
  lastSeen: string;
  queries: number;
  /** Group ids this client is linked to. Empty ⇒ Default group (0). */
  groups: number[];
  /** Operator-assigned friendly name; shown instead of the hostname. */
  nickname?: string;
}

export type QueryStatus =
  | 'forwarded'
  | 'cached'
  | 'blocked' // gravity / blocklist
  | 'allowed' // explicitly allowlisted
  | 'nxdomain'
  | 'refused' // rate-limited / refused
  | 'local'; // answered from hosts / conditional forwarding

/** One row in the query log. */
export interface DnsQuery {
  id: number;
  ts: string;
  client: string; // ip
  clientName?: string;
  domain: string;
  type: string; // A, AAAA, HTTPS, PTR, …
  status: QueryStatus;
  upstream?: string;
  replyMs: number;
  reply?: string; // first answer / 0.0.0.0 / NXDOMAIN
  listId?: number; // the list that blocked/allowed it
}

/** A selectable upstream resolver, with its privacy/security traits. */
export interface UpstreamPreset {
  id: string;
  name: string;
  ipv4: string[];
  ipv6: string[];
  ecs: boolean;
  dnssec: boolean;
}

export type BlockingMode = 'null' | 'nxdomain' | 'refused'; // null ⇒ 0.0.0.0 / ::

/** A conditional-forwarding reverse server. */
export interface CondForwardRule {
  enabled: boolean;
  cidr: string; // 192.168.1.0/24
  target: string; // 192.168.1.1[#port]
  domain?: string; // lan / fritz.box
}

/** How the resolver listens on the network. */
export type ListenMode = 'local' | 'single' | 'bind' | 'all';

export interface DnsResolverSettings {
  // routing
  upstreams: string[]; // active upstreams, e.g. ['8.8.8.8', '1.1.1.1#53']
  blockingMode: BlockingMode;
  // domain
  localDomain: string; // 'lan'
  expandHostnames: boolean;
  // rate limiting (per client)
  rateLimitCount: number; // 1000
  rateLimitWindow: number; // 60 (seconds); 0/0 disables
  // interface
  bindAddress: string; // '192.168.1.2' | '0.0.0.0'
  port: number; // 53 (or 5335 in dev)
  listenMode: ListenMode;
  iface: string; // 'wlan0' / 'eth0'
  // advanced
  neverForwardNonFqdn: boolean;
  neverForwardReversePrivate: boolean;
  dnssec: boolean;
  /** Send EDNS Client Subnet to upstreams (geo-accurate, less private). */
  ecs: boolean;
  // conditional forwarding
  condForwarding: CondForwardRule[];
  // privacy / logging
  /** Record queries to the long-term database + query log. */
  logQueries: boolean;
  /** 0 everything · 1 hide domains · 2 hide domains+clients · 3 anonymous (no history). */
  privacyLevel: 0 | 1 | 2 | 3;
  /** Days to keep query rows before pruning. */
  dbMaxDays: number;
  /** Days to keep client (network address) rows. */
  ipMaxDays: number;
}

/** Global blocking on/off, optionally disabled until a timestamp. */
export interface BlockingState {
  enabled: boolean;
  /** When blocking is paused: ISO time it resumes, or null for indefinite. */
  disabledUntil: string | null;
}

export interface DnsResolverStatus {
  running: boolean;
  bind: string; // actually-bound address
  port: number; // actual port (53 privileged, or 5335 fallback)
  privileged: boolean;
  startedAt?: string;
  message?: string; // e.g. "fell back to :5335 — :53 needs CAP_NET_BIND_SERVICE"
  upstreams: Array<{ addr: string; healthy: boolean; latencyMs: number }>;
  /** Global blocking state (paused via the "disable blocking" control). */
  blocking: BlockingState;
}

export interface DnsCountPair {
  domain: string;
  count: number;
}

export interface DnsResolverStats {
  totalQueries: number;
  blocked: number;
  blockedPct: number; // 0..100
  cached: number;
  forwarded: number;
  uniqueClients: number;
  uniqueDomains: number;
  domainsOnLists: number; // gravity + manual block entries
  activeClients: number;
  /** 24h, bucketed. */
  series: Array<{ t: number; total: number; blocked: number }>;
  topAllowed: DnsCountPair[];
  topBlocked: DnsCountPair[];
  topClients: Array<{ client: string; name?: string; count: number }>;
  topClientsByBlocked: Array<{ client: string; name?: string; count: number }>;
  queryTypes: Array<{ type: string; count: number }>;
  upstreamsUsed: Array<{ upstream: string; count: number }>;
  replyTimeMs: number; // avg
}

/** A hit when searching a domain across every list. */
export interface DnsListMatch {
  listId: number;
  type: DnsListType;
  kind: DnsDomainKind;
  domain: string; // the entry that matched
  enabled: boolean;
  groups: number[];
  source: 'manual' | 'adlist';
  adlistUrl?: string;
}

// ═══════════════════════════ DHCP server (Windows-DHCP parity) ═══════════════════════════
// A real DHCP server: hands out leases on the LAN, honoring scopes, exclusions,
// reservations, options, policies and MAC filters. OFF by default — it conflicts
// with the router's DHCP, so the router's must be disabled first. Separate from
// the demo DhcpState above (which the simulator still drives).

/** A single DHCP option value (option code → encoded value). */
export interface DhcpOptionValue {
  code: number; // 3 router, 6 dns, 15 domain, 42 ntp, 44/46 wins, 51 lease, 66/67 boot…
  value: string; // single value, or comma-separated for list options (IPs)
}

/** Catalog entry describing a known option for the UI. */
export interface DhcpOptionDef {
  code: number;
  name: string;
  kind: 'ip' | 'ips' | 'string' | 'number' | 'hex' | 'bool';
  common: boolean; // shown in the simple options list vs. the advanced catalog
  hint?: string;
}

export type DhcpScopeState = 'active' | 'disabled';

/** Per-scope DNS: inherit the server default, force Nexrelm's resolver, or custom. */
export type DhcpDnsMode = 'inherit' | 'nexrelm' | 'custom';

/** A scope: an address range + its lease policy and options. */
export interface DhcpScopeDef {
  id: string;
  name: string;
  description?: string;
  state: DhcpScopeState;
  subnet: string; // 192.168.1.0
  mask: string; // 255.255.255.0
  rangeStart: string; // 192.168.1.100
  rangeEnd: string; // 192.168.1.200
  leaseSeconds: number;
  /** DNS handed to clients in this scope (option 006). */
  dnsMode: DhcpDnsMode;
  /** Custom DNS servers used when dnsMode === 'custom'. */
  dnsServers: string[];
  /** Scope-level options (override server options). */
  options: DhcpOptionValue[];
}

export interface DhcpExclusion {
  id: string;
  scopeId: string;
  start: string;
  end: string;
}

export type DhcpReservationType = 'both' | 'dhcp' | 'bootp';

export interface DhcpReservation {
  id: string;
  scopeId: string;
  ip: string;
  mac: string;
  name?: string;
  description?: string;
  supported: DhcpReservationType;
  options: DhcpOptionValue[];
}

export type DhcpLeaseState = 'active' | 'expired' | 'reserved' | 'declined' | 'offered' | 'released';

export interface DhcpLeaseInfo {
  id: string;
  scopeId: string;
  ip: string;
  mac: string;
  hostname?: string;
  vendor?: string;
  state: DhcpLeaseState;
  startedAt: string;
  expiresAt: string;
  clientId?: string;
}

export type DhcpFilterType = 'allow' | 'deny';

/** A MAC allow/deny filter entry (full MAC or a prefix like 8c:84:42). */
export interface DhcpFilter {
  id: string;
  mac: string;
  type: DhcpFilterType;
  description?: string;
}

export interface DhcpFilterSettings {
  allowEnabled: boolean; // when on, only Allow-listed MACs are served
  denyEnabled: boolean; // when on, Deny-listed MACs are refused
}

export type DhcpPolicyCondition = 'mac' | 'vendor' | 'user';

/** A policy: match clients by MAC/vendor/user class → apply extra options. */
export interface DhcpPolicy {
  id: string;
  scopeId: string;
  name: string;
  enabled: boolean;
  conditionType: DhcpPolicyCondition;
  conditionValue: string; // MAC prefix, vendor class string, or user class string
  options: DhcpOptionValue[];
}

export interface DhcpServerSettings {
  enabled: boolean; // master switch — OFF by default (conflicts with the router's DHCP)
  iface: string; // interface to serve on (e.g. wlan0)
  serverIp: string; // this server's address — option 54 / siaddr
  port: number; // 67
  /** Ping the candidate address before offering it (0 = disabled). */
  conflictDetectionAttempts: number;
  authoritative: boolean; // NAK requests for addresses outside our scopes
  /** Register leases as A/PTR in the Nexrelm DNS resolver. */
  ddnsUpdate: boolean;
  /** Hand out Nexrelm's own DNS (serverIp) as option 006 to all clients. */
  useOwnDns: boolean;
  /** Used when useOwnDns is false. */
  customDns: string[];
  /** Default option 015 domain name. */
  domainName: string;
}

/** Active DHCP discovery probe — finds every DHCP server answering on the LAN. */
export interface DhcpServerSeen {
  server: string; // server-id (option 54)
  offered: string; // address it offered
  router?: string; // gateway it would push (option 3)
  dns?: string; // first DNS it would push (option 6)
}
export interface DhcpProbeResult {
  ranAt: string;
  durationMs: number;
  servers: DhcpServerSeen[];
  rogue: boolean; // more than one server answered → a rogue is present
}

export interface DhcpServerStatus {
  running: boolean;
  enabled: boolean;
  bind: string; // 0.0.0.0:67 or an error reason
  message?: string;
  startedAt?: string;
}

export interface DhcpServerStats {
  scopes: number;
  totalAddresses: number;
  inUse: number;
  available: number;
  reserved: number;
  utilization: number; // 0..1
  // BOOTP/DHCP message counters since start
  discovers: number;
  offers: number;
  requests: number;
  acks: number;
  naks: number;
  declines: number;
  releases: number;
  informs: number;
  /** Per-scope utilization for the dashboard. */
  perScope: Array<{ scopeId: string; name: string; inUse: number; total: number; utilization: number }>;
}

// ═══════════════════════════ Directory (real AD / Samba) ═══════════════════════════
// A live Active Directory / Samba management surface. Connect to a domain
// controller with admin credentials, then manage users, groups, devices and DCs.
// Separate from the demo DirectoryState above (which the simulator still drives).

export type DirectoryMode = 'ad' | 'samba';

/** How to secure the LDAP connection. */
export type DirectorySecurity = 'plain' | 'starttls' | 'ldaps';

export interface DirectoryConnectInput {
  mode: DirectoryMode;
  host: string; // DC hostname or IP (optionally host:port)
  domain: string; // NEXRELM.LAN
  username: string; // administrator (sAMAccountName, DOMAIN\\user or UPN)
  password: string;
  /** plain LDAP :389 · StartTLS :389 · LDAPS :636. */
  security: DirectorySecurity;
  /** Retain this connection (encrypted at rest) and auto-reconnect on restart. */
  remember?: boolean;
}

export interface DirectoryStatus {
  connected: boolean;
  mode?: DirectoryMode;
  domain?: string; // NEXRELM.LAN
  baseDN?: string; // DC=nexrelm,DC=lan
  host?: string;
  username?: string;
  connectedAt?: string;
  /** Last error (e.g. bind failed / connection dropped → re-prompt). */
  error?: string;
  /** True when this connection is retained (encrypted) and survives restarts. */
  remembered?: boolean;
}

export interface AdUser {
  dn: string;
  username: string; // sAMAccountName
  displayName: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  upn?: string; // userPrincipalName
  description?: string;
  enabled: boolean;
  locked?: boolean;
  admin: boolean;
  groups: string[]; // group names (memberOf)
  ou: string; // parent container/OU (friendly)
  lastLogon?: string;
  created?: string;
  pwdLastSet?: string;
}

export interface AdUserInput {
  username: string;
  firstName?: string;
  lastName?: string;
  displayName?: string;
  email?: string;
  password?: string; // on create
  description?: string;
  ou?: string; // target OU DN (defaults to Users container)
  enabled?: boolean;
}

export type AdGroupScope = 'global' | 'domainLocal' | 'universal';
export type AdGroupType = 'security' | 'distribution';

export interface AdGroup {
  dn: string;
  name: string; // sAMAccountName / cn
  description?: string;
  scope: AdGroupScope;
  type: AdGroupType;
  memberCount: number;
  members?: string[]; // member names
  ou: string;
}

export interface AdGroupInput {
  name: string;
  description?: string;
  scope?: AdGroupScope;
  type?: AdGroupType;
  ou?: string;
}

export interface AdComputer {
  dn: string;
  name: string; // sAMAccountName without trailing $
  dnsName?: string;
  /** Best-effort IPv4, resolved live from the DC's own DNS (A record). */
  ip?: string;
  os?: string;
  osVersion?: string;
  enabled: boolean;
  owner?: string; // managedBy / inferred user
  lastLogon?: string;
  created?: string;
  isServer: boolean;
  isDc: boolean;
}

export interface AdDomainController {
  name: string;
  dnsName: string;
  os?: string;
  site?: string;
  ip?: string;
  roles: string[]; // FSMO roles held
}

export interface AdServerInfo {
  name: string;
  dnsName?: string;
  os?: string;
  enabled: boolean;
  lastLogon?: string;
  // best-effort live usage (only when reachable)
  reachable?: boolean;
}

/** Aggregate counts for the Directory dashboard. */
export interface DirectorySummary {
  users: number;
  enabledUsers: number;
  groups: number;
  computers: number;
  servers: number;
  dcs: number;
  ous: number;
}

/** A device ↔ user edge for the topology mesh. */
export interface DirectoryTopology {
  domain: string;
  dcs: Array<{ id: string; name: string }>;
  users: Array<{ id: string; name: string; enabled: boolean; admin: boolean }>;
  devices: Array<{ id: string; name: string; os?: string; isServer: boolean; isDc: boolean }>;
  /** device → user ownership links. */
  links: Array<{ device: string; user: string }>;
}

// ───────────────────────────── Virtualization (real SSH-backed VMs) ─────────────────────────────

/** A disk/mount usage row reported by a VM. */
export interface VmDisk {
  mount: string;
  fs?: string;
  sizeKb: number;
  usedKb: number;
  usePct: number;
}

/** Live telemetry collected from a VM over SSH. */
export interface VmMachineStats {
  reachable: boolean;
  error?: string;
  hostname?: string;
  os?: string;
  kernel?: string;
  arch?: string;
  virtType?: string;
  uptimeSec?: number;
  cpuModel?: string;
  cpuCores?: number;
  load1?: number;
  load5?: number;
  load15?: number;
  /** derived quick indicator: load1 / cores, clamped to 100 */
  cpuPct?: number;
  memTotalKb?: number;
  memUsedKb?: number;
  memAvailableKb?: number;
  swapTotalKb?: number;
  swapUsedKb?: number;
  disks?: VmDisk[];
  ipAddrs?: string[];
  loggedInUsers?: number;
  processes?: number;
  collectedMs?: number;
}

/** A registered VM the operator manages over SSH. Password is never returned. */
export interface VmMachine {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  hasPassword: boolean;
  tags: string[];
  notes?: string;
  createdAt: string;
  lastChecked?: string;
  stats?: VmMachineStats;
}

/** Payload to register or update a VM. */
export interface VmMachineInput {
  name: string;
  host: string;
  port?: number;
  username: string;
  password?: string;
  tags?: string[];
  notes?: string;
}

// ───────────────────────────── Security (real, app-layer) ─────────────────────────────

export type ClientOs = 'windows' | 'macos' | 'linux' | 'ios' | 'android' | 'network' | 'other';

export interface SecClientGroup {
  os: ClientOs;
  count: number;
  queries: number;
}

export interface SecTopEntry {
  key: string;
  label?: string;
  count: number;
}

export interface SecuritySeriesPoint {
  t: number; // epoch ms (bucket start)
  total: number;
  blocked: number;
}

/** Live posture + traffic analytics derived from the DNS resolver's query stream. */
export interface SecurityOverview {
  generatedAt: string;
  windowSec: number;
  qps: number;
  totalQueries: number;
  access: number; // allowed/forwarded/cached/local
  blocked: number; // blocked/refused
  blockRate: number; // 0..1
  uniqueClients: number;
  clientsByOs: SecClientGroup[];
  statusBreakdown: Array<{ status: QueryStatus; count: number }>;
  topSources: SecTopEntry[]; // top querying client IPs (sending)
  topDestinations: SecTopEntry[]; // top resolved answer IPs (receiving)
  series: SecuritySeriesPoint[];
  postureScore: number;
  activeAlerts: number;
}

export type SecSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export type ThreatKind =
  | 'port_scan'
  | 'dns_recon'
  | 'nxdomain_flood'
  | 'query_flood'
  | 'dga'
  | 'spoofing'
  | 'ddos'
  | 'malware_domain'
  | 'data_exfil'
  | 'anomaly'
  // L2 / on-the-wire adversary-in-the-middle + poisoning
  | 'arp_spoof'
  | 'mac_spoof'
  | 'rogue_dhcp'
  | 'llmnr_poison'
  | 'ad_attack'
  // app / behavioural
  | 'suspicious_domain'
  | 'beaconing'
  | 'lateral_movement'
  // inventory / behaviour / geo
  | 'new_device'
  | 'baseline_anomaly'
  | 'geo_anomaly';

export interface SecurityAlert {
  id: string;
  ts: string;
  severity: SecSeverity;
  kind: ThreatKind;
  source: string; // client ip
  title: string;
  detail: string;
  evidence?: string;
  count?: number;
  acknowledged?: boolean;
  /** MITRE ATT&CK technique, e.g. { id: 'T1046', name: 'Network Service Discovery' }. */
  mitre?: { id: string; name: string };
  /** Auto-response taken (e.g. 'blocked source'), when active response is on. */
  response?: string;
}

// ── Competitive: threat-intel feeds + active response + reports ──
export interface ThreatFeed {
  id: string;
  name: string;
  url: string;
  kind: 'ip' | 'domain';
  enabled: boolean;
  entries: number;
  lastFetch?: string;
  error?: string;
}

export interface ThreatFeedState {
  feeds: ThreatFeed[];
  totalIndicators: number;
  lastRefresh?: string;
}

export interface ActiveResponseState {
  enabled: boolean;
  /** Auto-block sources at/above this severity. */
  minSeverity: SecSeverity;
  blocked: Array<{ ip: string; reason: string; ts: string }>;
}

// ── Firewall (Nexrelm policy engine — app-layer + nftables export) ──
export type FwDirection = 'inbound' | 'outbound';
export type FwAction = 'allow' | 'deny' | 'drop';
export type FwProto = 'any' | 'tcp' | 'udp' | 'icmp';
export type FwTrust = 'trusted' | 'internal' | 'dmz' | 'guest' | 'untrusted';

export interface FwZone {
  id: string;
  name: string;
  cidrs: string[];
  trust: FwTrust;
}

export interface FwRule {
  id: string;
  order: number;
  enabled: boolean;
  direction: FwDirection;
  action: FwAction;
  proto: FwProto;
  source: string; // cidr | zone:<id> | any
  dest: string; // cidr | any
  port: string; // '443' | '1-1024' | 'any'
  comment?: string;
  hits: number;
}

export interface FirewallState {
  zones: FwZone[];
  rules: FwRule[];
  /** Whether Nexrelm actively enforces deny/drop at its own surface (DNS). */
  enforced: boolean;
}

export interface FwRuleInput {
  direction: FwDirection;
  action: FwAction;
  proto?: FwProto;
  source: string;
  dest?: string;
  port?: string;
  comment?: string;
  enabled?: boolean;
}

// ── Vulnerability scanning + posture ──
export interface ScanService {
  port: number;
  proto: string;
  state: string;
  service?: string;
  product?: string;
  version?: string;
  risk?: SecSeverity;
}

export interface ScanHost {
  host: string;
  up: boolean;
  latencyMs?: number;
  os?: string;
  services: ScanService[];
  /** NSE script findings (e.g. vuln scripts) when a deep profile is used. */
  scripts?: string[];
}

export type ScanProfileId = 'discovery' | 'quick' | 'standard' | 'deep' | 'custom';

export interface ScanProfileInfo {
  id: ScanProfileId;
  name: string;
  description: string;
  depth: string;
  eta: string;
}

export interface ScanRequest {
  target: string;
  profile?: ScanProfileId;
  /** custom profile only */
  ports?: string;
  version?: boolean;
  os?: boolean;
  scripts?: boolean;
  /** extra-verbose nmap output (-vv) with no log filtering. */
  verbose?: boolean;
  /** custom profile: extra raw nmap flags appended (output flags stripped). */
  extraArgs?: string;
}

export interface ScanResult {
  id: string;
  target: string;
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
  running: boolean;
  hosts: ScanHost[];
  error?: string;
  /** Live verbose nmap output (progress + stats), newest last. */
  log?: string[];
  /** Whether OS fingerprinting (-O) actually ran (needs raw-socket capability). */
  osDetection?: boolean;
  profile?: ScanProfileId;
}

/** Recurring scan schedule. intervalSec = 0 ⇒ off. */
export interface ScanSchedule {
  enabled: boolean;
  intervalSec: number;
  target: string;
  lastRun?: string;
  nextRun?: string;
}

// ── External scanner statistics (Nessus / Wazuh) ──
export interface ScannerVuln {
  name: string;
  severity: SecSeverity;
  host?: string;
  count?: number;
}

export interface ScannerStats {
  kind: 'nessus' | 'wazuh';
  ok: boolean;
  error?: string;
  fetchedAt: string;
  severityCounts: Record<string, number>; // critical/high/medium/low/info → n
  totals: Array<{ label: string; value: number }>;
  top: ScannerVuln[];
}

export interface PostureFinding {
  severity: SecSeverity;
  title: string;
  detail: string;
  recommendation: string;
  host?: string;
}

/** Open-source EOL / deprecated-software intelligence (endoflife.date), refreshable. */
export interface VulnIntelState {
  provider: string;
  lastRefresh?: string;
  refreshing: boolean;
  /** products tracked vs successfully loaded. */
  products: number;
  loaded: number;
  total: number; // total release cycles cached
  sources: Array<{ name: string; entries: number; error?: string }>;
}

export interface PostureReport {
  score: number; // 0..100
  grade: string; // A..F
  generatedAt: string;
  findings: PostureFinding[];
  summary: { hosts: number; openPorts: number; risky: number };
}

export interface ScannerConnection {
  kind: 'nessus' | 'wazuh';
  configured: boolean;
  url?: string;
  reachable?: boolean;
  lastChecked?: string;
  note?: string;
}

// ── Threat intel (VirusTotal) ──
export interface ThreatVendor {
  engine: string;
  category: string;
  result: string;
}

export interface ThreatLookup {
  indicator: string;
  kind: 'domain' | 'ip' | 'hash' | 'url';
  malicious: number;
  suspicious: number;
  harmless: number;
  undetected: number;
  reputation?: number;
  verdict: 'malicious' | 'suspicious' | 'clean' | 'unknown';
  vendors?: ThreatVendor[];
  checkedAt: string;
  error?: string;
}

/** How aggressively the heuristic engine flags — scales every detector threshold. */
export type HeuristicSensitivity = 'low' | 'medium' | 'high';
export interface HeuristicTuning {
  sensitivity: HeuristicSensitivity;
  /** IPs / CIDRs exempt from the scan / sweep / lateral detectors (busy hosts, DNS servers, gateways). */
  trustedHosts: string[];
}

export interface SecuritySettings {
  virusTotalConfigured: boolean;
  heuristicsEnabled: boolean;
  tuning: HeuristicTuning;
  nessus: ScannerConnection;
  wazuh: ScannerConnection;
}

/** Monitoring pause — mirrors the DNS blocking pause control. */
export interface SecurityPauseState {
  active: boolean; // true ⇒ monitoring paused
  until: string | null; // ISO; null ⇒ indefinite when active
}

// ── Network device inventory (security is network-wide, not just this host) ──
export interface SecurityDevice {
  ip: string;
  mac?: string;
  vendor?: string;
  hostname?: string;
  os: ClientOs;
  online: boolean;
  firstSeen: string;
  lastSeen: string;
  queries: number;
  /** where this device was observed: 'arp' | 'dns' | 'scan' */
  sources: string[];
  openPorts: ScanService[];
  /** NSE vuln-script findings from a deep scan of this device. */
  scripts?: string[];
  risk?: SecSeverity;
  scanned: boolean;
}

// ── Remediation (actionable recommendations from detections + scans) ──
export type RemediationActionKind = 'block_ip' | 'block_domain' | 'block_port' | 'advice';

export interface RemediationItem {
  id: string;
  severity: SecSeverity;
  title: string;
  detail: string;
  /** the device/IP/domain this concerns. */
  target?: string;
  source: 'threat' | 'vulnerability';
  action: { kind: RemediationActionKind; label: string };
  /** MITRE technique, when from a threat. */
  mitre?: { id: string; name: string };
  applied?: boolean;
}

export interface RemediationState {
  items: RemediationItem[];
  applied: Array<{ id: string; title: string; ts: string }>;
}

// ── Inline gateway (P1: forward + NAT a pilot device through Nexrelm) ──
/** A WAN→LAN port-forward (DNAT) rule. */
export interface PortForward {
  id: string;
  proto: 'tcp' | 'udp';
  wanPort: number;
  toHost: string; // internal IPv4
  toPort: number;
  comment?: string;
}

/** How Nexrelm is integrated into the network — modes stack, each unlocks more. */
export interface NetworkPosture {
  lanIp: string;
  /** clients resolving through Nexrelm (Pi-hole-style) → filtering, sinkhole, DNS threat detection. */
  dns: { active: boolean; clients: number; queries: number };
  /** Nexrelm hands out leases → inventory, new-device detection, can advertise itself as DNS/gateway. */
  dhcp: { active: boolean; leases: number };
  /** promiscuous capture (this segment or a mirror/SPAN port) → wire + L2 threat detection. */
  capture: { active: boolean; packets: number; iface: string };
  /** on-path routing → ALL traffic network-wide + enforcement (the most powerful mode). */
  gateway: GatewayState;
}

export type GatewayMode = 'off' | 'device' | 'lan';

export interface GatewayState {
  /** helper installed + sudo works. */
  available: boolean;
  enabled: boolean;
  /** off · pilot one device (inline) · be the LAN gateway (whole subnet). */
  mode: GatewayMode;
  /** the pilot client IP/CIDR routed through Nexrelm (device mode). */
  client: string;
  /** the LAN subnet routed through Nexrelm (lan mode). */
  lanSubnet: string;
  /** the upstream (WAN) interface traffic is forwarded out. */
  wan: string;
  /** Nexrelm's LAN IP — point the device/router DHCP here. */
  lanIp: string;
  /** IP forwarding currently enabled in the kernel. */
  ipForward?: boolean;
  /** WAN→LAN port forwards (exported as nft to apply). */
  forwards: PortForward[];
  /** DHCP is advertising Nexrelm as the router (opt 3) + DNS (opt 6). */
  dhcpHandoff: boolean;
  helperStatus?: string;
  error?: string;
}

// ── Event persistence / history & timeline (security + dns) ──
/** Retention window the operator picks; 'custom' uses customDays. */
export type RetentionWindow = '24h' | 'week' | 'month' | 'custom';
export interface RetentionConfig {
  window: RetentionWindow;
  /** effective number of days events are kept (derived from window/customDays). */
  days: number;
  customDays?: number;
}
export interface PersistedSecurityEvent {
  id: number;
  ts: string;
  kind: ThreatKind;
  severity: SecSeverity;
  source: string;
  title: string;
  detail: string;
  evidence?: string;
  mitreId?: string;
}
export interface TimelineBucket {
  ts: string; // bucket start ISO
  total: number;
  critical: number;
  high: number;
  medium: number;
  low: number;
  info: number;
}
export interface SecurityHistory {
  retention: RetentionConfig;
  total: number;
  timeline: TimelineBucket[];
  events: PersistedSecurityEvent[];
  topKinds: Array<{ kind: ThreatKind; count: number }>;
}
export interface DnsHistory {
  retention: RetentionConfig;
  total: number;
  timeline: Array<{ ts: string; total: number; blocked: number; cached: number; forwarded: number }>;
}

// ── Blocked things (review + undo) ──
export interface BlockedRule {
  id: string;
  source: string;
  action: FwAction;
  direction: string;
  proto?: string;
  port?: string;
  comment?: string;
  hits: number;
}
export interface BlockedDomain {
  id: number;
  domain: string;
  comment?: string;
  hits: number;
}
export interface BlockedState {
  firewall: BlockedRule[];
  domains: BlockedDomain[];
  devices: RegisteredDevice[];
}

// ── New-device detection / registry ──
export type DeviceTrust = 'pending' | 'known' | 'blocked';
export interface RegisteredDevice {
  mac: string;
  ip: string;
  name?: string;
  vendor?: string;
  os?: ClientOs;
  trust: DeviceTrust;
  firstSeen: string;
  lastSeen: string;
}
export interface DeviceRegistryState {
  devices: RegisteredDevice[];
  pending: number;
  known: number;
  blocked: number;
}

// ── DNS sinkholing of threat intel ──
export interface SinkholeState {
  enabled: boolean;
  /** number of known-bad domains loaded into the sinkhole set. */
  domains: number;
  /** total queries sinkholed since start. */
  blocked: number;
  lastLoaded?: string;
}

// ── Geo-IP / ASN enrichment ──
export interface GeoDestination {
  ip: string;
  hostname?: string;
  country: string;
  countryCode: string;
  city?: string;
  asn?: string;
  org?: string;
  lat: number;
  lon: number;
  count: number;
  risk: boolean;
}
export interface GeoState {
  enabled: boolean;
  destinations: GeoDestination[];
  countries: Array<{ code: string; country: string; count: number; risk: boolean }>;
  riskHits: number;
  resolved: number;
  pending: number;
}

// ── Adaptive anomaly baselining ──
export interface DeviceBaseline {
  client: string;
  /** per-metric learned mean ± stddev and the current window value. */
  metrics: Array<{ metric: string; mean: number; std: number; current: number; deviation: number; samples: number }>;
  anomalous: boolean;
}
export interface BaselineState {
  learning: boolean;
  devices: DeviceBaseline[];
  sampleCount: number;
}

export interface DeviceDiscovery {
  running: boolean;
  subnet: string;
  lastRun?: string;
  found: number;
  devices: SecurityDevice[];
}

// ── Automated threat intel (heuristics → VirusTotal) ──
export interface AutoIntelEntry {
  indicator: string;
  kind: ThreatLookup['kind'];
  verdict: ThreatLookup['verdict'];
  malicious: number;
  suspicious: number;
  checkedAt: string;
  /** why it was auto-flagged for checking, e.g. "DGA domain from 192.168.1.5". */
  reason: string;
  source?: string; // client IP that triggered it
}

export interface AutoIntelState {
  enabled: boolean;
  configured: boolean; // VT key present
  checkedCount: number;
  queued: number;
  recent: AutoIntelEntry[];
}
