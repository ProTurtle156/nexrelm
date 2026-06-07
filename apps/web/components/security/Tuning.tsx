'use client';

import { useState } from 'react';
import { SlidersHorizontal, Plus, X } from 'lucide-react';
import type { SecuritySettings, HeuristicSensitivity } from '@nexrelm/types';
import { useSec, secSend } from '@/lib/security';
import { Panel, PanelHeader } from '@/components/ui/Panel';

const LEVELS: Array<{ id: HeuristicSensitivity; label: string; hint: string }> = [
  { id: 'low', label: 'Low', hint: 'fewest alerts' },
  { id: 'medium', label: 'Medium', hint: 'balanced' },
  { id: 'high', label: 'High', hint: 'most sensitive' },
];

export function Tuning() {
  const { data, refresh } = useSec<SecuritySettings>('/api/security/settings', 0);
  const [host, setHost] = useState('');
  const tuning = data?.tuning;
  const sens = tuning?.sensitivity ?? 'medium';
  const hosts = tuning?.trustedHosts ?? [];

  async function setSensitivity(s: HeuristicSensitivity) {
    await secSend('POST', '/api/security/tuning', { sensitivity: s });
    refresh();
  }
  async function addHost() {
    const h = host.trim();
    if (!h || hosts.includes(h)) return;
    await secSend('POST', '/api/security/tuning', { trustedHosts: [...hosts, h] });
    setHost('');
    refresh();
  }
  async function removeHost(h: string) {
    await secSend('POST', '/api/security/tuning', { trustedHosts: hosts.filter((x) => x !== h) });
    refresh();
  }

  return (
    <Panel brackets>
      <PanelHeader label="Tuning" title="Engine sensitivity" hint="how aggressively to flag" right={<SlidersHorizontal size={16} className="text-accent" />} />
      <div className="flex flex-col gap-4 px-5 pb-5 pt-2">
        <div className="flex overflow-hidden rounded-lg border border-line">
          {LEVELS.map((l) => {
            const on = sens === l.id;
            return (
              <button key={l.id} onClick={() => setSensitivity(l.id)} className={`flex flex-1 flex-col items-center gap-0.5 px-3 py-2 transition-colors ${on ? 'bg-[color-mix(in_oklch,var(--accent)_16%,transparent)] text-accent' : 'text-muted hover:text-text'}`}>
                <span className="text-sm font-medium">{l.label}</span>
                <span className="text-[0.6rem] text-faint">{l.hint}</span>
              </button>
            );
          })}
        </div>

        <div>
          <div className="label">Trusted hosts</div>
          <p className="mt-1 text-[0.66rem] text-faint">IPs / CIDRs exempt from <span className="text-muted">port-scan / sweep / lateral</span> detection — for DNS servers, gateways, and other legitimately busy hosts. This machine's own IPs are always exempt. Known-bad-IP contact is still flagged for everyone.</p>
          <div className="mt-2 flex gap-2">
            <input
              value={host}
              onChange={(e) => setHost(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addHost()}
              placeholder="192.168.1.10  or  192.168.1.0/24"
              className="flex-1 rounded-lg border border-line bg-[var(--bg-0)] px-3 py-1.5 stat text-xs text-text outline-none placeholder:text-faint focus:border-accent"
            />
            <button onClick={addHost} disabled={!host.trim()} className="flex items-center gap-1 rounded-lg border border-accent/40 bg-[color-mix(in_oklch,var(--accent)_14%,transparent)] px-3 text-xs font-medium text-accent disabled:opacity-40"><Plus size={13} /> Add</button>
          </div>
          {hosts.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {hosts.map((h) => (
                <span key={h} className="flex items-center gap-1 rounded-full border border-line px-2 py-0.5 stat text-[0.66rem] text-muted">
                  {h}
                  <button onClick={() => removeHost(h)} className="text-faint hover:text-danger"><X size={11} /></button>
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </Panel>
  );
}
