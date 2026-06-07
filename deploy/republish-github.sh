#!/usr/bin/env bash
#
# Nexrelm — DELETE the existing GitHub repo and re-publish the clean version.
# Use this when a repo was pushed with content you need fully gone (deleting the
# repo removes dangling commits that a force-push leaves reachable by SHA).
#
# Prompts for a token (hidden), deletes the repo, recreates it, and pushes the
# current clean `main`. The token needs scopes: repo + delete_repo (classic PAT:
# tick both; fine-grained: Administration read/write + Contents read/write).
#
# Usage:  bash deploy/republish-github.sh
set -euo pipefail

if [ -t 1 ]; then B=$'\e[1m'; CY=$'\e[36m'; GR=$'\e[32m'; YE=$'\e[33m'; RD=$'\e[31m'; NC=$'\e[0m'; else B=; CY=; GR=; YE=; RD=; NC=; fi
die() { echo "${RD}error: $*${NC}" >&2; exit 1; }
api() { curl -s -o "$2" -w '%{http_code}' -H "Authorization: token $GH_TOKEN" -H "Accept: application/vnd.github+json" "${@:3}" "$1"; }

cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
command -v git >/dev/null 2>&1 || die "git not installed"
command -v curl >/dev/null 2>&1 || die "curl not installed"
[ -d .git ] || die "not a git repo"

echo ""
echo "${B}${CY}  Nexrelm — delete & re-publish (clean)${NC}"
echo "  ${YE}This DELETES the GitHub repo, then pushes the current clean main.${NC}"
echo ""

read -r -s -p "  GitHub token (repo + delete_repo scope, hidden): " GH_TOKEN; echo
[ -n "$GH_TOKEN" ] || die "a token is required"

RESP="$(mktemp)"; trap 'rm -f "$RESP"; unset GH_TOKEN' EXIT
CODE="$(api https://api.github.com/user "$RESP")"
[ "$CODE" = "200" ] || die "token rejected by GitHub (HTTP $CODE)"
GH_LOGIN="$(grep -oE '"login"[[:space:]]*:[[:space:]]*"[^"]+"' "$RESP" | head -1 | sed -E 's/.*"([^"]+)".*/\1/')"
[ -n "$GH_LOGIN" ] || die "could not read account login from token"
echo "  ${GR}✓${NC} authenticated as ${B}$GH_LOGIN${NC}"

read -r -p "  Repository name (default: nexrelm): " GH_REPO; GH_REPO="${GH_REPO:-nexrelm}"
read -r -p "  Visibility for the fresh repo [public/private] (default: public): " VIS; VIS="${VIS:-public}"
PRIV=$([ "$VIS" = "private" ] && echo true || echo false)

echo ""
read -r -p "  Type DELETE to confirm deleting $GH_LOGIN/$GH_REPO and re-publishing: " CONF
[ "$CONF" = "DELETE" ] || die "aborted"

# ── delete ────────────────────────────────────────────────────────────────────
echo "  deleting $GH_LOGIN/$GH_REPO…"
CODE="$(api "https://api.github.com/repos/$GH_LOGIN/$GH_REPO" "$RESP" -X DELETE)"
case "$CODE" in
  204) echo "  ${GR}✓${NC} repository deleted";;
  404) echo "  ${YE}!${NC} repository didn't exist — will create fresh";;
  403) die "token lacks the 'delete_repo' scope. Either add it and re-run, or delete the repo manually in GitHub → Settings → Danger Zone, then run: bash deploy/publish-github.sh";;
  *)   echo "$(cat "$RESP")"; die "delete failed (HTTP $CODE)";;
esac

# ── recreate (the name can be briefly reserved right after deletion) ───────────
echo "  creating $GH_LOGIN/$GH_REPO ($VIS)…"
for attempt in 1 2 3 4 5; do
  CODE="$(curl -s -o "$RESP" -w '%{http_code}' -X POST \
    -H "Authorization: token $GH_TOKEN" -H "Accept: application/vnd.github+json" \
    https://api.github.com/user/repos \
    -d "{\"name\":\"$GH_REPO\",\"private\":$PRIV,\"description\":\"Nexrelm — open-source network control plane (DNS · DHCP · Directory · Virtualization · Security).\"}")"
  [ "$CODE" = "201" ] && { echo "  ${GR}✓${NC} created"; break; }
  [ "$attempt" = "5" ] && { echo "$(cat "$RESP")"; die "create failed (HTTP $CODE)"; }
  sleep 3
done

# ── remote + push the clean main ──────────────────────────────────────────────
REMOTE="https://github.com/$GH_LOGIN/$GH_REPO.git"
git remote get-url origin >/dev/null 2>&1 && git remote set-url origin "$REMOTE" || git remote add origin "$REMOTE"
git branch -M main
git config --local credential.helper "store --file=$(pwd)/.git/.credentials"
printf 'protocol=https\nhost=github.com\nusername=%s\npassword=%s\n\n' "$GH_LOGIN" "$GH_TOKEN" | git credential approve
chmod 600 "$(pwd)/.git/.credentials" 2>/dev/null || true

echo "  pushing clean main…"
git push --force -u origin main

echo ""
echo "${GR}${B}  ✓ Re-published clean → https://github.com/$GH_LOGIN/$GH_REPO${NC}"
echo "  The old repo (and its commits) are gone; this is a fresh repo with only the clean commit."
echo ""
