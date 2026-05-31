#!/usr/bin/env sh
# One-line install for testers:
#   curl -fsSL https://raw.githubusercontent.com/hatifmujahid/strava-for-ai/master/install.sh | sh
#
# Reads the last 90 days of local Claude Code usage and submits aggregate token
# counts to the leaderboard backend. Requires Node 18+.
set -e

REPO="${STRAVIBE_REPO:-hatifmujahid/strava-for-ai}"                  # GitHub owner/repo
API_URL="${STRAVIBE_API:-https://randi-unparticularized-carri.ngrok-free.dev/v1/import}"  # <-- your tunnel/ingest URL
DAYS="${STRAVIBE_DAYS:-90}"
HANDLE="${STRAVIBE_HANDLE:-$(whoami)}"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 18+ is required: https://nodejs.org" >&2
  exit 1
fi

echo "Scanning your last ${DAYS} days of Claude Code usage as '${HANDLE}'..."
echo "Only token counts, model names, and timestamps are sent — no prompts, code, or project names."

STRAVIBE_API="$API_URL" npx -y "github:$REPO" submit --days "$DAYS" --handle "$HANDLE" --api "$API_URL"
