#!/usr/bin/env node
import { scanUsage } from "../src/scan.js";
import { sync } from "../src/submit.js";
import { login, clearCreds, loadCreds } from "../src/auth.js";
import { loadStore, storePath, resetStore } from "../src/store.js";
import { installHook, uninstallHook, hookStatus } from "../src/hook.js";
import { DEFAULT_API } from "../src/config.js";

const argv = process.argv.slice(2);
const cmd = argv[0];
function flag(name, def) {
  const i = argv.indexOf(`--${name}`);
  return i !== -1 && argv[i + 1] ? argv[i + 1] : def;
}
const has = (name) => argv.includes(`--${name}`);
const n = (x) => Number(x).toLocaleString("en-US");

async function runScan() {
  const days = Number(flag("days", 90));
  const s = await scanUsage({ days });
  if (has("json")) return console.log(JSON.stringify(s, null, 2));
  console.log(`\nAI agent usage — last ${s.days} days  (${s.since.slice(0, 10)} → ${s.until.slice(0, 10)})`);
  if (s.error) console.log(`  ! ${s.error}`);
  console.log(`  agents: ${s.agents_scanned.join(", ") || "none"}   sessions: ${s.sessions}   calls: ${n(s.calls)}`);
  console.log(`  input ${n(s.tokens.input)}  |  output ${n(s.tokens.output)}  |  cache_read ${n(s.tokens.cache_read)}  |  cache_write ${n(s.tokens.cache_write)}`);
  console.log(`  TOTAL (in+out): ${n(s.total)}`);
  const ags = Object.entries(s.by_agent);
  if (ags.length) {
    console.log(`\n  by agent:`);
    for (const [, a] of ags.sort((x, y) => (y[1].input + y[1].output) - (x[1].input + x[1].output)))
      console.log(`    ${a.label.padEnd(16)} ${n(a.input + a.output).padStart(14)}  (${a.calls} calls)`);
  }
  if (s.agents_experimental.length) console.log(`\n  ⚠ experimental (unverified) collectors contributed: ${s.agents_experimental.join(", ")}`);
  if (s.detected_unsupported.length)
    console.log(`  ℹ detected but not scrapeable locally: ${s.detected_unsupported.map((a) => a.label).join(", ")} — needs vendor OAuth`);
  console.log(`\n  (this is a rolling ${s.days}-day view; \`stravibe sync\` persists an all-time score)`);
}

// `sync` (and its alias `submit`): fold new calls into the persistent local
// store, then push the all-time cumulative total to the leaderboard.
async function runSync() {
  const api = flag("api", process.env.STRAVIBE_API);
  const handle = flag("handle", process.env.STRAVIBE_HANDLE);
  const dryRun = has("dry-run");
  const quiet = has("quiet"); // used by the SessionEnd hook: silent, never disrupts the session
  try {
    const r = await sync({ api, handle, dryRun });
    if (quiet) return;
    const delta = `+${n(r.added.total)} tokens / +${n(r.added.calls)} calls since last sync`;
    if (!r.sent) {
      const why = dryRun ? "(dry run)" : "(no --api given and not linked)";
      console.log(`${why} ${delta}.  Cumulative all-time: ${n(r.payload.totals.total)} tokens.\n`);
      console.log(JSON.stringify(r.payload, null, 2));
      if (!dryRun) console.log(`\nSet --api <url> (or STRAVIBE_API), or run \`stravibe login\`, to submit.`);
      return;
    }
    const who = r.linked
      ? `${r.linked.provider || "account"}:${r.linked.login || r.linked.email || r.linked.id}`
      : r.payload.device_id + " (anonymous — run `stravibe login` to link)";
    console.log(`synced all-time ${n(r.payload.totals.total)} tokens (${delta}) for ${who} → ${r.status}`);
    console.log(JSON.stringify(r.response, null, 2));
  } catch (e) {
    if (quiet) return process.exit(0); // a failed background sync must never break Claude Code
    throw e;
  }
}

