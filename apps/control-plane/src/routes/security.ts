import type { FastifyInstance } from 'fastify';
import type { ApiResponse, FwRuleInput, FwTrust, ScanRequest, ScanSchedule, SecSeverity } from '@nexrelm/types';
import { computeOverview } from '../security/analytics';
import { detectThreats } from '../security/heuristics';
import { pauseState, setPause, setHeuristics, acknowledge } from '../security/state';
import { firewallState, ruleAdd, ruleUpdate, ruleDelete, ruleReorder, zoneAdd, zoneDelete, setEnforced, evaluate, exportNft } from '../security/firewall';
import { currentScan, startScan, cancelScan, scorePosture, getSchedule, setSchedule, scanProfiles } from '../security/scan';
import { feedState, refreshFeeds, setFeedEnabled } from '../security/intel-feeds';
import { activeResponseState, setActiveResponse } from '../security/response';
import { remediationState, applyRemediation, dismissRemediation, applyMany, dismissMany } from '../security/remediation';
import { gatewayStatus, enableGateway, enableLanGateway, disableGateway, addForward, delForward, exportForwardsNft, setDhcpHandoff } from '../security/gateway';
import { networkPosture, setDhcpServer } from '../security/network';
import { registryAll, setTrust, setTrustMany, setDeviceName } from '../security/registry';
import { baselineState } from '../security/baseline';
import { sinkholeState, setSinkholeEnabled, setSinkholeDomains } from '../dns';
import { badDomains } from '../security/intel-feeds';
import { setTuning } from '../security/tuning';
import { vulnIntelState, refreshVulnIntel } from '../security/vuln-intel';
import { blockedState, unblock } from '../security/blocked';
import type { DeviceTrust, HeuristicSensitivity } from '@nexrelm/types';
import { securitySettings, setVtKey, lookupIndicator, connectScanner } from '../security/threat';
import { inventory, startDiscovery, discoveryState } from '../security/inventory';
import { autoIntelState } from '../security/autointel';
import { scannerStats } from '../security/scanner-stats';
import { recentEvents } from '../security/events';
import { snifferState, startSniffer, stopSniffer } from '../security/sniffer';

function ok<T>(data: T): ApiResponse<T> {
  return { ok: true, data, error: null, meta: { generatedAt: new Date().toISOString() } };
}
function fail(error: string): ApiResponse<null> {
  return { ok: false, data: null, error };
}

const SEV_PENALTY: Record<string, number> = { critical: 14, high: 7, medium: 3, low: 1, info: 0 };

function postureScore(): number {
  const scan = currentScan();
  let score = scan && scan.hosts.length ? scorePosture(scan.hosts).score : 100;
  for (const a of detectThreats()) score -= SEV_PENALTY[a.severity] ?? 0;
  return Math.max(0, Math.min(100, Math.round(score)));
}

