#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Nexrelm inline-gateway P1 — privileged installer (run this yourself).
#
# Installs the audited root helper and a SINGLE NOPASSWD sudoers entry so the
# non-root control plane can manage routing through one fixed command. This is a
# deliberate, reviewable privilege grant — that's why Nexrelm does NOT do it for
# you. Read deploy/nexrelm-gateway.sh first; it is the only thing this entry can
# run, with strict input validation and a dead-man watchdog.
#
# Usage:   sudo bash deploy/install-gateway.sh          (install)
#          sudo bash deploy/install-gateway.sh --remove  (full uninstall)
#
# After install, the gateway is still OFF. You enable it per-device from the
# Security → Gateway tab, and the kill switch / dead-man timer can revert it.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail

HELPER_SRC="$(cd "$(dirname "$0")" && pwd)/nexrelm-gateway.sh"
HELPER_DST=/usr/local/sbin/nexrelm-gateway
SUDOERS=/etc/sudoers.d/nexrelm-gateway
REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run with sudo:  sudo bash deploy/install-gateway.sh" >&2
  exit 1
fi

# Full uninstall — runs before user-detection so it works even if the service user
# is gone. Reverts routing, removes the helper + the NOPASSWD sudoers grant, and
# makes sure kernel IP forwarding is left OFF (no standing privilege or routing).
if [[ "${1:-}" == "--remove" ]]; then
  echo "==> removing inline-gateway helper + sudoers"
  if [[ -x "$HELPER_DST" ]]; then "$HELPER_DST" disable 2>/dev/null || true; fi
  rm -f "$HELPER_DST" "$SUDOERS"
  sysctl -wq net.ipv4.ip_forward=0 2>/dev/null || true
  echo "    removed: $HELPER_DST, $SUDOERS (routing reverted, ip_forward=0)"
  exit 0
fi

# Which user does the control plane ACTUALLY run as? That's who needs the NOPASSWD
# entry — pinning it to the wrong user is the #1 reason the Gateway tab shows the
# helper as "not installed / not invokable". Priority: explicit override → the
# installed systemd unit's User= → the sudo invoker → the repo owner.
detect_run_user() {
  if [[ -n "${NEXRELM_USER:-}" ]]; then echo "$NEXRELM_USER"; return; fi
  local svc; svc="$(systemctl show -p User --value nexrelm-control-plane 2>/dev/null || true)"
  if [[ -n "$svc" && "$svc" != "root" ]]; then echo "$svc"; return; fi
  if [[ -n "${SUDO_USER:-}" && "$SUDO_USER" != "root" ]]; then echo "$SUDO_USER"; return; fi
  stat -c '%U' "$REPO_DIR" 2>/dev/null || echo os
}
RUN_USER="$(detect_run_user)"
id "$RUN_USER" >/dev/null 2>&1 || { echo "ERROR: service user '$RUN_USER' does not exist — pass NEXRELM_USER=<user>" >&2; exit 1; }

if [[ ! -f "$HELPER_SRC" ]]; then
  echo "ERROR: helper not found at $HELPER_SRC" >&2
  exit 1
fi

echo "==> installing root helper -> $HELPER_DST"
install -m 0755 -o root -g root "$HELPER_SRC" "$HELPER_DST"

echo "==> writing + validating sudoers entry for user '$RUN_USER'"
tmp="$(mktemp)"
# !requiretty: the control plane is a daemon with no controlling terminal, so the
# entry must work without a tty (some distros default to requiretty). NOPASSWD on
# the single fixed helper path is the whole privilege grant.
{
  echo "Defaults:$RUN_USER !requiretty"
  echo "$RUN_USER ALL=(root) NOPASSWD: $HELPER_DST"
} > "$tmp"
if visudo -cf "$tmp"; then
  install -m 0440 -o root -g root "$tmp" "$SUDOERS"
  echo "    sudoers ok -> $SUDOERS"
else
  echo "ERROR: sudoers validation failed — not installing" >&2
  rm -f "$tmp"; exit 1
fi
rm -f "$tmp"

echo "==> sanity check (as '$RUN_USER', no tty — exactly how the control plane calls it)"
out="$(mktemp)"
# setsid drops the controlling terminal so this mirrors the daemon; fall back to a
# plain call where setsid is unavailable.
if command -v setsid >/dev/null 2>&1; then
  probe=(setsid -w sudo -n "$HELPER_DST" status)
else
  probe=(sudo -n "$HELPER_DST" status)
fi
if sudo -n -u "$RUN_USER" "${probe[@]}" >"$out" 2>&1; then
  echo "    OK -> $(cat "$out")"
  echo "    ✓ the control plane (user '$RUN_USER') can reach the helper — the Gateway tab will detect it."
else
  echo "    WARNING: user '$RUN_USER' could NOT invoke the helper via sudo -n:" >&2
  sed 's/^/      /' "$out" >&2
  echo "      → If your control plane runs as a different user, re-run:" >&2
  echo "          sudo NEXRELM_USER=<that-user> bash deploy/install-gateway.sh" >&2
fi
rm -f "$out"

echo
echo "==> DONE. Inline gateway is installed and OFF."
echo "    Open Security → Gateway, point a pilot device's gateway at this host's"
echo "    LAN IP, then enable for that one device. The kill switch reverts it."
