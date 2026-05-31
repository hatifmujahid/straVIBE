import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { collectJsonl, forEachJsonLine, num } from "./util.js";

// Gemini CLI stores session/telemetry logs under ~/.gemini/.
// EXPERIMENTAL: shape varies; FAILS SAFE if usageMetadata isn't recognized.
// Verify on a machine that has Gemini CLI before trusting these numbers.
export const geminiCli = {
  name: "gemini-cli",
  label: "Gemini CLI",
  verified: false,

  root(home = os.homedir()) {
    return path.join(home, ".gemini");
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
          const u = entry?.usageMetadata || entry?.response?.usageMetadata;
          if (!u) return;
          const input = num(u.promptTokenCount);
          const output = num(u.candidatesTokenCount);
          const cache_read = num(u.cachedContentTokenCount);
          if (input + output + cache_read === 0) return;
          batch.push({
            agent: this.name,
            ts: entry.timestamp || entry.ts ? Date.parse(entry.timestamp || entry.ts) : NaN,
            model: entry.model || "unknown",
            dedupeKey: entry.id || `${file}:${batch.length}`,
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
