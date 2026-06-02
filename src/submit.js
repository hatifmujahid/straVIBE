import { loadCreds } from "./auth.js";
import { deviceId } from "./identity.js";
import { accumulate, saveStore } from "./store.js";
import { countEnvironment } from "./collectors/environment.js";
import { INGEST_URL } from "./config.js";

export { deviceId };

/**
 * Build the leaderboard request body from the persistent all-time store.
 *
 * >>> THIS IS THE SEAM AWAITING YOUR API SPEC <<<
 * Sends ONLY aggregate counts — no content, paths, or names. `mode:"cumulative"`
 * signals the totals are all-time (not a 90-day window), so the backend can keep
 * REPLACE semantics: this number only ever grows, and re-sending is safe.
 *
 * `environment` is a CURRENT inventory snapshot (skills/agents/MCP counts) for
 * THIS machine, not part of the cumulative store — it reflects the setup at
 * submit time. The backend stores one CLI row per machine (keyed by device) and
 * SUMS environment across the user's machines, so each PC contributes its own
 * counts. Counts only; no skill/agent/server names are sent.
 */
export function buildPayload(store, { handle, environment = countEnvironment() } = {}) {
  const c = store.cumulative;
  return {
    device_id: store.device_id || deviceId(),
    handle: handle || null, // optional display name for the leaderboard
    mode: "cumulative",
    since: store.first_synced,
    until: store.last_synced,
    totals: {
      input: c.tokens.input,
      output: c.tokens.output,
      cache_read: c.tokens.cache_read,
      cache_write: c.tokens.cache_write,
      total: c.total,
    },
    calls: c.calls,
    sessions: store.sessions?.length ?? 0,
    agents: Object.keys(c.by_agent),
    by_agent: c.by_agent,
    by_model: c.by_model,
    by_day: c.by_day,
    environment, // { skills, agents, mcp_servers } — this machine's setup, counts only
    client: { name: "stravibe", version: "0.2.0" },
  };
}

/**
 * Accumulate new local usage into the persistent store, then submit the
 * all-time totals to the leaderboard. The store is saved BEFORE the network
 * call, so local history is durable even if the submission fails; because we
 * always send the full cumulative snapshot (which the backend replaces), the
 * next successful sync self-heals any dropped submission.
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

  const { store, added } = await accumulate({ home });
  saveStore(store);

  const payload = buildPayload(store, { handle, environment: countEnvironment(home) });

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
  return { sent: true, status: res.status, response: body, payload, added, linked: creds?.user ?? null, store };
}

// Back-compat alias. `submit` used to send a 90-day window; it now accumulates
// into the persistent store and sends the all-time cumulative total (the score
// no longer drops old calls). `--days` only affects the read-only `scan` view.
export async function submit(opts = {}) {
  return sync(opts);
}
