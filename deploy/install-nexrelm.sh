#!/usr/bin/env bash
#
# Nexrelm installer — one-shot, idempotent setup of the control plane:
#   1. preflight checks      5. install the systemd service
#   2. install dependencies  6. (re)start the service
#   3. build / verify         7. create the admin account (generated password)
#   4. install the `nexrelm` CLI
#
# Run with sudo from inside the repo:
#     sudo bash deploy/install-nexrelm.sh
#
# Every step is wrapped: on failure it prints the step, the failing command, the
# line, and the captured output so you can debug immediately. Re-running is safe
# (deps refresh, CLI/service reinstall, account creation is skipped if it exists).

set -Eeuo pipefail

# ── pretty output ─────────────────────────────────────────────────────────────
if [ -t 1 ]; then BOLD=$'\e[1m'; DIM=$'\e[2m'; CY=$'\e[36m'; GR=$'\e[32m'; YE=$'\e[33m'; RD=$'\e[31m'; NC=$'\e[0m'; else BOLD=; DIM=; CY=; GR=; YE=; RD=; NC=; fi
CURRENT_STEP="startup"
step()  { CURRENT_STEP="$1"; echo "${CY}▸ ${1}${NC}"; }
info()  { echo "  ${DIM}$*${NC}"; }
ok()    { echo "  ${GR}✓${NC} $*"; }
die()   { echo "" >&2; echo "${RD}✖ ERROR during: ${CURRENT_STEP}${NC}" >&2; echo "  ${1}" >&2; [ -n "${2:-}" ] && echo "  ${DIM}debug: ${2}${NC}" >&2; exit 1; }
trap 'die "command failed" "line $LINENO → $BASH_COMMAND"' ERR

# Run a command, capturing output; on failure show it as debug context.
run_logged() {
  local desc="$1"; shift
  local log; log="$(mktemp)"
  if "$@" >"$log" 2>&1; then ok "$desc"; rm -f "$log";
  else local out; out="$(tail -n 20 "$log")"; rm -f "$log"; die "$desc failed" "$out"; fi
}

echo ""
echo "${BOLD}${CY}  NEXRELM${NC}  installer"
echo "  ${DIM}one nexus · every realm${NC}"
echo ""

# ── 1. preflight ──────────────────────────────────────────────────────────────
step "Preflight checks"

[ "$(id -u)" = "0" ] || die "must be run as root" "re-run: sudo bash deploy/install-nexrelm.sh"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
[ -f "$REPO_DIR/package.json" ] || die "not a Nexrelm repo" "no package.json at $REPO_DIR"
[ -d "$REPO_DIR/apps/control-plane" ] || die "repo layout unexpected" "missing apps/control-plane in $REPO_DIR"

# Service user = the owner of the repo (the systemd unit runs as this user).
NEXRELM_USER="${SUDO_USER:-$(stat -c '%U' "$REPO_DIR")}"
[ "$NEXRELM_USER" = "root" ] && NEXRELM_USER="$(stat -c '%U' "$REPO_DIR")"
id "$NEXRELM_USER" >/dev/null 2>&1 || die "service user '$NEXRELM_USER' does not exist" "set SUDO_USER or fix repo ownership"
NEXRELM_HOME="$(getent passwd "$NEXRELM_USER" | cut -d: -f6)"
[ -n "$NEXRELM_HOME" ] || die "cannot resolve home for $NEXRELM_USER" "getent passwd $NEXRELM_USER returned no home"
NEXRELM_GROUP="$(id -gn "$NEXRELM_USER" 2>/dev/null || echo "$NEXRELM_USER")"
NEXRELM_DATA="$NEXRELM_HOME/.nexrelm"

# render a systemd unit template (User/Group/WorkingDirectory) for this host
render_unit() { sed -e "s#__NEXRELM_USER__#$NEXRELM_USER#g" -e "s#__NEXRELM_GROUP__#$NEXRELM_GROUP#g" -e "s#__NEXRELM_DIR__#$REPO_DIR#g" "$1" > "$2"; }

