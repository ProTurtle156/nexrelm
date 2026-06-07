/**
 * Retained directory session. The admin connection details are encrypted with
 * the secret vault and written to disk so the control plane can silently
 * re-bind after a restart instead of re-prompting the operator. Only ever
 * written when the operator opted into "remember".
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { DirectoryConnectInput } from '@nexrelm/types';
import { encryptSecret, decryptSecret } from '../security/vault';

const DATA_DIR = process.env.NEXRELM_DATA ?? path.join(os.homedir(), '.nexrelm');
const FILE = process.env.NEXRELM_DIR_SESSION ?? path.join(DATA_DIR, 'directory-session.enc');

export function saveSession(input: DirectoryConnectInput): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(FILE, encryptSecret(JSON.stringify(input)), { mode: 0o600 });
  try {
    fs.chmodSync(FILE, 0o600);
  } catch {
    /* best effort */
  }
}

export function loadSession(): DirectoryConnectInput | null {
  try {
    const blob = fs.readFileSync(FILE, 'utf8');
    const json = decryptSecret(blob);
    if (!json) return null;
    return JSON.parse(json) as DirectoryConnectInput;
  } catch {
    return null;
  }
}

export function clearSession(): void {
  try {
    fs.rmSync(FILE, { force: true });
  } catch {
    /* already gone */
  }
}

export function hasSession(): boolean {
  return fs.existsSync(FILE);
}
