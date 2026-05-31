import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// Auto-sync via a Claude Code SessionEnd hook: when a Claude Code session ends,
// the hook runs `stravibe sync --quiet`, folding that session's calls into the
// persistent store and pushing the new all-time total to the leaderboard.
// See https://docs.claude.com/en/docs/claude-code/hooks
const EVENT = "SessionEnd";
const DEFAULT_INVOKER = "npx -y stravibe"; // published npm package; matches install.sh distribution

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

/** The command string the hook will run. */
export function buildHookCommand({ invoker = DEFAULT_INVOKER, api, handle } = {}) {
  let cmd = `${invoker} sync --quiet`;
  if (api) cmd += ` --api ${shellQuote(api)}`;
  if (handle) cmd += ` --handle ${shellQuote(handle)}`;
  return cmd;
}

/**
 * Install (or refresh) the Claude Code SessionEnd hook in ~/.claude/settings.json,
 * merging into any existing hooks. Idempotent — prior stravibe entries are
 * replaced, never duplicated.
 *
 * @param {object} [opts]
 * @param {string} [opts.command]  full command override (else built from invoker/api/handle)
 * @param {string} [opts.invoker]  how to launch the CLI (default: npx github form)
 * @param {string} [opts.api]      baked into the command for the hook's bare shell
 * @param {string} [opts.handle]   baked-in display name
 * @param {string} [opts.home]     override home dir (testing)
 */
export function installHook({ home = os.homedir(), command, invoker, api, handle } = {}) {
  const file = settingsPath(home);
  const settings = readSettings(file);
  settings.hooks ??= {};
  const groups = (settings.hooks[EVENT] ??= []);

  // Strip any prior stravibe entries from existing groups, then drop emptied groups.
  for (const g of groups) {
    if (Array.isArray(g.hooks)) g.hooks = g.hooks.filter((h) => !isOurs(h.command));
  }
  settings.hooks[EVENT] = groups.filter((g) => !Array.isArray(g.hooks) || g.hooks.length > 0);

  const cmd = command || buildHookCommand({ invoker, api, handle });
  settings.hooks[EVENT].push({ hooks: [{ type: "command", command: cmd }] });

  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(settings, null, 2));
  return { file, command: cmd };
}

/** Remove the stravibe SessionEnd hook(s). Returns how many were removed. */
export function uninstallHook({ home = os.homedir() } = {}) {
  const file = settingsPath(home);
  const settings = readSettings(file);
  const groups = settings.hooks?.[EVENT];
  if (!Array.isArray(groups)) return { file, removed: 0 };

  let removed = 0;
  for (const g of groups) {
    if (!Array.isArray(g.hooks)) continue;
    const before = g.hooks.length;
    g.hooks = g.hooks.filter((h) => !isOurs(h.command));
    removed += before - g.hooks.length;
  }
  settings.hooks[EVENT] = groups.filter((g) => !Array.isArray(g.hooks) || g.hooks.length > 0);
  if (settings.hooks[EVENT].length === 0) delete settings.hooks[EVENT];

  fs.writeFileSync(file, JSON.stringify(settings, null, 2));
  return { file, removed };
}

/** Whether our SessionEnd hook is currently installed. */
export function hookStatus({ home = os.homedir() } = {}) {
  const file = settingsPath(home);
  const groups = readSettings(file).hooks?.[EVENT] || [];
  const commands = [];
  for (const g of groups) for (const h of g.hooks || []) if (isOurs(h.command)) commands.push(h.command);
  return { file, installed: commands.length > 0, commands };
}
