# ai-usage-tracker

Scan your local AI **coding-agent** token usage (last N days) and submit aggregate
counts to a leaderboard backend, optionally linked to your GitHub/Google account.

## Agent support

| Agent | Source | Status |
|---|---|---|
| **Claude Code** | `~/.claude/projects/**/*.jsonl` | ✅ verified |
| **Codex CLI** | `~/.codex/sessions/**/*.jsonl` | ⚠️ experimental (fails safe until verified) |
| **Gemini CLI** | `~/.gemini/**` | ⚠️ experimental (fails safe until verified) |
| **Cursor / Copilot / Windsurf** | server-side | ❌ no local token data — needs vendor OAuth/usage API |

Experimental collectors contribute **nothing** rather than guessing if they don't
recognize the token shape. Verify them on a machine that has the agent, then flip
`verified: true` in `src/collectors/<agent>.js`.

## Privacy

Only **token counts, model names, agent names, and timestamps** leave the machine.
Prompts, responses, file paths, and project/folder names are never read into the
payload. See `src/collectors/*.js` — only numeric/metadata fields are touched.

## Use

```sh
npx aiusage scan --days 90                       # local only, no network
npx aiusage login --api https://api.example.com --with github   # link account (browser)
npx aiusage submit --days 90 --dry-run           # preview the exact payload
npx aiusage submit --days 90 --api https://api.example.com/v1/import
npx aiusage whoami | npx aiusage logout
```

Run on any PC straight from GitHub (no clone/install):

```sh
npx -y github:hatifmujahid/strava-for-ai submit --days 90 --handle "your-name" --api https://your-backend/v1/import
```

Or one-line curl install:

```sh
curl -fsSL https://raw.githubusercontent.com/hatifmujahid/strava-for-ai/master/install.sh | sh
```

## Identity / account linking

Device-authorization flow (like `gh auth login`). **The backend owns the GitHub/Google
OAuth** — the CLI never holds client secrets. If the user hasn't linked, submissions
fall back to an anonymous, stable `device_id` (a salted machine hash, no PII), which
the backend can later merge into a linked account.

## Two seams awaiting your backend dev's spec

1. **Ingest** — `src/submit.js` → `buildPayload()` + the POST URL. Reshape to match
   your API; `Authorization: Bearer <token>` is attached automatically when linked.
2. **Auth** — `src/auth.js`. Provisional contract:
   - `POST {api}/auth/cli/start { device_id, provider } -> { user_code, verification_url, device_code, interval }`
   - `POST {api}/auth/cli/poll  { device_code } -> 202 pending | 200 { token, user }`

## Leaderboard metric note

Claude Code is cache-heavy: ~2.1M input+output here vs ~237M **cache-read** over 90
days. Decide which number ranks the board (in+out, or weighted incl. cache) before
wiring the UI — it shifts standings ~100×.
