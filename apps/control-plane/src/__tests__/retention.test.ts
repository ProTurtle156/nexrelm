import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pruneNow, saveSystemSettings } from '../core/system-settings';
import { queryInsert } from '../dns';

test('retention: pruneNow removes data older than the configured window', async () => {
  // set a 30-day DNS window first (saving prunes immediately) ...
  await saveSystemSettings({ dnsQueryRetentionDays: 30, dnsClientRetentionDays: 30 });
  // ... then add a query stamped 100 days ago
  const old = new Date(Date.now() - 100 * 86_400_000).toISOString();
  queryInsert({ ts: old, client: '10.30.0.5', domain: 'ancient.test', type: 'A', status: 'forwarded', replyMs: 2 });

  const result = pruneNow();
  assert.ok(result.dnsQueries >= 1, 'the 100-day-old query is pruned');

  // a second prune removes nothing new
  const again = pruneNow();
  assert.equal(again.dnsQueries, 0, 'idempotent — nothing left to prune');
});

test('retention: 0 days means keep forever', async () => {
  await saveSystemSettings({ dnsQueryRetentionDays: 0 });
  const old = new Date(Date.now() - 500 * 86_400_000).toISOString();
  queryInsert({ ts: old, client: '10.30.0.6', domain: 'forever.test', type: 'A', status: 'forwarded', replyMs: 2 });
  const result = pruneNow();
  assert.equal(result.dnsQueries, 0, 'with retention 0, nothing is pruned');
});
