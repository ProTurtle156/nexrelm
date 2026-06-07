/**
 * Local authentication — created by the first-run installer. One admin account,
 * scrypt-hashed password (auto-generated at setup, shown once, forced change on
 * first login). Hardening:
 *   • sessions persisted as SHA-256 token HASHES (a stolen auth.json can't replay),
 *   • each session bound to the client's User-Agent fingerprint (anti-hijack:
 *     a lifted token used from a different browser is rejected),
 *   • absolute (7d) + idle (24h) session expiry,
 *   • brute-force lockout: N failed sign-ins → a timed lockout.
 * Until setup runs, isAuthInitialized() is false and the API guard stays open —
 * that's what routes a fresh install into the wizard instead of locking it out.
 */
import { createHash, randomBytes, randomInt, scryptSync, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AuthAccountInfo, AuthMe, AuthSession, AuthSetupResult } from '@nexrelm/types';
import { pushLog } from './logbus';

const DATA_DIR = process.env.NEXRELM_DATA ?? path.join(os.homedir(), '.nexrelm');
const FILE = path.join(DATA_DIR, 'auth.json');

const SESSION_TTL_MS = 7 * 86400_000; // absolute lifetime
const IDLE_TTL_MS = 24 * 3600_000; // expire after inactivity
const SEEN_THROTTLE_MS = 5 * 60_000; // how often last-seen is persisted
const MAX_SESSIONS = 10;
const MIN_PASSWORD_LEN = 8;
const MAX_FAILS = 5; // failed sign-ins before lockout
const FAIL_WINDOW_MS = 15 * 60_000; // failures older than this don't count
const LOCKOUT_MS = 15 * 60_000; // how long a lockout lasts

export interface LoginContext {
  ip?: string;
  ua?: string;
}
export type LoginResult = { session: AuthSession } | { error: 'invalid' } | { error: 'locked'; retryAfterSec: number };

interface SessionRec {
  tokenHash: string;
  createdAt: string;
  expiresAt: string;
  lastSeenAt: string;
  uaHash?: string;
  lastIp?: string;
}
interface AuthFile {
  username: string;
  salt: string; // hex
  hash: string; // hex, scrypt-64
  mustChangePassword: boolean;
  createdAt: string;
  updatedAt: string;
  sessions: SessionRec[];
  failedAttempts?: number;
  lastFailAt?: string;
  lockedUntil?: string;
}

function load(): AuthFile | null {
  try {
    return JSON.parse(fs.readFileSync(FILE, 'utf8')) as AuthFile;
  } catch {
    return null;
  }
}
function save(a: AuthFile): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(a, null, 2), { mode: 0o600 });
}

const hashPassword = (password: string, saltHex: string): string => scryptSync(password, Buffer.from(saltHex, 'hex'), 64).toString('hex');
const tokenHash = (token: string): string => createHash('sha256').update(token).digest('hex');
const fp = (s: string): string => createHash('sha256').update(s).digest('hex').slice(0, 32);
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Readable, unambiguous, ~115-bit generated password: 4 groups of 5. */
function generatePassword(): string {
  const alphabet = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const group = (): string => Array.from({ length: 5 }, () => alphabet[randomInt(alphabet.length)]).join('');
  return [group(), group(), group(), group()].join('-');
}

const live = (s: SessionRec, now: number): boolean =>
  new Date(s.expiresAt).getTime() > now && now - new Date(s.lastSeenAt).getTime() < IDLE_TTL_MS;

function pruneSessions(a: AuthFile): void {
  const now = Date.now();
  a.sessions = a.sessions.filter((s) => live(s, now));
  if (a.sessions.length > MAX_SESSIONS) a.sessions = a.sessions.slice(-MAX_SESSIONS);
}

export function isAuthInitialized(): boolean {
  return load() !== null;
}

/** First-run setup (the installer / `nexrelm setup`): create the admin account with a generated password. Returns it ONCE. */
export function setupAuth(): AuthSetupResult {
  if (isAuthInitialized()) throw new Error('already initialized');
  const password = generatePassword();
  const salt = randomBytes(16).toString('hex');
  const now = new Date().toISOString();
  save({ username: 'admin', salt, hash: hashPassword(password, salt), mustChangePassword: true, createdAt: now, updatedAt: now, sessions: [] });
  pushLog('system', 'info', 'installer — admin account created (password change required on first login)');
  return { username: 'admin', password };
}

/**
 * CLI recovery (`nexrelm reset-password`): set a new password, clear any lockout,
 * and revoke every session. A generated password forces a change at next sign-in.
 */
export function resetPassword(newPassword?: string): AuthSetupResult {
  const a = load();
  if (!a) throw new Error('not initialized — run `nexrelm setup` first');
  const explicit = typeof newPassword === 'string' && newPassword.length >= MIN_PASSWORD_LEN;
  if (typeof newPassword === 'string' && !explicit) throw new Error(`password must be at least ${MIN_PASSWORD_LEN} characters`);
  const password = explicit ? newPassword! : generatePassword();
  const salt = randomBytes(16).toString('hex');
  a.salt = salt;
  a.hash = hashPassword(password, salt);
  a.mustChangePassword = !explicit;
  a.sessions = [];
  a.failedAttempts = 0;
  a.lockedUntil = undefined;
  a.updatedAt = new Date().toISOString();
  save(a);
  pushLog('system', 'warn', 'admin password reset via CLI — all sessions revoked, lockout cleared');
  return { username: a.username, password };
}

