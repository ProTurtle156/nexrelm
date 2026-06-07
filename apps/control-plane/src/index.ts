import { buildServer } from './server';
import { config } from './config';
import { world } from './core/world';
import { startDns } from './dns';
import { startDhcp } from './dhcp';
import { directory } from './directory/ldap';
import { pushLog } from './core/logbus';
import { startLogCollector } from './core/log-collector';
import { startSystemMaintenance } from './core/system-settings';
import type { DnsResolverStatus } from '@nexrelm/types';

async function main(): Promise<void> {
  const app = await buildServer();
  world.start(config.tickMs);
  await app.listen({ port: config.port, host: config.host });
  const scheme = config.tls ? 'https' : 'http';
  pushLog('system', 'info', `control plane online · ${scheme.toUpperCase()} :${config.port} · ${config.tls ? 'wss' : 'ws'} /ws${config.tls ? '' : ' (TLS off — run `nexrelm gen-cert`)'}`);

  // The DNS resolver binds its own UDP/TCP sockets; a bind failure must not take
  // down the REST/WS control plane, so it's isolated.
  let dns: DnsResolverStatus | null = null;
  try {
    dns = await startDns();
    pushLog('dns', 'info', dns?.running ? `resolver listening on ${dns.bind}:${dns.port}` : 'resolver started');
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[nexrelm] DNS resolver failed to start:', err);
    pushLog('dns', 'error', `resolver failed to start: ${err instanceof Error ? err.message : 'unknown'}`);
  }
  // DHCP is OFF by default (conflicts with the router's DHCP); start() is a no-op
  // unless the operator has explicitly enabled it.
  try {
    await startDhcp();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[nexrelm] DHCP server failed to start:', err);
  }
  // Silently re-bind a retained directory session (encrypted at rest) so the
  // operator isn't re-prompted after a restart. Failure just leaves it logged out.
  try {
    const restored = await directory.restoreSession();
    if (restored) {
      console.log('[nexrelm] directory session restored from retained credentials');
      pushLog('directory', 'info', 'directory session restored from retained credentials');
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[nexrelm] directory session restore failed:', err);
  }

  // security background runners: auto threat-intel, scan scheduler, event feed
  try {
    const { startAutoIntel } = await import('./security/autointel');
    const { startScanScheduler } = await import('./security/scan');
    const { startEventRunner } = await import('./security/events');
    const { startFeeds } = await import('./security/intel-feeds');
    const { startVulnIntel } = await import('./security/vuln-intel');
    startAutoIntel();
    startScanScheduler();
    startEventRunner();
    startFeeds();
    startVulnIntel();
    pushLog('security', 'info', 'security engine started (threat detection, feeds, scans)');
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[nexrelm] security runners failed to start:', err);
    pushLog('security', 'error', `security runners failed: ${err instanceof Error ? err.message : 'unknown'}`);
  }

  startLogCollector();
  startSystemMaintenance(); // apply log-buffer size + hourly retention prune
  banner(dns);
}

function banner(dns: DnsResolverStatus | null): void {
  const line = '─'.repeat(54);
  const dnsLine = dns?.running
    ? `\x1b[32m${dns.bind}:${dns.port}\x1b[0m${dns.privileged ? '' : ' \x1b[33m(unprivileged)\x1b[0m'}`
    : '\x1b[31mnot running\x1b[0m';
  /* eslint-disable no-console */
  console.log(`\x1b[36m┌${line}┐\x1b[0m`);
  console.log(`\x1b[36m│\x1b[0m  \x1b[1m\x1b[35mNEXRELM\x1b[0m control plane  ·  one nexus, every realm   \x1b[36m│\x1b[0m`);
  console.log(`\x1b[36m├${line}┤\x1b[0m`);
  console.log(`\x1b[36m│\x1b[0m  REST   http://${config.host}:${config.port}/api/dashboard      `);
  console.log(`\x1b[36m│\x1b[0m  WS     ws://${config.host}:${config.port}/ws                    `);
  console.log(`\x1b[36m│\x1b[0m  DNS    ${dnsLine}`);
  if (dns?.message) console.log(`\x1b[36m│\x1b[0m  note   \x1b[33m${dns.message}\x1b[0m`);
  console.log(`\x1b[36m│\x1b[0m  mode   \x1b[33msimulator\x1b[0m  ·  tick ${config.tickMs}ms                  `);
  console.log(`\x1b[36m└${line}┘\x1b[0m`);
  /* eslint-enable no-console */
}

main().catch((err: unknown) => {
  // eslint-disable-next-line no-console
  console.error('[nexrelm] fatal:', err);
  process.exit(1);
});
