import { loadCreds } from "./auth.js";
import { deviceId } from "./identity.js";
import { accumulate, saveStore } from "./store.js";

export { deviceId };

/**
 * Build the leaderboard request body from the persistent all-time store.
 *
 * >>> THIS IS THE SEAM AWAITING YOUR API SPEC <<<
 * Sends ONLY aggregate counts — no content, paths, or names. `mode:"cumulative"`
 * signals the totals are all-time (not a 90-day window), so the backend can keep
 * REPLACE semantics: this number only ever grows, and re-sending is safe.
 */
export function buildPayload(store, { handle } = {}) {
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
    client: { name: "stravibe", version: "0.1.0" },
  };
}

/**
 * Accumulate new local usage into the persistent store, then submit the
 * all-time totals to the leaderboard. The store is saved BEFORE the network
 * call, so local history is durable even if the submission fails; because we
 * always send the full cumulative snapshot (which the backend replaces), the
 * next successful sync self-heals any dropped submission.
 *
 * @param {object} opts
 * @param {string} [opts.api]     ingest endpoint; falls back to the linked
 *                                account's saved api (so the hook works with no env)
 * @param {string} [opts.handle]  optional public display name
 * @param {boolean} [opts.dryRun] build + persist locally, but don't send
 * @param {string} [opts.home]    override home dir (testing)
 */
export async function sync({ api, handle, dryRun = false, home } = {}) {
  const creds = loadCreds();
  api = api || creds?.api || null; // a SessionEnd hook runs without env vars

  const { store, added } = await accumulate({ home });
  saveStore(store);

  const payload = buildPayload(store, { handle });

  if (dryRun || !api) {
    return { sent: false, payload, added, linked: creds?.user ?? null, store };
  }

  const headers = { "content-type": "application/json" };
  if (creds?.token) headers.authorization = `Bearer ${creds.token}`; // attaches to GitHub/Google identity

  const res = await fetch(api, {
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
