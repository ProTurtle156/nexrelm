#!/usr/bin/env bash
# Nexrelm DNS — one-shot setup to run the resolver on :53 and become your LAN's
# DNS server (Pi-hole style). Safe + idempotent. Needs sudo only for the unit.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
UNIT="nexrelm-control-plane.service"

# 1) Detect the LAN IP devices will point at.
LAN_IP="$(ip -4 -o addr show scope global 2>/dev/null \
  | awk '{print $4}' | cut -d/ -f1 \
  | grep -vE '^(172\.(1[6-9]|2[0-9]|3[01])\.|192\.168\.122\.)' \
  | grep -E '^192\.168\.|^10\.' | head -1)"
LAN_IP="${1:-${LAN_IP:-}}"

if [[ -z "$LAN_IP" ]]; then
  echo "Could not auto-detect a LAN IP. Pass it explicitly:  $0 192.168.1.2"
  exit 1
fi

echo "── Nexrelm DNS setup ───────────────────────────────────────────"
echo "Repo:    $REPO"
echo "LAN IP:  $LAN_IP   (devices/router will use this as their DNS server)"
echo

# 2) systemd-resolved coexistence: Nexrelm binds ONLY the LAN IP, so resolved's
#    loopback stub (127.0.0.53) is untouched. Nothing to disable. Just confirm
#    the LAN IP:53 is free.
if ss -ulnH "sport = :53" | awk '{print $5}' | grep -q "^${LAN_IP}:53$"; then
  echo "WARNING: something already listens on ${LAN_IP}:53 — free it first."
  exit 1
fi

# 3) Install the system unit (grants CAP_NET_BIND_SERVICE for :53).
echo "Installing ${UNIT} (requires sudo)…"
sudo cp "$REPO/deploy/${UNIT}" "/etc/systemd/system/${UNIT}"
sudo sed -i "s|^WorkingDirectory=.*|WorkingDirectory=${REPO}|" "/etc/systemd/system/${UNIT}"
sudo sed -i "s|^# Environment=DNS_BIND=.*|Environment=DNS_BIND=${LAN_IP}|" "/etc/systemd/system/${UNIT}"
sudo systemctl daemon-reload
sudo systemctl enable --now "${UNIT}"
sleep 3

# 4) Report.
echo
if ss -ulnH "sport = :53" | grep -q "${LAN_IP}:53"; then
  echo "✓ Nexrelm DNS is live on ${LAN_IP}:53"
else
  echo "Resolver may still be starting — check:  journalctl -u ${UNIT} -f"
fi
cat <<EOF

Next step — point your network at it:
  • Router DHCP DNS → ${LAN_IP}   (every device now resolves through Nexrelm)
    Router admin → DHCP/LAN settings → set Primary DNS = ${LAN_IP}, then renew leases.
  • Or per-device: set DNS to ${LAN_IP}.

Test from another machine:   dig @${LAN_IP} doubleclick.net    (expect 0.0.0.0)
GUI:                         the DNS tab in Nexrelm (web :3007)
Logs:                        journalctl -u ${UNIT} -f
EOF
