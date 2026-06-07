# Contributing to Nexrelm

Thanks for your interest in Nexrelm! This is an open-source network control plane, and contributions of all kinds — bug reports, features, docs, tests — are welcome.

## Getting started

```bash
git clone <your-fork> nexrelm && cd nexrelm
npm install
npm run dev:all        # web :3007 · control-plane :8787 (hot reload)
```

The repo is an npm-workspace monorepo:

| Path | What |
|---|---|
| `packages/types` | The shared contract — every domain model + the REST/WS envelope. **Both apps import it, so shapes can't drift.** Change a model here first. |
| `apps/control-plane` | Fastify daemon (runs via `tsx`): DNS resolver, DHCP, AD/Samba client, VM SSH layer, security engine, auth. |
| `apps/web` | Next.js 14 GUI (dark-cyber, custom SVG). |
| `deploy/` | Installer, `nexrelm` CLI, systemd units, Docker, TLS, reverse proxy. |

## Before you open a PR

Everything must pass — CI runs exactly these:

```bash
npm run typecheck      # strict TypeScript across all workspaces
npm test               # integration tests
npm run build --workspace apps/web   # production GUI build
```

## Conventions

- **TypeScript, strict.** No `any` in application code; narrow `unknown`. Public/exported functions get explicit types.
- **Shared types live in `packages/types`** — never duplicate a model in an app.
- **Immutability** — return new objects, don't mutate inputs.
- **Small, cohesive files** (≈200–400 lines; 800 max). Many small files over a few large ones.
- **Errors are handled explicitly** — never silently swallowed.
- **Match the surrounding code** — comment density, naming, idioms.
- **Commits**: conventional style (`feat:`, `fix:`, `refactor:`, `docs:`, `test:`, `chore:`).

## Tests

Add tests for new control-plane logic in `apps/control-plane/src/__tests__/*.test.ts` (Node's built-in test runner via `tsx`). Tests run against an isolated `NEXRELM_DATA` temp dir, so they never touch real data. Keep them deterministic — the suite runs serially.

## Security

- Never commit secrets. Runtime state + certs live in `~/.nexrelm/` and are git-ignored.
- Auth, sessions, and crypto live in `apps/control-plane/src/core/auth.ts` — changes there get extra review.
- Found a vulnerability? Please report it privately rather than opening a public issue.

## Reporting bugs

Open an issue with: what you did, what you expected, what happened, and `sudo nexrelm doctor` output if it's a deployment issue.

By contributing you agree your work is licensed under [Apache-2.0](LICENSE).
