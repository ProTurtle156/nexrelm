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
RUN_USER="${SUDO_USER:-os}"   # the user the control plane runs as

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run with sudo:  sudo bash deploy/install-gateway.sh" >&2
  exit 1
fi

if [[ "${1:-}" == "--remove" ]]; then
  echo "==> removing inline-gateway helper + sudoers"
  /usr/local/sbin/nexrelm-gateway disable 2>/dev/null || true
  rm -f "$HELPER_DST" "$SUDOERS"
  echo "    removed. (any active routing was reverted)"
  exit 0
fi

if [[ ! -f "$HELPER_SRC" ]]; then
  echo "ERROR: helper not found at $HELPER_SRC" >&2
  exit 1
fi

echo "==> installing root helper -> $HELPER_DST"
install -m 0755 -o root -g root "$HELPER_SRC" "$HELPER_DST"

echo "==> writing + validating sudoers entry for user '$RUN_USER'"
tmp="$(mktemp)"
echo "$RUN_USER ALL=(root) NOPASSWD: $HELPER_DST" > "$tmp"
if visudo -cf "$tmp"; then
  install -m 0440 -o root -g root "$tmp" "$SUDOERS"
  echo "    sudoers ok -> $SUDOERS"
else
  echo "ERROR: sudoers validation failed — not installing" >&2
  rm -f "$tmp"; exit 1
fi
rm -f "$tmp"

echo "==> sanity check"
sudo -n -u "$RUN_USER" sudo -n "$HELPER_DST" status || echo "    (status check returned non-zero; that's fine if not enabled)"

echo
echo "==> DONE. Inline gateway is installed and OFF."
echo "    Open Security → Gateway, point a pilot device's gateway at this host's"
echo "    LAN IP, then enable for that one device. The kill switch reverts it."
