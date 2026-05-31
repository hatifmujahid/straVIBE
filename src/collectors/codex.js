import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { collectJsonl, forEachJsonLine, num } from "./util.js";

// Codex CLI (OpenAI) stores rollout transcripts under ~/.codex/sessions/.
// EXPERIMENTAL: field names vary across Codex versions. This collector reads
// defensively and FAILS SAFE — if it doesn't recognize a token shape it yields
// nothing rather than guessing. Verify on a machine that has Codex before
// trusting these numbers in the leaderboard.
export const codexCli = {
  name: "codex-cli",
  label: "Codex CLI",
  verified: false,

  root(home = os.homedir()) {
    return path.join(home, ".codex", "sessions");
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
          // accept either an embedded `usage` object or a token_count event
          const u =
            entry?.usage ||
            entry?.response?.usage ||
            entry?.payload?.usage ||
            (entry?.type === "token_count" ? entry : null);
          if (!u) return;
          const input = num(u.input_tokens ?? u.prompt_tokens ?? u.input);
          const output = num(u.output_tokens ?? u.completion_tokens ?? u.output);
          const cache_read = num(
            u.cache_read_input_tokens ?? u.cached_tokens ?? u.input_tokens_details?.cached_tokens
          );
          if (input + output + cache_read === 0) return;
          batch.push({
            agent: this.name,
            ts: entry.timestamp || entry.ts ? Date.parse(entry.timestamp || entry.ts) : NaN,
            model: entry.model || entry.response?.model || "unknown",
            dedupeKey: entry.id || entry.response?.id || `${file}:${meta?.files_scanned}:${batch.length}`,
            sessionId: path.basename(file),
            input,
            output,
            cache_read,
            cache_write: 0,
          });
        },
        meta
      );
      for (const ev of batch) yield ev;
    }
  },
};
