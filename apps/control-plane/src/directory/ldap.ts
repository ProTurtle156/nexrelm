/**
 * Live Active Directory / Samba integration over LDAP(S) using ldapts.
 * One connection per process (single-user control plane); credentials live in
 * memory only and the operator is re-prompted when the bind drops or expires.
 */
import net from 'node:net';
import { Attribute, Change, Client } from 'ldapts';
import { saveSession, loadSession, clearSession } from './session';
import { pushLog } from '../core/logbus';
import type {
  AdComputer,
  AdServerInfo,
  AdDomainController,
  AdGroup,
  AdGroupInput,
  AdUser,
  AdUserInput,
  DirectoryConnectInput,
  DirectoryStatus,
  DirectorySummary,
  DirectoryTopology,
} from '@nexrelm/types';

// ───────────────────────────── helpers ─────────────────────────────
const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** Turn a raw connect/bind failure into actionable guidance. */
function explainConnectError(e: unknown, sec: 'plain' | 'starttls' | 'ldaps', host: string, port: number): string {
  const m = msg(e);
  const code = (e as NodeJS.ErrnoException)?.code;
  if (/ECONNRESET|EPROTO|socket hang up|wrong version|ssl|secure TLS|disconnected before/i.test(m)) {
    if (sec === 'ldaps') return `bind failed (${m}): the DC at ${host}:${port} reset the secure connection. LDAPS is often not enabled on the DC (it needs a server certificate). Try StartTLS, or Plain LDAP, or confirm :636 actually serves LDAPS.`;
    if (sec === 'starttls') return `bind failed (${m}): the DC rejected StartTLS on ${host}:${port}. Try LDAPS (:636) or Plain LDAP (:389).`;
    return `bind failed (${m}): the DC reset the connection on ${host}:${port}.`;
  }
  if (code === 'ECONNREFUSED') return `bind failed: nothing is listening on ${host}:${port}. Check the DC address and that ${sec === 'ldaps' ? 'LDAPS (636)' : 'LDAP (389)'} is open.`;
  if (code === 'ETIMEDOUT' || /timeout/i.test(m)) return `bind failed: timed out reaching ${host}:${port}. Confirm the DC is reachable and the firewall allows ${port}.`;
  if (/invalid credentials|data 52e|80090308|49,/i.test(m)) return 'bind failed: invalid username or password. Use DOMAIN\\user, user@domain, or the full DN.';
  return `bind failed: ${m}`;
}

/** Best-effort TCP reachability probe (SMB/445 by default). */
function probe(host: string, port = 445, timeout = 1500): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = net.connect({ host, port });
    const done = (ok: boolean): void => {
      sock.destroy();
      resolve(ok);
    };
    sock.setTimeout(timeout);
    sock.once('connect', () => done(true));
    sock.once('timeout', () => done(false));
    sock.once('error', () => done(false));
  });
}
const domainToBaseDN = (domain: string): string => domain.split('.').filter(Boolean).map((p) => `DC=${p}`).join(',');

type Entry = Record<string, unknown> & { dn: string };