command -v node >/dev/null 2>&1 || die "node not found" "install Node.js 22.5+ and retry — see README 'Install dependencies'"
command -v npm  >/dev/null 2>&1 || die "npm not found" "install npm and retry"
# Nexrelm stores data in Node's built-in node:sqlite, which lands in Node 22.5.0
# (behind --experimental-sqlite). Earlier Node has no SQLite module at all, so the
# control plane cannot start — reject it here with an upgrade path instead of
# installing a broken service.
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
NODE_MINOR="$(node -p 'process.versions.node.split(".")[1]')"
if [ "$NODE_MAJOR" -lt 22 ] || { [ "$NODE_MAJOR" -eq 22 ] && [ "$NODE_MINOR" -lt 5 ]; }; then
  die "Node $(node -v) is too old — Nexrelm needs Node 22.5+ (built-in node:sqlite)" \
      "Debian/Ubuntu/Kali: curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt-get install -y nodejs | Fedora/RHEL: sudo dnf module reset -y nodejs && sudo dnf module enable -y nodejs:22 && sudo dnf install -y nodejs npm"
fi
command -v runuser >/dev/null 2>&1 || die "runuser not found" "install util-linux"

LANIP="$(ip -4 -o addr show scope global 2>/dev/null | awk '{print $4}' | cut -d/ -f1 | grep -vE '^(127\.|169\.254\.)' | head -1)"
ok "repo:    $REPO_DIR"
ok "user:    $NEXRELM_USER ${DIM}(home $NEXRELM_HOME)${NC}"
ok "node:    $(node -v)"
ok "LAN IP:  ${LANIP:-127.0.0.1}"

# helper: run a command as the service user with its real HOME + sqlite flag
as_user() { sudo -u "$NEXRELM_USER" env HOME="$NEXRELM_HOME" NODE_OPTIONS="--experimental-sqlite" "$@"; }

# ── 1b. choose HTTP or HTTPS ──────────────────────────────────────────────────
step "Choosing how Nexrelm is served"
# Non-interactive: NEXRELM_SCHEME=http|https and NEXRELM_TLS_HOST=<host>.
SCHEME="${NEXRELM_SCHEME:-}"
if [ -z "$SCHEME" ]; then
  if [ -t 0 ]; then
    echo "  How should the GUI + API be served?"
    echo "    ${BOLD}1) HTTP${NC}   — simplest, no browser warnings (fine on a trusted LAN)"
    echo "    ${BOLD}2) HTTPS${NC}  — encrypted; a self-signed certificate is generated now"
    read -r -p "  Choose [1/2] (default 1): " _ans
    [ "${_ans:-1}" = "2" ] && SCHEME=https || SCHEME=http
  else
    SCHEME=http   # default for unattended installs
  fi
fi
if [ "$SCHEME" = "https" ]; then
  DEF_HOST="${NEXRELM_TLS_HOST:-${LANIP:-nexrelm.local}}"
  CERT_HOST="$DEF_HOST"
  if [ -t 0 ] && [ -z "${NEXRELM_TLS_HOST:-}" ]; then
    read -r -p "  Hostname/IP clients will use to reach Nexrelm [$DEF_HOST]: " _h
    CERT_HOST="${_h:-$DEF_HOST}"
  fi
  run_logged "generate self-signed certificate (CN/SAN incl. $CERT_HOST)" \
    as_user env NEXRELM_DATA="$NEXRELM_DATA" NEXRELM_TLS_HOST="$CERT_HOST" bash "$REPO_DIR/deploy/gen-cert.sh" "$NEXRELM_DATA"
  API_ORIGIN="https://${CERT_HOST}:8787"
  ok "TLS on — GUI will talk to ${API_ORIGIN}"
else
  CERT_HOST="${LANIP:-127.0.0.1}"
  API_ORIGIN="http://${LANIP:-127.0.0.1}:8787"
  ok "HTTP — GUI will talk to ${API_ORIGIN}"