/** Read-only account summary for `nexrelm status` (never exposes the hash). */
export function accountInfo(): AuthAccountInfo {
  const a = load();
  if (!a) return { initialized: false };
  const now = Date.now();
  const locked = !!a.lockedUntil && new Date(a.lockedUntil).getTime() > now;
  return {
    initialized: true,
    username: a.username,
    mustChangePassword: a.mustChangePassword,
    activeSessions: a.sessions.filter((s) => live(s, now)).length,
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
    locked,
  };
}

export async function login(username: string, password: string, ctx: LoginContext = {}): Promise<LoginResult> {
  const a = load();
  const now = Date.now();

  // brute-force lockout — checked before any password work
  if (a?.lockedUntil) {
    const until = new Date(a.lockedUntil).getTime();
    if (until > now) {
      await sleep(300);
      return { error: 'locked', retryAfterSec: Math.ceil((until - now) / 1000) };
    }
  }

  const candidate = a ? Buffer.from(hashPassword(password, a.salt), 'hex') : randomBytes(64); // constant work even for a bad user
  const stored = a ? Buffer.from(a.hash, 'hex') : randomBytes(64);
  const okUser = !!a && username.toLowerCase() === a.username.toLowerCase();

  if (!okUser || !timingSafeEqual(candidate, stored)) {
    await sleep(400); // damp brute force
    if (a) {
      const recent = a.lastFailAt && now - new Date(a.lastFailAt).getTime() < FAIL_WINDOW_MS;
      a.failedAttempts = (recent ? a.failedAttempts ?? 0 : 0) + 1;
      a.lastFailAt = new Date(now).toISOString();
      let lockedJustNow = false;
      if (a.failedAttempts >= MAX_FAILS) {
        a.lockedUntil = new Date(now + LOCKOUT_MS).toISOString();
        a.failedAttempts = 0;
        lockedJustNow = true;
      }
      save(a);
      // never log the raw value — a user who typed a password in the username field shouldn't leak it
      const safeUser = username.length > 24 ? '[redacted]' : username.replace(/[^\w.@-]/g, '');
      pushLog('system', 'warn', `failed sign-in for "${safeUser}"${lockedJustNow ? ` — account locked for ${LOCKOUT_MS / 60_000}m` : ''}`);
      if (lockedJustNow) return { error: 'locked', retryAfterSec: Math.ceil(LOCKOUT_MS / 1000) };
    }
    return { error: 'invalid' };
  }

  // success — clear failure state, mint a UA-bound session
  const token = randomBytes(32).toString('base64url');
  const iso = new Date(now).toISOString();
  a!.sessions.push({ tokenHash: tokenHash(token), createdAt: iso, expiresAt: new Date(now + SESSION_TTL_MS).toISOString(), lastSeenAt: iso, uaHash: ctx.ua ? fp(ctx.ua) : undefined, lastIp: ctx.ip });
  a!.failedAttempts = 0;
  a!.lockedUntil = undefined;
  pruneSessions(a!);
  save(a!);
  pushLog('system', 'info', `admin signed in${a!.mustChangePassword ? ' (password change pending)' : ''}${ctx.ip ? ` from ${ctx.ip}` : ''}`);
  return { session: { token, username: a!.username, mustChangePassword: a!.mustChangePassword } };
}

/** Returns the account when the bearer token is a live, UA-matching session, else null. */
export function verifyToken(token: string | undefined, ctx: LoginContext = {}): AuthMe | null {
  if (!token) return null;
  const a = load();
  if (!a) return null;
  const now = Date.now();
  const h = tokenHash(token);
  const s = a.sessions.find((x) => x.tokenHash === h);
  if (!s || !live(s, now)) return null;

  // anti-hijack: a lifted token replayed from a different browser fails the bind
  if (s.uaHash && ctx.ua && fp(ctx.ua) !== s.uaHash) {
    pushLog('system', 'warn', `rejected session with mismatched fingerprint${ctx.ip ? ` from ${ctx.ip}` : ''} — possible token theft`);
    return null;
  }

  // refresh last-seen (throttled, so we don't write on every request)
  if (now - new Date(s.lastSeenAt).getTime() > SEEN_THROTTLE_MS) {
    s.lastSeenAt = new Date(now).toISOString();
    if (ctx.ip) s.lastIp = ctx.ip;
    save(a);
  }
  return { username: a.username, mustChangePassword: a.mustChangePassword };
}

export function logout(token: string | undefined): void {
  if (!token) return;
  const a = load();
  if (!a) return;
  const h = tokenHash(token);
  a.sessions = a.sessions.filter((s) => s.tokenHash !== h);
  save(a);
}

/** Verify current password, set the new one, clear the first-login flag, revoke every other session. */
export function changePassword(token: string | undefined, currentPassword: string, newPassword: string): void {
  const me = verifyToken(token);
  if (!me) throw new Error('unauthorized');
  if (typeof newPassword !== 'string' || newPassword.length < MIN_PASSWORD_LEN) throw new Error(`new password must be at least ${MIN_PASSWORD_LEN} characters`);
  const a = load()!;
  const current = Buffer.from(hashPassword(currentPassword ?? '', a.salt), 'hex');
  if (!timingSafeEqual(current, Buffer.from(a.hash, 'hex'))) throw new Error('current password is incorrect');
  const salt = randomBytes(16).toString('hex');
  a.salt = salt;
  a.hash = hashPassword(newPassword, salt);
  a.mustChangePassword = false;
  a.updatedAt = new Date().toISOString();
  const keep = token ? tokenHash(token) : '';
  a.sessions = a.sessions.filter((s) => s.tokenHash === keep); // sign out everywhere else
  save(a);
  pushLog('system', 'info', 'admin password changed');
}