function val(e: Entry, attr: string): string | undefined {
  const v = e[attr];
  if (v == null) return undefined;
  const first = Array.isArray(v) ? v[0] : v;
  if (first == null) return undefined;
  return Buffer.isBuffer(first) ? first.toString('utf8') : String(first);
}
function vals(e: Entry, attr: string): string[] {
  const v = e[attr];
  if (v == null) return [];
  const a = Array.isArray(v) ? v : [v];
  return a.map((x) => (Buffer.isBuffer(x) ? x.toString('utf8') : String(x)));
}
function num(e: Entry, attr: string): number {
  return Number(val(e, attr) ?? 0);
}
/** First CN/OU after the leading RDN — a friendly container name. */
function parentOu(dn: string): string {
  const parts = dn.split(',').slice(1);
  const hit = parts.find((p) => /^(OU|CN)=/i.test(p.trim()));
  return hit ? hit.split('=')[1]!.trim() : 'Domain';
}
function cnOf(dn: string): string {
  const m = dn.match(/^CN=([^,]+)/i);
  return m ? m[1]! : dn;
}
function filetimeToIso(ft: string | undefined): string | undefined {
  if (!ft || ft === '0' || ft === '9223372036854775807') return undefined;
  try {
    const ms = Number(BigInt(ft) / 10000n) - 11644473600000;
    return ms > 0 ? new Date(ms).toISOString() : undefined;
  } catch {
    return undefined;
  }
}
function genTimeToIso(g: string | undefined): string | undefined {
  if (!g) return undefined;
  const m = g.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/);
  return m ? new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z`).toISOString() : undefined;
}

const UAC_DISABLED = 0x2;
const UAC_LOCKOUT = 0x10;
const GT_SECURITY = 0x80000000;
const GT_GLOBAL = 0x2;
const GT_DOMAINLOCAL = 0x4;
const GT_UNIVERSAL = 0x8;

const USER_ATTRS = ['distinguishedName', 'sAMAccountName', 'displayName', 'givenName', 'sn', 'mail', 'userPrincipalName', 'description', 'userAccountControl', 'memberOf', 'lastLogonTimestamp', 'whenCreated', 'pwdLastSet'];
const GROUP_ATTRS = ['distinguishedName', 'sAMAccountName', 'cn', 'description', 'groupType', 'member'];
const COMP_ATTRS = ['distinguishedName', 'sAMAccountName', 'dNSHostName', 'operatingSystem', 'operatingSystemVersion', 'userAccountControl', 'managedBy', 'lastLogonTimestamp', 'whenCreated'];

class Directory {
  private client: Client | null = null;
  private creds: DirectoryConnectInput | null = null;
  private baseDN = '';
  private usersDN = '';
  private connectedAt = 0;
  private lastError: string | undefined;
  private remembered = false;

  async connect(input: DirectoryConnectInput): Promise<DirectoryStatus> {
    await this.disconnect();
    const [host, portStr] = input.host.split(':');
    const sec = input.security ?? 'plain';
    const port = portStr ? Number(portStr) : sec === 'ldaps' ? 636 : 389;
    const url = `${sec === 'ldaps' ? 'ldaps' : 'ldap'}://${host}:${port}`;
    // ldapts treats the mere presence of `tlsOptions` as "use TLS" — so for a
    // plain ldap:// socket it must be omitted, or every bind fails with
    // "socket disconnected before secure TLS connection was established".
    // LDAPS needs it at construction; StartTLS passes it to startTLS() instead.
    const tlsOptions = { rejectUnauthorized: false, minVersion: 'TLSv1' as const };
    const client = new Client({ url, timeout: 12_000, connectTimeout: 8000, ...(sec === 'ldaps' ? { tlsOptions } : {}) });
    // AD/Samba accept UPN (user@domain), DOMAIN\user, or a full DN.
    const bindUser = /[@\\=]/.test(input.username) ? input.username : `${input.username}@${input.domain}`;
    try {
      if (sec === 'starttls') await client.startTLS(tlsOptions);
      await client.bind(bindUser, input.password);
    } catch (e) {
      await client.unbind().catch(() => undefined);
      this.lastError = explainConnectError(e, sec, host!, port);
      pushLog('directory', 'error', `bind failed for ${bindUser}@${host}: ${this.lastError}`);
      throw new Error(this.lastError);
    }
    pushLog('directory', 'info', `bound to ${input.domain} as ${bindUser} (${sec})`);
    this.client = client;
    this.creds = input;
    this.baseDN = domainToBaseDN(input.domain);
    this.usersDN = `CN=Users,${this.baseDN}`;
    this.connectedAt = Date.now();
    this.lastError = undefined;
    // retain (encrypted) unless the operator opted out
    if (input.remember !== false) {
      try {
        saveSession(input);
        this.remembered = true;
      } catch {
        this.remembered = false;
      }
    } else {
      clearSession();
      this.remembered = false;
    }
    return this.status();
  }

  /** Drop the live bind. `forget` also wipes the retained (encrypted) session. */
  async disconnect(forget = false): Promise<void> {
    if (this.client) {
      await this.client.unbind().catch(() => undefined);
      this.client = null;
      this.creds = null;
    }
    if (forget) {
      clearSession();
      this.remembered = false;
    }
  }

  /** Re-bind from a retained session on startup. Clears it if it no longer works. */
  async restoreSession(): Promise<boolean> {
    const saved = loadSession();
    if (!saved) return false;
    try {
      await this.connect(saved);
      return !!this.client;
    } catch {
      clearSession();
      this.remembered = false;
      return false;
    }
  }

  status(): DirectoryStatus {
    return {
      connected: !!this.client,
      mode: this.creds?.mode,
      domain: this.creds?.domain,
      baseDN: this.baseDN || undefined,
      host: this.creds?.host,
      username: this.creds?.username,
      connectedAt: this.connectedAt ? new Date(this.connectedAt).toISOString() : undefined,
      error: this.lastError,
      remembered: this.remembered,
    };
  }

  /**
   * The DC host + admin credentials for an interactive shell. Strips any LDAP
   * port from the host (SSH uses its own port). Held in memory only; null when
   * not connected.
   */
  shellCreds(): { host: string; username: string; password: string } | null {
    if (!this.creds) return null;
    return { host: this.creds.host.split(':')[0]!, username: this.creds.username, password: this.creds.password };
  }

  private ensure(): Client {
    if (!this.client) throw new Error('not connected — connect to a domain controller first');
    return this.client;
  }

  private async find(filter: string, attributes: string[]): Promise<Entry[]> {
    try {
      const { searchEntries } = await this.ensure().search(this.baseDN, { scope: 'sub', filter, attributes, paged: { pageSize: 500 } });
      return searchEntries as Entry[];
    } catch (e) {
      // a dropped/expired connection surfaces here → mark for re-prompt
      this.lastError = msg(e);
      if (/connection|ECONN|socket|unwilling|bind/i.test(this.lastError)) {
        this.client = null;
      }
      throw new Error(this.lastError);
    }
  }

  // ── reads ────────────────────────────────────────────────────────────────────
  async users(): Promise<AdUser[]> {
    const entries = await this.find('(&(objectClass=user)(objectCategory=person))', USER_ATTRS);
    return entries.map((e) => {
      const uac = num(e, 'userAccountControl');
      const groups = vals(e, 'memberOf').map(cnOf);
      return {
        dn: e.dn,
        username: val(e, 'sAMAccountName') ?? cnOf(e.dn),
        displayName: val(e, 'displayName') ?? val(e, 'sAMAccountName') ?? cnOf(e.dn),
        firstName: val(e, 'givenName'),
        lastName: val(e, 'sn'),
        email: val(e, 'mail'),
        upn: val(e, 'userPrincipalName'),
        description: val(e, 'description'),
        enabled: (uac & UAC_DISABLED) === 0,
        locked: (uac & UAC_LOCKOUT) !== 0,
        admin: groups.some((g) => /^(Domain Admins|Administrators|Enterprise Admins|Schema Admins)$/i.test(g)),
        groups,
        ou: parentOu(e.dn),
        lastLogon: filetimeToIso(val(e, 'lastLogonTimestamp')),
        created: genTimeToIso(val(e, 'whenCreated')),
        pwdLastSet: filetimeToIso(val(e, 'pwdLastSet')),
      };
    });
  }

  async groups(): Promise<AdGroup[]> {
    const entries = await this.find('(objectClass=group)', GROUP_ATTRS);
    return entries.map((e) => {
      const gt = num(e, 'groupType') | 0;
      const scope = gt & GT_UNIVERSAL ? 'universal' : gt & GT_DOMAINLOCAL ? 'domainLocal' : 'global';
      return {
        dn: e.dn,
        name: val(e, 'sAMAccountName') ?? val(e, 'cn') ?? cnOf(e.dn),
        description: val(e, 'description'),
        scope: scope as AdGroup['scope'],
        type: gt & GT_SECURITY ? 'security' : 'distribution',
        memberCount: vals(e, 'member').length,
        members: vals(e, 'member').map(cnOf),
        ou: parentOu(e.dn),
      };
    });
  }

  async computers(): Promise<AdComputer[]> {
    const entries = await this.find('(objectClass=computer)', COMP_ATTRS);
    return entries.map((e) => {
      const uac = num(e, 'userAccountControl');
      const os = val(e, 'operatingSystem') ?? '';
      const isDc = (uac & 0x2000) !== 0; // SERVER_TRUST_ACCOUNT
      return {
        dn: e.dn,
        name: (val(e, 'sAMAccountName') ?? cnOf(e.dn)).replace(/\$$/, ''),
        dnsName: val(e, 'dNSHostName'),
        os: os || undefined,
        osVersion: val(e, 'operatingSystemVersion'),
        enabled: (uac & UAC_DISABLED) === 0,
        owner: val(e, 'managedBy') ? cnOf(val(e, 'managedBy')!) : undefined,
        lastLogon: filetimeToIso(val(e, 'lastLogonTimestamp')),
        created: genTimeToIso(val(e, 'whenCreated')),
        isServer: /server/i.test(os),
        isDc,
      };
    });
  }

  async dcs(): Promise<AdDomainController[]> {
    const entries = await this.find('(&(objectClass=computer)(userAccountControl:1.2.840.113556.1.4.803:=8192))', COMP_ATTRS);
    return entries.map((e) => ({
      name: (val(e, 'sAMAccountName') ?? cnOf(e.dn)).replace(/\$$/, ''),
      dnsName: val(e, 'dNSHostName') ?? '',
      os: val(e, 'operatingSystem'),
      site: undefined,
      roles: [],
    }));
  }

  async servers(): Promise<AdServerInfo[]> {
    const comps = (await this.computers()).filter((c) => c.isServer && !c.isDc);
    return Promise.all(
      comps.map(async (c) => ({
        name: c.name,
        dnsName: c.dnsName,
        os: c.os,
        enabled: c.enabled,
        lastLogon: c.lastLogon,
        reachable: c.dnsName ? await probe(c.dnsName) : undefined,
      })),
    );
  }

  async summary(): Promise<DirectorySummary> {
    const [users, groups, computers] = await Promise.all([this.users(), this.groups(), this.computers()]);
    return {
      users: users.length,
      enabledUsers: users.filter((u) => u.enabled).length,
      groups: groups.length,
      computers: computers.filter((c) => !c.isDc).length,
      servers: computers.filter((c) => c.isServer && !c.isDc).length,
      dcs: computers.filter((c) => c.isDc).length,
      ous: new Set([...users, ...groups].map((x) => x.ou)).size,
    };
  }

  async topology(): Promise<DirectoryTopology> {
    const [users, computers] = await Promise.all([this.users(), this.computers()]);
    const links = computers.filter((c) => c.owner).map((c) => ({ device: c.name, user: c.owner! }));
    return {
      domain: this.creds?.domain ?? '',
      dcs: computers.filter((c) => c.isDc).map((c) => ({ id: c.name, name: c.name })),
      users: users.map((u) => ({ id: u.username, name: u.displayName, enabled: u.enabled, admin: u.admin })),
      devices: computers.map((c) => ({ id: c.name, name: c.name, os: c.os, isServer: c.isServer, isDc: c.isDc })),
      links,
    };
  }

  // ── user CRUD ────────────────────────────────────────────────────────────────
  async addUser(input: AdUserInput): Promise<void> {
    const c = this.ensure();
    const cn = input.displayName || `${input.firstName ?? ''} ${input.lastName ?? ''}`.trim() || input.username;
    const ou = input.ou || this.usersDN;
    const dn = `CN=${cn},${ou}`;
    const entry: Record<string, string | string[]> = {
      objectClass: ['top', 'person', 'organizationalPerson', 'user'],
      cn,
      sAMAccountName: input.username,
      userPrincipalName: `${input.username}@${this.creds!.domain}`,
      displayName: cn,
    };
    if (input.firstName) entry.givenName = input.firstName;
    if (input.lastName) entry.sn = input.lastName;
    if (input.email) entry.mail = input.email;
    if (input.description) entry.description = input.description;
    await c.add(dn, entry);
    if (input.password) await this.setPassword(dn, input.password).catch(() => undefined);
    // new AD accounts are disabled until a password is set; enable unless told otherwise
    await this.setEnabled(dn, input.enabled !== false).catch(() => undefined);
  }

  async updateUser(dn: string, patch: Partial<AdUserInput>): Promise<void> {
    const mods: Change[] = [];
    const map: Array<[keyof AdUserInput, string]> = [['firstName', 'givenName'], ['lastName', 'sn'], ['displayName', 'displayName'], ['email', 'mail'], ['description', 'description']];
    for (const [k, attr] of map) {
      const v = patch[k];
      if (v !== undefined) mods.push(new Change({ operation: 'replace', modification: new Attribute({ type: attr, values: [String(v)] }) }));
    }
    if (mods.length) await this.ensure().modify(dn, mods);
  }

  async deleteUser(dn: string): Promise<void> {
    await this.ensure().del(dn);
  }

  async setPassword(dn: string, password: string): Promise<void> {
    const pwd = Buffer.from(`"${password}"`, 'utf16le');
    await this.ensure().modify(dn, new Change({ operation: 'replace', modification: new Attribute({ type: 'unicodePwd', values: [pwd] }) }));
  }

  async setEnabled(dn: string, enabled: boolean): Promise<void> {
    const uac = enabled ? 512 : 514; // NORMAL_ACCOUNT (+ ACCOUNTDISABLE)
    await this.ensure().modify(dn, new Change({ operation: 'replace', modification: new Attribute({ type: 'userAccountControl', values: [String(uac)] }) }));
  }

  // ── group CRUD ───────────────────────────────────────────────────────────────
  async addGroup(input: AdGroupInput): Promise<void> {
    const ou = input.ou || this.usersDN;
    const dn = `CN=${input.name},${ou}`;
    const scopeBit = input.scope === 'universal' ? GT_UNIVERSAL : input.scope === 'domainLocal' ? GT_DOMAINLOCAL : GT_GLOBAL;
    const groupType = (input.type === 'distribution' ? 0 : GT_SECURITY) | scopeBit;
    await this.ensure().add(dn, {
      objectClass: ['top', 'group'],
      cn: input.name,
      sAMAccountName: input.name,
      groupType: String(groupType | 0),
      ...(input.description ? { description: input.description } : {}),
    });
  }

  async deleteGroup(dn: string): Promise<void> {
    await this.ensure().del(dn);
  }

  async setMember(groupDn: string, memberDn: string, add: boolean): Promise<void> {
    await this.ensure().modify(groupDn, new Change({ operation: add ? 'add' : 'delete', modification: new Attribute({ type: 'member', values: [memberDn] }) }));
  }
}

export const directory = new Directory();