async function runLogin() {
  const api = flag("api", process.env.STRAVIBE_API) || DEFAULT_API;
  const provider = flag("with"); // github | google
  const user = await login({ api, provider });
  console.log(`linked as ${user?.provider || ""} ${user?.login || user?.email || user?.id || "(unknown)"} ✓`);
  // Offer auto-sync now that we have a saved api to bake into the hook.
  if (api && !hookStatus().installed) {
    const { file } = installHook({ api });
    console.log(`auto-sync enabled — Claude Code SessionEnd hook added to ${file}`);
    console.log(`(disable any time with \`stravibe uninstall-hook\`)`);
  }
}

function runLogout() {
  clearCreds();
  console.log("logged out — credentials removed. (local usage store kept; run `stravibe reset` to clear it)");
}

function runWhoami() {
  const c = loadCreds();
  const store = loadStore();
  const hook = hookStatus();
  if (!c?.user) console.log("not linked (anonymous). Run `stravibe login --api <url> --with github`.");
  else console.log(`linked as ${c.user.provider || ""} ${c.user.login || c.user.email || c.user.id}`);
  console.log(`all-time score: ${n(store.cumulative.total)} tokens / ${n(store.cumulative.calls)} calls  (store: ${storePath()})`);
  if (store.last_synced) console.log(`last synced: ${store.last_synced}`);
  console.log(`auto-sync hook: ${hook.installed ? "installed" : "not installed (run `stravibe install-hook`)"}`);
}

function runInstallHook() {
  const api = flag("api", process.env.STRAVIBE_API) || loadCreds()?.api;
  const handle = flag("handle", process.env.STRAVIBE_HANDLE);
  const invoker = flag("invoker");
  const command = flag("cmd");
  const { file, command: cmd } = installHook({ command, invoker, api, handle });
  console.log(`installed Claude Code SessionEnd hook → ${file}`);
  console.log(`  command: ${cmd}`);
  if (!api && !command) console.log(`  endpoint: default backend (${DEFAULT_API}) — pass --api to override.`);
  console.log(`Your usage now syncs automatically every time a Claude Code session ends.`);
}

function runUninstallHook() {
  const { file, removed } = uninstallHook();
  console.log(removed ? `removed ${removed} stravibe hook(s) from ${file}` : `no stravibe hook found in ${file}`);
}

function runReset() {
  if (!has("yes")) return console.log("this clears your all-time local score. Re-run with --yes to confirm.");
  resetStore();
  console.log(`local usage store cleared (${storePath()}). Next sync rebuilds it from local transcripts.`);
}

async function main() {
  switch (cmd) {
    case "scan":
      return runScan();
    case "sync":
    case "submit":
      return runSync();
    case "login":
      return runLogin();
    case "logout":
      return runLogout();
    case "whoami":
      return runWhoami();
    case "install-hook":
      return runInstallHook();
    case "uninstall-hook":
      return runUninstallHook();
    case "reset":
      return runReset();
    default:
      console.log(`straVIBE — track your AI coding-agent token usage

Usage:
  stravibe scan   [--days 90] [--json]              show local rolling-window usage, no network
  stravibe sync   [--api URL] [--handle NAME] [--dry-run] [--quiet]
                                                   fold new calls into your all-time score + submit
  stravibe login  --api URL [--with github|google]  link account (browser) + enable auto-sync
  stravibe install-hook   [--api URL] [--handle NAME]  auto-sync on every Claude Code session end
  stravibe uninstall-hook                          disable auto-sync
  stravibe whoami | logout | reset [--yes]

\`submit\` is a back-compat alias of \`sync\`. The score is cumulative and persisted at
~/.stravibe/usage.json, so every LLM call keeps counting even after transcripts age out.

Env: STRAVIBE_API, STRAVIBE_HANDLE
Agents: Claude Code (verified); Codex/Gemini CLI (experimental); Cursor/Copilot need OAuth.
Privacy: only token counts, model names, agent names, and timestamps leave your machine.`);
  }
}
main().catch((e) => {
  console.error("error:", e.message);
  process.exit(1);
});
