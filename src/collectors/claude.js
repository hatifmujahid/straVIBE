import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { collectJsonl, forEachJsonLine, num } from "./util.js";

// Claude Code writes one .jsonl per session under ~/.claude/projects/<slug>/,
// plus subagent transcripts in .../subagents/. Each assistant turn carries
// message.usage. VERIFIED against real transcripts.
export const claudeCode = {
  name: "claude-code",
  label: "Claude Code",
  verified: true,

  root(home = os.homedir()) {
    return path.join(home, ".claude", "projects");
  },

  isPresent(home) {
    return fs.existsSync(this.root(home));
  },

  async *events({ home, meta } = {}) {
    const files = collectJsonl(this.root(home));
    for (const file of files) {
      if (meta) meta.files_scanned++;
      const batch = [];
      await forEachJsonLine(
        file,
        (entry) => {
          const u = entry?.message?.usage;
          if (!u) return;
          const input = num(u.input_tokens);
          const output = num(u.output_tokens);
          const cache_read = num(u.cache_read_input_tokens);
          const cache_write = num(u.cache_creation_input_tokens);
          if (input + output + cache_read + cache_write === 0) return;
          batch.push({
            agent: this.name,
            ts: entry.timestamp ? Date.parse(entry.timestamp) : NaN,
            model: entry.message.model || "unknown",
            dedupeKey: entry.message.id || `${entry.requestId || ""}:${entry.uuid || ""}`,
            sessionId: entry.sessionId,
            input,
            output,
            cache_read,
            cache_write,
          });
        },
        meta
      );
      for (const ev of batch) yield ev;
    }
  },
};
