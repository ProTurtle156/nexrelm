#!/usr/bin/env bash
# nexrelm-gateway — the ONLY privileged surface for inline-gateway mode.
# Fixed command set, strict input validation, no shell interpolation of args.
# Installed at /usr/local/sbin/nexrelm-gateway (root:root 0755) and invoked by the
# (non-root) control plane via a single NOPASSWD sudoers entry. Implements a
# dead-man watchdog: if the control plane stops refreshing the heartbeat, routing
# auto-reverts within ~90s so a crash can never strand the network.
set -euo pipefail

STATE_DIR=/run/nexrelm-gw
ALIVE="$STATE_DIR/alive"
SAVED_FWD="$STATE_DIR/saved_ip_forward"
TABLE="nexrelm_gw"

is_ipv4() { [[ "$1" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}(/[0-9]{1,2})?$ ]]; }
is_iface() { [[ "$1" =~ ^[a-zA-Z0-9._-]{1,16}$ ]] && ip link show "$1" >/dev/null 2>&1; }

revert() {
  nft delete table ip "$TABLE" 2>/dev/null || true
  if [[ -f "$SAVED_FWD" ]]; then sysctl -wq net.ipv4.ip_forward="$(cat "$SAVED_FWD")" || true; fi
  rm -rf "$STATE_DIR"
}

start_watchdog() {
  # detached root watchdog: revert if the heartbeat goes stale (control plane died)
  setsid bash -c '
    STATE_DIR=/run/nexrelm-gw; ALIVE="$STATE_DIR/alive"
    while true; do
      sleep 10
      [[ -f "$ALIVE" ]] || break
      age=$(( $(date +%s) - $(stat -c %Y "$ALIVE") ))
      [[ "$age" -gt 90 ]] && break
    done
    nft delete table ip nexrelm_gw 2>/dev/null || true
    [[ -f "$STATE_DIR/saved_ip_forward" ]] && sysctl -wq net.ipv4.ip_forward="$(cat "$STATE_DIR/saved_ip_forward")" 2>/dev/null || true
    rm -rf "$STATE_DIR"
  ' >/dev/null 2>&1 < /dev/null &
}

cmd="${1:-status}"
case "$cmd" in
  enable)
    wan="${2:-}"; client="${3:-}"
    is_iface "$wan"   || { echo "ERROR: invalid wan interface"; exit 2; }
    is_ipv4  "$client" || { echo "ERROR: invalid client ip/cidr"; exit 2; }
    mkdir -p "$STATE_DIR"; chmod 755 "$STATE_DIR"
    [[ -f "$SAVED_FWD" ]] || cat /proc/sys/net/ipv4/ip_forward > "$SAVED_FWD"
    sysctl -wq net.ipv4.ip_forward=1
    nft delete table ip "$TABLE" 2>/dev/null || true
    nft -f - <<NFT
table ip ${TABLE} {
  chain forward { type filter hook forward priority 0; policy accept; }
  chain postrouting {
    type nat hook postrouting priority 100; policy accept;
    ip saddr ${client} oifname "${wan}" masquerade
  }
}
NFT
    date +%s > "$ALIVE"
    start_watchdog
    echo "OK enabled wan=${wan} client=${client}"
    ;;
  enable-lan)
    # route + NAT an ENTIRE LAN subnet through Nexrelm (be the gateway)
    wan="${2:-}"; lan="${3:-}"
    is_iface "$wan" || { echo "ERROR: invalid wan interface"; exit 2; }
    is_ipv4  "$lan" || { echo "ERROR: invalid lan cidr"; exit 2; }
    mkdir -p "$STATE_DIR"; chmod 755 "$STATE_DIR"
    [[ -f "$SAVED_FWD" ]] || cat /proc/sys/net/ipv4/ip_forward > "$SAVED_FWD"
    sysctl -wq net.ipv4.ip_forward=1
    nft delete table ip "$TABLE" 2>/dev/null || true
    nft -f - <<NFT
table ip ${TABLE} {
  chain forward { type filter hook forward priority 0; policy accept; }
  chain postrouting {
    type nat hook postrouting priority 100; policy accept;
    ip saddr ${lan} oifname "${wan}" masquerade
  }
}
NFT
    date +%s > "$ALIVE"
    start_watchdog
    echo "OK enabled-lan wan=${wan} lan=${lan}"
    ;;
  heartbeat)
    [[ -d "$STATE_DIR" ]] && date +%s > "$ALIVE" && echo "OK" || { echo "not enabled"; exit 1; }
    ;;
  disable)
    revert
    echo "OK disabled"
    ;;
  status)
    fwd=$(cat /proc/sys/net/ipv4/ip_forward)
    if nft list table ip "$TABLE" >/dev/null 2>&1; then
      age=$(( $(date +%s) - $(stat -c %Y "$ALIVE" 2>/dev/null || echo 0) ))
      echo "enabled ip_forward=${fwd} heartbeat_age=${age}"
    else
      echo "disabled ip_forward=${fwd}"
    fi
    ;;
  *)
    echo "usage: nexrelm-gateway {enable <wan> <client>|enable-lan <wan> <lan-cidr>|disable|heartbeat|status}"; exit 2
    ;;
esac
