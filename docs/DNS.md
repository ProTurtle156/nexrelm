# Nexrelm DNS — a real Pi-hole-style resolver

Nexrelm's DNS module is an actual forwarding/filtering DNS server. Point your
router's DHCP DNS at the machine running it and **every device on the network
resolves through Nexrelm** — filtered, logged, and per-client controllable,
exactly like Pi-hole.

## How it works

```
 device ──DNS──▶  Nexrelm resolver (LAN-IP:53)
                    │  ├─ allowlist?  → forward
                    │  ├─ blocklist?  → 0.0.0.0 / NXDOMAIN  (null-blocking)
                    │  └─ otherwise   → forward to your chosen upstream
                    │
                    ├─ logs every query to SQLite  (~/.nexrelm/dns.db)
                    └─ tracks each client (IP · MAC · vendor · hostname · counts)
```

- **Forwarding** relays the *raw* DNS datagram to the upstream, so EDNS/DNSSEC
  flags pass through untouched. Responses are cached by TTL.
- **Blocking** is group-scoped: a list applies to a client only if they share a
  group. Default mode is "null" (`0.0.0.0` / `::`), like Pi-hole.
- **Gravity** fetches remote adlists (StevenBlack, etc.) and compiles them into a
  fast in-memory lookup. A built-in starter list ships so filtering works offline.
- **Storage** is Node's built-in SQLite (`--experimental-sqlite`) — no native
  dependency, no Python.

## Run it on :53 and become your LAN's DNS (the Pi-hole flow)

Port 53 is privileged. The included systemd unit grants exactly one capability
(`CAP_NET_BIND_SERVICE`) so the resolver binds :53 as a normal user — **alongside
systemd-resolved**, which only holds loopback (`127.0.0.53`). Nothing to disable.

```bash
# one-shot: detects your LAN IP, installs the unit, starts on :53
./deploy/setup-dns.sh            # or: ./deploy/setup-dns.sh 192.168.1.2
```

Then point your network at it:

1. **Router → DHCP/LAN settings → Primary DNS = `<LAN-IP>`** (e.g. `192.168.1.2`).
2. Renew DHCP leases (or reboot devices). Every device now resolves through Nexrelm.

Verify from another machine:

```bash
dig @192.168.1.2 doubleclick.net     # → 0.0.0.0  (blocked)
dig @192.168.1.2 example.com         # → real address (forwarded)
```

### Coexistence with systemd-resolved

Nexrelm binds **only the LAN interface IP** on :53, so the host's own resolver
(`127.0.0.53`) keeps working and is never touched. If you'd rather the host
*itself* also filter, set its DNS to the LAN IP too — optional.

## Dev mode (no privileges)

Run the control plane normally and the resolver auto-falls back to `:5335`:

```bash
npm run dev:api
dig @127.0.0.1 -p 5335 doubleclick.net   # → 0.0.0.0
```

The bound address/port (and any fallback reason) is shown in the boot banner and
at `GET /api/dns/status`.

## What you can configure

| Area | Capability |
|---|---|
| **Upstreams** | Preset resolvers (Google, OpenDNS, Level3, Comodo, Quad9 ×3, Cloudflare — with ECS/DNSSEC traits) + custom `IP#port` servers |
| **Lists** | Block/allow, exact or regex, searchable across every list (manual + gravity) |
| **Adlists** | Remote gravity sources; rebuild on demand |
| **Groups & clients** | Create groups, link clients, scope which lists apply to whom |
| **Statistics** | Total/blocked/%, cached, top domains/clients, query types, 24h timeline, per-client information stream |
| **Settings** | Local domain, rate-limiting, interface/listen mode, DNSSEC, never-forward-non-FQDN, never-forward-private-reverse, conditional forwarding |

## REST API (under `/api/dns`)

`status` · `stats` · `queries` · `clients` (+`/:id/groups`) · `lists` (GET/POST/PATCH/DELETE)
· `search?q=` · `adlists` (CRUD) · `gravity` (rebuild) · `groups` (CRUD)
· `settings` (GET/PATCH) · `upstreams` (presets) · `control` (start/stop/restart).

All responses use the standard `{ ok, data, error, meta }` envelope.

## Status

✅ **Backend complete & verified** — resolver (UDP+TCP), forwarding, null-blocking,
TTL cache, per-client rate-limiting, query logging, client enrichment (ARP MAC +
OUI vendor + reverse-DNS hostname), gravity, groups, full REST surface.

🚧 **GUI** — the multi-tab Pi-hole-style DNS interface (dashboard, query log,
clients, lists + search, groups, upstreams, settings) builds on this surface next.
