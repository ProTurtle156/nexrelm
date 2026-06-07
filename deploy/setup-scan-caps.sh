#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Grant nmap + tcpdump the Linux capabilities Nexrelm's NON-ROOT control plane
# needs for clean SYN / version / OS scans and promiscuous capture — without ever
# running the daemon as root.
#
# Why: nmap's -sV version detection binds privileged source ports (<1024). With
# only --privileged (raw-socket privilege) but no CAP_NET_BIND_SERVICE in nmap's
# own effective set, every such bind fails:
#     NSOCK ERROR mksock_bind_addr(): Bind to 0.0.0.0:NNN failed: Permission denied (13)
# File-capabilities on the nmap binary fix it at the source, for any caller.
#
# Usage:  sudo bash deploy/setup-scan-caps.sh
# Undo:   sudo setcap -r /usr/bin/nmap; sudo setcap -r /usr/bin/tcpdump
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run with sudo:  sudo bash deploy/setup-scan-caps.sh" >&2
  exit 1
fi

NMAP="$(command -v nmap || echo /usr/bin/nmap)"
TCPDUMP="$(command -v tcpdump || echo /usr/bin/tcpdump)"

if [[ -x "$NMAP" ]]; then
  echo "==> nmap: cap_net_raw,cap_net_admin,cap_net_bind_service  ($NMAP)"
  setcap 'cap_net_raw,cap_net_admin,cap_net_bind_service+eip' "$NMAP"
else
  echo "!! nmap not found — install it (sudo dnf install -y nmap)" >&2
fi

if [[ -x "$TCPDUMP" ]]; then
  echo "==> tcpdump: cap_net_raw,cap_net_admin  ($TCPDUMP)  — for the promiscuous sniffer"
  setcap 'cap_net_raw,cap_net_admin+eip' "$TCPDUMP"
else
  echo "!! tcpdump not found — install it (sudo dnf install -y tcpdump)" >&2
fi

echo "==> verify"
getcap "$NMAP" "$TCPDUMP" 2>/dev/null || true
echo
echo "Done. Re-run a scan from Security → Vulnerabilities — the NSOCK 'Permission denied'"
echo "bind errors during -sV should be gone, and the sniffer can capture without root."
