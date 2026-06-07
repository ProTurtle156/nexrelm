#!/usr/bin/env bash
#
# Nexrelm admin CLI — installed to /usr/local/bin/nexrelm by install-nexrelm.sh,
# which fills the __PLACEHOLDERS__ below. A bash dispatcher: operational commands
# (service, databases, reset, relocation, diagnostics) are handled here; account
# commands (setup / reset-password / account) delegate to the in-app tsx CLI so
# the admin password is only ever born on the server console.
#
# The data directory is read live from the systemd unit (drop-in), so `move-data`
# only has to edit one place and everything else follows.
set -euo pipefail

NEXRELM_DIR="__NEXRELM_DIR__"
NEXRELM_USER="__NEXRELM_USER__"
DEFAULT_DATA="__DEFAULT_DATA__"
SERVICE="nexrelm-control-plane"
DROPIN="/etc/systemd/system/${SERVICE}.service.d/nexrelm-data.conf"
SELF="$0"
ARGV=("$@")
TSX="$NEXRELM_DIR/node_modules/.bin/tsx"
NODE_CLI="$NEXRELM_DIR/apps/control-plane/src/cli.ts"
export NODE_OPTIONS="--experimental-sqlite"

if [ -t 1 ]; then B=$'\e[1m'; D=$'\e[2m'; CY=$'\e[36m'; GR=$'\e[32m'; YE=$'\e[33m'; RD=$'\e[31m'; NC=$'\e[0m'; else B=; D=; CY=; GR=; YE=; RD=; NC=; fi
say()  { echo "$*"; }
ok()   { echo "  ${GR}✓${NC} $*"; }
bad()  { echo "  ${RD}✗${NC} $*"; }
err()  { echo "${RD}nexrelm: $*${NC}" >&2; }

ASSUME_YES=0
for a in "${ARGV[@]:-}"; do [ "$a" = "--yes" ] || [ "$a" = "-y" ] && ASSUME_YES=1; done

require_root() { [ "$(id -u)" = "0" ] || exec sudo -- "$SELF" "${ARGV[@]}"; }
confirm()      { [ "$ASSUME_YES" = "1" ] && return 0; local a; read -r -p "$1 ${D}type 'yes':${NC} " a; [ "$a" = "yes" ]; }
home_of()      { getent passwd "$NEXRELM_USER" | cut -d: -f6; }
unit_env()     { systemctl show "$SERVICE" -p Environment --value 2>/dev/null | tr ' ' '\n' | sed -n "s/^$1=//p" | head -n1; }
data_dir()     { local d; d="$(unit_env NEXRELM_DATA)"; [ -n "$d" ] && echo "$d" || echo "$DEFAULT_DATA"; }
svc_port()     { local p; p="$(unit_env PORT)"; [ -n "$p" ] && echo "$p" || echo 8787; }

# run the in-app account CLI as the service user (keeps auth.json owned correctly)
node_cli() {
  cd "$NEXRELM_DIR/apps/control-plane"
  local dd; dd="$(data_dir)"
  if [ "$(id -un)" = "$NEXRELM_USER" ]; then NEXRELM_DATA="$dd" "$TSX" "$NODE_CLI" "$@"
  elif [ "$(id -u)" = "0" ]; then runuser -u "$NEXRELM_USER" -- env NEXRELM_DATA="$dd" NODE_OPTIONS="$NODE_OPTIONS" "$TSX" "$NODE_CLI" "$@"
  else err "run as $NEXRELM_USER or with sudo"; return 1; fi
}
# run a command in the repo as the service user (npm etc.)
as_user_repo() { require_root; runuser -u "$NEXRELM_USER" -- bash -lc "cd '$NEXRELM_DIR' && HOME='$(home_of)' NODE_OPTIONS='$NODE_OPTIONS' $*"; }