fi

# ── 2. dependencies ───────────────────────────────────────────────────────────
step "Installing dependencies"
cd "$REPO_DIR"
run_logged "npm install (workspaces)" as_user npm install --no-audit --no-fund --prefix "$REPO_DIR"
[ -x "$REPO_DIR/node_modules/.bin/tsx" ] || die "tsx missing after install" "expected $REPO_DIR/node_modules/.bin/tsx"

# ── 3. build / verify ─────────────────────────────────────────────────────────
step "Building & verifying the application"
run_logged "typecheck (control-plane + web + types)" as_user npm run typecheck
# API_ORIGIN was chosen in step 1b (http/https). Override with NEXRELM_API_ORIGIN.
API_ORIGIN="${NEXRELM_API_ORIGIN:-$API_ORIGIN}"
run_logged "production build — GUI → $API_ORIGIN" as_user env NEXT_PUBLIC_API_URL="$API_ORIGIN" npm run build --workspace apps/web

# ── 4. install the nexrelm CLI ────────────────────────────────────────────────
step "Installing the 'nexrelm' command"
CLI_BIN="/usr/local/bin/nexrelm"
CLI_SRC="$REPO_DIR/deploy/nexrelm-cli.sh"
[ -f "$CLI_SRC" ] || die "CLI template missing" "expected $CLI_SRC"
# render the committed dispatcher template with this install's paths
sed -e "s#__NEXRELM_DIR__#$REPO_DIR#g" \
    -e "s#__NEXRELM_USER__#$NEXRELM_USER#g" \
    -e "s#__DEFAULT_DATA__#$NEXRELM_DATA#g" \
    "$CLI_SRC" > "$CLI_BIN"
chmod 0755 "$CLI_BIN"
bash -n "$CLI_BIN" || die "rendered CLI failed syntax check" "$CLI_BIN"
ok "installed $CLI_BIN ${DIM}(run 'sudo nexrelm help' for all commands)${NC}"

# ── 5. systemd service ────────────────────────────────────────────────────────
step "Installing the systemd services"
UNIT="/etc/systemd/system/nexrelm-control-plane.service"
SRC_UNIT="$REPO_DIR/deploy/nexrelm-control-plane.service"
if [ -f "$SRC_UNIT" ]; then
  render_unit "$SRC_UNIT" "$UNIT"; systemctl enable nexrelm-control-plane >/dev/null 2>&1 || true
  ok "control-plane unit installed (user=$NEXRELM_USER, dir=$REPO_DIR)"
else
  info "no unit file in deploy/ — skipping (assuming an existing service)"
fi
# the web GUI service (Next.js production server, :3007) — self-hosted, no external manager
WEB_UNIT="/etc/systemd/system/nexrelm-web.service"
SRC_WEB="$REPO_DIR/deploy/nexrelm-web.service"
if [ -f "$SRC_WEB" ]; then
  render_unit "$SRC_WEB" "$WEB_UNIT"; systemctl enable nexrelm-web >/dev/null 2>&1 || true; ok "web GUI unit installed"
fi
# pin the data dir via a drop-in so `nexrelm move-data` has one source of truth
DROPIN_DIR="/etc/systemd/system/nexrelm-control-plane.service.d"
mkdir -p "$DROPIN_DIR"
printf '[Service]\nEnvironment=NEXRELM_DATA=%s\n' "$NEXRELM_DATA" > "$DROPIN_DIR/nexrelm-data.conf"
systemctl daemon-reload
ok "data directory pinned → $NEXRELM_DATA"

