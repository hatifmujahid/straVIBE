import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// Inventory probe for the local Claude Code setup. UNLIKE the usage collectors
// (claude/codex/gemini), this does NOT stream token events — it returns a
// point-in-time COUNT of how many skills, agents (subagents), and MCP servers
// are configured. Reported as raw counts only; per the privacy guarantee, the
// names of skills/agents/MCP servers never leave the machine.
//
// Counting model (deliberately conservative and well-defined):
//   skills      — directories containing a SKILL.md, under user + project scopes
//   agents      — *.md files under .claude/agents, user + project scopes
//   mcp_servers — DISTINCT server names across every scope (global ~/.claude.json
//                 mcpServers, ~/.claude/settings.json mcpServers, and each
//                 project's mcpServers in ~/.claude.json)

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

/** Count skill dirs (those holding a SKILL.md) recursively under `dir`. */
function countSkills(dir) {
  let n = 0;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  if (entries.some((e) => e.isFile() && e.name === "SKILL.md")) n++;
  for (const e of entries) {
    if (e.isDirectory()) n += countSkills(path.join(dir, e.name));
  }
  return n;
}

/** Count *.md files recursively under `dir` (agent/subagent definitions). */
function countMarkdown(dir) {
  let n = 0;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) n += countMarkdown(full);
    else if (e.isFile() && e.name.endsWith(".md")) n++;
  }
  return n;
}

/**
 * Snapshot the local Claude Code inventory. Counts user-level config
 * (~/.claude) plus every project recorded in ~/.claude.json, so it mirrors how
 * MCP servers are scoped. Always returns numbers — missing files count as 0.
 */
export function countEnvironment(home = os.homedir()) {
  const claude = path.join(home, ".claude");

  let skills = countSkills(path.join(claude, "skills"));
  let agents = countMarkdown(path.join(claude, "agents"));

  // Distinct MCP server names across all scopes.
  const mcp = new Set();
  const addServers = (obj) => {
    if (obj && typeof obj === "object") for (const name of Object.keys(obj)) mcp.add(name);
  };

  const settings = readJson(path.join(claude, "settings.json"));
  if (settings) addServers(settings.mcpServers);

  const cfg = readJson(path.join(home, ".claude.json"));
  if (cfg) {
    addServers(cfg.mcpServers);
    const projects = cfg.projects || {};
    for (const [projPath, proj] of Object.entries(projects)) {
      addServers(proj?.mcpServers);
      // Project-scoped skills/agents live under <project>/.claude.
      skills += countSkills(path.join(projPath, ".claude", "skills"));
      agents += countMarkdown(path.join(projPath, ".claude", "agents"));
    }
  }

  return { skills, agents, mcp_servers: mcp.size };
}
