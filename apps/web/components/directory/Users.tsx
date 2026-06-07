'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { UserPlus, KeyRound, Trash2, Power, Save, ChevronRight, ChevronDown, ArrowUp, ArrowDown, Search, Shield, MonitorSmartphone } from 'lucide-react';
import type { AdComputer, AdUser, SecurityDevice } from '@nexrelm/types';
import { dirSend, useDir } from '@/lib/directory';
import { useDns } from '@/lib/dns';
import { relTime, cn } from '@/lib/format';
import { Panel, PanelHeader } from '@/components/ui/Panel';
import { Badge } from '@/components/ui/Badge';
import { StatusDot } from '@/components/ui/StatusDot';

const cls = 'rounded-lg border border-line bg-[var(--bg-2)] px-3 py-2 text-sm text-text outline-none placeholder:text-faint focus:border-accent/50';
const GRID = '1.7fr 1.7fr 1.5fr 0.9fr 1fr';

type SortKey = 'name' | 'logon' | 'role' | 'status' | 'created';
interface Sort {
  key: SortKey;
  dir: 'asc' | 'desc';
}

function fmtDate(iso?: string): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    return iso;
  }
}

function sortUsers(users: AdUser[], { key, dir }: Sort): AdUser[] {
  const sign = dir === 'asc' ? 1 : -1;
  const t = (s?: string): number => (s ? new Date(s).getTime() || 0 : 0);
  const name = (u: AdUser): string => (u.displayName || u.username).toLowerCase();
  return [...users].sort((a, b) => {
    let d = 0;
    if (key === 'name') d = name(a).localeCompare(name(b));
    else if (key === 'logon') d = t(a.lastLogon) - t(b.lastLogon);
    else if (key === 'created') d = t(a.created) - t(b.created);
    else if (key === 'status') d = Number(a.enabled) - Number(b.enabled);
    else if (key === 'role') d = Number(a.admin) - Number(b.admin);
    if (d === 0) d = name(a).localeCompare(name(b)); // stable tiebreak
    return d * sign;
  });
}

function devicesForUser(user: AdUser, computers: AdComputer[]): AdComputer[] {
  const keys = [user.username, user.displayName].filter(Boolean).map((s) => s.toLowerCase());
  return computers.filter((c) => c.owner && keys.includes(c.owner.toLowerCase()));
}

const shortHost = (s?: string): string => (s ?? '').split('.')[0]!.toLowerCase();

/** Best-effort IP for a user: owned device first, else a hostname≈username match (e.g. IBRAHIM-PC → ibrahim). */
interface UserIp {
  ip?: string;
  via?: string;
}

