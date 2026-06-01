# straVIBE

[![CI](https://github.com/hatifmujahid/straVIBE/actions/workflows/ci.yml/badge.svg)](https://github.com/hatifmujahid/straVIBE/actions/workflows/ci.yml)

Scan your local AI **coding-agent** token usage and submit aggregate counts to a
leaderboard backend, optionally linked to your GitHub/Google account.

Your score is **cumulative and all-time**: a small ledger at `~/.stravibe/usage.json`
remembers what's already been counted (a per-provider timestamp watermark), so every
new LLM call keeps adding to your total — even after the agent's transcripts age past
90 days or get deleted. Install the Claude Code hook and it syncs itself.

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
npx stravibe scan --days 90        # local rolling-window view, no network
npx stravibe login --with github   # link your GitHub/Google account + enable auto-sync
npx stravibe sync                  # fold new calls into your all-time score + submit
npx stravibe install-hook          # auto-sync on each Claude Code session end
npx stravibe whoami | npx stravibe uninstall-hook | npx stravibe reset --yes
```

`submit` is a back-compat alias of `sync`; `--days` only affects the read-only
`scan` view — the submitted score is always the all-time cumulative total.

### How the cumulative score works

1. `sync` scans all local transcripts and folds every event **newer than the stored
   per-provider watermark** (`claude-code` / `codex-cli` / `gemini-cli`) into
   `~/.stravibe/usage.json`, then advances the watermark. Re-runs add nothing — it's
   idempotent, so calls are never double-counted.
2. It submits the full **all-time** total. The backend uses replace-semantics, which is
   safe because the number only grows; a dropped submission self-heals on the next sync.
3. `install-hook` (also auto-offered after `login`) adds a Claude Code **SessionEnd**
   hook that runs `stravibe sync --quiet`, so usage syncs automatically — a failed
   background sync exits quietly and never disrupts your session.

Install globally from npm (one-liner — no API URL needed, it's baked in):

```sh
npm i -g stravibe && stravibe sync --handle "your-name"
```

Then enable auto-sync once: `stravibe install-hook`.

Or run ad-hoc with no install — `npx` fetches the published package on demand:

```sh
npx -y stravibe sync --handle "your-name"
```

## Leaderboard metric note

Claude Code is cache-heavy: ~2.2M input+output vs ~244M **cache-read** in this 90-day
sample. Decide which number ranks the board (in+out, or weighted incl. cache) before
wiring the UI — it shifts standings ~100×. The store keeps all four counts
(`input` / `output` / `cache_read` / `cache_write`) so you can change the metric later
without re-scanning.
