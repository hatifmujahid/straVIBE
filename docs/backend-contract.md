# straVIBE backend contract

This is the API the **CLI already speaks**. Implement these endpoints on the
backend (currently `http://localhost:3000`, set in `src/config.js`) and the
published CLI works unchanged. The CLI handles **no** provider logic itself — it
opens a browser to a page you host, and that page is where the user chooses
**GitHub or Email**.

Two hard rules that come straight from the CLI's behavior:
- **Linked-only.** Submitting usage requires a logged-in account. There are **no
  anonymous entries** — `/v1/import` must reject any tokenless request with `401`.
- **Self-reported data.** Every number arrives from a user-controlled machine and
  cannot be cryptographically trusted. Treat the client as untrusted and lean on
  §7 (Abuse mitigation) for integrity.

> Source of truth on the CLI side: `src/auth.js` (login flow), `src/submit.js`
> (ingest), `src/config.js` (base URL + paths). Don't change endpoint paths or
> field names without updating those files.

---

## 1. The flow (OAuth 2.0 Device Authorization, RFC 8628 style)

```
CLI                         Backend                         Browser (user)
 │  POST /auth/cli/start  ─▶ │                                     │
 │  ◀─ device_code,          │                                     │
 │     verification_url,     │                                     │
 │     user_code, interval   │                                     │
 │                           │                                     │
 │  opens verification_url ───────────────────────────────────▶   │
 │                           │   GET verification_url   ◀──────────│
 │                           │   render "Sign in with GitHub / Email"
 │                           │                                     │
 │                           │   ◀── user picks GitHub or Email ───│
 │                           │   run that provider's OAuth/magic-link
 │                           │   on success: mark device_code authorized,
 │                           │   mint an API token bound to the user
 │                           │                                     │
 │  POST /auth/cli/poll  ──▶ │                                     │
 │  (every `interval` s)     │                                     │
 │  ◀─ 202 while pending     │                                     │
 │  ◀─ 200 { token, user }   │  once authorized                    │
 │                           │                                     │
 │  POST /v1/import (Bearer token)                                 │
 │  ◀─ 200                   │  store totals against the user      │
```

The CLI polls for up to **5 minutes**, then gives up with
`login timed out — please re-run \`stravibe login\``.

---

## 2. Endpoints

### 2.1 `POST /auth/cli/start`

Begin a device-authorization session.

**Request body (JSON):**
```json
{ "device_id": "d_3f9a…", "provider": null }
```
- `device_id` — stable anonymous machine id from the CLI (`src/identity.js`). Not
  secret; use it only to associate this login with the device that started it.
- `provider` — usually `null`. May be `"github"` or `"email"` as an **optional
  hint**, but the CLI no longer prompts, so the web page is the source of truth.

**Response (200, JSON):**
```json
{
  "device_code": "long-opaque-secret",
  "verification_url": "http://localhost:3000/auth/device?code=ABCD-1234",
  "user_code": "ABCD-1234",
  "interval": 3
}
```
- `device_code` — **secret**, server-generated, single-use, ~10 min TTL. The CLI
  echoes this back on every poll; it's how you find the session.
- `verification_url` — the page the CLI opens in the browser. Encode everything the
  user needs (incl. the code) in the URL so they don't have to type anything.