# ── 6. (re)start the control plane ────────────────────────────────────────────
step "Starting the control plane"
run_logged "systemctl restart nexrelm-control-plane" systemctl restart nexrelm-control-plane
# wait for /api/health (-k: accept the self-signed cert under HTTPS)
PORT="$(grep -oP 'Environment=PORT=\K[0-9]+' "$UNIT" 2>/dev/null || echo 8787)"
for i in $(seq 1 20); do
  if curl -fsSk --max-time 2 "${SCHEME}://127.0.0.1:${PORT}/api/health" >/dev/null 2>&1; then break; fi
  [ "$i" = "20" ] && die "control plane did not become healthy" "check: journalctl -u nexrelm-control-plane -n 50"
  sleep 1
done
ok "control plane healthy on ${SCHEME}://…:$PORT"

# ── 6b. start the web GUI (skip if something already serves :3007) ─────────────
step "Starting the web GUI"
WEBPORT=3007
if ss -ltn 2>/dev/null | grep -q ":${WEBPORT} "; then
  info "port ${WEBPORT} is already in use — leaving nexrelm-web stopped (another process is serving the GUI)."
else
  run_logged "systemctl restart nexrelm-web" systemctl restart nexrelm-web
  for i in $(seq 1 30); do
    curl -fsS --max-time 2 "http://127.0.0.1:${WEBPORT}" >/dev/null 2>&1 && break
    [ "$i" = "30" ] && { info "web not responding yet — check: journalctl -u nexrelm-web -n 50"; break; }
    sleep 1
  done
  ok "web GUI on :${WEBPORT}"
fi

# ── 7. create the admin account ───────────────────────────────────────────────
step "Creating the admin account"
set +e
SETUP_OUT="$("$CLI_BIN" setup 2>&1)"; SETUP_RC=$?
set -e
echo "$SETUP_OUT"
if [ "$SETUP_RC" = "3" ]; then
  info "admin already exists — left untouched. Forgot the password? Run: ${BOLD}sudo nexrelm reset-password${NC}"
elif [ "$SETUP_RC" != "0" ]; then
  die "admin creation failed" "$SETUP_OUT"
fi

# ── done ──────────────────────────────────────────────────────────────────────
echo ""
echo "${GR}${BOLD}  ✓ Nexrelm is installed.${NC}"
echo ""
echo "  ${BOLD}Open the GUI:${NC}  ${CY}http://${CERT_HOST}:3007${NC}"
if [ "$SCHEME" = "https" ]; then
echo "  ${BOLD}HTTPS API:${NC}     ${CY}https://${CERT_HOST}:8787${NC} — first time, open it once and accept the"
echo "                 self-signed cert so the GUI can reach it. Or front everything with"
echo "                 one trusted origin via ${CY}deploy/Caddyfile${NC} (recommended for HTTPS)."
echo "                 Re-issue the cert any time: ${CY}sudo nexrelm gen-cert${NC} → ${CY}sudo nexrelm restart${NC}"
else
echo "  ${BOLD}Want HTTPS later?${NC}  ${CY}sudo nexrelm gen-cert${NC} then ${CY}sudo nexrelm restart${NC} (or front with deploy/Caddyfile)"
fi
echo ""
echo "  ${BOLD}Console commands${NC} (run with sudo):"
echo "    ${CY}sudo nexrelm status${NC}            services + API + account summary"
echo "    ${CY}sudo nexrelm reset-password${NC}    new temp password if you're locked out"
echo "    ${CY}sudo nexrelm logs -f${NC}           live logs   ·   ${CY}nexrelm crash${NC}  debug a crash"
echo "    ${CY}sudo nexrelm clear <db>${NC}        wipe a database   ·   ${CY}nexrelm reset${NC}  factory reset"
echo "    ${CY}sudo nexrelm backup${NC} / ${CY}restore${NC}     ·   ${CY}nexrelm move-data <dir>${NC}  relocate"
echo "    ${CY}sudo nexrelm doctor${NC}            run diagnostics   ·   ${CY}nexrelm help${NC}  all commands"
echo ""
echo "  ${BOLD}Next${NC}: open the GUI, sign in as ${BOLD}admin${NC} with the password above, and"
echo "        set your own password when prompted. (You can change it any time in"
echo "        Settings → Account.)"
echo ""
