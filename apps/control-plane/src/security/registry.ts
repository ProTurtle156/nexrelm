/**
 * Device registry — the backbone of new-device detection. Every device the
 * inventory observes (keyed by MAC) is recorded with first/last-seen and a trust
 * level. A MAC seen for the first time lands as 'pending' and raises a new_device
 * alert; the operator approves it ('known') or blocks it. Persisted in SQLite.
 */
import type { ClientOs, DeviceRegistryState, DeviceTrust, RegisteredDevice, SecurityAlert } from '@nexrelm/types';
import { db } from './store';

function rowToDevice(r: Record<string, unknown>): RegisteredDevice {
  return {
    mac: String(r.mac),
    ip: String(r.ip ?? ''),
    name: r.name != null ? String(r.name) : undefined,
    vendor: r.vendor != null ? String(r.vendor) : undefined,
    os: r.os != null ? (String(r.os) as ClientOs) : undefined,
    trust: String(r.trust) as DeviceTrust,
    firstSeen: String(r.first_seen),
    lastSeen: String(r.last_seen),
  };
}

export function registryAll(): DeviceRegistryState {
  const devices = db.prepare('SELECT * FROM devices ORDER BY last_seen DESC').all().map(rowToDevice);
  return {
    devices,
    pending: devices.filter((d) => d.trust === 'pending').length,
    known: devices.filter((d) => d.trust === 'known').length,
    blocked: devices.filter((d) => d.trust === 'blocked').length,
  };
}

/** Build the alert raised when a brand-new device appears. */
export function newDeviceAlert(d: RegisteredDevice): SecurityAlert {
  const label = d.name || `${d.ip}${d.vendor ? ` (${d.vendor})` : ''}`;
  return {
    id: `new_device:${d.mac}`,
    ts: new Date().toISOString(),
    severity: 'medium',
    kind: 'new_device',
    source: d.ip || d.mac,
    title: 'New device joined the network',
    detail: `A previously-unseen device — ${label} [${d.mac}] — appeared on the network. Approve it as known or block it in the Devices tab.`,
    count: 1,
    evidence: d.mac,
    mitre: { id: 'T1200', name: 'Hardware Additions' },
  };
}

/** Reconcile observed devices into the registry; returns the newly-seen (pending) ones. */
export function syncDevices(observed: Array<{ mac?: string; ip: string; vendor?: string; os?: ClientOs }>): RegisteredDevice[] {
  const now = new Date().toISOString();
  const newly: RegisteredDevice[] = [];
  for (const d of observed) {
    if (!d.mac) continue; // need a stable L2 identity to track a device
    const mac = d.mac.toLowerCase();
    const existing = db.prepare('SELECT * FROM devices WHERE mac = ?').get(mac);
    // a concrete OS (e.g. nmap fingerprinted Windows) overwrites a prior "other"
    const osVal = d.os && d.os !== 'other' ? d.os : null;
    if (existing) {
      db.prepare('UPDATE devices SET ip = ?, last_seen = ?, vendor = COALESCE(vendor, ?), os = COALESCE(?, os) WHERE mac = ?').run(d.ip, now, d.vendor ?? null, osVal, mac);
    } else {
      db.prepare('INSERT INTO devices(mac, ip, vendor, os, trust, first_seen, last_seen) VALUES(?,?,?,?,?,?,?)').run(mac, d.ip, d.vendor ?? null, d.os ?? null, 'pending', now, now);
      newly.push({ mac, ip: d.ip, vendor: d.vendor, os: d.os, trust: 'pending', firstSeen: now, lastSeen: now });
    }
  }
  return newly;
}

export function setTrust(mac: string, trust: DeviceTrust): DeviceRegistryState {
  db.prepare('UPDATE devices SET trust = ? WHERE mac = ?').run(trust, mac.toLowerCase());
  return registryAll();
}

/** Set trust on many devices at once (approve all / block all). */
export function setTrustMany(macs: string[], trust: DeviceTrust): DeviceRegistryState {
  const stmt = db.prepare('UPDATE devices SET trust = ? WHERE mac = ?');
  for (const mac of macs) stmt.run(trust, mac.toLowerCase());
  return registryAll();
}

export function setDeviceName(mac: string, name: string): DeviceRegistryState {
  db.prepare('UPDATE devices SET name = ? WHERE mac = ?').run(name || null, mac.toLowerCase());
  return registryAll();
}

/** MACs the operator has explicitly blocked — feed into quarantine/firewall logic. */
export function blockedMacs(): string[] {
  return db
    .prepare("SELECT mac FROM devices WHERE trust = 'blocked'")
    .all()
    .map((r) => String(r.mac));
}
