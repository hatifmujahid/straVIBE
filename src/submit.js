import { scanUsage } from "./scan.js";
import { loadCreds } from "./auth.js";
import { deviceId } from "./identity.js";

export { deviceId };

/**
 * Build the request body sent to your backend.
 *
 * >>> THIS IS THE SEAM AWAITING YOUR API SPEC <<<
 * Replace the field names / shape here to match the exact payload your backend
 * expects. It currently sends ONLY aggregate counts — no content, paths, or names.
 */
export function buildPayload(summary, { handle } = {}) {
  return {
    device_id: deviceId(),
    handle: handle || null, // optional display name for the leaderboard
    window_days: summary.days,
    since: summary.since,
    until: summary.until,
    totals: {
      input: summary.tokens.input,
      output: summary.tokens.output,
      cache_read: summary.tokens.cache_read,
      cache_write: summary.tokens.cache_write,
      total: summary.total,
    },
    calls: summary.calls,
    sessions: summary.sessions,
    agents: summary.agents_scanned,
    by_agent: summary.by_agent,
    by_model: summary.by_model,
    by_day: summary.by_day,
    client: { name: "stravibe", version: "0.1.0" },
  };
}

/**
 * Scan local history and submit it to the leaderboard backend.
 * @param {object} opts
 * @param {string} opts.api      backend endpoint (e.g. https://api.example.com/v1/import)
 * @param {string} [opts.handle] optional public display name
 * @param {number} [opts.days=90]
 * @param {boolean} [opts.dryRun] print the payload instead of sending
 */
export async function submit({ api, handle, days = 90, dryRun = false } = {}) {
  const summary = await scanUsage({ days });
  if (summary.error) throw new Error(summary.error);
  const payload = buildPayload(summary, { handle });

  const creds = loadCreds();
  if (dryRun || !api) {
    return { sent: false, payload, linked: creds?.user ?? null };
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
  return { sent: true, status: res.status, response: body, payload, linked: creds?.user ?? null };
}