- `user_code` — *optional* short human-readable code shown in the terminal ("enter
  this if asked"). Omit if `verification_url` already carries the code.
- `interval` — *optional*, seconds between polls. Defaults to `3` if omitted.

### 2.2 `POST /auth/cli/poll`

Poll for completion.

**Request body (JSON):**
```json
{ "device_code": "long-opaque-secret" }
```

**Responses — status code is significant (the CLI branches on it):**

| Status | Meaning | Body |
|---|---|---|
| **202** | Still pending — user hasn't finished in the browser | (ignored) |
| **200** | Authorized | `{ "token": "…", "user": { … } }` |
| **4xx / 5xx** | Error — CLI aborts with `auth poll failed: <status>` | (ignored) |

> ⚠️ Pending **must** be `202`, not `200`. The CLI treats any `200` as success and
> stops polling. Expired/denied device codes should return a 4xx (e.g. `410`/`400`).

**`token`** — bearer credential the CLI stores in `~/.stravibe/credentials.json`
(plaintext, mode 600) and sends on every `/v1/import`. Use an opaque random token
or a JWT; bind it to the `user` and (recommended) the `device_id`. See §7.4 for
lifetime/revocation guidance.

**`user`** — identity object. The CLI reads these fields (populate at least one of
`login`/`email`, plus a stable `id`):
```json
{
  "id": "usr_123",
  "provider": "github",        // or "email"
  "login": "octocat",          // GitHub username (GitHub logins)
  "email": "user@example.com", // email (email logins; optional for GitHub)
  "name": "Ada Lovelace"        // optional display name
}
```
The CLI shows `user.login || user.email || user.id`.

### 2.3 `GET /auth/device?code=…` (the verification page — you design this)

A web page (served from the same origin) that:
1. Reads the code from the URL, looks up the pending `device_code` session.
2. Renders **two buttons: "Continue with GitHub" and "Continue with Email."**
3. Runs the chosen provider's auth (see §3), then **marks that device session
   authorized** and associates it with the resolved user + a minted token.
4. Shows a "You're signed in — return to your terminal" confirmation.

This is the only place GitHub-vs-email is decided. The CLI never sees it.

### 2.4 `POST /v1/import` (usage ingest)

Already wired in `src/submit.js`. Accepts the aggregate payload and stores it.

**Authentication is REQUIRED — no anonymous entries.** Only signed-up, linked
users may submit. The CLI always sends a Bearer token here (it refuses to call
this endpoint when not logged in), and the backend **must reject any request
without a valid token with `401`**. Do not create or update usage rows keyed by
`device_id` alone — every usage row belongs to an authenticated user.

**Headers:** `content-type: application/json` and **`authorization: Bearer <token>`**
(always present; reject with `401` if missing/invalid/expired/revoked).

**Request body** (exact shape the CLI sends — privacy-reviewed, counts only):
```json
{
  "device_id": "d_3f9a…",
  "handle": "optional-display-name-or-null",
  "mode": "cumulative",
  "since": "2026-03-01T…Z",
  "until": "2026-06-01T…Z",
  "totals": { "input": 0, "output": 0, "cache_read": 0, "cache_write": 0, "total": 0 },
  "calls": 0,
  "sessions": 0,
  "agents": ["claude-code"],
  "by_agent": { "claude-code": { "label": "Claude Code", "input": 0, "output": 0, "cache_read": 0, "cache_write": 0, "calls": 0 } },
  "by_model": { "claude-opus-4-8": { "input": 0, "output": 0, "…": 0 } },
  "by_day": { "2026-06-01": { "input": 0, "…": 0 } },
  "environment": { "skills": 0, "agents": 0, "mcp_servers": 0 },
  "client": { "name": "stravibe", "version": "0.1.0" }
}
```

**Semantics — important:**
- `mode: "cumulative"` means `totals` is the user's **all-time** count, not a
  delta. Use **replace semantics**: store the new totals over the old. This is
  safe because the number only ever grows, and a dropped request self-heals on the
  next sync.
- Key the usage record by the **authenticated user** resolved from the Bearer
  token — never by `device_id`. (`device_id` is still in the payload; use it only
  as secondary metadata, e.g. to note which machines a user submits from.)
- Respond **2xx** on success (the CLI requires `res.ok`); `401` for missing/invalid
  token; any other non-2xx makes the CLI throw `backend <status>: <body>`. Return
  JSON (it's pretty-printed to the user) or plain text.
- Apply the §7 validation **before** persisting (reject or clamp implausible
  values; never let a bad submission overwrite a good stored total).
- `environment` is a **current** snapshot of the user's Claude Code setup —
  counts of installed skills, agents (subagents), and configured MCP servers.
  Unlike `totals`, it is **not** cumulative: it reflects the setup at submit time
  and may go up or down between syncs, so use replace semantics for it too.
  **Counts only by design** — the CLI never sends skill/agent/server names
  (privacy guarantee), so treat these purely as untrusted self-reported metrics.

---

## 3. Provider auth (the part you're adding)

Both providers converge on the same outcome: a resolved `user` object + an
authorized `device_code` + a minted `token`.

### 3.1 GitHub
- Standard GitHub OAuth web flow: redirect to
  `https://github.com/login/oauth/authorize?client_id=…&scope=read:user%20user:email&state=…`.
- On callback, exchange `code` → access token, then `GET https://api.github.com/user`
  (and `/user/emails` if you need a verified email).
- Map to `user`: `{ id, provider:"github", login, email?, name? }`.
- Use `state` to carry/verify the pending `device_code` session.

### 3.2 Email (no CLI involvement — all on the web page)
Pick one (magic link is simplest UX):
- **Magic link:** user enters email → you email a signed, single-use, short-TTL
  link back to your origin → clicking it verifies the email and authorizes the
  device session. Map to `user`: `{ id, provider:"email", email, name? }`.
- **OTP code:** email a 6-digit code, user types it on the page. Same outcome.

Either way: verify ownership of the email **before** authorizing the device
session and minting the token.

---

## 4. Security checklist
- **Linked-only ingest:** `/v1/import` must `401` without a valid Bearer token.
  No usage row is ever created or updated for an unauthenticated/anonymous caller.
- `device_code` and `token` are secrets: opaque, high-entropy, single-use
  (device_code) / revocable (token).
- Expire pending device sessions (~10 min) and rate-limit `/auth/cli/poll`.
- Bind the minted `token` to the `user` and (recommended) the `device_id` that
  started the flow.
- CORS: the device page is same-origin, so the browser flow needs no special
  CORS; the CLI calls are server-to-server (no browser), so no CORS needed there.
- Validate/limit the `/v1/import` payload size; never trust client numbers for
  anything but display ranking (they're self-reported).

---

## 5. Minimal data model (suggestion)
```
users            (id, provider, github_login, email, name, created_at)
device_sessions  (device_code PK, user_code, device_id, status[pending|authorized|expired],
                  user_id?, expires_at)
api_tokens       (token PK/hash, user_id, device_id?, created_at, expires_at?, revoked_at?)
usage            (user_id PK, input, output, cache_read, cache_write, total,
                  calls, sessions, by_agent JSON, by_model JSON, by_day JSON,
                  env_skills, env_agents, env_mcp_servers,   -- current-setup counts
                  since, until, updated_at)   -- one row per USER, replaced each import
                                              -- (no anonymous/device-keyed rows)
audit_submissions(id, user_id, device_id, prev_total, new_total, delta, ip,
                  client_version, accepted[bool], reason, created_at)  -- for §7
```

---

## 6. Endpoint summary
| Method | Path | Purpose |
|---|---|---|
| POST | `/auth/cli/start` | begin device auth → `{ device_code, verification_url, user_code?, interval? }` |
| GET  | `/auth/device?code=` | browser page: choose GitHub/Email, run auth, authorize session |
| POST | `/auth/cli/poll` | `202` pending / `200 { token, user }` |
| POST | `/v1/import` | store all-time usage totals — **Bearer-auth required, 401 if missing** (no anonymous) |

GitHub OAuth callback + the email magic-link/OTP verify endpoints are internal to
the web flow — name them however you like; the CLI never calls them.

---

## 7. Abuse mitigation

The client is untrusted: the numbers are self-reported and the published package
is readable, so a motivated user can submit fabricated totals (call the endpoint
directly with their own valid token, edit the open package, forge `.claude`
transcript files, or edit the local `~/.stravibe/usage.json`). You **cannot**
prove a request came from a genuine, unmodified package — so don't try to. Instead
constrain and validate **server-side**. The goal is an honest-majority leaderboard,
not a tamper-proof one.

### 7.1 Authentication & rate limiting (table stakes)
- `/v1/import` requires a valid Bearer token (§2.4) — already enforced by the CLI.
- Per-user rate limit on `/v1/import` (e.g. a handful of submissions per minute; an
  honest client syncs at most once per session end). Return `429` on exceed.
- Per-IP rate limit + small global cap on the **auth** endpoints, especially
  `/auth/cli/poll` and the email magic-link/OTP request (prevent code-guessing and
  email-bombing). Add a short lockout after repeated failures.
- Bound `/v1/import` payload size; reject oversized or malformed bodies with `400`.

### 7.2 Plausibility bounds (the real anti-cheat lever)
Reject or clamp submissions that aren't physically achievable. Tune the constants
to real data, but enforce *something*:
- **Per-day ceiling.** A human + agent can only burn so many tokens/day. Cap
  `by_day[date].total` (e.g. tens of millions incl. cache; far less for in+out).
  Reject or clamp days above the ceiling.
- **Monotonic + bounded growth.** `totals.total` must be `>=` the stored value
  (it's cumulative). Reject decreases. Cap the **delta** since the last accepted
  submission against `(elapsed_time × per-day-ceiling)` — a sudden +500M jump after
  an hour is impossible.
- **Internal consistency.** `totals.total == input + output` (the ranking metric);
  per-agent / per-model / per-day sums should reconcile with `totals` within a
  tolerance. Reject wildly inconsistent payloads.
- **Window sanity.** `since <= until`, both not in the future, span not absurd
  (Claude Code keeps ~90 days locally — a first sync claiming years of data is
  suspect).
- **Calls vs tokens.** `tokens / calls` must fall in a sane range (no 1 call with
  100M tokens; no 10M calls in a day).

Prefer **clamp-and-flag** over hard-reject for borderline values (keeps honest
heavy users on the board), and **hard-reject + flag** for the impossible.

### 7.3 Anomaly detection & audit
- Write an `audit_submissions` row (§5) for every import: prev/new totals, delta,
  IP, `client.version`, accept/reject + reason. This is what lets you investigate
  and roll back later.
- Flag outliers for review: top-N sudden risers, users far above the population
  distribution, many distinct `device_id`s under one user, or one `device_id`
  submitting for many users (token sharing).
- Keep the ability to **recompute the leaderboard from the audit log** so a
  discovered cheat can be reversed without data loss.

### 7.4 Token hygiene
- Mint per-user, revocable tokens; store only a hash. Support revocation so a
  leaked/abused token can be killed (the user just re-runs `stravibe login`).
- Consider a moderate TTL with silent re-auth, or at least rotation on suspicion.
- Bind the token to the `user` and `device_id`; alert when one token is used from
  many IPs/devices at once.

### 7.5 Soft client signal (weak — telemetry only, not security)
The CLI sends `client: { name, version }` and you can require a
`User-Agent: stravibe/<version>` header. Use these to block *casual* scripted
abuse and to spot stale/forked clients — but **never** treat them as proof of
authenticity; both are trivially spoofable. They are a speed bump, not a gate.

### 7.6 Enforcement (policy, not code)
The proprietary `LICENSE` and your service terms prohibit submitting fabricated or
tampered data and accessing the service via a modified package. That gives you
grounds to **suspend or ban** offending accounts and zero out their scores when
§7.3 surfaces abuse — the legal/policy backstop behind the technical limits above.