wait_health() {
  local port; port="$(svc_port)"
  for _ in $(seq 1 20); do curl -fsS --max-time 2 "http://127.0.0.1:${port}/api/health" >/dev/null 2>&1 && return 0; sleep 1; done
  return 1
}

# ── service ───────────────────────────────────────────────────────────────────
cmd_start()   { require_root; systemctl start "$SERVICE"; systemctl start nexrelm-web 2>/dev/null || true; ok "started (control plane + web)";  }
cmd_stop()    { require_root; systemctl stop "$SERVICE"; systemctl stop nexrelm-web 2>/dev/null || true; ok "stopped (control plane + web)";  }
cmd_restart() {
  require_root
  systemctl restart "$SERVICE"; wait_health && ok "control plane restarted (healthy)" || bad "control plane not healthy — try: sudo nexrelm crash"
  systemctl restart nexrelm-web 2>/dev/null && ok "web GUI restarted" || true
}
cmd_enable()  { require_root; systemctl enable "$SERVICE"  >/dev/null 2>&1; ok "will start on boot"; }
cmd_disable() { require_root; systemctl disable "$SERVICE" >/dev/null 2>&1; ok "won't start on boot"; }

cmd_logs() {
  require_root
  local n=200 follow=0
  while [ $# -gt 0 ]; do case "$1" in -f|--follow) follow=1;; -n) n="$2"; shift;; esac; shift; done
  if [ "$follow" = "1" ]; then journalctl -u "$SERVICE" -n "$n" -f
  else journalctl -u "$SERVICE" -n "$n" --no-pager; fi
}

cmd_crash() {
  require_root
  say "${B}service status${NC}"
  systemctl status "$SERVICE" --no-pager -n 0 || true
  say ""
  say "${B}exit / restart info${NC}"
  systemctl show "$SERVICE" -p Result -p ExecMainStatus -p NRestarts -p ActiveState
  say ""
  say "${B}recent warnings & errors${NC} ${D}(last 80)${NC}"
  journalctl -u "$SERVICE" -p warning -n 80 --no-pager || true
  say ""
  say "${D}Live tail: ${NC}sudo nexrelm logs -f"
}

# ── account (delegate) ────────────────────────────────────────────────────────
cmd_setup()          { node_cli setup; }
cmd_reset_password() { node_cli reset-password "$@"; }
cmd_account()        { node_cli status; }

# ── databases ─────────────────────────────────────────────────────────────────
cmd_clear() {
  require_root
  local t="${1:-}"
  case "$t" in dns|dhcp|security|all) :;; *) err "usage: nexrelm clear <dns|dhcp|security|all>"; exit 2;; esac
  confirm "Clear the ${B}$t${NC} database(s)? This permanently deletes that data." || { say "aborted"; exit 1; }
  local dd; dd="$(data_dir)"
  systemctl stop "$SERVICE"
  local names=(); case "$t" in all) names=(dns dhcp security);; *) names=("$t");; esac
  for n in "${names[@]}"; do rm -f "$dd/$n.db" "$dd/$n.db-wal" "$dd/$n.db-shm"; ok "cleared $n.db"; done
  systemctl start "$SERVICE"; wait_health && ok "service restarted (fresh schema)" || bad "service not healthy — sudo nexrelm crash"
}

# ── full reset ────────────────────────────────────────────────────────────────
cmd_reset() {
  require_root
  local dd; dd="$(data_dir)"
  confirm "${RD}FULL RESET${NC} — wipes ALL Nexrelm data (databases, settings, admin account, secrets) in $dd." || { say "aborted"; exit 1; }
  systemctl stop "$SERVICE"
  if [ -e "$dd" ]; then
    local bak="${dd%/}.reset-$(date +%Y%m%d-%H%M%S)"
    mv "$dd" "$bak"; ok "old data backed up → $bak"
  fi
  install -d -o "$NEXRELM_USER" -g "$NEXRELM_USER" -m 700 "$dd"; ok "fresh data dir created"
  systemctl start "$SERVICE"; wait_health || true
  say ""; say "${GR}Reset complete.${NC} Create a new admin: ${CY}sudo nexrelm setup${NC}"
}

