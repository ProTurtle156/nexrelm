'use client';

import { useState } from 'react';
import { Search, Plus, RefreshCw, Trash2, ChevronUp, ChevronDown } from 'lucide-react';
import type { DnsAdlist, DnsGroup, DnsListDomain, DnsListMatch, DnsListType } from '@nexrelm/types';
import { dnsGet, dnsSend, useDns } from '@/lib/dns';
import { num } from '@/lib/format';
import { Panel, PanelHeader } from '@/components/ui/Panel';
import { Badge } from '@/components/ui/Badge';
import { StatusDot } from '@/components/ui/StatusDot';

export function Lists() {
  const { data: domains, refresh: refreshDomains } = useDns<DnsListDomain[]>('/api/dns/lists', 0);
  const { data: adlists, refresh: refreshAdlists } = useDns<DnsAdlist[]>('/api/dns/adlists', 0);
  const { data: groups } = useDns<DnsGroup[]>('/api/dns/groups', 0);

  return (
    <div className="flex flex-col gap-5">
      <DomainSearch groups={groups ?? []} />
      <ManualLists domains={domains ?? []} groups={groups ?? []} onChange={refreshDomains} />
      <Adlists adlists={adlists ?? []} groups={groups ?? []} onChange={refreshAdlists} />
    </div>
  );
}

// ── reusable: edit which groups a list applies to ────────────────────────────────
function GroupsEditor({ selected, groups, onSave }: { selected: number[]; groups: DnsGroup[]; onSave: (ids: number[]) => void }) {
  const [open, setOpen] = useState(false);
  const groupName = (id: number) => groups.find((g) => g.id === id)?.name ?? (id === 0 ? 'Everyone' : `#${id}`);
  const shown = selected.length ? selected : [0];

  function toggle(id: number) {
    const set = new Set(selected);
    if (set.has(id)) set.delete(id);
    else set.add(id);
    onSave([...set]);
  }

  return (
    <div className="relative">
      <button onClick={() => setOpen((v) => !v)} className="flex flex-wrap gap-1" title="which groups this list applies to">
        {shown.map((g) => (
          <Badge key={g} color="var(--violet)">{groupName(g)}</Badge>
        ))}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-full z-50 mt-1 w-52 rounded-lg border border-line bg-[var(--bg-1)] p-1.5 shadow-xl">
            <p className="px-2 py-1 text-[0.65rem] uppercase tracking-wide text-faint">Apply this list to</p>
            {groups.length === 0 ? (
              <p className="px-2 py-1.5 text-xs text-faint">No groups yet — applies to everyone.</p>
            ) : (
              groups.map((g) => (
                <label key={g.id} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm text-text hover:bg-[var(--bg-2)]">
                  <input type="checkbox" checked={selected.includes(g.id)} onChange={() => toggle(g.id)} className="accent-[var(--accent)]" />
                  {g.name}
                </label>
              ))
            )}
            <p className="px-2 pt-1 text-[0.65rem] text-faint">None checked ⇒ applies to everyone.</p>
          </div>
        </>
      )}
    </div>
  );
}

