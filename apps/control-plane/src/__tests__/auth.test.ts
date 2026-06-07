import { test } from 'node:test';
import assert from 'node:assert/strict';
import { accountInfo, changePassword, isAuthInitialized, login, resetPassword, setupAuth, verifyToken } from '../core/auth';

// Runs against an isolated NEXRELM_DATA (set by the test script) — auth.json starts absent.
test('auth: full lifecycle — setup, login, forced change, reset', async () => {
  assert.equal(isAuthInitialized(), false);

  const created = setupAuth();
  assert.equal(created.username, 'admin');
  assert.ok(created.password.length >= 16, 'generated password is strong');
  assert.equal(isAuthInitialized(), true);
  assert.throws(() => setupAuth(), /already initialized/); // one-shot

  // wrong password is rejected
  const bad = await login('admin', 'definitely-wrong');
  assert.ok(!('session' in bad), 'bad password yields no session');

  // correct password → session, first login forces a change
  const r = await login('admin', created.password);
  assert.ok('session' in r, 'login returns a session');
  if (!('session' in r)) return;
  assert.equal(r.session.mustChangePassword, true);
  assert.ok(verifyToken(r.session.token), 'token verifies');

  // forced change clears the flag and revokes other sessions
  changePassword(r.session.token, created.password, 'my-own-passw0rd');
  assert.equal(accountInfo().mustChangePassword, false);

  // the generated password no longer works; the new one does
  assert.ok(!('session' in (await login('admin', created.password))));
  assert.ok('session' in (await login('admin', 'my-own-passw0rd')));
  assert.throws(() => changePassword(r.session.token, 'my-own-passw0rd', 'short'), /at least/);
});

test('auth: reset-password issues a temp credential and revokes sessions', async () => {
  const r = await login('admin', 'my-own-passw0rd');
  assert.ok('session' in r);
  if (!('session' in r)) return;
  const reset = resetPassword(); // generated → forces change at next login
  assert.equal(accountInfo().mustChangePassword, true);
  assert.equal(verifyToken(r.session.token), null, 'old session revoked by reset');
  assert.ok('session' in (await login('admin', reset.password)));

  const explicit = resetPassword('explicit-passw0rd'); // explicit → used as-is
  assert.equal(explicit.password, 'explicit-passw0rd');
  assert.equal(accountInfo().mustChangePassword, false);
});

test('auth: sessions are bound to the client fingerprint (anti-hijack)', async () => {
  resetPassword('bind-test-passw0rd');
  const r = await login('admin', 'bind-test-passw0rd', { ua: 'Mozilla/BrowserA', ip: '10.0.0.2' });
  assert.ok('session' in r);
  if (!('session' in r)) return;
  const token = r.session.token;
  // a lifted token replayed from a different browser is rejected
  assert.equal(verifyToken(token, { ua: 'curl/EvilClient', ip: '10.0.0.9' }), null, 'mismatched UA rejected');
  assert.ok(verifyToken(token, { ua: 'Mozilla/BrowserA' }), 'same UA accepted');
  assert.ok(verifyToken(token), 'internal verify (no UA) accepted');
});

test('auth: brute-force lockout after repeated failures, cleared by reset', async () => {
  resetPassword('lockout-test-passw0rd');
  let lastError: string | undefined;
  for (let i = 0; i < 5; i++) {
    const r = await login('admin', `wrong-${i}`);
    if ('error' in r) lastError = r.error;
  }
  assert.equal(lastError, 'locked', 'account locks after the threshold');
  assert.equal(accountInfo().locked, true);

  // even the correct password is refused while locked
  const blocked = await login('admin', 'lockout-test-passw0rd');
  assert.ok('error' in blocked && blocked.error === 'locked', 'correct password still locked out');

  // reset clears the lockout
  resetPassword('cleared-passw0rd');
  assert.equal(accountInfo().locked, false);
  assert.ok('session' in (await login('admin', 'cleared-passw0rd')));
});
