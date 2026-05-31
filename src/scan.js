import os from "node:os";
import { collectors, detectUnsupported } from "./collectors/index.js";

/**
 * Scan local AI-agent transcripts for token usage over a time window.
 *
 * PRIVACY: extracts ONLY token counts, model names, agent names, and timestamps.
 * Never reads prompt/response content, file paths, or project names into output.
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
    tokens: { input: 0, output: 0, cache_read: 0, cache_write: 0 },
    total: 0,
    calls: 0,
    by_model: {},
    by_agent: {},
    by_day: {},
    sessions: 0,
    agents_scanned: [],
    agents_experimental: [],
    detected_unsupported: detectUnsupported(home),
    files_scanned: 0,
    skipped_lines: 0,
  };

  const active = collectors.filter(
    (c) => (!agents || agents.includes(c.name)) && (experimental || c.verified) && c.isPresent(home)
  );

  if (active.length === 0) {
    summary.error = "no supported AI-agent data found locally";
    return summary;
  }

  const seen = new Set(); // global dedupe across all collectors
  const sessions = new Set();

  for (const c of active) {
    summary.agents_scanned.push(c.name);
    if (!c.verified) summary.agents_experimental.push(c.name);

    const a = (summary.by_agent[c.name] ??= agentBucket(c.label));

    for await (const ev of c.events({ home, meta: summary })) {
      if (!Number.isNaN(ev.ts) && ev.ts < cutoff) continue;
      if (ev.dedupeKey && seen.has(ev.dedupeKey)) continue;
      if (ev.dedupeKey) seen.add(ev.dedupeKey);

      addTokens(summary.tokens, ev);
      summary.calls++;
      addTokens(a, ev);
      a.calls++;

      const m = (summary.by_model[ev.model] ??= bucket());
      addTokens(m, ev);
      m.calls++;

      if (!Number.isNaN(ev.ts)) {
        const day = new Date(ev.ts).toISOString().slice(0, 10);
        const d = (summary.by_day[day] ??= { input: 0, output: 0, total: 0 });
        d.input += ev.input;
        d.output += ev.output;
        d.total += ev.input + ev.output;
      }
      if (ev.sessionId) sessions.add(`${c.name}:${ev.sessionId}`);
    }
  }

  // Drop agents that were scanned but contributed nothing, so the leaderboard
  // payload only lists agents actually used.
  for (const [name, a] of Object.entries(summary.by_agent)) {
    if (a.calls === 0) delete summary.by_agent[name];
  }
  const contributors = Object.keys(summary.by_agent);
  summary.agents_scanned = contributors;
  summary.agents_experimental = summary.agents_experimental.filter((n) => contributors.includes(n));

  summary.sessions = sessions.size;
  summary.total = summary.tokens.input + summary.tokens.output;
  return summary;
}

function bucket() {
  return { input: 0, output: 0, cache_read: 0, cache_write: 0, calls: 0 };
}
function agentBucket(label) {
  return { label, ...bucket() };
}
function addTokens(target, ev) {
  target.input += ev.input;
  target.output += ev.output;
  target.cache_read += ev.cache_read;
  target.cache_write += ev.cache_write;
}