/** Real, app-layer security: posture analytics, heuristics, firewall, scanning, threat intel. */
export async function registerSecurityRoutes(app: FastifyInstance): Promise<void> {
  // ── dashboard ──
  app.get<{ Querystring: { window?: string } }>('/api/security/overview', async (req) => {
    const windowSec = Math.min(3600, Math.max(30, Number(req.query.window) || 300));
    const alerts = detectThreats();
    const devices = await inventory();
    return ok(computeOverview(windowSec, { postureScore: postureScore(), activeAlerts: alerts.filter((a) => !a.acknowledged).length }, devices));
  });

  // live feed — rolling threat-level detections (NOT raw DNS)
  app.get<{ Querystring: { limit?: string } }>('/api/security/feed', async (req) => {
    const limit = Math.min(300, Math.max(1, Number(req.query.limit) || 120));
    return ok(recentEvents(limit));
  });

  // ── network device inventory ──
  app.get('/api/security/devices', async () => ok(await inventory()));
  app.get('/api/security/devices/discovery', async () => ok(discoveryState()));
  app.post<{ Body: { subnet?: string } }>('/api/security/devices/discover', async (req, reply) => {
    try {
      return ok(await startDiscovery(req.body?.subnet));
    } catch (e) {
      reply.code(400);
      return fail(e instanceof Error ? e.message : 'discovery failed');
    }
  });

  // ── automated threat intel (VirusTotal) ──
  app.get('/api/security/intel', async () => ok(autoIntelState()));

  // ── threat-intelligence feeds ──
  app.get('/api/security/feeds', async () => ok(feedState()));
  app.post('/api/security/feeds/refresh', async () => ok(await refreshFeeds()));
  app.post<{ Params: { id: string }; Body: { enabled: boolean } }>('/api/security/feeds/:id', async (req) => ok(setFeedEnabled(req.params.id, req.body?.enabled !== false)));

  // ── active response (IPS) ──
  app.get('/api/security/response', async () => ok(activeResponseState()));
  app.post<{ Body: { enabled?: boolean; minSeverity?: SecSeverity } }>('/api/security/response', async (req) => ok(setActiveResponse(req.body ?? {})));

  // ── network integration posture (DNS · DHCP · capture · gateway modes) ──
  app.get('/api/security/network', async () => ok(await networkPosture()));
  app.post<{ Body: { enabled?: boolean } }>('/api/security/network/dhcp', async (req) => ok(await setDhcpServer(req.body?.enabled !== false)));

  // ── gateway / network edge (device pilot · LAN gateway · forwards · DHCP hand-off) ──
  app.get('/api/security/gateway', async () => ok(await gatewayStatus()));
  app.post<{ Body: { action: 'device' | 'lan' | 'disable'; client?: string; subnet?: string } }>('/api/security/gateway', async (req, reply) => {
    try {
      const a = req.body?.action;
      if (a === 'device') return ok(await enableGateway(req.body?.client ?? ''));
      if (a === 'lan') return ok(await enableLanGateway(req.body?.subnet));
      if (a === 'disable') return ok(await disableGateway());
      reply.code(400);
      return fail('action must be device | lan | disable');
    } catch (e) {
      reply.code(400);
      return fail(e instanceof Error ? e.message : 'gateway action failed');
    }
  });
  app.post<{ Body: { proto: 'tcp' | 'udp'; wanPort: number; toHost: string; toPort: number; comment?: string } }>('/api/security/gateway/forwards', async (req, reply) => {
    try {
      return ok(addForward(req.body));
    } catch (e) {
      reply.code(400);
      return fail(e instanceof Error ? e.message : 'invalid port forward');
    }
  });
  app.delete<{ Params: { id: string } }>('/api/security/gateway/forwards/:id', async (req) => ok(delForward(req.params.id)));
  app.get('/api/security/gateway/forwards/export', async (_req, reply) => {
    const st = await gatewayStatus(); // use the detected WAN interface, even when off
    reply.header('content-type', 'text/plain; charset=utf-8');
    return exportForwardsNft(st.wan);
  });
  app.post<{ Body: { enabled?: boolean } }>('/api/security/gateway/dhcp-handoff', async (req) => ok(await setDhcpHandoff(req.body?.enabled !== false)));

  // ── device registry / new-device detection ──
  app.get('/api/security/registry', async () => ok(registryAll()));
  // bulk: approve all / block all (or a selected subset of macs)
  app.post<{ Body: { action: 'approve' | 'block' | 'pending'; macs?: string[] } }>('/api/security/registry/bulk', async (req, reply) => {
    const action = req.body?.action;
    const trust: DeviceTrust | undefined = action === 'approve' ? 'known' : action === 'block' ? 'blocked' : action === 'pending' ? 'pending' : undefined;
    if (!trust) {
      reply.code(400);
      return fail('action must be approve | block | pending');
    }
    const macs = req.body?.macs?.length ? req.body.macs : registryAll().devices.map((d) => d.mac);
    return ok(setTrustMany(macs, trust));
  });
  app.post<{ Params: { mac: string }; Body: { action?: 'approve' | 'block' | 'pending'; name?: string } }>('/api/security/registry/:mac', async (req, reply) => {
    const { action, name } = req.body ?? {};
    if (name != null) setDeviceName(req.params.mac, name);
    const trust: DeviceTrust | undefined = action === 'approve' ? 'known' : action === 'block' ? 'blocked' : action === 'pending' ? 'pending' : undefined;
    if (trust) return ok(setTrust(req.params.mac, trust));
    if (name != null) return ok(registryAll());
    reply.code(400);
    return fail('provide action (approve|block|pending) and/or name');
  });

  // ── DNS sinkhole of threat intel ──
  app.get('/api/security/sinkhole', async () => ok(sinkholeState()));
  app.post<{ Body: { enabled?: boolean } }>('/api/security/sinkhole', async (req) => {
    const on = req.body?.enabled !== false;
    setSinkholeEnabled(on);
    if (on) setSinkholeDomains(badDomains());
    return ok(sinkholeState());
  });

  // ── adaptive anomaly baseline ──
  app.get('/api/security/baseline', async () => ok(baselineState()));

  // ── blocked things (review + undo) ──
  app.get('/api/security/blocked', async () => ok(blockedState()));
  app.post<{ Body: { kind: 'firewall' | 'domain' | 'device'; id: string } }>('/api/security/blocked/unblock', async (req, reply) => {
    const { kind, id } = req.body ?? {};
    if ((kind !== 'firewall' && kind !== 'domain' && kind !== 'device') || !id) {
      reply.code(400);
      return fail('kind (firewall|domain|device) and id are required');
    }
    const r = unblock(kind, id);
    if (!r.ok) {
      reply.code(400);
      return fail(r.error ?? 'unblock failed');
    }
    return ok(blockedState());
  });

  // ── vulnerability intelligence (deprecated/EOL services + OSs) ──
  app.get('/api/security/vuln-intel', async () => ok(vulnIntelState()));
  app.post('/api/security/vuln-intel/refresh', async () => ok(await refreshVulnIntel()));

  // ── remediation ──
  app.get('/api/security/remediation', async () => ok(remediationState()));
  app.post<{ Params: { id: string } }>('/api/security/remediation/:id/apply', async (req, reply) => {
    const r = applyRemediation(req.params.id);
    if (!r.ok) {
      reply.code(400);
      return fail(r.error ?? 'apply failed');
    }
    return ok(remediationState());
  });
  app.post<{ Params: { id: string } }>('/api/security/remediation/:id/dismiss', async (req) => {
    dismissRemediation(req.params.id);
    return ok(remediationState());
  });
  // bulk: remediate all / ignore all (or a selected subset of ids)
  app.post<{ Body: { action: 'apply' | 'dismiss'; ids?: string[] } }>('/api/security/remediation/bulk', async (req, reply) => {
    const action = req.body?.action;
    if (action !== 'apply' && action !== 'dismiss') {
      reply.code(400);
      return fail('action must be apply | dismiss');
    }
    const ids = req.body?.ids?.length ? req.body.ids : remediationState().items.filter((i) => !i.applied).map((i) => i.id);
    if (action === 'apply') applyMany(ids);
    else dismissMany(ids);
    return ok(remediationState());
  });

  // ── scan schedule ──
  app.get('/api/security/scan/schedule', async () => ok(getSchedule()));
  app.post<{ Body: Partial<ScanSchedule> }>('/api/security/scan/schedule', async (req) => ok(setSchedule(req.body ?? {})));

  // ── external scanner stats ──
  app.get<{ Querystring: { kind?: 'nessus' | 'wazuh' } }>('/api/security/scanner/stats', async (req, reply) => {
    const kind = req.query.kind;
    if (kind !== 'nessus' && kind !== 'wazuh') {
      reply.code(400);
      return fail('kind must be nessus | wazuh');
    }
    return ok(await scannerStats(kind));
  });

  // ── passive sniffer ──
  app.get('/api/security/sniffer', async () => ok(snifferState()));
  app.post<{ Body: { action: 'start' | 'stop' } }>('/api/security/sniffer', async (req, reply) => {
    const action = req.body?.action;
    if (action === 'start') return ok(await startSniffer());
    if (action === 'stop') return ok(stopSniffer());
    reply.code(400);
    return fail('action must be start | stop');
  });

  // ── threats / heuristics ──
  app.get<{ Querystring: { window?: string } }>('/api/security/alerts', async (req) => {
    const windowSec = Math.min(3600, Math.max(30, Number(req.query.window) || 120));
    return ok(detectThreats(windowSec));
  });
  app.post<{ Params: { id: string } }>('/api/security/alerts/:id/ack', async (req) => {
    acknowledge(req.params.id);
    return ok({ id: req.params.id });
  });

  // ── pause (DNS-style) ──
  app.get('/api/security/pause', async () => ok(pauseState()));
  app.post<{ Body: { action: 'pause' | 'resume'; seconds?: number } }>('/api/security/pause', async (req, reply) => {
    const action = req.body?.action;
    if (action !== 'pause' && action !== 'resume') {
      reply.code(400);
      return fail('action must be pause | resume');
    }
    return ok(setPause(action, req.body?.seconds));
  });
  app.post<{ Body: { enabled: boolean } }>('/api/security/heuristics', async (req) => {
    setHeuristics(req.body?.enabled !== false);
    return ok(securitySettings());
  });
  // engine tuning: sensitivity + trusted-host allowlist
  app.post<{ Body: { sensitivity?: HeuristicSensitivity; trustedHosts?: string[] } }>('/api/security/tuning', async (req, reply) => {
    const s = req.body?.sensitivity;
    if (s != null && s !== 'low' && s !== 'medium' && s !== 'high') {
      reply.code(400);
      return fail('sensitivity must be low | medium | high');
    }
    setTuning({ sensitivity: s, trustedHosts: req.body?.trustedHosts });
    return ok(securitySettings());
  });

  // ── firewall ──
  app.get('/api/security/firewall', async () => ok(firewallState()));
  app.post<{ Body: FwRuleInput }>('/api/security/firewall/rules', async (req, reply) => {
    const b = req.body;
    if (!b?.direction || !b.action || !b.source) {
      reply.code(400);
      return fail('direction, action and source are required');
    }
    return ok(ruleAdd(b));
  });
  app.patch<{ Params: { id: string }; Body: Record<string, unknown> }>('/api/security/firewall/rules/:id', async (req, reply) => {
    const r = ruleUpdate(req.params.id, req.body ?? {});
    if (!r) {
      reply.code(404);
      return fail('no such rule');
    }
    return ok(r);
  });
  app.delete<{ Params: { id: string } }>('/api/security/firewall/rules/:id', async (req, reply) => {
    if (!ruleDelete(req.params.id)) {
      reply.code(404);
      return fail('no such rule');
    }
    return ok({ id: req.params.id });
  });
  app.post<{ Params: { id: string }; Body: { dir: -1 | 1 } }>('/api/security/firewall/rules/:id/reorder', async (req) => ok(ruleReorder(req.params.id, req.body?.dir === 1 ? 1 : -1)));
  app.post<{ Body: { name: string; cidrs: string[]; trust: FwTrust } }>('/api/security/firewall/zones', async (req, reply) => {
    if (!req.body?.name) {
      reply.code(400);
      return fail('name is required');
    }
    return ok(zoneAdd(req.body.name, req.body.cidrs ?? [], req.body.trust ?? 'internal'));
  });
  app.delete<{ Params: { id: string } }>('/api/security/firewall/zones/:id', async (req, reply) => {
    if (!zoneDelete(req.params.id)) {
      reply.code(404);
      return fail('no such zone');
    }
    return ok({ id: req.params.id });
  });
  app.post<{ Body: { enforced: boolean } }>('/api/security/firewall/enforce', async (req) => ok(setEnforced(req.body?.enforced !== false)));
  app.post<{ Body: { ip: string; direction?: 'inbound' | 'outbound' } }>('/api/security/firewall/test', async (req, reply) => {
    if (!req.body?.ip) {
      reply.code(400);
      return fail('ip is required');
    }
    return ok(evaluate(req.body.ip, req.body.direction ?? 'inbound'));
  });
  app.get('/api/security/firewall/export', async (_req, reply) => {
    reply.header('content-type', 'text/plain; charset=utf-8');
    return exportNft();
  });

  // ── vulnerability scan + posture ──
  app.get('/api/security/scan', async () => ok(currentScan()));
  app.get('/api/security/scan/profiles', async () => ok(scanProfiles()));
  app.post('/api/security/scan/cancel', async () => ok(cancelScan()));
  app.post<{ Body: ScanRequest }>('/api/security/scan', async (req, reply) => {
    if (!req.body?.target) {
      reply.code(400);
      return fail('target is required');
    }
    try {
      return ok(startScan(req.body));
    } catch (e) {
      reply.code(400);
      return fail(e instanceof Error ? e.message : 'scan failed to start');
    }
  });
  app.get('/api/security/posture', async () => {
    const scan = currentScan();
    if (!scan || !scan.hosts.length) return ok(null);
    return ok(scorePosture(scan.hosts));
  });

  // ── threat intel + settings ──
  app.get('/api/security/settings', async () => ok(securitySettings()));
  app.post<{ Body: { key: string } }>('/api/security/vt-key', async (req) => {
    setVtKey(req.body?.key ?? '');
    return ok(securitySettings());
  });
  app.post<{ Body: { indicator: string } }>('/api/security/threat/lookup', async (req, reply) => {
    if (!req.body?.indicator) {
      reply.code(400);
      return fail('indicator is required');
    }
    return ok(await lookupIndicator(req.body.indicator));
  });
  app.post<{ Body: { kind: 'nessus' | 'wazuh'; url: string; token: string } }>('/api/security/scanner', async (req, reply) => {
    const b = req.body;
    if ((b?.kind !== 'nessus' && b?.kind !== 'wazuh') || !b.url) {
      reply.code(400);
      return fail('kind (nessus|wazuh) and url are required');
    }
    return ok(await connectScanner(b.kind, b.url, b.token ?? ''));
  });
}
