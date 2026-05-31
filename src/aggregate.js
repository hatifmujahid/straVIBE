// Shared aggregation primitives used by BOTH the windowed scan (src/scan.js)
// and the persistent all-time store (src/store.js), so they fold events the
// exact same way. An "aggregate" is the canonical shape:
//   { tokens:{input,output,cache_read,cache_write}, total, calls,
//     by_model:{}, by_agent:{}, by_day:{} }

export function bucket() {
  return { input: 0, output: 0, cache_read: 0, cache_write: 0, calls: 0 };
}

export function agentBucket(label) {
  return { label, ...bucket() };
}

export function addTokens(target, ev) {
  target.input += ev.input;
  target.output += ev.output;
  target.cache_read += ev.cache_read;
  target.cache_write += ev.cache_write;
}

/** A fresh, empty aggregate sub-tree (no scan metadata). */
export function emptyAggregate() {
  return {
    tokens: { input: 0, output: 0, cache_read: 0, cache_write: 0 },
    total: 0,
    calls: 0,
    by_model: {},
    by_agent: {},
    by_day: {},
  };
}

/**
 * Fold one normalized event into an aggregate, mutating it in place.
 * `agentLabel` supplies a human label the first time an agent is seen.
 */
export function foldEvent(agg, ev, agentLabel) {
  addTokens(agg.tokens, ev);
  agg.calls++;

  const a = (agg.by_agent[ev.agent] ??= agentBucket(agentLabel || ev.agent));
  addTokens(a, ev);
  a.calls++;

  const m = (agg.by_model[ev.model] ??= bucket());
  addTokens(m, ev);
  m.calls++;

  if (!Number.isNaN(ev.ts)) {
    const day = new Date(ev.ts).toISOString().slice(0, 10);
    const d = (agg.by_day[day] ??= { input: 0, output: 0, total: 0 });
    d.input += ev.input;
    d.output += ev.output;
    d.total += ev.input + ev.output;
  }

  agg.total = agg.tokens.input + agg.tokens.output;
}
