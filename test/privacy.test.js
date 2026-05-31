// Privacy invariant: ONLY token counts, model names, agent names, timestamps,
// and the optional handle may leave the machine. Prompts, responses, file paths,
// project/folder names, session ids, and cwd must never reach the payload.
//
// Run: npm test   (uses the built-in node:test runner, no dependencies)
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { emptyStore, accumulate } from "../src/store.js";
import { buildPayload } from "../src/submit.js";

// A Claude Code transcript line packed with leak-bait: a secret cwd, a private
// project name, prompt/response content, an ssh key path, and a session id —
// all alongside the only fields we're allowed to read (usage/model/timestamp).
const LEAK = {
  cwd: "C:\\Users\\victim\\projects\\my-private-startup",
  project: "my-private-startup",
  secretText: "THE-LAUNCH-CODE-is-hunter2 and my key at /home/victim/.ssh/id_rsa",
  sessionId: "sess-TOP-SECRET-9f3a",
};

function writeFixtureHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "stravibe-priv-"));
  const dir = path.join(home, ".claude", "projects", "encoded-" + LEAK.project);
  fs.mkdirSync(dir, { recursive: true });
  const line = JSON.stringify({
    timestamp: "2026-05-01T12:00:00.000Z",
    sessionId: LEAK.sessionId,
    cwd: LEAK.cwd,
    requestId: "req_abc",
    uuid: "uuid_abc",
    message: {
      id: "msg_abc",
      model: "claude-opus-4-8",
      role: "assistant",
      content: [{ type: "text", text: LEAK.secretText }],
      usage: {
        input_tokens: 11,
        output_tokens: 22,
        cache_read_input_tokens: 5,
        cache_creation_input_tokens: 3,
      },
    },
  });
  fs.writeFileSync(path.join(dir, "session.jsonl"), line + "\n");
  return home;
}

const ALLOWED_TOP_LEVEL = new Set([
  "device_id", "handle", "mode", "since", "until",
  "totals", "calls", "sessions", "agents", "by_agent", "by_model", "by_day", "client",
]);

test("payload contains only allowlisted top-level keys", async () => {
  const home = writeFixtureHome();
  try {
    const { store } = await accumulate({ store: emptyStore(), home });
    const payload = buildPayload(store, { handle: "tester" });
    for (const k of Object.keys(payload)) {
      assert.ok(ALLOWED_TOP_LEVEL.has(k), `unexpected key in payload: ${k}`);
    }
    // sanity: the usage we planted was actually counted (test isn't a no-op)
    assert.equal(payload.totals.total, 33, "expected input(11)+output(22) to be aggregated");
    assert.equal(payload.calls, 1);
    assert.deepEqual(payload.agents, ["claude-code"]);
    assert.ok(payload.by_model["claude-opus-4-8"], "model name should be present");
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("no path / content / session-id leaks anywhere in the serialized payload", async () => {
  const home = writeFixtureHome();
  try {
    const { store } = await accumulate({ store: emptyStore(), home });
    const serialized = JSON.stringify(buildPayload(store, { handle: "tester" }));

    const forbidden = [
      LEAK.cwd,
      LEAK.project,
      LEAK.secretText,
      LEAK.sessionId,
      "hunter2",
      "id_rsa",
      ".ssh",
      ".jsonl",
      "projects",
      "C:\\\\", // any windows path separator that survived
      "/home/",
    ];
    for (const needle of forbidden) {
      assert.ok(
        !serialized.includes(needle),
        `payload leaked forbidden substring: ${JSON.stringify(needle)}`
      );
    }
    // sessions is a COUNT, never the id
    assert.equal(typeof JSON.parse(serialized).sessions, "number");
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});
