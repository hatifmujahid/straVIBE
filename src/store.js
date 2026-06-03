import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { deviceId } from "./identity.js";
import { scanEvents, activeCollectors, currentMonthStart, currentMonthKey } from "./scan.js";
import { emptyAggregate, foldEvent } from "./aggregate.js";

// The persistent, on-machine ledger. THIS is what makes a score monotonic:
// calls counted once stay counted forever, even after the agent's transcripts
// age past the 90-day window or are deleted. Lives next to credentials.json.
const STORE_DIR = path.join(os.homedir(), ".stravibe");
const STORE_FILE = path.join(STORE_DIR, "usage.json");
const STORE_VERSION = 1;

export function storePath() {
  return STORE_FILE;
}

export function emptyStore() {
  return {
    version: STORE_VERSION,
    device_id: deviceId(),
    // Newest event timestamp (ms) already folded in, PER provider (claude-code,
    // codex-cli, gemini-cli). Next sync only counts events strictly newer than
    // this, so re-scans never double-count.
    watermarks: {},
    // Unique "agent:sessionId" keys ever counted. Sessions are far fewer than
    // calls, so this stays small while keeping the session count accurate.
    sessions: [],
    // All-time aggregate the leaderboard ranks on.
    cumulative: emptyAggregate(),
    first_synced: null,
    last_synced: null,
  };
}

export function loadStore() {
  try {
    const s = JSON.parse(fs.readFileSync(STORE_FILE, "utf8"));
    if (s && s.version === STORE_VERSION && s.cumulative && s.watermarks) return s;
  } catch {}
  return emptyStore();
}

export function saveStore(store) {
  fs.mkdirSync(STORE_DIR, { recursive: true });
  fs.writeFileSync(STORE_FILE, JSON.stringify(store, null, 2), { mode: 0o600 });
  return store;
}

export function resetStore() {
  try {
    fs.rmSync(STORE_FILE);
  } catch {}
}

/**
 * Fold every not-yet-counted local event into the persistent store and advance
 * each provider's watermark. Idempotent: only events strictly newer than the
 * stored watermark are counted, so calls accrue forever without double-counting.
 *
 * Events without a timestamp (some experimental collectors) can't be
 * watermark-deduped across runs, so they're counted only on a provider's FIRST
 * sync and skipped thereafter — a deliberate undercount over a double-count.
 *
 * Does NOT persist — the caller decides when to saveStore(). Returns the
 * (mutated) store, the delta added this run, and a CURRENT-MONTH aggregate
 * (`month`) built in the same pass — the windowed view the leaderboard submits.
 *
 * @param {object} [opts]
 * @param {object} [opts.store=loadStore()]
 * @param {string} [opts.home]    override home dir (testing)
 * @param {string} [opts.nowIso]  override timestamp (testing)
 */
export async function accumulate({ store = loadStore(), home = os.homedir(), nowIso } = {}) {
  const labels = Object.fromEntries(activeCollectors({ home }).map((c) => [c.name, c.label]));

  const before = { calls: store.cumulative.calls, total: store.cumulative.total };
  const sessions = new Set(store.sessions || []);
  const maxTs = {}; // highest valid ts folded this run, per agent
  const touched = new Set();

  // Current calendar-month window, accumulated in the SAME pass as the all-time
  // store. Unlike the store, it is NOT watermark-gated: we want the full month
  // every run (the backend replaces the month row), not just new events.
  const now = nowIso ? new Date(nowIso) : new Date();
  const monthCutoff = currentMonthStart(now);
  const month = emptyAggregate();
  const monthSessions = new Set();

  for await (const ev of scanEvents({ home })) {
    if (!Number.isNaN(ev.ts) && ev.ts >= monthCutoff) {
      foldEvent(month, ev, labels[ev.agent] || ev.agent);
      if (ev.sessionId) monthSessions.add(`${ev.agent}:${ev.sessionId}`);
    }

    const wm = store.watermarks[ev.agent]; // pre-run watermark (not mutated mid-loop)

    if (Number.isNaN(ev.ts)) {
      if (wm != null) continue; // no timestamp + already synced once -> can't dedupe, skip
    } else if (wm != null && ev.ts <= wm) {
      continue; // already counted in a previous run
    }

    foldEvent(store.cumulative, ev, labels[ev.agent] || ev.agent);
    if (ev.sessionId) sessions.add(`${ev.agent}:${ev.sessionId}`);
    touched.add(ev.agent);
    if (!Number.isNaN(ev.ts) && !(maxTs[ev.agent] >= ev.ts)) maxTs[ev.agent] = ev.ts;
  }

  // Advance watermarks. Never move backwards. A provider that contributed only
  // timestamp-less events still gets a watermark (floor 0) so first-sync is
  // recorded and those events aren't recounted next run.
  for (const name of touched) {
    const prev = store.watermarks[name] ?? -Infinity;
    store.watermarks[name] = Math.max(prev, maxTs[name] ?? 0);
  }

  store.sessions = [...sessions];
  store.device_id = store.device_id || deviceId();
  store.last_synced = now.toISOString();
  if (!store.first_synced) store.first_synced = store.last_synced;

  return {
    store,
    added: {
      calls: store.cumulative.calls - before.calls,
      total: store.cumulative.total - before.total,
    },
    // Current-month windowed view: aggregate counts + the period/since/until the
    // backend needs to scope and reconcile the snapshot.
    month: {
      ...month,
      sessions: monthSessions.size,
      period: currentMonthKey(now),
      since: new Date(monthCutoff).toISOString(),
      until: store.last_synced,
    },
  };
}
