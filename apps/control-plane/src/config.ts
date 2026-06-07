/** Runtime configuration, read once from the environment. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * TLS: serve HTTPS when a cert + key are present. Looked up (in order) from
 * NEXRELM_TLS_CERT/NEXRELM_TLS_KEY, then <data-dir>/tls/{cert,key}.pem. Generate
 * a self-signed pair with `nexrelm gen-cert` (deploy/gen-cert.sh). Absent → HTTP.
 */
function resolveTls(): { cert: Buffer; key: Buffer } | null {
  const dataDir = process.env.NEXRELM_DATA ?? path.join(os.homedir(), '.nexrelm');
  const certPath = process.env.NEXRELM_TLS_CERT ?? path.join(dataDir, 'tls', 'cert.pem');
  const keyPath = process.env.NEXRELM_TLS_KEY ?? path.join(dataDir, 'tls', 'key.pem');
  try {
    if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
      return { cert: fs.readFileSync(certPath), key: fs.readFileSync(keyPath) };
    }
  } catch {
    /* fall through to HTTP */
  }
  return null;
}

export const config = {
  port: Number(process.env.PORT ?? 8787),
  host: process.env.HOST ?? '0.0.0.0',
  corsOrigin: process.env.CORS_ORIGIN ?? '*',
  /** Simulator tick interval in milliseconds. */
  tickMs: Number(process.env.TICK_MS ?? 2000),
  /** TLS material when HTTPS is configured, else null (plain HTTP). */
  tls: resolveTls(),
} as const;

export type Config = typeof config;
