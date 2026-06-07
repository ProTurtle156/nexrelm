/**
 * Shared visual vocabulary — maps domain enums onto the design tokens in
 * globals.css so every panel speaks the same color language.
 */
import type { Health, KpiTone, NodeKind, Severity } from '@nexrelm/types';

/** A CSS color string (a token reference) for a KPI tone. */
export function toneVar(tone: KpiTone | undefined): string {
  switch (tone) {
    case 'good':
      return 'var(--good)';
    case 'warn':
      return 'var(--warn)';
    case 'danger':
      return 'var(--danger)';
    case 'violet':
      return 'var(--violet)';
    case 'accent':
    default:
      return 'var(--accent)';
  }
}

export function healthVar(health: Health): string {
  switch (health) {
    case 'operational':
      return 'var(--good)';
    case 'degraded':
      return 'var(--warn)';
    case 'offline':
      return 'var(--danger)';
    case 'disabled':
    default:
      return 'var(--faint)';
  }
}

export function severityVar(sev: Severity): string {
  switch (sev) {
    case 'critical':
      return 'var(--danger)';
    case 'high':
      return 'var(--danger)';
    case 'medium':
      return 'var(--warn)';
    case 'low':
      return 'var(--accent-dim)';
    case 'info':
    default:
      return 'var(--faint)';
  }
}

/** Status used by topology nodes + leases + links. */
export function stateVar(state: string): string {
  switch (state) {
    case 'online':
    case 'up':
    case 'active':
    case 'running':
      return 'var(--good)';
    case 'degraded':
    case 'offered':
    case 'reserved':
    case 'paused':
    case 'suspended':
      return 'var(--warn)';
    case 'offline':
    case 'down':
    case 'expired':
    case 'error':
    case 'stopped':
      return 'var(--danger)';
    default:
      return 'var(--faint)';
  }
}

/** Relative radius (px) for a topology node by role. */
export function nodeRadius(kind: NodeKind): number {
  switch (kind) {
    case 'gateway':
    case 'firewall':
      return 16;
    case 'switch':
    case 'router':
      return 13;
    case 'server':
    case 'host':
      return 12;
    case 'ap':
      return 10;
    case 'vm':
    case 'container':
      return 9;
    case 'iot':
      return 7;
    default:
      return 8;
  }
}

export const NODE_GLYPH: Record<NodeKind, string> = {
  gateway: '⊕',
  firewall: '▣',
  router: '⇄',
  switch: '⊟',
  ap: '☷',
  server: '▤',
  host: '▥',
  vm: '◇',
  container: '⬡',
  iot: '◦',
  unknown: '∙',
};
