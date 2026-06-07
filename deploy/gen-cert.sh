#!/usr/bin/env bash
#
# Generate a self-signed TLS certificate for the Nexrelm control plane, written
# to <data-dir>/tls/{cert.pem,key.pem}. The control plane serves HTTPS whenever
# those files exist (see config.ts). Browsers will warn on a self-signed cert —
# that's expected for a LAN appliance; accept it once, or front Nexrelm with a
# reverse proxy + a real cert (see deploy/Caddyfile).
#
# Usage:  nexrelm gen-cert            (preferred — resolves the data dir for you)
#         sudo bash deploy/gen-cert.sh [data-dir]
set -euo pipefail

DATA_DIR="${1:-${NEXRELM_DATA:-$HOME/.nexrelm}}"
TLS_DIR="$DATA_DIR/tls"
DAYS="${NEXRELM_TLS_DAYS:-397}"   # within the CA/Browser Forum max

command -v openssl >/dev/null 2>&1 || { echo "openssl not found — install it (sudo dnf install -y openssl)" >&2; exit 1; }

mkdir -p "$TLS_DIR"

# Subject Alternative Names: localhost + every global IPv4 this host owns (so the
# cert is valid however you reach it on the LAN) + an optional operator-chosen
# hostname/IP via NEXRELM_TLS_HOST (the installer passes the value you enter).
SANS="DNS:localhost,DNS:nexrelm.local,IP:127.0.0.1"
while read -r ip; do [ -n "$ip" ] && SANS="$SANS,IP:$ip"; done < <(ip -4 -o addr show scope global 2>/dev/null | awk '{print $4}' | cut -d/ -f1)
if [ -n "${NEXRELM_TLS_HOST:-}" ]; then
  if printf '%s' "$NEXRELM_TLS_HOST" | grep -qE '^[0-9.]+$'; then SANS="$SANS,IP:$NEXRELM_TLS_HOST"; else SANS="$SANS,DNS:$NEXRELM_TLS_HOST"; fi
fi

echo "==> generating self-signed cert (valid ${DAYS} days)"
echo "    SAN: $SANS"
openssl req -x509 -newkey rsa:4096 -nodes \
  -keyout "$TLS_DIR/key.pem" -out "$TLS_DIR/cert.pem" \
  -days "$DAYS" -subj "/CN=nexrelm" \
  -addext "subjectAltName=$SANS" >/dev/null 2>&1

chmod 600 "$TLS_DIR/key.pem"
chmod 644 "$TLS_DIR/cert.pem"

echo "==> wrote $TLS_DIR/cert.pem and key.pem"
echo "    Restart the control plane to serve HTTPS:  sudo nexrelm restart"
