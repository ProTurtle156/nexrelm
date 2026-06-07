# Nexrelm Inline Gateway — design spec (Phase: P1 built)

> Status: **P1 IMPLEMENTED** (2026-06-05) — per-device forward + NAT (Tier 1 flow
> metadata), with a Gateway tab, kill switch, and dead-man watchdog. DHCP-wide mode
> (P1 mode 1) and Tiers 2–3 remain spec. Inserting Nexrelm inline re-routes traffic
> and needs elevated privileges — it is installed and enabled **deliberately, never
> silently** (see Installation below). This documents the architecture, the staged
> rollout, the privileges, and the rollback.

> **Quick start:** `sudo bash deploy/install-gateway.sh` (one-time), then
> Security → Gateway → point a pilot device's gateway at the shown LAN IP → enable.
> See [Installation](#installation--p1) and [Deployment](#deployment-notes) below.

## Goal
Move Nexrelm from a **side-car** (sees only DNS + what the passive sniffer catches on
its own segment) to an **inline observation point** so it can see and act on *all*
client traffic: every flow, destination, protocol, and (optionally) TLS SNI/cert
metadata — feeding the same heuristic engine, device inventory, traffic analytics,
and threat feed that already exist.

## Why a side-car can't see everything
On a switched LAN, promiscuous capture only yields broadcast/multicast + the host's
own traffic. To see a client's traffic you must be **on the path** — i.e. the client's
gateway (or a tap/mirror). Hence "inline".

## How clients get routed through Nexrelm (pick one)
1. **DHCP gateway hand-off (preferred, least invasive).** Nexrelm's DHCP module
   (already exists) hands clients `option 3 (router) = Nexrelm IP` and `option 6
   (dns) = Nexrelm IP`. Clients then send off-subnet traffic to Nexrelm, which
   forwards to the real router. Only affects clients that take a new lease; easy to
   revert (point option 3 back at the router). **Requires Nexrelm's DHCP to be the
   only DHCP server** (disable the router's) — coordinated change.
2. **Per-device static gateway.** Point one or a few devices' gateway at Nexrelm
   manually. Safest for piloting; no DHCP change.
3. **ARP redirection (NOT default, aggressive).** Nexrelm answers ARP for the router
   IP so clients send it their traffic. This is ARP spoofing — powerful but fragile
   and easily disruptive; only behind an explicit "aggressive" opt-in for an isolated
   test segment.

## Data plane (when inline)
```
client ──▶ Nexrelm (eth0)
             │  1. nf capture/inspect (CAP_NET_RAW)  → flows → heuristics/inventory
             │  2. IP forward + NAT (CAP_NET_ADMIN)  → out to real router
             ▼
          real router/gateway ──▶ internet
```
- **IP forwarding**: `net.ipv4.ip_forward=1` + an nftables NAT/forward chain (the
  firewall module already compiles nft — extend it to emit the forward+masquerade
  rules). Needs **root or CAP_NET_ADMIN** (control plane already has CAP_NET_ADMIN
  ambient from the security work).
- **Capture/inspection**: the existing passive sniffer, but now it sees *forwarded*
  traffic too. L3/L4 metadata (src/dst/port/proto/bytes) is enough for flows,
  port-scan detection, beaconing, and known-bad-IP contact.
- **TLS visibility (optional, separate sub-phase)**: passive **SNI + cert** extraction
  from the ClientHello/Certificate (no decryption, no MITM) gives the destination
  hostname for HTTPS without breaking anything. **Full TLS MITM** (terminating +
  re-signing with a Nexrelm CA installed on clients) is a heavy, consent-required,
  per-device trust step — explicitly out of scope unless the operator opts each
  device in.

## Inspection scope tiers (operator-selectable)
- **Tier 0 — Forward only**: route traffic, no inspection. (Baseline to prove routing.)
- **Tier 1 — Flow metadata** (default once inline): src/dst/port/proto/bytes →
  heuristics + inventory + traffic. No payload.
- **Tier 2 — Passive app metadata**: TLS SNI, HTTP Host, DNS already covered. No decryption.
- **Tier 3 — TLS MITM**: opt-in per device with a trusted CA. Heavy, last resort.

## Privileges
- `CAP_NET_ADMIN` (forwarding/nft) + `CAP_NET_RAW` (capture) — control plane already
  has both (ambient) from the security build. Writing nft NAT rules + toggling
  `ip_forward` still needs a small **root helper** (a tiny setuid/sudo-gated script or
  a polkit action) because `sysctl` + applying nft to the *system* table isn't a
  capability the node process holds for the global namespace. Spec'd as a vetted
  `nexrelm-gateway` helper with a fixed, auditable command set (no user input).

## Safety / rollback (mandatory before enable)
- **Kill switch**: a single "Disable gateway" that restores `option 3 → router`,
  flushes the NAT/forward chain, and sets `ip_forward=0`. Also a **dead-man timer**:
  if the control plane dies, the helper auto-reverts after N seconds.
- **Pilot first**: mode 2 (one device) before mode 1 (DHCP-wide).
- **Pre-flight checks**: confirm Nexrelm can reach the real router, has a stable LAN
  IP, and DHCP authority is coordinated, before flipping clients.
- **No double-DHCP**: refuse to enable DHCP gateway mode if another DHCP server is live.

## Phased rollout
1. **P0 (this spec).** Design + the kill-switch/dead-man helper contract.
2. **P1 — Forward + Tier 1.** `nexrelm-gateway` helper (ip_forward + nft NAT), a
   "Gateway" tab with mode select (per-device → DHCP), live forward/flow stats, and
   the kill switch. Pilot with one device.
3. **P2 — Heuristics on forwarded flows.** (Mostly free — the sniffer→heuristics wiring
   from this session already maps flows to threats; inline just feeds it everything.)
4. **P3 — Tier 2 passive app metadata** (SNI/cert/Host).
5. **P4 (opt-in only) — Tier 3 TLS MITM** with per-device CA trust + clear consent UI.

## Code touch-points (when we build P1)
- `apps/control-plane/src/gateway/` — helper invoker, ip_forward + nft NAT, dead-man.
- `dhcp` module — option 3 = Nexrelm in "DHCP gateway" mode + the no-double-DHCP guard.
- `firewall` module — extend `exportNft`/apply to emit the forward + masquerade chain.
- `sniffer`/`heuristics` — already consume flows (done this session); inline just widens what they see.
- web `app/security` — a "Gateway" tab (mode, tiers, stats, kill switch).
- `deploy/` — the `nexrelm-gateway` root-helper + polkit/sudoers entry (fixed commands).

## Decision needed from operator before P1
- Which routing mode to pilot (recommend mode 2: one device).
- Whether Nexrelm should become the LAN's DHCP authority (mode 1).
- Confirm a tested rollback window (do it when you can power-cycle the router if needed).

---

## Installation (P1)
The control plane runs **non-root**, so the privileged surface is a single audited
helper. Installing it is a deliberate, reviewable one-time step — **Nexrelm never
self-installs it** (the agent's safety classifier blocks an unattended NOPASSWD
sudoers grant, which is correct: standing root persistence must be operator-approved).

```bash
# from the repo root — read deploy/nexrelm-gateway.sh first
sudo bash deploy/install-gateway.sh            # install
sudo bash deploy/install-gateway.sh --remove   # full uninstall (reverts any active routing)
```

What the installer does:
1. Installs `deploy/nexrelm-gateway.sh` → `/usr/local/sbin/nexrelm-gateway` (root:root 0755).
2. Writes `/etc/sudoers.d/nexrelm-gateway` = `<run-user> ALL=(root) NOPASSWD: /usr/local/sbin/nexrelm-gateway`,
   **validated with `visudo -cf` in a temp file before being moved into place** (a bad
   sudoers file can lock you out of sudo — this avoids that).
3. Leaves the gateway **OFF**. You enable per-device from the UI.

Until the helper is installed, `GET /api/security/gateway` returns `available:false`
and the Gateway tab shows the install command and degrades gracefully — nothing else
in Security is affected.

The helper is the **only** thing the sudoers entry can run, with a fixed command set
(`enable <wan> <client> | disable | heartbeat | status`), strict IPv4/interface
validation, and no shell interpolation of arguments.

## Enabling / using
1. Security → **Gateway** tab.
2. On the pilot device, set its **default gateway** (and optionally DNS) to the host
   LAN IP shown in the tab.
3. Enter that device's IP/CIDR and **Enable**. Only that device's traffic is forwarded
   and NATed out the auto-detected WAN interface; the sniffer/heuristics now see all of it.
4. **Kill switch** (top of the tab) tears it down instantly and restores `ip_forward`.
   The **dead-man watchdog** auto-reverts within ~90s if the control plane stops sending
   its 20s heartbeat — a crash can't strand the network.

## Deployment notes
- **Capabilities**: the `nexrelm-control-plane` service runs as the non-root service user with
  `CAP_NET_RAW`+`CAP_NET_ADMIN` in its `CapabilityBoundingSet` (for nmap/sniffer); the
  gateway's privileged ops (`sysctl ip_forward`, system nft table) go through the
  sudo-gated helper, not process caps — so they work regardless of how the service is
  launched.
- **Idempotent + isolated**: the helper uses its own nft table `ip nexrelm_gw` and
  `/run/nexrelm-gw/` state dir; enable/disable are safe to repeat and never touch other
  firewall rules.
- **Packaging**: ship `deploy/nexrelm-gateway.sh` + `deploy/install-gateway.sh` with any
  release. Do **not** bake the sudoers entry into an image or run the installer in CI/
  provisioning unattended — it's an interactive, operator-consented step by design. For
  fleet/automated installs, treat it like any privileged package: install the helper via
  your config-management tool and drop the validated sudoers file, but keep the gateway
  disabled until an operator enables a device.
- **Audit caveat**: if the host has a broken sudo audit plugin (seen as
  `sudo: error initializing audit plugin sudoers_audit` on the `sudo -n` probe), fix the
  system sudo/audit config — the helper invocation depends on a working `sudo`.
