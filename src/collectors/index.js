import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { claudeCode } from "./claude.js";
import { codexCli } from "./codex.js";
import { geminiCli } from "./gemini.js";

// Collectors that read token usage from local files.
export const collectors = [claudeCode, codexCli, geminiCli];

// Agents whose usage lives server-side — detectable on disk, but NOT scrapeable
// for token counts. Surface them so the UI can offer "connect via OAuth" instead
// of silently under-counting.
const SERVER_SIDE = [
  { name: "cursor", label: "Cursor", probe: ".cursor" },
  { name: "copilot", label: "GitHub Copilot", probe: ".config/github-copilot" },
  { name: "windsurf", label: "Windsurf", probe: ".windsurf" },
];

export function detectUnsupported(home = os.homedir()) {
  return SERVER_SIDE.filter((a) => fs.existsSync(path.join(home, a.probe))).map((a) => ({
    name: a.name,
    label: a.label,
    reason: "usage is server-side; requires vendor OAuth/usage API",
  }));
}