# ── backup / restore ──────────────────────────────────────────────────────────
cmd_backup() {
  local dd; dd="$(data_dir)"
  local out="${1:-$(home_of)/nexrelm-backup-$(date +%Y%m%d-%H%M%S).tgz}"
  [ "$(id -u)" = "0" ] || [ "$(id -un)" = "$NEXRELM_USER" ] || require_root
  tar czf "$out" -C "$(dirname "$dd")" "$(basename "$dd")"
  ok "backup written → $out ($(du -h "$out" | cut -f1))"
}
cmd_restore() {
  require_root
  local f="${1:-}"; [ -f "$f" ] || { err "usage: nexrelm restore <backup.tgz>"; exit 2; }
  local dd; dd="$(data_dir)"
  # reject a tampered archive that would escape the data dir (restore runs as root)
  if tar tzf "$f" 2>/dev/null | grep -qE '(^|/)\.\.(/|$)|^/'; then err "archive contains absolute or traversal paths — refusing to extract"; exit 1; fi
  confirm "Restore $f over the current data in $dd? Current data is backed up first." || { say "aborted"; exit 1; }
  systemctl stop "$SERVICE"
  [ -e "$dd" ] && mv "$dd" "${dd%/}.pre-restore-$(date +%Y%m%d-%H%M%S)"
  tar xzf "$f" -C "$(dirname "$dd")"
  chown -R "$NEXRELM_USER":"$NEXRELM_USER" "$dd" 2>/dev/null || true
  systemctl start "$SERVICE"; wait_health && ok "restored + restarted" || bad "restored but not healthy"
}

# ── relocation (install/data location) ────────────────────────────────────────
cmd_move_data() {
  require_root
  local new="${1:-}"; [ -n "$new" ] || { err "usage: nexrelm move-data <new-directory>"; exit 2; }
  local old; old="$(data_dir)"
  [ "$new" = "$old" ] && { say "already at $new"; exit 0; }
  systemctl stop "$SERVICE"
  mkdir -p "$(dirname "$new")"
  if [ -e "$old" ]; then mv "$old" "$new"; ok "moved data $old → $new"; else install -d "$new"; ok "created $new"; fi
  chown -R "$NEXRELM_USER":"$NEXRELM_USER" "$new"
  mkdir -p "$(dirname "$DROPIN")"
  printf '[Service]\nEnvironment=NEXRELM_DATA=%s\n' "$new" > "$DROPIN"
  systemctl daemon-reload
  systemctl start "$SERVICE"; wait_health && ok "service now using $new" || bad "service not healthy after move"
}

# ── maintenance ───────────────────────────────────────────────────────────────
cmd_rebuild() {
  require_root
  say "${B}installing dependencies…${NC}"; as_user_repo "npm install --no-audit --no-fund"
  say "${B}type-checking…${NC}";           as_user_repo "npm run typecheck"
  say "${B}building the GUI…${NC}";         as_user_repo "npm run build --workspace apps/web"
  systemctl restart "$SERVICE"; wait_health && ok "control plane rebuilt + restarted" || bad "control plane not healthy — sudo nexrelm crash"
  systemctl restart nexrelm-web 2>/dev/null && ok "web GUI restarted" || true
}

cmd_uninstall() {
  require_root
  local purge=0; for a in "$@"; do [ "$a" = "--purge" ] && purge=1; done
  confirm "Uninstall Nexrelm (stop+disable service, remove the 'nexrelm' command${purge:+, and PURGE all data})?" || { say "aborted"; exit 1; }
  systemctl disable --now "$SERVICE" >/dev/null 2>&1 || true
  rm -f "$DROPIN"; rmdir "$(dirname "$DROPIN")" 2>/dev/null || true
  rm -f /etc/systemd/system/${SERVICE}.service
  systemctl daemon-reload || true
  if [ "$purge" = "1" ]; then
    local dd; dd="$(data_dir)"; [ -e "$dd" ] && { mv "$dd" "${dd%/}.uninstalled-$(date +%Y%m%d-%H%M%S)"; ok "data moved aside (not deleted)"; }
  else say "  ${D}data kept at $(data_dir) and the repo at $NEXRELM_DIR${NC}"; fi
  rm -f /usr/local/bin/nexrelm
  ok "uninstalled. Reinstall any time: sudo bash $NEXRELM_DIR/deploy/install-nexrelm.sh"
}

