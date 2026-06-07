/**
 * In-memory compiled view of every list (manual block/allow + subscribed
 * adlists, each of which can be a block OR allow list) for fast per-query
 * lookup. When a domain is on several lists, the highest-priority list wins;
 * at equal priority, allow beats block. Group-scoped: a list only applies to a
 * client that shares one of its groups.
 */
import { activeEntries, gravityEntries } from './db';

interface ListEntry {
  id: number; // manual entry id, or -1 for gravity
  type: 'block' | 'allow';
  priority: number;
  groups: Set<number>;
}
interface RegexEntry extends ListEntry {
  re: RegExp;
}

let exact = new Map<string, ListEntry[]>();
let regex: RegexEntry[] = [];
let blockCount = 0;

export function compile(): void {
  const ex = new Map<string, ListEntry[]>();
  const rx: RegexEntry[] = [];
  const push = (domain: string, e: ListEntry): void => {
    const a = ex.get(domain);
    if (a) a.push(e);
    else ex.set(domain, [e]);
  };

  for (const t of ['block', 'allow'] as const) {
    for (const e of activeEntries(t)) {
      const groups = new Set(e.groups.length ? e.groups : [0]);
      if (e.kind === 'regex') {
        try {
          rx.push({ id: e.id, type: t, priority: e.priority, groups, re: new RegExp(e.domain, 'i') });
        } catch {
          /* skip invalid regex */
        }
      } else {
        push(e.domain, { id: e.id, type: t, priority: e.priority, groups });
      }
    }
  }
  for (const g of gravityEntries()) {
    push(g.domain, { id: -1, type: g.type, priority: g.priority, groups: new Set(g.groups.length ? g.groups : [0]) });
  }

  exact = ex;
  regex = rx;

  let bc = 0;
  for (const arr of ex.values()) if (arr.some((e) => e.type === 'block')) bc++;
  bc += rx.filter((e) => e.type === 'block').length;
  blockCount = bc;
}

export function blockDomainCount(): number {
  return blockCount;
}

const overlaps = (set: Set<number>, groups: number[]): boolean => groups.some((g) => set.has(g));

export type LookupResult = { action: 'allow' | 'block'; listId: number } | { action: 'none' };

/**
 * Decide a domain for a client's group set. Collect every matching list entry,
 * then the highest-priority one wins (allow beating block at equal priority).
 *
 * Matching is by domain AND any of its parent domains: a list entry for
 * `facebook.com` therefore also covers `www.facebook.com`, `m.facebook.com`,
 * etc. — which is what people expect when they block a site. We walk every
 * suffix from the full name down to (but not including) the bare TLD, so a
 * lone `com` entry can never blanket-block everything.
 */
export function lookup(domainRaw: string, clientGroups: number[]): LookupResult {
  const domain = domainRaw.toLowerCase().replace(/\.$/, '');
  const matches: ListEntry[] = [];
  const labels = domain.split('.');
  for (let i = 0; i < labels.length - 1; i++) {
    const suffix = i === 0 ? domain : labels.slice(i).join('.');
    const ex = exact.get(suffix);
    if (ex) for (const e of ex) if (overlaps(e.groups, clientGroups)) matches.push(e);
  }
  for (const e of regex) if (overlaps(e.groups, clientGroups) && e.re.test(domain)) matches.push(e);
  if (!matches.length) return { action: 'none' };
  matches.sort((a, b) => b.priority - a.priority || (a.type === b.type ? 0 : a.type === 'allow' ? -1 : 1));
  const w = matches[0]!;
  return { action: w.type, listId: w.id };
}
