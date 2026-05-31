#!/usr/bin/env sh
# One-line install for testers:
#   curl -fsSL https://raw.githubusercontent.com/hatifmujahid/strava-for-ai/master/install.sh | sh
#
# Folds your local Claude Code usage into an all-time score, submits it to the
# leaderboard, and installs a SessionEnd hook so every future session auto-syncs.
# Requires Node 18+.
set -e

REPO="${STRAVIBE_REPO:-hatifmujahid/strava-for-ai}"                  # GitHub owner/repo
API_URL="${STRAVIBE_API:-https://randi-unparticularized-carri.ngrok-free.dev/v1/import}"  # <-- your tunnel/ingest URL
HANDLE="${STRAVIBE_HANDLE:-$(whoami)}"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 18+ is required: https://nodejs.org" >&2
  exit 1
fi

echo "Scanning your local Claude Code usage as '${HANDLE}' and building your all-time score..."
echo "Only token counts, model names, and timestamps are sent — no prompts, code, or project names."

STRAVIBE_API="$API_URL" npx -y "github:$REPO" sync --handle "$HANDLE" --api "$API_URL"

echo "Enabling auto-sync (runs after every Claude Code session)..."
STRAVIBE_API="$API_URL" npx -y "github:$REPO" install-hook --handle "$HANDLE" --api "$API_URL" || \
  echo "(could not install the auto-sync hook — run \`npx -y github:$REPO install-hook --api $API_URL\` manually)"
