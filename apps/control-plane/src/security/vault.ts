/**
 * At-rest secret vault. Encrypts retained credentials (directory session, VM
 * passwords) with AES-256-GCM so they never sit on disk in plaintext.
 *
 * Security model (self-hosted tool):
 *  - The 256-bit key lives in its OWN file (`secret.key`, mode 0600), separate
 *    from every ciphertext — reading a creds file alone reveals nothing.
 *  - GCM's auth tag makes ciphertext tamper-evident: a swapped/forged blob fails
 *    to decrypt rather than yielding attacker-chosen plaintext (anti-forgery).
 *  - A fresh 96-bit IV per encryption.
 * For stronger isolation the key file can be backed by an OS keyring later; the
 * envelope format (`v1.iv.tag.ct`) is versioned to allow that migration.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

const DATA_DIR = process.env.NEXRELM_DATA ?? path.join(os.homedir(), '.nexrelm');
const KEY_FILE = process.env.NEXRELM_KEYFILE ?? path.join(DATA_DIR, 'secret.key');

let cachedKey: Buffer | null = null;

function key(): Buffer {
  if (cachedKey) return cachedKey;
  try {
    const k = fs.readFileSync(KEY_FILE);
    if (k.length === 32) {
      cachedKey = k;
      return k;
    }
  } catch {
    /* generate below */
  }
  const k = crypto.randomBytes(32);
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(KEY_FILE, k, { mode: 0o600 });
  try {
    fs.chmodSync(KEY_FILE, 0o600);
  } catch {
    /* best effort on platforms without POSIX perms */
  }
  cachedKey = k;
  return k;
}

/** True if `s` looks like one of our envelopes (vs. legacy plaintext). */
export function isEncrypted(s: string): boolean {
  return typeof s === 'string' && s.startsWith('v1.');
}

export function encryptSecret(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString('base64')}.${tag.toString('base64')}.${ct.toString('base64')}`;
}

/** Decrypt an envelope. Returns null on any failure (tamper, wrong key, garbage). */
export function decryptSecret(blob: string): string | null {
  try {
    const parts = blob.split('.');
    if (parts.length !== 4 || parts[0] !== 'v1') return null;
    const [, ivB, tagB, ctB] = parts;
    const decipher = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(ivB!, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB!, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(ctB!, 'base64')), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}