# ── diagnostics ───────────────────────────────────────────────────────────────
cmd_doctor() {
  local dd port; dd="$(data_dir)"; port="$(svc_port)"
  say "${B}Nexrelm doctor${NC}"
  local nv nmaj nmin; nv="$(node -v 2>/dev/null || echo none)"
  nmaj="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
  nmin="$(node -p 'process.versions.node.split(".")[1]' 2>/dev/null || echo 0)"
  if [ "$nmaj" -gt 22 ] || { [ "$nmaj" -eq 22 ] && [ "$nmin" -ge 5 ]; }; then ok "node $nv"; else bad "node $nv (need 22.5+ for node:sqlite)"; fi
  [ -x "$TSX" ] && ok "tsx present" || bad "tsx missing — run sudo nexrelm rebuild"
  systemctl is-active --quiet "$SERVICE" && ok "control plane active" || bad "control plane inactive — sudo nexrelm start"
  systemctl is-active --quiet nexrelm-web 2>/dev/null && ok "web GUI active" || bad "web GUI inactive (or managed elsewhere)"
  systemctl is-enabled --quiet "$SERVICE" 2>/dev/null && ok "starts on boot" || bad "not enabled on boot"
  (ss -ltn 2>/dev/null | grep -q ":$port ") && ok "API listening on :$port" || bad "nothing on :$port"
  (ss -ltn 2>/dev/null | grep -q ":3007 ") && ok "GUI listening on :3007" || bad "nothing on :3007"
  if curl -fsS --max-time 2 "http://127.0.0.1:$port/api/health" >/dev/null 2>&1; then
    local v; v="$(curl -fsS "http://127.0.0.1:$port/api/health" | sed -n 's/.*"version":"\([^"]*\)".*/\1/p')"; ok "API healthy (v$v)"
  else bad "API /api/health unreachable"; fi
  if [ -d "$dd" ]; then ok "data dir $dd ($(stat -c '%U %a' "$dd"))"; else bad "data dir $dd missing"; fi
  local init; init="$(node_cli status 2>/dev/null | sed -n 's/.*"initialized": *\([a-z]*\).*/\1/p')"
  [ "$init" = "true" ] && ok "admin account initialized" || bad "no admin account — sudo nexrelm setup"
  if [ -d "$dd" ]; then for f in "$dd"/*.db; do [ -e "$f" ] && say "    ${D}$(basename "$f"): $(du -h "$f" | cut -f1)${NC}"; done; fi
}

cmd_status() {
  local port dd; port="$(svc_port)"; dd="$(data_dir)"
  local active; active="$(systemctl is-active "$SERVICE" 2>/dev/null || true)"
  say "${B}Nexrelm${NC}  ${D}service${NC} $([ "$active" = active ] && echo "${GR}$active${NC}" || echo "${RD}$active${NC}")  ${D}boot${NC} $(systemctl is-enabled "$SERVICE" 2>/dev/null || echo unknown)"
  if curl -fsS --max-time 2 "http://127.0.0.1:$port/api/health" >/dev/null 2>&1; then
    local h; h="$(curl -fsS "http://127.0.0.1:$port/api/health")"
    say "  ${D}api${NC} :$port  ${D}version${NC} $(echo "$h"|sed -n 's/.*"version":"\([^"]*\)".*/\1/p')  ${D}uptime${NC} $(echo "$h"|sed -n 's/.*"uptimeSec":\([0-9]*\).*/\1/p')s"
  else say "  ${D}api${NC} :$port ${RD}unreachable${NC}"; fi
  say "  ${D}account${NC} $(node_cli status 2>/dev/null | tr -d '\n ' )"
  say "  ${D}data${NC} $dd"
}

