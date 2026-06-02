#!/usr/bin/env node
import { scanUsage } from "../src/scan.js";
import { sync } from "../src/submit.js";
import { login, clearCreds, loadCreds } from "../src/auth.js";
import { loadStore, storePath, resetStore } from "../src/store.js";
import { installHook, uninstallHook, hookStatus } from "../src/hook.js";
import { INGEST_URL } from "../src/config.js";

const argv = process.argv.slice(2);
const cmd = argv[0];
function flag(name, def) {
  const i = argv.indexOf(`--${name}`);
  return i !== -1 && argv[i + 1] ? argv[i + 1] : def;
}
const has = (name) => argv.includes(`--${name}`);
const wantsHelp = argv.some((a) => ["-h", "-help", "--help", "help"].includes(a));
const n = (x) => Number(x).toLocaleString("en-US");

function printHelp() {
  console.log(`straVIBE — track your AI coding-agent token usage

Usage:
  stravibe login  [--handle NAME]                   link account (browser) + submit last 90 days + enable auto-sync
  stravibe scan   [--days 90] [--json]              show local rolling-window usage, no network
  stravibe sync   [--handle NAME] [--quiet]         fold new calls into your all-time score + submit
  stravibe install-hook   [--handle NAME]           auto-sync on every Claude Code session end
  stravibe uninstall-hook                          disable auto-sync
  stravibe whoami | logout | reset [--yes]
  stravibe --help                                  show this help

\`submit\` is a back-compat alias of \`sync\`. The score is cumulative and persisted at
~/.stravibe/usage.json, so every LLM call keeps counting even after transcripts age out.

The leaderboard backend is fixed (built in) — there is no --api/STRAVIBE_API override.
Env: STRAVIBE_HANDLE
Agents: Claude Code (verified); Codex/Gemini CLI (experimental); Cursor/Copilot need OAuth.
Privacy: only token counts, model names, agent names, timestamps, and setup counts
(how many skills/agents/MCP servers — never their names) leave your machine.`);
}

async function runScan() {
  const days = Number(flag("days", 90));
  const s = await scanUsage({ days });
  if (has("json")) return console.log(JSON.stringify(s, null, 2));
  console.log(`\nAI agent usage — last ${s.days} days  (${s.since.slice(0, 10)} → ${s.until.slice(0, 10)})`);
  if (s.error) console.log(`  ! ${s.error}`);
  console.log(`  agents: ${s.agents_scanned.join(", ") || "none"}   sessions: ${s.sessions}   calls: ${n(s.calls)}`);
  console.log(`  input ${n(s.tokens.input)}  |  output ${n(s.tokens.output)}  |  cache_read ${n(s.tokens.cache_read)}  |  cache_write ${n(s.tokens.cache_write)}`);
  console.log(`  TOTAL (in+out): ${n(s.total)}`);
  const e = s.environment;
  if (e) console.log(`  setup: ${e.skills} skills  |  ${e.agents} agents  |  ${e.mcp_servers} MCP servers`);
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
  const handle = flag("handle", process.env.STRAVIBE_HANDLE);
  const quiet = has("quiet"); // used by the SessionEnd hook: silent, never disrupts the session
  try {
    const r = await sync({ handle });
    if (quiet) return;
    const delta = `+${n(r.added.total)} tokens / +${n(r.added.calls)} calls since last sync`;
    const who = `${r.linked?.provider || "account"}:${r.linked?.login || r.linked?.email || r.linked?.id}`;
    console.log(`synced all-time ${n(r.payload.totals.total)} tokens (${delta}) for ${who} → ${r.status}`);
    console.log(JSON.stringify(r.response, null, 2));
  } catch (e) {
    if (quiet) return process.exit(0); // a failed/unlinked background sync must never break Claude Code
    if (e.code === "NOT_LINKED") {
      console.error("not linked. Run `stravibe login` to link your GitHub/email account — then your usage will sync.");
      return process.exit(1);
    }
    throw e;
  }
}

// `login` is the one-step onboarding command:
//   1. open the browser to the straVIBE web app, which handles the actual
//      GitHub/email sign-in choice — the CLI just opens it and polls,
//   2. immediately fold the last ~90 days of local usage into the all-time score
//      and submit it to the leaderboard,
//   3. install the Claude Code SessionEnd hook so every future session auto-syncs.
async function runLogin() {
  const user = await login();
  console.log(`linked as ${user?.provider || ""} ${user?.login || user?.email || user?.id || "(unknown)"} ✓`);

  const handle = flag("handle", process.env.STRAVIBE_HANDLE);

  // Initial submission: count everything currently on disk (Claude Code keeps
  // roughly the last 90 days of transcripts) and push the all-time total now.
  try {
    console.log("Calculating your usage from the last ~90 days and submitting…");
    const r = await sync({ handle });
    console.log(`submitted all-time ${n(r.payload.totals.total)} tokens / ${n(r.payload.calls)} calls → ${r.status}`);
  } catch (e) {
    console.log(`(initial submit failed: ${e.message} — run \`stravibe sync\` to retry)`);
  }

  // Auto-sync around every future Claude Code session. Bake in the handle so
  // background syncs keep the same leaderboard display name.
  if (!hookStatus().installed) {
    const { file, events } = installHook({ handle });
    console.log(`auto-sync enabled — Claude Code ${events.join(" + ")} hooks added to ${file}`);
    console.log(`(disable any time with \`stravibe uninstall-hook\`)`);
  } else {
    console.log("auto-sync already enabled — future sessions sync automatically.");
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
  if (!c?.user) console.log("not linked. Run `stravibe login` to link your GitHub/email account (required to sync).");
  else console.log(`linked as ${c.user.provider || ""} ${c.user.login || c.user.email || c.user.id}`);
  console.log(`all-time score: ${n(store.cumulative.total)} tokens / ${n(store.cumulative.calls)} calls  (store: ${storePath()})`);
  if (store.last_synced) console.log(`last synced: ${store.last_synced}`);
  console.log(`auto-sync hook: ${hook.installed ? `installed (${hook.events.join(" + ")})` : "not installed (run `stravibe install-hook`)"}`);
}

function runInstallHook() {
  const handle = flag("handle", process.env.STRAVIBE_HANDLE);
  const invoker = flag("invoker");
  const command = flag("cmd");
  const { file, command: cmd, events } = installHook({ command, invoker, handle });
  console.log(`installed Claude Code ${events.join(" + ")} hooks → ${file}`);
  console.log(`  command: ${cmd}`);
  console.log(`  endpoint: ${INGEST_URL} (fixed)`);
  console.log(`Your usage now syncs automatically at the start and end of every Claude Code session.`);
  console.log(`(SessionStart recovers any prior session closed abruptly before its SessionEnd hook could run.)`);
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
  if (wantsHelp || cmd === undefined) return printHelp();
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
      console.log(`unknown command: ${cmd}\n`);
      return printHelp();
  }
}
main().catch((e) => {
  console.error("error:", e.message);
  process.exit(1);
});
