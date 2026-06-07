import { test } from 'node:test';
import assert from 'node:assert/strict';
import { onboardingState } from '../core/onboarding';

test('onboarding: readiness state assembles with the expected shape', async () => {
  const s = await onboardingState();

  assert.equal(typeof s.lan.ip, 'string');
  assert.equal(typeof s.lan.cidr, 'string');
  assert.equal(typeof s.wanIface, 'string');
  assert.equal(typeof s.dnsPointAt, 'string');

  assert.equal(typeof s.caps.capture, 'boolean');
  assert.equal(typeof s.caps.scan, 'boolean');
  assert.equal(typeof s.gatewayAvailable, 'boolean');

  assert.ok(s.posture, 'posture is present');
  assert.equal(typeof s.trafficFlowing, 'boolean');
  assert.ok(['dns', 'gateway'].includes(s.recommended));
  assert.equal(typeof s.trafficSignal, 'string');
});
