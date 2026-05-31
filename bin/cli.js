#!/usr/bin/env node
import { scanUsage } from "../src/scan.js";
import { submit } from "../src/submit.js";
import { login, clearCreds, loadCreds } from "../src/auth.js";

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
}

async function runSubmit() {
  const api = flag("api", process.env.STRAVIBE_API);
  const handle = flag("handle", process.env.STRAVIBE_HANDLE);
  const days = Number(flag("days", 90));
  const dryRun = has("dry-run") || !api;
  const r = await submit({ api, handle, days, dryRun });
  if (!r.sent) {
    console.log(dryRun && api ? "(dry run) " : "(no --api given) ", "payload that would be sent:\n");
    console.log(JSON.stringify(r.payload, null, 2));
    if (!api) console.log(`\nSet --api <url> (or STRAVIBE_API) to submit.`);
    return;
  }
  const who = r.linked ? `${r.linked.provider || "account"}:${r.linked.login || r.linked.email || r.linked.id}` : r.payload.device_id + " (anonymous — run `stravibe login` to link)";
  console.log(`submitted ${n(r.payload.totals.total)} tokens for ${who} → ${r.status}`);
  console.log(JSON.stringify(r.response, null, 2));
}

async function runLogin() {
  const api = flag("api", process.env.STRAVIBE_API);
  const provider = flag("with"); // github | google
  const user = await login({ api, provider });
  console.log(`linked as ${user?.provider || ""} ${user?.login || user?.email || user?.id || "(unknown)"} ✓`);
}

function runLogout() {
  clearCreds();
  console.log("logged out — credentials removed.");
}

function runWhoami() {
  const c = loadCreds();
  if (!c?.user) return console.log("not linked (anonymous). Run `stravibe login --api <url> --with github`.");
  console.log(`linked as ${c.user.provider || ""} ${c.user.login || c.user.email || c.user.id}`);
}

async function main() {
  switch (cmd) {
    case "scan":
      return runScan();
    case "submit":
      return runSubmit();
    case "login":
      return runLogin();
    case "logout":
      return runLogout();
    case "whoami":
      return runWhoami();
    default:
      console.log(`straVIBE — track your AI coding-agent token usage

Usage:
  stravibe scan   [--days 90] [--json]              show local usage, no network
  stravibe login  --api URL [--with github|google]  link your account (browser)
  stravibe submit [--days 90] [--api URL] [--handle NAME] [--dry-run]
                                                   scan + send to the leaderboard
  stravibe whoami | logout

Env: STRAVIBE_API, STRAVIBE_HANDLE
Agents: Claude Code (verified); Codex/Gemini CLI (experimental); Cursor/Copilot need OAuth.
Privacy: only token counts, model names, agent names, and timestamps leave your machine.`);
  }
}
main().catch((e) => {
  console.error("error:", e.message);
  process.exit(1);
});