// ── search across every list ────────────────────────────────────────────────────
function DomainSearch({ groups }: { groups: DnsGroup[] }) {
  const [q, setQ] = useState('');
  const [res, setRes] = useState<DnsListMatch[] | null>(null);
  const [busy, setBusy] = useState(false);
  const groupName = (id: number) => groups.find((g) => g.id === id)?.name ?? `#${id}`;

  async function run() {
    if (!q.trim()) return;
    setBusy(true);
    try {
      setRes(await dnsGet<DnsListMatch[]>(`/api/dns/search?q=${encodeURIComponent(q.trim())}`));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel brackets>
      <PanelHeader label="Search" title="Is a domain on a list?" hint="checks manual block/allow entries and every blocklist" />
      <div className="px-5 pb-5 pt-2">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && run()}
              placeholder="e.g. doubleclick.net"
              className="w-full rounded-lg border border-line bg-[var(--bg-2)] py-2 pl-9 pr-3 font-mono text-sm text-text outline-none placeholder:text-faint focus:border-accent/50"
            />
          </div>
          <button onClick={run} disabled={busy} className="rounded-lg border border-accent/40 bg-[color-mix(in_oklch,var(--accent)_14%,transparent)] px-4 text-sm font-medium text-accent disabled:opacity-50">
            {busy ? '…' : 'Search'}
          </button>
        </div>
        {res && (
          <div className="mt-3">
            {res.length === 0 ? (
              <p className="text-sm text-muted">Not found on any list — this domain is not filtered.</p>
            ) : (
              <div className="flex flex-col gap-1.5">
                <p className="text-xs text-faint">{res.length} match{res.length > 1 ? 'es' : ''} — highest priority wins:</p>
                {res.slice(0, 40).map((m, i) => (
                  <div key={i} className="panel-2 flex flex-wrap items-center gap-2 px-3 py-2 text-xs">
                    <Badge color={m.type === 'block' ? 'var(--danger)' : 'var(--good)'}>{m.type}</Badge>
                    <Badge color="var(--accent-dim)">{m.kind}</Badge>
                    <span className="font-mono text-text">{m.domain}</span>
                    <span className="ml-auto text-faint">{m.source === 'adlist' ? m.adlistUrl : `groups: ${m.groups.map(groupName).join(', ')}`}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </Panel>
  );
}

// ── manual block/allow entries ───────────────────────────────────────────────────
function ManualLists({ domains, groups, onChange }: { domains: DnsListDomain[]; groups: DnsGroup[]; onChange: () => void }) {
  const [type, setType] = useState<DnsListType>('block');
  const [kind, setKind] = useState<'exact' | 'regex'>('exact');
  const [domain, setDomain] = useState('');
  const [busy, setBusy] = useState(false);
  const shown = domains.filter((d) => d.type === type);

  async function add() {
    if (!domain.trim()) return;
    setBusy(true);
    try {
      await dnsSend('POST', '/api/dns/lists', { type, kind, domain: domain.trim() });
      setDomain('');
      onChange();
    } finally {
      setBusy(false);
    }
  }
  async function toggle(d: DnsListDomain) {
    await dnsSend('PATCH', `/api/dns/lists/${d.id}`, { enabled: !d.enabled });
    onChange();
  }
  async function setGroups(d: DnsListDomain, ids: number[]) {
    await dnsSend('PATCH', `/api/dns/lists/${d.id}`, { groups: ids });
    onChange();
  }
  async function remove(d: DnsListDomain) {
    await dnsSend('DELETE', `/api/dns/lists/${d.id}`);
    onChange();
  }

  return (
    <Panel>
      <PanelHeader
        label="Manage Lists"
        title="Block & allow domains"
        hint="blocking a domain also blocks its subdomains (block facebook.com ⇒ www/m.facebook.com too). A manual allow always beats a blocklist — e.g. allow youtube.com to override an ad list."
        right={
          <div className="flex gap-1">
            {(['block', 'allow'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setType(t)}
                className="rounded-full border px-3 py-1 text-xs transition-colors"
                style={{
                  color: type === t ? (t === 'block' ? 'var(--danger)' : 'var(--good)') : 'var(--muted)',
                  borderColor: type === t ? 'currentColor' : 'var(--line)',
                }}
              >
                {t === 'block' ? 'Blocklist' : 'Allowlist'}
              </button>
            ))}
          </div>
        }
      />
      <div className="flex flex-wrap items-center gap-2 px-5 py-3">
        <select value={kind} onChange={(e) => setKind(e.target.value as 'exact' | 'regex')} className="rounded-lg border border-line bg-[var(--bg-2)] px-2 py-2 text-sm text-text outline-none">
          <option value="exact">exact</option>
          <option value="regex">regex</option>
        </select>
        <input
          value={domain}
          onChange={(e) => setDomain(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()}
          placeholder={kind === 'regex' ? '^ads?\\..*' : 'domain to ' + type}
          className="flex-1 rounded-lg border border-line bg-[var(--bg-2)] px-3 py-2 font-mono text-sm text-text outline-none placeholder:text-faint focus:border-accent/50"
        />
        <button onClick={add} disabled={busy} className="flex items-center gap-1.5 rounded-lg border border-accent/40 bg-[color-mix(in_oklch,var(--accent)_14%,transparent)] px-4 py-2 text-sm font-medium text-accent disabled:opacity-50">
          <Plus size={15} /> Add
        </button>
      </div>
      <div className="max-h-[360px] overflow-y-auto border-t border-line">
        {shown.length === 0 ? (
          <div className="px-5 py-8 text-center text-sm text-faint">no {type} entries yet</div>
        ) : (
          shown.map((d) => (
            <div key={d.id} className="flex items-center gap-3 border-b border-line/50 px-5 py-2.5 last:border-0">
              <button onClick={() => toggle(d)} title={d.enabled ? 'disable' : 'enable'}>
                <StatusDot color={d.enabled ? 'var(--good)' : 'var(--faint)'} pulse={false} />
              </button>
              <span className="font-mono text-sm text-text">{d.domain}</span>
              <Badge color="var(--accent-dim)">{d.kind}</Badge>
              <GroupsEditor selected={d.groups} groups={groups} onSave={(ids) => setGroups(d, ids)} />
              <span className="ml-auto stat text-xs text-faint">{num(d.hits)} hits</span>
              <button onClick={() => remove(d)} className="text-faint transition-colors hover:text-danger" title="delete">
                <Trash2 size={14} />
              </button>
            </div>
          ))
        )}
      </div>
    </Panel>
  );
}

// ── adlists (subscribed block / allow lists) ──────────────────────────────────────
function Adlists({ adlists, groups, onChange }: { adlists: DnsAdlist[]; groups: DnsGroup[]; onChange: () => void }) {
  const [url, setUrl] = useState('');
  const [type, setType] = useState<DnsListType>('block');
  const [busy, setBusy] = useState(false);
  const [grav, setGrav] = useState<string | null>(null);

  // highest priority first → top of the list wins conflicts
  const sorted = [...adlists].sort((a, b) => b.priority - a.priority || a.id - b.id);

  async function add() {
    if (!url.trim()) return;
    setBusy(true);
    try {
      await dnsSend('POST', '/api/dns/adlists', { url: url.trim(), type });
      setUrl('');
      onChange();
    } finally {
      setBusy(false);
    }
  }
  async function toggle(a: DnsAdlist) {
    await dnsSend('PATCH', `/api/dns/adlists/${a.id}`, { enabled: !a.enabled });
    onChange();
  }
  async function setGroups(a: DnsAdlist, ids: number[]) {
    await dnsSend('PATCH', `/api/dns/adlists/${a.id}`, { groups: ids });
    onChange();
  }
  async function move(a: DnsAdlist, dir: -1 | 1) {
    const idx = sorted.findIndex((x) => x.id === a.id);
    const neighbour = sorted[idx + dir];
    if (!neighbour) return;
    // dir -1 = move up (toward higher priority); +1 = move down
    const newPriority = dir === -1 ? neighbour.priority + 1 : neighbour.priority - 1;
    await dnsSend('PATCH', `/api/dns/adlists/${a.id}`, { priority: newPriority });
    onChange();
  }
  async function remove(a: DnsAdlist) {
    await dnsSend('DELETE', `/api/dns/adlists/${a.id}`);
    onChange();
  }
  async function updateLists() {
    setBusy(true);
    setGrav('updating lists… (fetching)');
    try {
      const r = await dnsSend<{ ok: number; failed: number; total: number }>('POST', '/api/dns/gravity');
      setGrav(`✓ ${num(r.total)} domains from ${r.ok} list(s)${r.failed ? `, ${r.failed} failed` : ''}`);
      onChange();
    } catch {
      setGrav('list update failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel>
      <PanelHeader
        label="Subscribed Lists"
        title="Block & allow sources"
        hint={grav ?? `${adlists.length} lists · order = priority (top wins conflicts)`}
        right={
          <button onClick={updateLists} disabled={busy} className="flex items-center gap-1.5 rounded-lg border border-accent/40 bg-[color-mix(in_oklch,var(--accent)_14%,transparent)] px-3 py-1.5 text-xs font-medium text-accent disabled:opacity-50">
            <RefreshCw size={13} className={busy ? 'animate-spin' : ''} /> Update lists
          </button>
        }
      />
      <div className="flex flex-wrap items-center gap-2 px-5 py-3">
        <div className="flex overflow-hidden rounded-lg border border-line">
          {(['block', 'allow'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setType(t)}
              className="px-3 py-2 text-xs font-medium transition-colors"
              style={{
                color: type === t ? (t === 'block' ? 'var(--danger)' : 'var(--good)') : 'var(--muted)',
                background: type === t ? 'color-mix(in oklch, currentColor 12%, transparent)' : 'transparent',
              }}
            >
              {t === 'block' ? 'Blocklist' : 'Allowlist'}
            </button>
          ))}
        </div>
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()}
          placeholder={type === 'block' ? 'https://…/hosts  (domains to block)' : 'https://…/allowlist  (domains to always allow)'}
          className="min-w-[180px] flex-1 rounded-lg border border-line bg-[var(--bg-2)] px-3 py-2 font-mono text-xs text-text outline-none placeholder:text-faint focus:border-accent/50"
        />
        <button onClick={add} disabled={busy} className="flex items-center gap-1.5 rounded-lg border border-accent/40 bg-[color-mix(in_oklch,var(--accent)_14%,transparent)] px-4 py-2 text-sm font-medium text-accent disabled:opacity-50">
          <Plus size={15} /> Add
        </button>
      </div>
      <div className="border-t border-line">
        {sorted.length === 0 ? (
          <div className="px-5 py-8 text-center text-sm text-faint">no subscribed lists yet</div>
        ) : (
          sorted.map((a, i) => (
            <div key={a.id} className="flex items-center gap-3 border-b border-line/50 px-5 py-2.5 last:border-0">
              <div className="flex flex-col">
                <button onClick={() => move(a, -1)} disabled={i === 0} className="text-faint transition-colors hover:text-accent disabled:opacity-25" title="higher priority">
                  <ChevronUp size={13} />
                </button>
                <button onClick={() => move(a, 1)} disabled={i === sorted.length - 1} className="text-faint transition-colors hover:text-accent disabled:opacity-25" title="lower priority">
                  <ChevronDown size={13} />
                </button>
              </div>
              <button onClick={() => toggle(a)} title={a.enabled ? 'disable' : 'enable'}>
                <StatusDot color={a.enabled ? 'var(--good)' : 'var(--faint)'} pulse={false} />
              </button>
              <Badge color={a.type === 'block' ? 'var(--danger)' : 'var(--good)'}>{a.type}</Badge>
              <span className="min-w-0 flex-1 truncate font-mono text-xs text-text" title={a.url}>{a.url}</span>
              <GroupsEditor selected={a.groups} groups={groups} onSave={(ids) => setGroups(a, ids)} />
              <Badge color={a.status === 'ok' ? 'var(--good)' : a.status === 'error' ? 'var(--danger)' : 'var(--faint)'}>{a.status}</Badge>
              <span className="stat shrink-0 text-xs text-muted">{num(a.count)}</span>
              <button onClick={() => remove(a)} className="text-faint transition-colors hover:text-danger" title="delete">
                <Trash2 size={14} />
              </button>
            </div>
          ))
        )}
      </div>
    </Panel>
  );
}
