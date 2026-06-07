import { test } from 'node:test';
import assert from 'node:assert/strict';
import { leaseByIp, leaseUpsert, pruneLeasesByAge, scopeAdd } from '../dhcp/db';
import { allocate, canAssign } from '../dhcp/allocator';

test('dhcp: allocator hands out an address inside the scope range', () => {
  const scope = scopeAdd({
    name: 'test-lan',
    state: 'active',
    subnet: '10.20.0.0',
    mask: '255.255.255.0',
    rangeStart: '10.20.0.100',
    rangeEnd: '10.20.0.110',
    leaseSeconds: 3600,
    dnsMode: 'inherit',
    dnsServers: [],
    options: [],
  });

  const ip = allocate(scope, 'aa:bb:cc:00:00:01');
  assert.ok(ip, 'an address is offered');
  const n = Number(ip!.split('.')[3]);
  assert.ok(n >= 100 && n <= 110, `address ${ip} is in range`);
  assert.equal(canAssign(scope, 'aa:bb:cc:00:00:01', ip!), true);

  // record the lease (as the server does on DISCOVER), then a second client must
  // get a different address — proving the allocator avoids assigned IPs.
  leaseUpsert({ id: 'first', scopeId: scope.id, ip: ip!, mac: 'aa:bb:cc:00:00:01', state: 'active', startedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 3_600_000).toISOString() });
  const ip2 = allocate(scope, 'aa:bb:cc:00:00:02');
  assert.ok(ip2);
  assert.notEqual(ip2, ip, 'a different client gets a different address');
});

test('dhcp: lease retention prunes old, non-active leases', () => {
  const old = new Date(Date.now() - 40 * 86_400_000).toISOString();
  const fresh = new Date().toISOString();
  leaseUpsert({ id: 'old', scopeId: 's', ip: '10.20.0.250', mac: 'aa:bb:cc:00:00:09', state: 'expired', startedAt: old, expiresAt: old });
  leaseUpsert({ id: 'active', scopeId: 's', ip: '10.20.0.251', mac: 'aa:bb:cc:00:00:0a', state: 'active', startedAt: old, expiresAt: old });
  leaseUpsert({ id: 'recent', scopeId: 's', ip: '10.20.0.252', mac: 'aa:bb:cc:00:00:0b', state: 'expired', startedAt: fresh, expiresAt: fresh });

  const removed = pruneLeasesByAge(30);
  assert.ok(removed >= 1, 'at least the old expired lease is removed');
  assert.equal(leaseByIp('10.20.0.250'), undefined, 'old expired lease gone');
  assert.ok(leaseByIp('10.20.0.251'), 'active lease kept regardless of age');
  assert.ok(leaseByIp('10.20.0.252'), 'recent expired lease kept');
});
