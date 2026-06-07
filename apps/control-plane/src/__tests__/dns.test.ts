import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeStats, domainAdd, queryInsert } from '../dns';
import { compile, lookup } from '../dns/lists';

test('dns stats: 48 aligned, zero-filled 30-minute buckets summing to total', () => {
  const now = new Date().toISOString();
  queryInsert({ ts: now, client: '10.9.0.5', domain: 'alpha.test', type: 'A', status: 'forwarded', replyMs: 4 });
  queryInsert({ ts: now, client: '10.9.0.5', domain: 'bravo.test', type: 'A', status: 'blocked', replyMs: 0 });

  const s = computeStats();
  // regression guard for the node:sqlite REAL-binding bug: must be a real 24h grid
  assert.equal(s.series.length, 48, '48 half-hour buckets');
  for (const p of s.series) assert.equal(p.t % 1_800_000, 0, 'every bucket aligned to 30 min');
  const gaps = new Set<number>();
  for (let i = 1; i < s.series.length; i++) gaps.add(s.series[i]!.t - s.series[i - 1]!.t);
  assert.deepEqual([...gaps], [1_800_000], 'uniform spacing');
  assert.equal(
    s.series.reduce((a, p) => a + p.total, 0),
    s.totalQueries,
    'buckets sum to the total',
  );
});

test('dns blocking: matches a domain and its subdomains, never a substring', () => {
  domainAdd({ type: 'block', kind: 'exact', domain: 'blocked.test' });
  compile();
  assert.equal(lookup('blocked.test', [0]).action, 'block');
  assert.equal(lookup('www.blocked.test', [0]).action, 'block');
  assert.equal(lookup('m.blocked.test', [0]).action, 'block');
  assert.equal(lookup('notblocked.test', [0]).action, 'none', 'substring is not a match');
  assert.equal(lookup('allowed.test', [0]).action, 'none');
});
