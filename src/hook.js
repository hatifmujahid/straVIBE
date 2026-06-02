import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// Auto-sync via Claude Code hooks: the hook runs `stravibe sync --quiet`,
// folding local transcript usage into the persistent store and pushing the new
// all-time total to the leaderboard. We install on TWO events so coverage holds
// even when a session never exits gracefully:
//   - SessionEnd   fires on graceful exits (/exit, Ctrl-C/D, /clear, logout).
//   - SessionStart fires when the next session begins, sweeping up any prior
//     session that was killed abruptly (window closed, crash) and so never ran
//     its SessionEnd hook. The sync re-scans on-disk transcripts and dedupes by
//     watermark, so the recovered session is counted exactly once.
// See https://docs.claude.com/en/docs/claude-code/hooks
const EVENTS = ["SessionEnd", "SessionStart"];

// Pin the hook to the EXACT version that installed it. If the hook re-resolved
// "latest" on every session end, a future (possibly compromised) publish would
// auto-run on the user's machine with no action from them — a real supply-chain
// vector. Pinning removes it; re-run `stravibe install-hook` after upgrading to
// advance the pin. Falls back to unpinned if the version can't be read.
function pkgVersion() {
  try {
    return JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;
  } catch {
    return null;
  }
}
const DEFAULT_INVOKER = pkgVersion() ? `npx -y stravibe@${pkgVersion()}` : "npx -y stravibe";

function settingsPath(home = os.homedir()) {
  return path.join(home, ".claude", "settings.json");
}

function readSettings(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) || {};
  } catch {
    return {};
  }
}

// Recognize our own hook entries so install is idempotent and uninstall is targeted.
function isOurs(cmd = "") {
  return /\b(stravibe|strava-for-ai)\b[\s\S]*\bsync\b/.test(cmd);
}

function shellQuote(s) {
  s = String(s);
  return /[^\w@:/.\-]/.test(s) ? `"${s.replace(/"/g, '\\"')}"` : s;
}

/** The command string the hook will run. The backend is hardcoded, so the only
 *  bake-in is the optional display handle. */
export function buildHookCommand({ invoker = DEFAULT_INVOKER, handle } = {}) {
  let cmd = `${invoker} sync --quiet`;
  if (handle) cmd += ` --handle ${shellQuote(handle)}`;
  return cmd;
}

/**
 * Install (or refresh) the Claude Code SessionEnd + SessionStart hooks in
 * ~/.claude/settings.json, merging into any existing hooks. Idempotent — prior
 * stravibe entries are replaced, never duplicated.
 *
 * @param {object} [opts]
 * @param {string} [opts.command]  full command override (else built from invoker/handle)
 * @param {string} [opts.invoker]  how to launch the CLI (default: pinned npm package)
 * @param {string} [opts.handle]   baked-in display name
 * @param {string} [opts.home]     override home dir (testing)
 */
export function installHook({ home = os.homedir(), command, invoker, handle } = {}) {
  const file = settingsPath(home);
  const settings = readSettings(file);
  settings.hooks ??= {};

  const cmd = command || buildHookCommand({ invoker, handle });
  for (const event of EVENTS) {
    const groups = (settings.hooks[event] ??= []);
    // Strip any prior stravibe entries from existing groups, then drop emptied groups.
    for (const g of groups) {
      if (Array.isArray(g.hooks)) g.hooks = g.hooks.filter((h) => !isOurs(h.command));
    }
    settings.hooks[event] = groups.filter((g) => !Array.isArray(g.hooks) || g.hooks.length > 0);
    settings.hooks[event].push({ hooks: [{ type: "command", command: cmd }] });
  }

  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(settings, null, 2));
  return { file, command: cmd, events: EVENTS };
}

/** Remove the stravibe SessionEnd + SessionStart hook(s). Returns how many were removed. */
export function uninstallHook({ home = os.homedir() } = {}) {
  const file = settingsPath(home);
  const settings = readSettings(file);

  let removed = 0;
  for (const event of EVENTS) {
    const groups = settings.hooks?.[event];
    if (!Array.isArray(groups)) continue;
    for (const g of groups) {
      if (!Array.isArray(g.hooks)) continue;
      const before = g.hooks.length;
      g.hooks = g.hooks.filter((h) => !isOurs(h.command));
      removed += before - g.hooks.length;
    }
    settings.hooks[event] = groups.filter((g) => !Array.isArray(g.hooks) || g.hooks.length > 0);
    if (settings.hooks[event].length === 0) delete settings.hooks[event];
  }

  fs.writeFileSync(file, JSON.stringify(settings, null, 2));
  return { file, removed };
}

/** Whether our auto-sync hooks are installed, and on which events. */
export function hookStatus({ home = os.homedir() } = {}) {
  const file = settingsPath(home);
  const hooks = readSettings(file).hooks || {};
  const commands = [];
  const events = [];
  for (const event of EVENTS) {
    let found = false;
    for (const g of hooks[event] || []) {
      for (const h of g.hooks || []) {
        if (isOurs(h.command)) {
          commands.push(h.command);
          found = true;
        }
      }
    }
    if (found) events.push(event);
  }
  return { file, installed: commands.length > 0, commands, events };
}
