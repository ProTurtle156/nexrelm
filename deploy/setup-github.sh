#!/usr/bin/env bash
#
# Nexrelm — GitHub version control + CI setup. Interactive: it asks for your
# GitHub username and a Personal Access Token (or sets up SSH), wires the remote
# + a local credential helper, makes sure the CI workflow is present, and stages
# an initial commit. It deliberately does NOT push — publish when you're ready:
#     git push -u origin main
#
# Your token is read hidden and stored ONLY in git's local credential store
# (~/.git-credentials, git-ignored) — never printed, never committed.
#
# Usage:  bash deploy/setup-github.sh
set -euo pipefail

if [ -t 1 ]; then B=$'\e[1m'; CY=$'\e[36m'; GR=$'\e[32m'; YE=$'\e[33m'; RD=$'\e[31m'; NC=$'\e[0m'; else B=; CY=; GR=; YE=; RD=; NC=; fi
say() { echo "$*"; }
die() { echo "${RD}error: $*${NC}" >&2; exit 1; }

cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
command -v git >/dev/null 2>&1 || die "git is not installed"

echo ""
echo "${B}${CY}  Nexrelm — GitHub setup${NC}"
echo "  ${YE}Nothing is pushed. We publish together when you're ready.${NC}"
echo ""

# ── repo ──────────────────────────────────────────────────────────────────────
[ -d .git ] || { git init -q; say "${GR}✓${NC} initialised a new git repository"; }
git symbolic-ref -q HEAD >/dev/null || true

# ── identity (only if unset) ──────────────────────────────────────────────────
if ! git config user.name >/dev/null 2>&1; then
  read -r -p "  Your name (for commits): " GIT_NAME; git config user.name "$GIT_NAME"
fi
if ! git config user.email >/dev/null 2>&1; then
  read -r -p "  Your email (for commits): " GIT_EMAIL; git config user.email "$GIT_EMAIL"
fi

# ── auth method ───────────────────────────────────────────────────────────────
echo ""
echo "  Authentication:"
echo "    ${B}1) HTTPS + token${NC} (Personal Access Token — easiest)"
echo "    ${B}2) SSH${NC} (you already have an SSH key on GitHub)"
read -r -p "  Choose [1/2] (default 1): " METHOD
METHOD="${METHOD:-1}"

read -r -p "  GitHub username/org: " GH_USER
[ -n "$GH_USER" ] || die "username is required"
read -r -p "  Repository name (default: nexrelm): " GH_REPO
GH_REPO="${GH_REPO:-nexrelm}"

if [ "$METHOD" = "2" ]; then
  REMOTE="git@github.com:${GH_USER}/${GH_REPO}.git"
else
  REMOTE="https://github.com/${GH_USER}/${GH_REPO}.git"
  # token, hidden
  read -r -s -p "  GitHub Personal Access Token (repo scope, hidden): " GH_TOKEN; echo
  [ -n "$GH_TOKEN" ] || die "token is required for HTTPS"
  # repo-scoped credential store (NOT --global — don't touch the user's other repos)
  git config --local credential.helper "store --file=$(pwd)/.git/.credentials"
  { printf 'protocol=https\nhost=github.com\nusername=%s\npassword=%s\n\n' "$GH_USER" "$GH_TOKEN"; } | git credential approve
  chmod 600 "$(pwd)/.git/.credentials" 2>/dev/null || true
  unset GH_TOKEN
  say "${GR}✓${NC} token stored repo-locally in .git/.credentials (never committed)"
fi

# ── remote ────────────────────────────────────────────────────────────────────
if git remote get-url origin >/dev/null 2>&1; then
  git remote set-url origin "$REMOTE"
else
  git remote add origin "$REMOTE"
fi
say "${GR}✓${NC} remote 'origin' → $REMOTE"

# ── branch ────────────────────────────────────────────────────────────────────
CURRENT="$(git branch --show-current 2>/dev/null || echo '')"
if [ "$CURRENT" != "main" ]; then
  git branch -M main 2>/dev/null || true
  say "${GR}✓${NC} default branch → main"
fi

# ── CI present? ───────────────────────────────────────────────────────────────
[ -f .github/workflows/ci.yml ] && say "${GR}✓${NC} CI workflow present (.github/workflows/ci.yml)" || say "${YE}!${NC} no CI workflow found (expected .github/workflows/ci.yml)"

# ── stage an initial commit (local only) ──────────────────────────────────────
git add -A
if git diff --cached --quiet; then
  say "  nothing to commit (working tree already committed)"
else
  git commit -q -m "chore: prepare Nexrelm for open-source release" || true
  say "${GR}✓${NC} committed locally"
fi

echo ""
echo "${GR}${B}  Ready.${NC} When we decide to publish:"
echo "    ${CY}git push -u origin main${NC}"
echo "  (create the empty repo on GitHub first, or use 'gh repo create')."
echo ""
