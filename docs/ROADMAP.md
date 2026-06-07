# Nexrelm — Roadmap

Nexrelm is now a real, self-hosted appliance — every module is backed by live system integration, with authentication, an installer, a CLI, and a guided onboarding flow. This roadmap tracks what's shipped and what's next.

## Status legend

- ✅ done
- 🚧 partial / in progress
- 🧭 planned

## Shipped

**Modules (all live, no simulator):**
- ✅ DNS — forwarding/filtering resolver, lists + gravity adlists, per-client groups, 24h analytics, sinkholing
- ✅ DHCP — authoritative server, scopes/reservations/options/leases, active rogue-server probe
- ✅ Directory — live AD/Samba (users, groups, computers, DCs, per-user IP) + SSH shell
- ✅ Virtualization — VM fleet over SSH, deep telemetry, PTY terminal, encrypted credentials
- ✅ Security — all-traffic threat engine, nmap scans + EOL/vuln intel, policy firewall, threat-intel feeds, device registry, baselining, remediation
- ✅ Gateway — stacking integration modes + LAN-gateway routing (root helper, kill switch, dead-man watchdog)
- ✅ Topology — live aggregated network map; Logs — unified live bus

**Platform:**
- ✅ Authentication — admin account, scrypt, bearer sessions (hashed, fingerprint-bound, idle/absolute expiry), brute-force lockout
- ✅ Install wizard (bash) + `nexrelm` CLI (service, data, backup/restore, reset, gen-cert, doctor, …)
- ✅ Guided 5-step onboarding ("put Nexrelm on the path")
- ✅ TLS (self-signed + reverse-proxy paths) and a HTTP/HTTPS install choice
- ✅ Backend settings — data retention + maintenance, enforced
- ✅ Self-hosting — two standalone systemd units; Docker as an optional alternative
- ✅ Theming — 5 themes (obsidian/brutalist/nord/solar/paper) × light/dark
- ✅ Integration tests (auth, sessions, lockout, DNS, DHCP, retention, onboarding) + CI

## Next

- 🚧 Broader test coverage — resolver resolution, security heuristics, web E2E (Playwright) toward the 80% bar
- 🧭 Performance at scale — cache `auth.json` reads + a write mutex; de-duplicate the heuristics' per-cycle table scans; async DHCP lease writes
- 🧭 Hardening — bump scrypt cost (versioned hash); `@fastify/rate-limit` as a second layer on login; raise the operator-password minimum
- 🧭 RBAC / multiple operators (today: one admin)
- 🧭 Zod validation at the REST boundary (today the contract is compile-time only)
- 🧭 Alerting sinks (email/webhook) for high-severity events
- 🧭 Multi-node — federate several control planes under one GUI

## Known caveats

- Gateway/NAT routing is limited on Wi-Fi interfaces (managed mode) — DNS-pointing works; full gateway wants a wired link.
- Directory DC detection flags only servers the LDAP query reports as `isDc` (a second DC may render as a member server).

## Contributing

See [CONTRIBUTING.md](../CONTRIBUTING.md). Pick a "Next" item or a module improvement; everything flows through the `packages/types` contract, so the GUI and control plane stay in lockstep.
