<div align="center">

<img src="docs/assets/banner.svg" alt="Nexrelm — one nexus for every realm of your network" width="100%" />

<br/>

**The open-source network control plane.**
DNS · DHCP · Directory · Virtualization · Security · live network map — one self-hosted pane of glass.

[![License](https://img.shields.io/badge/license-Apache--2.0-5fbfd6?style=flat-square)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3aa8c8?style=flat-square)](https://www.typescriptlang.org/)
[![Next.js](https://img.shields.io/badge/Next.js-14-eaf6f9?style=flat-square)](https://nextjs.org/)
[![Fastify](https://img.shields.io/badge/Fastify-control_plane-2f9fc4?style=flat-square)](https://fastify.dev/)
[![Self-hosted](https://img.shields.io/badge/self--hosted-Linux%20%7C%20Docker-9b8cff?style=flat-square)](#install)
[![Tests](https://img.shields.io/badge/tests-passing-80c98a?style=flat-square)](#development)

</div>

---

## Overview

Nexrelm is a self-hosted **network control plane** — the category occupied by pfSense, OPNsense, and Firewalla, but unified and opinionated. Instead of a separate tool for the resolver, another for the directory, and another for the firewall, Nexrelm runs them behind **one consistent API** and one dark, themeable console. Put it on your network's path (as the DNS server, or as the gateway) and a guided wizard lights up filtering, sinkholing, per-device traffic, packet capture, and enforcement — **network-wide, with no per-device setup**.

The name is *nexus + realm*: DNS has **domains**, Kerberos/AD calls its trust boundaries **REALMs**, DHCP carves **scopes**, VLANs cut zones. Nexrelm is the single nexus that unifies every realm. Every value in the GUI is backed by live system state — there is **no demo data, no telemetry, and no phone-home**; the only outbound traffic is opt-in threat-intel feeds and (optionally) VirusTotal lookups with your own key.

---

## Modules

Each module is a real integration in the control plane (`apps/control-plane/src/<module>`), surfaced as a page in the GUI and a slice of the REST/WS API.

### 🛰️ Dashboard
The command deck. A live, auto-built network map (gateway → AD → device inventory → VMs) sits at the center, ringed by real KPIs (DNS volume, active threats, DHCP leases, nodes online, AD users, VMs), a module-status strip, a security-alert feed, the 24-hour DNS activity chart, and a unified log stream. Click any node to inspect it.

### 🌐 DNS
A forwarding/filtering recursive resolver in the Pi-hole tradition. Point your router's DHCP "DNS server" at Nexrelm and every device resolves through it.
- Block / allow lists, **gravity adlists** (StevenBlack-style), and **per-client groups** so policy can differ by device.
- Apex-and-subdomain matching (blocking `example.com` also blocks `www`/`m`), label-suffix accurate (never substring).
- 24-hour analytics (queries, cache, blocked %, top domains/clients), full query log in SQLite, and **threat-intel sinkholing** (known-bad domains answered `0.0.0.0`).
- Conditional forwarding, EDNS/DNSSEC pass-through, per-client rate limiting.

### 🧩 DHCP
An authoritative DHCP server for the LAN.
- Scopes, exclusions, reservations, and a full DHCP option editor (per-scope DNS, gateway, domain, etc.).
- Live lease table with hostname/vendor/MAC, plus an **active rogue-server probe** that broadcasts a DISCOVER and reports every server that answers — so you can detect a second (unexpected) DHCP server on the wire.

### 🪪 Directory
A live Active Directory / Samba management surface over LDAP (Plain / StartTLS / LDAPS).
- Browse and manage **users, groups, computers, and domain controllers**; reset passwords, enable/disable accounts, edit group membership.
- Per-user IP resolution (matched against the device inventory) and an **in-browser SSH shell** to the DC.
- The connected session can be encrypted and retained across restarts (AES-256-GCM), or wiped on disconnect.

### 🖥️ Virtualization
A VM fleet manager over SSH (no agent required).
- Register machines by host + credentials; pull **deep telemetry** (OS, kernel, CPU/memory/disk, uptime, IPs, processes).
- A real **xterm terminal** bridged to the VM over a PTY. Credentials are **AES-256-GCM encrypted at rest** and never returned over the API.

### 🛡️ Security
An all-traffic threat engine plus the tooling around it.
- **Detection** across three sources: the DNS query stream (floods, NXDOMAIN storms, DGA via Shannon entropy, tunneling, beaconing by interval-regularity, suspicious TLDs), the wire via a promiscuous sniffer (port scans, host sweeps, lateral movement, C2/mining ports, data egress by bytes), and L2 (ARP spoofing, rogue DHCP, LLMNR/NBT-NS poisoning, Responder→NTLM-relay).
- **Enrichment**: MITRE ATT&CK tagging, eight auto-refreshed threat-intel feeds (abuse.ch, EmergingThreats, CINS, …), VirusTotal correlation, EOL/vulnerability intelligence from endoflife.date.
- **Action**: a policy firewall (ordered ACL + zones, exported as an `nft` ruleset), `nmap -sS/-sV/-O` scanning with a posture score, a device registry with new-device approval, adaptive per-device baselining, and one-click (or bulk) remediation. Sensitivity is operator-tunable, with a trusted-host allowlist.

### 🔌 Gateway
Integration modes that determine how much of the network Nexrelm can see — **stackable**, each off by default:
- **DNS** (resolve through Nexrelm), **DHCP** (hand out leases + advertise itself), **Capture** (promiscuous sniffer), and **Gateway** (route + NAT the whole LAN, the most powerful mode).
- The on-path modes go through a vetted root helper with a **kill switch and a dead-man watchdog** (routing auto-reverts if the control plane dies). Port-forwards (DNAT) are stored and exported as `nft`.

### 🗺️ Topology & 📜 Logs
A deterministic, live network map aggregated from the gateway, AD, inventory, and VMs (populations collapse into count nodes so it stays readable). A unified log bus streams real events from every module to one filterable console.

### ⚙️ Settings
Live module state, **data-retention controls** (per-database windows, enforced hourly), the account panel (sessions, password), TLS, theming, and the on-disk storage footprint.

---

## Requirements

- **Linux** host with systemd (bare-metal) **or Docker**
- **Node.js 20+** and npm (bare-metal)
- `openssl` (TLS) and `iproute2` (network detection); optional `nmap` + `tcpdump` for scanning/capture

## Install

### Linux (recommended)

One idempotent installer builds both apps, installs the `nexrelm` CLI, registers two systemd services, lets you **choose HTTP or HTTPS** (generating a self-signed cert for the hostname you enter), and creates the admin account with a one-time password:

```bash
git clone <your-fork> nexrelm && cd nexrelm
sudo bash deploy/install-nexrelm.sh
```

It prints your admin password and the GUI URL. The control plane (`:8787`) and web GUI (`:3007`) then run as standalone systemd units (`nexrelm-control-plane`, `nexrelm-web`) — no external process manager. Unattended installs can pass `NEXRELM_SCHEME=https NEXRELM_TLS_HOST=nexrelm.local`.

### Docker

Docker is an option, not a requirement. State persists in the `nexrelm-data` volume:

```bash
cd deploy
docker compose up --build -d
docker compose exec control-plane npx tsx src/cli.ts setup   # create the admin (prints the password)
# open http://localhost:3007
```

Full packet capture / DHCP serving / SYN scans need host networking + `NET_RAW` — see [`deploy/docker-compose.yml`](deploy/docker-compose.yml).

## First login & onboarding

1. Open the GUI and sign in as **`admin`** with the generated password.
2. You're required to **set your own password** (the generated one stops working). Account creation only ever happens on the **server console** — never over the network.
3. A fresh install shows a **Get-started banner** → a five-step wizard (`/onboarding`): detect the LAN → grant capabilities → choose *Make me your DNS* or *Make me your gateway* → start capture → **verify traffic is flowing**.

Locked out later? `sudo nexrelm reset-password` mints a fresh temporary password.

## The `nexrelm` CLI

Installed to `/usr/local/bin/nexrelm` (run privileged commands with `sudo`):

| Group | Commands |
|---|---|
| **Account** | `setup` · `reset-password [--password <pw>]` · `account` |
| **Service** | `start` · `stop` · `restart` · `enable`/`disable` · `status` · `logs [-f] [-n N]` · `crash` |
| **Data** | `clear <dns\|dhcp\|security\|all>` · `backup [file]` · `restore <file>` · `reset` (factory) |
| **Install** | `gen-cert` (TLS) · `move-data <dir>` · `rebuild` · `doctor` · `uninstall [--purge]` · `version` · `help` |

`sudo nexrelm doctor` runs full diagnostics; `sudo nexrelm crash` shows exit codes + recent errors.

## Security

Nexrelm is built to be a defensible appliance:

- **Passwords**: scrypt-hashed; the admin password is generated on the console and **never travels the network**. Minimum length enforced for operator-chosen passwords.
- **Sessions**: stored as SHA-256 token hashes (a stolen `auth.json` can't replay them), **bound to the client fingerprint** (a lifted token replayed from another browser is rejected), with idle (24h) + absolute (7d) expiry.
- **Brute force**: repeated failed sign-ins lock the account (HTTP 429 + `Retry-After`); failed-login logs are redacted.
- **Transport**: HTTPS when a cert exists; security headers (`X-Frame-Options`, `nosniff`, `Referrer-Policy`, HSTS under TLS) on the API and the GUI; `trustProxy` limited to loopback.
- **Secrets at rest**: VM/AD credentials and the retained directory session are **AES-256-GCM** encrypted; `~/.nexrelm/` is git-ignored.
- **Authorization**: every `/api` + WebSocket request requires a bearer session once setup is done.

## HTTP / HTTPS

You choose at install time. The control plane serves HTTPS natively whenever a cert exists (`<data-dir>/tls/{cert,key}.pem` — generate with `nexrelm gen-cert`). For a single trusted origin across the GUI **and** API (no CORS, no mixed content), front Nexrelm with [`deploy/Caddyfile`](deploy/Caddyfile).

## Architecture

```
┌──────────────────────────┐     REST /api/*  ·  WS /ws     ┌──────────────────────────┐
│ apps/web   (Next.js 14)  │ ───────────────────────────▶  │ apps/control-plane        │
│ GUI  :3007               │ ◀───────────────────────────  │ Fastify + WS + resolver   │
└──────────────────────────┘  bearer-auth · HTTPS-capable   │ :8787   (state ~/.nexrelm)│
                  ▲                                          └──────────────────────────┘
                  └───────────── packages/types (shared contract) ──────┘
```

One hard rule: **the GUI and the backend never disagree about a shape.** Every model and the REST/WS envelope live in `packages/types`; both apps import it, so a shape change is a compile error on both ends at once. Details in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Project layout

```
nexrelm/
├── apps/
│   ├── control-plane/   # Fastify daemon (runs via tsx): the real modules + auth
│   └── web/             # Next.js 14 GUI — themeable, all data live
├── packages/types/      # the shared contract (models + REST/WS envelope)
├── deploy/              # installer, nexrelm CLI, systemd units, Docker, TLS, Caddyfile
└── docs/                # architecture, roadmap, DNS, inline-gateway spec
```

## Configuration

Sensible defaults; override via `.env` (see [`.env.example`](.env.example)) or the systemd unit. Key variables: `PORT` (8787), `CORS_ORIGIN`, `NEXRELM_DATA` (state dir), `NEXRELM_TLS_CERT` / `NEXRELM_TLS_KEY`, and the build-time `NEXT_PUBLIC_API_URL` (the origin the browser uses to reach the control plane).

## Development

```bash
npm install
npm run dev:all     # web :3007 · control-plane :8787 (hot reload)
npm run typecheck   # strict TypeScript across every workspace
npm test            # integration tests (auth, sessions, lockout, DNS, DHCP, retention, onboarding)
```

CI runs typecheck + tests + a production build on every push ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)).

## Data, backup & reset

All state lives in `~/.nexrelm/` (relocate with `nexrelm move-data`). Use `nexrelm backup` / `restore` for snapshots, `nexrelm clear <db>` to wipe one database, and `nexrelm reset` for a full factory reset (it backs up first). Retention windows are configurable in **Settings → Backend**.

## Theming

Five themes — **Obsidian** (true black), **Brutalist** (stark, flat), **Nord**, **Solar** (Solarized), **Paper** (warm editorial) — each with light and dark modes. Switch in **Settings → Appearance** or with the topbar toggle.

## Contributing

Contributions welcome — see [CONTRIBUTING.md](CONTRIBUTING.md). The roadmap is in [`docs/ROADMAP.md`](docs/ROADMAP.md).

## License

[Apache-2.0](LICENSE) © Nexrelm contributors.
