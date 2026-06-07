'use client';

import { Check, Moon, Sun } from 'lucide-react';
import { useTheme } from '@/components/providers/ThemeProvider';
import { THEMES } from '@/lib/themes';
import { Panel, PanelHeader } from '@/components/ui/Panel';
import { cn } from '@/lib/format';
import type { Mode } from '@/lib/themes';

export function ThemePicker() {
  const { theme, mode, setTheme, setMode } = useTheme();
  return (
    <Panel>
      <PanelHeader label="Appearance" title="Theme" hint="pick a look — each works in light or dark" right={<ModeToggle mode={mode} setMode={setMode} />} />
      <div className="grid grid-cols-2 gap-3 px-5 pb-5 pt-3 sm:grid-cols-3 xl:grid-cols-5">
        {THEMES.map((t) => {
          const [bg, accent] = t.swatch[mode];
          const active = theme === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTheme(t.id)}
              className={cn('group flex flex-col gap-2 rounded-lg border p-2.5 text-left transition-colors', active ? 'border-accent/60' : 'border-line hover:border-line-strong')}
              style={active ? { background: 'color-mix(in oklch, var(--accent) 8%, transparent)' } : undefined}
            >
              {/* mini preview of the theme */}
              <div className="relative h-16 overflow-hidden rounded-md border" style={{ background: bg, borderColor: 'color-mix(in oklch, ' + accent + ' 25%, transparent)' }}>
                <span className="absolute left-2 top-2 h-1.5 w-10 rounded-full" style={{ background: accent }} />
                <span className="absolute left-2 top-[18px] h-1 w-14 rounded-full" style={{ background: accent, opacity: 0.4 }} />
                <span className="absolute bottom-2 left-2 right-2 h-5 rounded" style={{ background: 'color-mix(in oklch, ' + accent + ' 16%, transparent)', border: '1px solid color-mix(in oklch, ' + accent + ' 45%, transparent)' }} />
                {active && (
                  <span className="absolute right-1.5 top-1.5 grid h-5 w-5 place-items-center rounded-full" style={{ background: accent, color: bg }}>
                    <Check size={12} strokeWidth={3} />
                  </span>
                )}
              </div>
              <div>
                <div className="text-sm font-medium text-text">{t.label}</div>
                <div className="text-[0.66rem] leading-snug text-muted">{t.blurb}</div>
              </div>
            </button>
          );
        })}
      </div>
    </Panel>
  );
}

function ModeToggle({ mode, setMode }: { mode: Mode; setMode: (m: Mode) => void }) {
  return (
    <div className="flex items-center gap-0.5 rounded-full border border-line p-0.5">
      <button type="button" onClick={() => setMode('light')} className={cn('flex items-center gap-1 rounded-full px-2.5 py-1 text-xs transition-colors', mode === 'light' ? 'bg-surface-2 text-text' : 'text-muted hover:text-text')}>
        <Sun size={13} /> Light
      </button>
      <button type="button" onClick={() => setMode('dark')} className={cn('flex items-center gap-1 rounded-full px-2.5 py-1 text-xs transition-colors', mode === 'dark' ? 'bg-surface-2 text-text' : 'text-muted hover:text-text')}>
        <Moon size={13} /> Dark
      </button>
    </div>
  );
}
