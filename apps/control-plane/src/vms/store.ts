/**
 * Persistent registry of VMs the operator manages over SSH. Stored as JSON in
 * the Nexrelm data dir. Passwords are kept on disk so the control plane can SSH
 * in for telemetry and the terminal — they are NEVER returned over the API
 * (callers get `hasPassword` instead).
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import type { VmMachine, VmMachineInput, VmMachineStats } from '@nexrelm/types';
import type { ShellTarget } from '../net/ssh';
import { encryptSecret, decryptSecret, isEncrypted } from '../security/vault';

const DATA_DIR = process.env.NEXRELM_DATA ?? path.join(os.homedir(), '.nexrelm');
const FILE = process.env.NEXRELM_VMS_DB ?? path.join(DATA_DIR, 'vms.json');

interface StoredVm {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  password: string;
  tags: string[];
  notes?: string;
  createdAt: string;
  lastChecked?: string;
  stats?: VmMachineStats;
}

let cache: StoredVm[] | null = null;

function load(): StoredVm[] {
  if (cache) return cache;
  try {
    cache = JSON.parse(fs.readFileSync(FILE, 'utf8')) as StoredVm[];
  } catch {
    cache = [];
  }
  return cache;
}

function persist(): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(cache ?? [], null, 2));
}

function sanitize(v: StoredVm): VmMachine {
  return {
    id: v.id,
    name: v.name,
    host: v.host,
    port: v.port,
    username: v.username,
    hasPassword: !!v.password,
    tags: v.tags ?? [],
    notes: v.notes,
    createdAt: v.createdAt,
    lastChecked: v.lastChecked,
    stats: v.stats,
  };
}

export const vmStore = {
  list(): VmMachine[] {
    return load().map(sanitize);
  },
  getPublic(id: string): VmMachine | undefined {
    const v = load().find((x) => x.id === id);
    return v ? sanitize(v) : undefined;
  },
  /** SSH target (with decrypted password) for internal use — telemetry + terminal. */
  target(id: string): ShellTarget | null {
    const v = load().find((x) => x.id === id);
    if (!v || !v.password) return null;
    const password = isEncrypted(v.password) ? decryptSecret(v.password) : v.password; // tolerate legacy plaintext
    if (password == null) return null;
    return { host: v.host, port: v.port, username: v.username, password };
  },
  add(input: VmMachineInput): VmMachine {
    const list = load();
    const v: StoredVm = {
      id: randomUUID(),
      name: input.name.trim(),
      host: input.host.trim(),
      port: input.port && input.port > 0 ? input.port : 22,
      username: input.username.trim(),
      password: input.password ? encryptSecret(input.password) : '',
      tags: input.tags ?? [],
      notes: input.notes,
      createdAt: new Date().toISOString(),
    };
    list.push(v);
    persist();
    return sanitize(v);
  },
  update(id: string, patch: Partial<VmMachineInput>): VmMachine | undefined {
    const list = load();
    const v = list.find((x) => x.id === id);
    if (!v) return undefined;
    if (patch.name != null) v.name = patch.name.trim();
    if (patch.host != null) v.host = patch.host.trim();
    if (patch.port != null && patch.port > 0) v.port = patch.port;
    if (patch.username != null) v.username = patch.username.trim();
    if (patch.password) v.password = encryptSecret(patch.password); // only overwrite when a new one is supplied
    if (patch.tags != null) v.tags = patch.tags;
    if (patch.notes != null) v.notes = patch.notes;
    persist();
    return sanitize(v);
  },
  remove(id: string): boolean {
    const list = load();
    const i = list.findIndex((x) => x.id === id);
    if (i < 0) return false;
    list.splice(i, 1);
    persist();
    return true;
  },
  setStats(id: string, stats: VmMachineStats): VmMachine | undefined {
    const v = load().find((x) => x.id === id);
    if (!v) return undefined;
    v.stats = stats;
    v.lastChecked = new Date().toISOString();
    persist();
    return sanitize(v);
  },
};
