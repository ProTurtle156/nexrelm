/**
 * Collect live telemetry from a VM over SSH. Runs one portable probe script and
 * parses the key=value output. Linux-focused (uses /proc, free, df); on a host
 * where the probe can't run, `reachable` is still true if SSH connected but the
 * fields stay undefined.
 */
import type { VmDisk, VmMachineStats } from '@nexrelm/types';
import { runSshCommand, type ShellTarget } from '../net/ssh';

// Note: \\n below is a literal backslash-n for `tr`, not a JS newline.
const PROBE = `
echo "HOST=$(hostname 2>/dev/null)"
echo "OS=$( (. /etc/os-release 2>/dev/null && printf '%s' "$PRETTY_NAME") || uname -s )"
echo "KERNEL=$(uname -r 2>/dev/null)"
echo "ARCH=$(uname -m 2>/dev/null)"
echo "VIRT=$(systemd-detect-virt 2>/dev/null || echo unknown)"
echo "UPTIME=$(cut -d' ' -f1 /proc/uptime 2>/dev/null)"
echo "CORES=$(nproc 2>/dev/null || getconf _NPROCESSORS_ONLN 2>/dev/null)"
echo "CPUMODEL=$(awk -F: '/model name/{print $2; exit}' /proc/cpuinfo 2>/dev/null | sed 's/^ *//')"
echo "LOAD=$(cut -d' ' -f1-3 /proc/loadavg 2>/dev/null)"
echo "USERS=$(who 2>/dev/null | wc -l)"
echo "PROCS=$(ps -e 2>/dev/null | tail -n +2 | wc -l)"
echo "MEM=$(free -k 2>/dev/null | awk '/^Mem:/{print $2","$3","$7}')"
echo "SWAP=$(free -k 2>/dev/null | awk '/^Swap:/{print $2","$3}')"
echo "IPS=$(hostname -I 2>/dev/null || ip -4 -o addr show scope global 2>/dev/null | awk '{print $4}' | cut -d/ -f1 | tr '\\n' ' ')"
echo DISKS_START
df -kP 2>/dev/null | tail -n +2 | awk '$1 !~ /tmpfs|devtmpfs|overlay|squashfs/ {print $6"|"$1"|"$2"|"$3"|"$5}'
echo DISKS_END
`;

function num(s?: string): number | undefined {
  if (s == null || s === '') return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}

function parse(out: string): VmMachineStats {
  const s: VmMachineStats = { reachable: true };
  const kv = new Map<string, string>();
  const disks: VmDisk[] = [];
  let inDisks = false;
  for (const raw of out.split('\n')) {
    const line = raw.replace(/\r$/, '');
    if (line === 'DISKS_START') {
      inDisks = true;
      continue;
    }
    if (line === 'DISKS_END') {
      inDisks = false;
      continue;
    }
    if (inDisks) {
      const p = line.split('|');
      if (p.length >= 5 && p[0]) disks.push({ mount: p[0]!, fs: p[1] || undefined, sizeKb: num(p[2]) ?? 0, usedKb: num(p[3]) ?? 0, usePct: num(String(p[4]).replace('%', '')) ?? 0 });
      continue;
    }
    const i = line.indexOf('=');
    if (i > 0) kv.set(line.slice(0, i), line.slice(i + 1));
  }
  const g = (k: string): string | undefined => kv.get(k)?.trim() || undefined;

  s.hostname = g('HOST');
  s.os = g('OS');
  s.kernel = g('KERNEL');
  s.arch = g('ARCH');
  s.virtType = g('VIRT');
  s.cpuModel = g('CPUMODEL');
  s.uptimeSec = g('UPTIME') ? Math.round(num(g('UPTIME')) ?? 0) : undefined;
  s.cpuCores = num(g('CORES'));
  s.loggedInUsers = num(g('USERS'));
  s.processes = num(g('PROCS'));

  const load = g('LOAD')?.split(/\s+/).map(Number);
  if (load && load.length >= 3) {
    [s.load1, s.load5, s.load15] = [load[0], load[1], load[2]];
  }
  if (s.load1 != null && s.cpuCores) s.cpuPct = Math.min(100, Math.round((s.load1 / s.cpuCores) * 100));

  const mem = g('MEM')?.split(',');
  if (mem && mem.length >= 2) {
    s.memTotalKb = num(mem[0]) ?? 0;
    s.memUsedKb = num(mem[1]) ?? 0;
    s.memAvailableKb = num(mem[2]);
  }
  const swap = g('SWAP')?.split(',');
  if (swap && swap.length >= 2) {
    s.swapTotalKb = num(swap[0]) ?? 0;
    s.swapUsedKb = num(swap[1]) ?? 0;
  }
  const ips = g('IPS');
  if (ips) s.ipAddrs = ips.split(/\s+/).filter(Boolean);
  if (disks.length) s.disks = disks;
  return s;
}

export async function collectStats(target: ShellTarget): Promise<VmMachineStats> {
  const t0 = Date.now();
  try {
    const r = await runSshCommand(target, PROBE, 12_000);
    const stats = parse(r.stdout);
    stats.collectedMs = Date.now() - t0;
    return stats;
  } catch (e) {
    return { reachable: false, error: e instanceof Error ? e.message : String(e), collectedMs: Date.now() - t0 };
  }
}
