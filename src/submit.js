import fs from "node:fs";
import { loadCreds } from "./auth.js";
import { deviceId } from "./identity.js";
import { accumulate, saveStore } from "./store.js";
import { currentMonthKey } from "./scan.js";
import { countEnvironment } from "./collectors/environment.js";
import { INGEST_URL } from "./config.js";

export { deviceId };

// Report the real installed version in the payload's `client` field, read once
// from package.json (same approach as src/hook.js). Falls back to "unknown" so a
// missing/unreadable manifest never breaks a sync.
function clientVersion() {
  try {
    return JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8")).version || "unknown";
  } catch {
    return "unknown";
  }
}
const CLIENT_VERSION = clientVersion();

/**
 * Build the leaderboard request body from a canonical usage aggregate
 * ({ tokens, total, calls, by_model, by_agent, by_day }) — typically the
 * CURRENT-MONTH window from `accumulate().month`, so totals, breakdowns, and
 * by_day all cover the same period and the backend's consistency check
 * reconciles.
 *
 * Sends ONLY aggregate counts — no content, paths, or names. `mode:"cumulative"`
 * keeps the backend's REPLACE semantics (the whole row is replaced, not added),
 * and `period` (YYYY-MM) tells it which month this snapshot covers — within a
 * month the score only grows, and a newer month replaces the row (the monthly
 * reset).
 *
 * `environment` is a CURRENT inventory snapshot (skills/agents/MCP counts) for
 * THIS machine, not part of the aggregate — it reflects the setup at submit
 * time. The backend stores one CLI row per machine (keyed by device) and SUMS
 * environment across the user's machines. Counts only; no names are sent.
 */
export function buildPayload(
  aggregate,
  { period, since, until, sessions, deviceId: deviceIdOverride, handle, environment = countEnvironment() } = {}
) {
  const t = aggregate.tokens;
  return {
    device_id: deviceIdOverride || deviceId(),
    handle: handle || null, // optional display name for the leaderboard
    mode: "cumulative",
    period: period || currentMonthKey(),
    since: since ?? null,
    until: until ?? null,
    totals: {
      input: t.input,
      output: t.output,
      cache_read: t.cache_read,
      cache_write: t.cache_write,
      total: aggregate.total,
    },
    calls: aggregate.calls,
    sessions: sessions ?? 0,
    agents: Object.keys(aggregate.by_agent),
    by_agent: aggregate.by_agent,
    by_model: aggregate.by_model,
    by_day: aggregate.by_day,
    environment, // { skills, agents, mcp_servers } — this machine's setup, counts only
    client: { name: "stravibe", version: CLIENT_VERSION },
  };
}

/**
 * Accumulate new local usage into the persistent store, then submit the
 * CURRENT-MONTH window to the leaderboard. The store is saved BEFORE the network
 * call, so local history is durable even if the submission fails; because we
 * always send the full month snapshot (which the backend replaces), the next
 * successful sync self-heals any dropped submission.
 *
 * The submission target is the hardcoded INGEST_URL — there is no --api/env
 * override, so installs always report to the one official backend.
 *
 * Linked-only: submitting requires a credential from `stravibe login`. The
 * backend rejects tokenless requests (no anonymous entries), so an unlinked
 * sync throws NOT_LINKED before scanning or making any network call.
 *
 * @param {object} opts
 * @param {string} [opts.handle]  optional public display name
 * @param {string} [opts.home]    override home dir (testing)
 */
export async function sync({ handle, home } = {}) {
  const creds = loadCreds();
  if (!creds?.token) {
    const err = new Error("not linked — run `stravibe login` to link your GitHub/email account first");
    err.code = "NOT_LINKED";
    throw err;
  }

  const { store, added, month } = await accumulate({ home });
  saveStore(store);

  const payload = buildPayload(month, {
    period: month.period,
    since: month.since,
    until: month.until,
    sessions: month.sessions,
    deviceId: store.device_id,
    handle,
    environment: countEnvironment(home),
  });

  const headers = { "content-type": "application/json", authorization: `Bearer ${creds.token}` };

  const res = await fetch(INGEST_URL, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`backend ${res.status}: ${text.slice(0, 300)}`);
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { sent: true, status: res.status, response: body, payload, added, linked: creds?.user ?? null, store, month };
}

// Back-compat alias. `submit` used to send a 90-day window; it now accumulates
// into the persistent store and submits the CURRENT-MONTH window to the
// leaderboard. `--days` only affects the read-only `scan` view.
export async function submit(opts = {}) {
  return sync(opts);
}