export function Users({ onAuthLost, focusUser, onFocusConsumed }: { onAuthLost: () => void; focusUser?: string | null; onFocusConsumed?: () => void }) {
  const { data, error, refresh } = useDir<AdUser[]>('/api/directory/users', 0);
  const { data: computers } = useDir<AdComputer[]>('/api/directory/computers', 0);
  // device inventory (ARP+DNS+sniffer) — the only place IPs live; AD has none
  const { data: inventory } = useDns<SecurityDevice[]>('/api/security/devices', 0);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [sort, setSort] = useState<Sort>({ key: 'name', dir: 'asc' });
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (error && /not connected|409/i.test(error)) onAuthLost();
  }, [error, onAuthLost]);

  // when navigated here from the mesh, expand + scroll to the picked user
  useEffect(() => {
    if (!focusUser || !data) return;
    const f = focusUser.toLowerCase();
    const u = data.find((x) => x.username.toLowerCase() === f || x.displayName.toLowerCase() === f);
    if (u) {
      setExpanded(u.dn);
      setTimeout(() => document.getElementById(`user-${u.dn}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 60);
    }
    onFocusConsumed?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusUser, data]);

  const invByHost = useMemo(() => {
    const m = new Map<string, SecurityDevice>();
    for (const d of inventory ?? []) if (d.hostname) m.set(shortHost(d.hostname), d);
    return m;
  }, [inventory]);

  const ipOfComputer = useCallback(
    // the DC-resolved A record is authoritative; the wire inventory is the fallback
    (c: AdComputer): string | undefined => c.ip ?? (invByHost.get(shortHost(c.name)) ?? (c.dnsName ? invByHost.get(shortHost(c.dnsName)) : undefined))?.ip,
    [invByHost],
  );

  const ipByDn = useMemo(() => {
    const m = new Map<string, UserIp>();
    for (const u of data ?? []) {
      let res: UserIp = {};
      // 1) devices that list this user as owner
      for (const c of devicesForUser(u, computers ?? [])) {
        const ip = ipOfComputer(c);
        if (ip) {
          res = { ip, via: c.name };
          break;
        }
      }
      // 2) fallback: workstation named after the user (IBRAHIM-PC → ibrahim)
      if (!res.ip) {
        const parts = [u.username, u.firstName, u.lastName]
          .filter((s): s is string => !!s)
          .flatMap((s) => s.toLowerCase().split(/[\s._-]+/))
          .filter((p) => p.length >= 3);
        for (const c of computers ?? []) {
          if (c.isDc || c.isServer) continue;
          const host = shortHost(c.name);
          if (!parts.some((p) => host.startsWith(p) || (p.length >= 5 && host.includes(p)))) continue;
          const ip = ipOfComputer(c);
          if (ip) {
            res = { ip, via: c.name };
            break;
          }
        }
      }
      m.set(u.dn, res);
    }
    return m;
  }, [data, computers, ipOfComputer]);

  // search across everything a row knows: name / username / email / upn / OU / groups / role / status / ip / device
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return data ?? [];
    const terms = q.split(/\s+/);
    return (data ?? []).filter((u) => {
      const info = ipByDn.get(u.dn);
      const hay = [
        u.displayName,
        u.username,
        u.email,
        u.upn,
        u.ou,
        info?.ip,
        info?.via,
        u.admin ? 'admin' : 'member',
        u.enabled ? 'enabled' : 'disabled',
        ...u.groups,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return terms.every((t) => hay.includes(t));
    });
  }, [data, query, ipByDn]);

  const rows = useMemo(() => sortUsers(filtered, sort), [filtered, sort]);

  function toggleSort(key: SortKey) {
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'logon' || key === 'created' || key === 'role' ? 'desc' : 'asc' }));
  }

  async function act(fn: () => Promise<unknown>) {
    setErr(null);
    try {
      await fn();
      refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'operation failed');
    }
  }

  return (
    <Panel>
      <PanelHeader
        label="Users"
        title="Domain users"
        hint={query ? `${rows.length} of ${data?.length ?? 0} accounts match` : `${data?.length ?? 0} accounts · click a user for full details`}
        right={
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-faint" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="search name / IP / group…"
                className={cn(cls, 'w-56 py-1.5 pl-8 text-xs')}
              />
            </div>
            <button onClick={() => { setAdding((a) => !a); setExpanded(null); }} className="flex items-center gap-1.5 rounded-lg border border-accent/40 bg-[color-mix(in_oklch,var(--accent)_14%,transparent)] px-3 py-1.5 text-xs font-medium text-accent"><UserPlus size={14} /> New user</button>
          </div>
        }
      />
      {err && <div className="mx-5 mb-1 rounded-lg border border-danger/30 bg-[color-mix(in_oklch,var(--danger)_8%,transparent)] px-3 py-2 text-xs text-danger">{err}</div>}
      {adding && <AddUser onDone={(refreshed) => { setAdding(false); if (refreshed) refresh(); }} onError={setErr} />}

      {/* sortable header */}
      <div className="grid items-center gap-3 border-y border-line bg-[var(--bg-2)]/30 px-5 py-2 text-[0.66rem] uppercase tracking-wider text-faint" style={{ gridTemplateColumns: GRID }}>
        <SortHead label="User" k="name" sort={sort} onSort={toggleSort} />
        <span>IP</span>
        <span>Groups</span>
        <SortHead label="Role" k="role" sort={sort} onSort={toggleSort} />
        <SortHead label="Last logon" k="logon" sort={sort} onSort={toggleSort} className="justify-end text-right" />
      </div>

      <div className="max-h-[calc(100vh-360px)] overflow-y-auto">
        {rows.length === 0 ? (
          <div className="px-5 py-8 text-center text-sm text-faint">{query ? `no users match “${query}”` : 'no users'}</div>
        ) : (
          rows.map((u) => {
            const open = expanded === u.dn;
            return (
              <div key={u.dn} id={`user-${u.dn}`} className="border-b border-line/50 last:border-0 scroll-mt-4">
                <button onClick={() => setExpanded(open ? null : u.dn)} className={cn('grid w-full items-center gap-3 px-5 py-2.5 text-left transition-colors hover:bg-[var(--bg-2)]/40', open && 'bg-[var(--bg-2)]/50')} style={{ gridTemplateColumns: GRID }}>
                  <span className="flex min-w-0 items-center gap-2">
                    {open ? <ChevronDown size={14} className="shrink-0 text-accent" /> : <ChevronRight size={14} className="shrink-0 text-faint" />}
                    <StatusDot color={u.enabled ? 'var(--good)' : 'var(--faint)'} pulse={false} />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-text">{u.displayName}</span>
                      <span className="block truncate font-mono text-[0.66rem] text-faint">{u.username}</span>
                    </span>
                  </span>
                  <IpCell info={ipByDn.get(u.dn)} />
                  <span className="flex flex-wrap gap-1">
                    {u.groups.slice(0, 2).map((g) => <Badge key={g} color="var(--accent-dim)">{g}</Badge>)}
                    {u.groups.length > 2 && <span className="text-[0.66rem] text-faint">+{u.groups.length - 2}</span>}
                  </span>
                  <span>{u.admin ? <Badge color="var(--danger)">admin</Badge> : <span className="text-xs text-faint">member</span>}</span>
                  <span className="text-right text-xs text-muted">{u.lastLogon ? relTime(u.lastLogon) : 'never'}</span>
                </button>
                {open && <UserDetail user={u} devices={devicesForUser(u, computers ?? [])} act={act} ipInfo={ipByDn.get(u.dn)} ipOf={ipOfComputer} />}
              </div>
            );
          })
        )}
      </div>
    </Panel>
  );
}

function IpCell({ info }: { info?: UserIp }) {
  if (!info?.ip) return <span className="text-xs text-faint">—</span>;
  return (
    <span className="min-w-0" title={info.via ? `via ${info.via}` : undefined}>
      <span className="block truncate font-mono text-xs text-text">{info.ip}</span>
      {info.via && <span className="block truncate text-[0.64rem] text-faint">{info.via}</span>}
    </span>
  );
}

function SortHead({ label, k, sort, onSort, className }: { label: string; k: SortKey; sort: Sort; onSort: (k: SortKey) => void; className?: string }) {
  const on = sort.key === k;
  return (
    <button onClick={() => onSort(k)} className={cn('flex items-center gap-1 uppercase tracking-wider transition-colors hover:text-text', on ? 'text-accent' : 'text-faint', className)}>
      {label}
      {on && (sort.dir === 'asc' ? <ArrowUp size={11} /> : <ArrowDown size={11} />)}
    </button>
  );
}

function UserDetail({ user, devices, act, ipInfo, ipOf }: { user: AdUser; devices: AdComputer[]; act: (fn: () => Promise<unknown>) => void; ipInfo?: UserIp; ipOf: (c: AdComputer) => string | undefined }) {
  const [displayName, setDisplayName] = useState(user.displayName);
  const [email, setEmail] = useState(user.email ?? '');
  const [description, setDescription] = useState(user.description ?? '');
  const [pw, setPw] = useState('');

  return (
    <div className="border-t border-line bg-[var(--bg-1)]/60 px-5 py-4">
      {/* identity summary */}
      <div className="grid gap-x-6 gap-y-2.5 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Display name" value={user.displayName} />
        <Field label="Username (sAMAccountName)" value={user.username} mono />
        <Field label="UPN" value={user.upn} mono />
        <Field label="First / last" value={[user.firstName, user.lastName].filter(Boolean).join(' ') || undefined} />
        <Field label="Email" value={user.email} />
        <Field label="IP address" value={ipInfo?.ip ? `${ipInfo.ip}${ipInfo.via ? ` · ${ipInfo.via}` : ''}` : undefined} mono />
        <Field label="Container / OU" value={user.ou} />
        <Field label="Status" node={<span className="flex items-center gap-1.5 text-sm"><StatusDot color={user.enabled ? 'var(--good)' : 'var(--faint)'} pulse={false} />{user.enabled ? 'Enabled' : 'Disabled'}{user.locked ? <Badge color="var(--warn)">locked</Badge> : null}</span>} />
        <Field label="Role" node={user.admin ? <span className="flex items-center gap-1.5 text-sm text-danger"><Shield size={13} /> Administrator</span> : <span className="text-sm text-muted">Member</span>} />
        <Field label="Last logon" value={user.lastLogon ? `${fmtDate(user.lastLogon)} (${relTime(user.lastLogon)})` : 'never'} />
        <Field label="Created" value={fmtDate(user.created)} />
        <Field label="Password last set" value={fmtDate(user.pwdLastSet)} />
        <Field label="Distinguished name" value={user.dn} mono cls="sm:col-span-2 lg:col-span-3" />
      </div>

      {/* groups */}
      <div className="mt-4">
        <div className="label mb-1.5">Group memberships & roles ({user.groups.length})</div>
        <div className="flex flex-wrap gap-1.5">
          {user.groups.length ? user.groups.map((g) => <Badge key={g} color={/admin|domain admins|enterprise/i.test(g) ? 'var(--danger)' : 'var(--violet)'}>{g}</Badge>) : <span className="text-xs text-faint">no group memberships</span>}
        </div>
      </div>

      {/* associated devices */}
      <div className="mt-4">
        <div className="label mb-1.5">Associated devices ({devices.length})</div>
        {devices.length ? (
          <div className="flex flex-col gap-1.5">
            {devices.map((d) => (
              <div key={d.dn} className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-[var(--bg-2)]/50 px-3 py-1.5 text-xs">
                <MonitorSmartphone size={13} className="text-good" />
                <span className="font-mono text-text">{d.name}</span>
                {d.dnsName && <span className="text-faint">{d.dnsName}</span>}
                {ipOf(d) && <span className="font-mono text-accent">{ipOf(d)}</span>}
                <span className="ml-auto text-muted">{d.os ?? 'unknown OS'}</span>
                <Badge color={d.isDc ? 'var(--accent)' : d.isServer ? 'var(--warn)' : 'var(--good)'}>{d.isDc ? 'DC' : d.isServer ? 'server' : 'workstation'}</Badge>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-faint">No domain-joined devices list this user as owner. The IP shown above (if any) comes from a workstation named after the user, matched against the live device inventory.</p>
        )}
      </div>

      {/* management */}
      <div className="mt-5 border-t border-line pt-4">
        <div className="label mb-2">Manage</div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="display name" className={cls} />
          <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="email" className={cls} />
          <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="description" className={cls} />
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button onClick={() => act(() => dirSend('PATCH', '/api/directory/users', { dn: user.dn, displayName, email, description }))} className="flex items-center gap-1.5 rounded-lg border border-accent/40 bg-[color-mix(in_oklch,var(--accent)_14%,transparent)] px-3 py-2 text-sm font-medium text-accent"><Save size={14} /> Save</button>
          <button onClick={() => act(() => dirSend('POST', '/api/directory/users/enabled', { dn: user.dn, enabled: !user.enabled }))} className="flex items-center gap-1.5 rounded-lg border border-line px-3 py-2 text-sm text-muted hover:text-text"><Power size={14} /> {user.enabled ? 'Disable' : 'Enable'}</button>
          <button onClick={() => act(() => dirSend('DELETE', `/api/directory/users?dn=${encodeURIComponent(user.dn)}`))} className="ml-auto flex items-center gap-1.5 rounded-lg border border-danger/40 px-3 py-2 text-sm text-danger"><Trash2 size={14} /> Delete</button>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-line pt-3">
          <KeyRound size={14} className="text-faint" />
          <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="new password (needs StartTLS/LDAPS)" className={cls + ' flex-1'} />
          <button disabled={!pw} onClick={() => { act(() => dirSend('POST', '/api/directory/users/password', { dn: user.dn, password: pw })); setPw(''); }} className="rounded-lg border border-warn/40 bg-[color-mix(in_oklch,var(--warn)_12%,transparent)] px-4 py-2 text-sm font-medium text-warn disabled:opacity-50">Reset password</button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, value, node, mono, cls: extra }: { label: string; value?: string; node?: React.ReactNode; mono?: boolean; cls?: string }) {
  return (
    <div className={extra}>
      <div className="label">{label}</div>
      {node ?? <div className={cn('truncate text-sm text-text', mono && 'font-mono text-xs')} title={value}>{value || '—'}</div>}
    </div>
  );
}

function AddUser({ onDone, onError }: { onDone: (refreshed: boolean) => void; onError: (e: string) => void }) {
  const [f, setF] = useState({ username: '', firstName: '', lastName: '', email: '', password: '' });
  const [busy, setBusy] = useState(false);
  async function create() {
    if (!f.username) return;
    setBusy(true);
    try {
      await dirSend('POST', '/api/directory/users', f);
      onDone(true);
    } catch (e) {
      onError(e instanceof Error ? e.message : 'create failed');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="grid grid-cols-1 gap-2 border-y border-line bg-[var(--bg-2)]/40 px-5 py-4 sm:grid-cols-3">
      <input value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} placeholder="username (sAMAccountName)" className={cls} />
      <input value={f.firstName} onChange={(e) => setF({ ...f, firstName: e.target.value })} placeholder="first name" className={cls} />
      <input value={f.lastName} onChange={(e) => setF({ ...f, lastName: e.target.value })} placeholder="last name" className={cls} />
      <input value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} placeholder="email" className={cls} />
      <input type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} placeholder="initial password" className={cls} />
      <button onClick={create} disabled={busy} className="rounded-lg border border-accent/40 bg-[color-mix(in_oklch,var(--accent)_14%,transparent)] px-4 py-2 text-sm font-medium text-accent disabled:opacity-50">{busy ? 'creating…' : 'Create user'}</button>
    </div>
  );
}