cmd_gencert() {
  local dd; dd="$(data_dir)"
  if [ "$(id -un)" = "$NEXRELM_USER" ]; then NEXRELM_DATA="$dd" bash "$NEXRELM_DIR/deploy/gen-cert.sh" "$dd"
  elif [ "$(id -u)" = "0" ]; then runuser -u "$NEXRELM_USER" -- env NEXRELM_DATA="$dd" bash "$NEXRELM_DIR/deploy/gen-cert.sh" "$dd"
  else err "run as $NEXRELM_USER or with sudo"; return 1; fi
}

cmd_version() {
  local port; port="$(svc_port)"
  curl -fsS --max-time 2 "http://127.0.0.1:$port/api/health" 2>/dev/null | sed -n 's/.*"version":"\([^"]*\)".*/v\1/p' \
    || node -p "'v'+require('$NEXRELM_DIR/apps/control-plane/package.json').version" 2>/dev/null || echo "unknown"
}

cmd_help() {
  cat <<H
${B}nexrelm${NC} — Nexrelm control-plane admin CLI   ${D}(run privileged commands with sudo)${NC}

${CY}Account${NC}
  setup                         create the admin account (first install)
  reset-password [--password X] new temp password (forces change), or set one explicitly
  account                       show account state (JSON)

${CY}Service${NC}
  start | stop | restart        control the control plane
  enable | disable              start on boot (or not)
  status                        service + API + account + data-dir summary
  logs [-f] [-n N]              journald logs (live tail with -f)
  crash                         exit codes + recent warnings/errors (debug a crash)

${CY}Data${NC}
  clear <dns|dhcp|security|all> wipe a database (schema recreated on restart)
  backup [file]                 tar.gz the data dir
  restore <file>                restore a backup (current data backed up first)
  reset [--yes]                 FULL factory reset (backs up, then wipes all data + account)

${CY}Installation${NC}
  gen-cert                      generate a self-signed TLS cert (control plane serves HTTPS)
  move-data <dir>               relocate the data directory (service follows)
  rebuild                       reinstall deps + typecheck + restart (after code changes)
  doctor                        run health/diagnostics checks
  uninstall [--purge]           remove the CLI + service (--purge also sets data aside)
  version                       print the running version

  ${D}Data: $(data_dir)   ·   Repo: $NEXRELM_DIR   ·   Service: $SERVICE${NC}
H
}

main() {
  local cmd="${1:-help}"; shift || true
  case "$cmd" in
    setup)                 cmd_setup "$@";;
    reset-password|resetpassword|resetpw) cmd_reset_password "$@";;
    account|whoami)        cmd_account "$@";;
    start)                 cmd_start;;
    stop)                  cmd_stop;;
    restart)               cmd_restart;;
    enable)                cmd_enable;;
    disable)               cmd_disable;;
    logs|log)              cmd_logs "$@";;
    crash|debug)           cmd_crash;;
    clear)                 cmd_clear "$@";;
    backup)                cmd_backup "$@";;
    restore)               cmd_restore "$@";;
    reset|factory-reset)   cmd_reset;;
    move-data|relocate)    cmd_move_data "$@";;
    rebuild|update)        cmd_rebuild;;
    uninstall)             cmd_uninstall "$@";;
    doctor|diagnose)       cmd_doctor;;
    status)                cmd_status;;
    gen-cert|tls)          cmd_gencert;;
    version|--version|-v)  cmd_version;;
    help|--help|-h)        cmd_help;;
    *) err "unknown command: $cmd"; echo; cmd_help; exit 2;;
  esac
}
main "$@"
