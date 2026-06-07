#!/usr/bin/env bash
#
# Nexrelm — one-shot publish to GitHub. Prompts for a Personal Access Token
# (hidden), creates the repo via the GitHub API, wires the remote, and PUSHES
# immediately. The token is read hidden, used locally for the API call + push,
# stored only in git's repo-local credential file (.git/.credentials, git-ignored),
# and unset on exit — it never appears on screen or in the repo.
#
# Usage:  bash deploy/publish-github.sh
set -euo pipefail

if [ -t 1 ]; then B=$'\e[1m'; CY=$'\e[36m'; GR=$'\e[32m'; YE=$'\e[33m'; RD=$'\e[31m'; NC=$'\e[0m'; else B=; CY=; GR=; YE=; RD=; NC=; fi
die() { echo "${RD}error: $*${NC}" >&2; exit 1; }

cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
command -v git >/dev/null 2>&1 || die "git is not installed"
command -v curl >/dev/null 2>&1 || die "curl is not installed"
[ -d .git ] || git init -q

echo ""
echo "${B}${CY}  Publish Nexrelm to GitHub${NC}"
echo ""

# ── credentials ───────────────────────────────────────────────────────────────
read -r -s -p "  GitHub Personal Access Token (repo scope, hidden): " GH_TOKEN; echo
[ -n "$GH_TOKEN" ] || die "a token is required"

# verify the token + learn the account login (so the remote URL is always correct)
WHO="$(curl -fsS -H "Authorization: token $GH_TOKEN" -H "Accept: application/vnd.github+json" https://api.github.com/user 2>/dev/null || true)"
GH_LOGIN="$(printf '%s' "$WHO" | grep -oE '"login"[[:space:]]*:[[:space:]]*"[^"]+"' | head -1 | sed -E 's/.*"login"[^"]*"([^"]+)".*/\1/')"
[ -n "$GH_LOGIN" ] || { unset GH_TOKEN; die "token rejected by GitHub (check it has 'repo' scope)"; }
echo "  ${GR}✓${NC} authenticated as ${B}$GH_LOGIN${NC}"

read -r -p "  Repository name (default: nexrelm): " GH_REPO; GH_REPO="${GH_REPO:-nexrelm}"
read -r -p "  Visibility [public/private] (default: public): " VIS; VIS="${VIS:-public}"
PRIV=$([ "$VIS" = "private" ] && echo true || echo false)

# ── git identity (only if unset) ──────────────────────────────────────────────
git config user.name  >/dev/null 2>&1 || git config user.name  "$GH_LOGIN"
git config user.email >/dev/null 2>&1 || git config user.email "${GH_LOGIN}@users.noreply.github.com"

# ── create the repo (idempotent) ──────────────────────────────────────────────
RESP="$(mktemp)"
CODE="$(curl -s -o "$RESP" -w '%{http_code}' -X POST \
  -H "Authorization: token $GH_TOKEN" -H "Accept: application/vnd.github+json" \
  https://api.github.com/user/repos \
  -d "{\"name\":\"$GH_REPO\",\"private\":$PRIV,\"description\":\"Nexrelm — open-source network control plane (DNS · DHCP · Directory · Virtualization · Security).\"}")"
case "$CODE" in
  201) echo "  ${GR}✓${NC} created $GH_LOGIN/$GH_REPO ($VIS)";;
  422) echo "  ${YE}!${NC} $GH_LOGIN/$GH_REPO already exists — pushing to it";;
  401) rm -f "$RESP"; unset GH_TOKEN; die "token unauthorized (needs 'repo' scope)";;
  *)   echo "$(cat "$RESP")"; rm -f "$RESP"; unset GH_TOKEN; die "repo create failed (HTTP $CODE)";;
esac
rm -f "$RESP"

# ── remote + repo-local credentials ───────────────────────────────────────────
REMOTE="https://github.com/$GH_LOGIN/$GH_REPO.git"
git remote get-url origin >/dev/null 2>&1 && git remote set-url origin "$REMOTE" || git remote add origin "$REMOTE"
git branch -M main
git config --local credential.helper "store --file=$(pwd)/.git/.credentials"
printf 'protocol=https\nhost=github.com\nusername=%s\npassword=%s\n\n' "$GH_LOGIN" "$GH_TOKEN" | git credential approve
chmod 600 "$(pwd)/.git/.credentials" 2>/dev/null || true

# ── make sure everything is committed, then push ──────────────────────────────
git add -A
git diff --cached --quiet || git commit -q -m "chore: publish Nexrelm"
echo "  pushing…"
git push -u origin main

unset GH_TOKEN
echo ""
echo "${GR}${B}  ✓ Published → https://github.com/$GH_LOGIN/$GH_REPO${NC}"
echo "  CI runs on this push (.github/workflows/ci.yml)."
echo ""
