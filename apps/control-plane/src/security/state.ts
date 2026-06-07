/** Shared security monitoring state: pause control (DNS-style), flags, acks. */
import type { SecurityPauseState } from '@nexrelm/types';

let paused: { active: boolean; until: number | null } = { active: false, until: null };
let heuristicsEnabled = true;
const acked = new Set<string>();

export function pauseState(): SecurityPauseState {
  if (paused.active && paused.until != null && Date.now() >= paused.until) paused = { active: false, until: null };
  return { active: paused.active, until: paused.until ? new Date(paused.until).toISOString() : null };
}

export function setPause(action: 'pause' | 'resume', seconds?: number): SecurityPauseState {
  if (action === 'resume') paused = { active: false, until: null };
  else paused = { active: true, until: seconds && seconds > 0 ? Date.now() + seconds * 1000 : null };
  return pauseState();
}

export function monitoringActive(): boolean {
  return !pauseState().active && heuristicsEnabled;
}

export function setHeuristics(on: boolean): void {
  heuristicsEnabled = on;
}
export function heuristicsOn(): boolean {
  return heuristicsEnabled;
}

export function acknowledge(id: string): void {
  acked.add(id);
}
export function isAcked(id: string): boolean {
  return acked.has(id);
}
