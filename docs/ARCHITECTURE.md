# Nexrelm — Architecture

Nexrelm is a small monorepo with one hard rule: **the GUI and the backend never disagree about a shape.** Every model and every wire envelope lives in `packages/types`, and both apps import it.

## The three pieces

### `packages/types` — the contract

Pure TypeScript, no runtime. It defines every domain model (`Topology`, `DnsResolverStats`, `DhcpServerStatus`, `AdUser`, `SecurityOverview`, `NetworkPosture`, `AuthSession`, `SystemSettings`, …) and the API envelope `ApiResponse<T> = { ok, data, error, meta }`, plus the `LiveEvent` union streamed over the WebSocket. Both apps depend on this package (via `transpilePackages` on the web side), so a shape change is a compile error on both ends at once — there is no drift.

### `apps/control-plane` — the daemon

A Fastify server (`:8787`, run via `tsx`) that is the source of truth. It hosts the real modules:

- **DNS** — a forwarding/filtering resolver (block/allow lists, gravity adlists, per-client groups, query log, sinkholing).
- **DHCP** — an authoritative lease server with scopes, reservations, options, and an active rogue-server probe.
- **Directory** — a live AD/Samba LDAP client (users, groups, computers, DCs) + an SSH shell bridge.
- **Virtualization** — a VM fleet over SSH with deep telemetry and a PTY terminal.
- **Security** — an all-traffic threat engine (DNS + wire + L2), nmap scanning + vuln intel, a policy firewall, threat-intel feeds, device registry, and remediation.
- **Gateway** — stacking integration modes (DNS · DHCP · capture · be-the-LAN-gateway) via a vetted root helper.
- **Topology / Logs / System** — a live aggregated network map, a unified log bus, and backend settings (retention, TLS).

Two transports: a REST snapshot under `/api/*` and a `/ws` WebSocket delta stream. An **auth guard** (`onRequest` hook) protects every `/api` + `/ws` request with a bearer session once setup is done; it serves **HTTPS** when a cert exists (`<data-dir>/tls/`).

### `apps/web` — the GUI

A Next.js 14 (App Router) dashboard. Every panel renders **live data from the control plane** — there is no demo mode. It carries the session token (Authorization header / `?token=` for WebSockets), routes through an `AuthGate` (setup → login → app), and is fully themeable (5 themes × light/dark, see `lib/themes.ts`).

## State & security

- All persistent state lives in **`~/.nexrelm/`** — SQLite (`dns.db`, `dhcp.db`, `security.db`) + JSON (`gateway.json`, `vms.json`, `system.json`, `auth.json`), with **AES-256-GCM** encryption for VM/AD secrets (`secret.key`) and the retained directory session.
- **Auth**: a single `admin` account created on the server console (installer / `nexrelm` CLI), scrypt-hashed; bearer sessions stored as SHA-256 hashes, bound to the client fingerprint, with idle + absolute expiry and brute-force lockout.

## Deployment

Two standalone systemd units — `nexrelm-control-plane` (`:8787`) and `nexrelm-web` (`:3007`) — installed by `deploy/install-nexrelm.sh`. Or run the whole stack with Docker (`deploy/docker-compose.yml`). For a single trusted HTTPS origin, front both with `deploy/Caddyfile`.

```
┌──────────────────────────┐     REST /api/*  ·  WS /ws     ┌──────────────────────────┐
│ apps/web   (Next.js 14)  │ ───────────────────────────▶  │ apps/control-plane        │
│ GUI  :3007               │ ◀───────────────────────────  │ Fastify + WS + resolver   │
└──────────────────────────┘  bearer-auth · HTTPS-capable   │ :8787   (state ~/.nexrelm)│
                  ▲                                          └──────────────────────────┘
                  └───────────── packages/types (shared contract) ──────┘
```
