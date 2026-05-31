import os from "node:os";
import { collectors, detectUnsupported } from "./collectors/index.js";
import { emptyAggregate, foldEvent } from "./aggregate.js";

/**
 * Collectors that should run for a scan, given agent filters and on-disk
 * presence. Shared by the windowed scan and the persistent store.
 */
export function activeCollectors({ agents, experimental = true, home = os.homedir() } = {}) {
  return collectors.filter(
    (c) => (!agents || agents.includes(c.name)) && (experimental || c.verified) && c.isPresent(home)
  );
}

/**
 * Stream normalized usage events from every active collector, with global
 * cross-collector dedupe. Does NO time filtering — callers decide the window:
 * the windowed scan applies a cutoff, the persistent store applies per-provider
 * watermarks. `meta`, if given, accumulates files_scanned / skipped_lines.
 *
 * Each event: { agent, ts(ms|NaN), model, dedupeKey, sessionId,
 *               input, output, cache_read, cache_write }
 *
 * PRIVACY: collectors extract ONLY token counts, model names, agent names, and
 * timestamps — never prompt/response content, file paths, or project names.
 */
export async function* scanEvents({ agents, experimental = true, home = os.homedir(), meta } = {}) {
  const seen = new Set(); // global dedupe across all collectors
  for (const c of activeCollectors({ agents, experimental, home })) {
    for await (const ev of c.events({ home, meta })) {
      if (ev.dedupeKey && seen.has(ev.dedupeKey)) continue;
      if (ev.dedupeKey) seen.add(ev.dedupeKey);
      yield ev;
    }
  }
}

/**
 * Scan local AI-agent transcripts for token usage over a rolling time window.
 * This is the read-only `scan` view; it does NOT persist anything. For the
 * cumulative all-time score, see src/store.js `accumulate`.
 *
 * @param {object} [opts]
 * @param {number} [opts.days=90]
 * @param {string[]} [opts.agents]   restrict to specific collector names
 * @param {boolean} [opts.experimental=true]  include unverified collectors (codex/gemini)
 * @param {string} [opts.home]       override home dir (testing)
 */
export async function scanUsage({ days = 90, agents, experimental = true, home = os.homedir() } = {}) {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;

  const summary = {
    days,
    since: new Date(cutoff).toISOString(),
    until: new Date().toISOString(),
    ...emptyAggregate(),
    sessions: 0,
    agents_scanned: [],
    agents_experimental: [],
    detected_unsupported: detectUnsupported(home),
    files_scanned: 0,
    skipped_lines: 0,
  };

  const active = activeCollectors({ agents, experimental, home });
  if (active.length === 0) {
    summary.error = "no supported AI-agent data found locally";
    return summary;
  }

  const experimentalNames = new Set(active.filter((c) => !c.verified).map((c) => c.name));
  const labels = Object.fromEntries(active.map((c) => [c.name, c.label]));
  const sessions = new Set();

  for await (const ev of scanEvents({ agents, experimental, home, meta: summary })) {
    if (!Number.isNaN(ev.ts) && ev.ts < cutoff) continue;
    foldEvent(summary, ev, labels[ev.agent]);
    if (ev.sessionId) sessions.add(`${ev.agent}:${ev.sessionId}`);
  }

  // Drop agents that were scanned but contributed nothing, so the payload only
  // lists agents actually used.
  for (const [name, a] of Object.entries(summary.by_agent)) {
    if (a.calls === 0) delete summary.by_agent[name];
  }
  const contributors = Object.keys(summary.by_agent);
  summary.agents_scanned = contributors;
  summary.agents_experimental = contributors.filter((n) => experimentalNames.has(n));

  summary.sessions = sessions.size;
  summary.total = summary.tokens.input + summary.tokens.output;
  return summary;
}
