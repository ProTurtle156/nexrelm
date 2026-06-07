'use client';

import { useState } from 'react';
import { ShieldCheck, Check, X, Bug, Radar, ListChecks } from 'lucide-react';
import type { RemediationItem, RemediationState } from '@nexrelm/types';
import { useSec, secSend, SEV_COLOR } from '@/lib/security';
import { relTime } from '@/lib/format';
import { Panel, PanelHeader } from '@/components/ui/Panel';
import { Badge } from '@/components/ui/Badge';

export function Remediation() {
  const { data, refresh } = useSec<RemediationState>('/api/security/remediation', 5000);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const items = data?.items ?? [];
  const threats = items.filter((i) => i.source === 'threat');
  const vulns = items.filter((i) => i.source === 'vulnerability');
  const actionable = items.filter((i) => !i.applied);
  const allSelected = actionable.length > 0 && actionable.every((i) => selected.has(i.id));

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }
  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(actionable.map((i) => i.id)));
  }

  async function apply(id: string) {
    try {
      await secSend('POST', `/api/security/remediation/${encodeURIComponent(id)}/apply`);
    } catch (e) {
      alert(e instanceof Error ? e.message : 'apply failed');
    }
    refresh();
  }
  async function dismiss(id: string) {
    await secSend('POST', `/api/security/remediation/${encodeURIComponent(id)}/dismiss`);
    refresh();
  }
  async function bulk(action: 'apply' | 'dismiss', ids?: string[]) {
    const count = ids ? ids.length : actionable.length;
    if (count === 0) return;
    if (action === 'apply' && !confirm(`Remediate ${ids ? `the ${count} selected` : `all ${count}`} item(s)? This applies firewall/DNS blocks for actionable items.`)) return;
    await secSend('POST', '/api/security/remediation/bulk', { action, ids });
    setSelected(new Set());
    refresh();
  }

  const hasSelection = selected.size > 0;

  return (
    <div className="flex flex-col gap-5">
      {/* bulk toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-[var(--bg-1)] px-4 py-2.5">
        <label className="flex cursor-pointer items-center gap-2 text-sm text-muted">
          <input type="checkbox" checked={allSelected} onChange={toggleAll} disabled={actionable.length === 0} className="accent-[var(--accent)]" />
          <ListChecks size={15} className="text-accent" />
          Select all
          <span className="stat text-xs text-faint">{hasSelection ? `${selected.size} selected` : `${actionable.length} actionable`}</span>
        </label>
        <div className="flex items-center gap-2">
          <button
            onClick={() => bulk('apply', hasSelection ? [...selected] : undefined)}
            disabled={actionable.length === 0}
            className="flex items-center gap-1.5 rounded-lg border border-accent/40 bg-[color-mix(in_oklch,var(--accent)_14%,transparent)] px-3 py-1.5 text-xs font-medium text-accent disabled:opacity-40"
          >
            <Check size={13} /> {hasSelection ? 'Remediate selected' : 'Remediate all'}
          </button>
          <button
            onClick={() => bulk('dismiss', hasSelection ? [...selected] : undefined)}
            disabled={actionable.length === 0}
            className="flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-xs text-muted hover:text-danger disabled:opacity-40"
          >
            <X size={13} /> {hasSelection ? 'Ignore selected' : 'Ignore all'}
          </button>
        </div>
      </div>

      <Section title="Threat remediations" hint="from the live detection engine — actions Nexrelm can take right now" icon={<Bug size={16} className="text-accent" />} items={threats} apply={apply} dismiss={dismiss} selected={selected} onToggle={toggle} emptyText="No active threats need remediation. As the engine flags something, an apply/dismiss action appears here." />
      <Section title="Device vulnerabilities" hint="recommendations from the latest scan, per device" icon={<Radar size={16} className="text-accent" />} items={vulns} apply={apply} dismiss={dismiss} selected={selected} onToggle={toggle} emptyText="No scan findings yet. Run a scan (Vulnerabilities tab) and per-device recommendations land here." />

      {(data?.applied ?? []).length > 0 && (
        <Panel>
          <PanelHeader label="Log" title="Applied remediations" hint={`${data?.applied.length} actions taken`} right={<ShieldCheck size={16} className="text-good" />} />
          <div className="flex flex-col">
            {(data?.applied ?? []).map((a, i) => (
              <div key={i} className="flex items-center gap-3 border-b border-line/50 px-5 py-2 text-xs last:border-0">
                <Check size={13} className="text-good" />
                <span className="text-text">{a.title}</span>
                <span className="ml-auto text-faint">{relTime(a.ts)}</span>
              </div>
            ))}
          </div>
        </Panel>
      )}
    </div>
  );
}

interface SectionProps {
  title: string;
  hint: string;
  icon: React.ReactNode;
  items: RemediationItem[];
  apply: (id: string) => void;
  dismiss: (id: string) => void;
  selected: Set<string>;
  onToggle: (id: string) => void;
  emptyText: string;
}

function Section({ title, hint, icon, items, apply, dismiss, selected, onToggle, emptyText }: SectionProps) {
  return (
    <Panel>
      <PanelHeader label="Remediation" title={title} hint={`${items.length} · ${hint}`} right={icon} />
      <div className="flex flex-col">
        {items.length === 0 && <div className="px-5 py-8 text-center text-sm text-faint">{emptyText}</div>}
        {items.map((it) => {
          const isSel = selected.has(it.id);
          return (
            <div key={it.id} className={`flex items-start gap-3 border-b border-line/50 px-5 py-3 last:border-0 ${it.applied ? 'opacity-55' : ''} ${isSel ? 'bg-[color-mix(in_oklch,var(--accent)_7%,transparent)]' : ''}`}>
              {it.applied ? (
                <span className="mt-1 h-3.5 w-3.5 shrink-0" />
              ) : (
                <input type="checkbox" checked={isSel} onChange={() => onToggle(it.id)} className="mt-1 shrink-0 accent-[var(--accent)]" />
              )}
              <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: SEV_COLOR[it.severity] }} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-text">{it.title}</span>
                  <Badge color={SEV_COLOR[it.severity]}>{it.severity}</Badge>
                  {it.mitre && <span className="rounded border border-violet/40 px-1.5 py-0.5 text-[0.6rem] text-violet" title={`MITRE ATT&CK: ${it.mitre.name}`}>{it.mitre.id}</span>}
                  {it.target && <span className="font-mono text-[0.66rem] text-faint">{it.target}</span>}
                </div>
                <p className="mt-0.5 text-xs text-muted">{it.detail}</p>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                {it.applied ? (
                  <span className="flex items-center gap-1 text-xs text-good"><Check size={13} /> applied</span>
                ) : it.action.kind === 'advice' ? (
                  <button onClick={() => dismiss(it.id)} className="rounded-lg border border-line px-2.5 py-1 text-xs text-muted hover:text-text">Acknowledge</button>
                ) : (
                  <>
                    <button onClick={() => apply(it.id)} className="flex items-center gap-1 rounded-lg border border-accent/40 bg-[color-mix(in_oklch,var(--accent)_14%,transparent)] px-2.5 py-1 text-xs font-medium text-accent" title={it.action.label}><Check size={12} /> {it.action.label}</button>
                    <button onClick={() => dismiss(it.id)} className="rounded-lg border border-line px-2 py-1 text-xs text-faint hover:text-danger"><X size={12} /></button>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </Panel>
  );
}
