#!/usr/bin/env sh
# Two ways to install (both use the published npm package; require Node 18+):
#   curl:  curl -fsSL https://raw.githubusercontent.com/hatifmujahid/strava-for-ai/master/install.sh | sh
#   npm:   npm i -g stravibe && stravibe sync
#
# Folds your local Claude Code usage into an all-time score, submits it to the
# leaderboard, and installs a SessionEnd hook so every future session auto-syncs.
# The backend URL is hardcoded in the package; override with STRAVIBE_API if needed.
set -e

PKG="${STRAVIBE_PKG:-stravibe}"                 # npm package name
HANDLE="${STRAVIBE_HANDLE:-$(whoami)}"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 18+ is required: https://nodejs.org" >&2
  exit 1
fi

echo "Scanning your local Claude Code usage as '${HANDLE}' and building your all-time score..."
echo "Only token counts, model names, and timestamps are sent — no prompts, code, or project names."

npx -y "$PKG" sync --handle "$HANDLE"

echo "Enabling auto-sync (runs after every Claude Code session)..."
npx -y "$PKG" install-hook --handle "$HANDLE" || \
  echo "(could not install the auto-sync hook — run \`npx -y $PKG install-hook\` manually)"
