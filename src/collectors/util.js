import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";

/** Recursively collect *.jsonl files under dir. */
export function collectJsonl(dir, out = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) collectJsonl(full, out);
    else if (e.isFile() && e.name.endsWith(".jsonl")) out.push(full);
  }
  return out;
}

/** Stream a JSONL file, calling cb(parsedObject) per valid line. */
export function forEachJsonLine(file, cb, meta) {
  return new Promise((resolve) => {
    let stream;
    try {
      stream = fs.createReadStream(file, { encoding: "utf8" });
    } catch {
      return resolve();
    }
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
    rl.on("line", (line) => {
      if (!line) return;
      let obj;
      try {
        obj = JSON.parse(line);
      } catch {
        if (meta) meta.skipped_lines++;
        return;
      }
      cb(obj);
    });
    rl.on("close", resolve);
    rl.on("error", () => resolve());
    stream.on("error", () => resolve());
  });
}

export function num(x) {
  return typeof x === "number" && Number.isFinite(x) ? x : 0;
}
