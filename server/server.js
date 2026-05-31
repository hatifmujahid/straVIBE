// Minimal test backend — zero dependencies, in-memory (resets on restart).
//   POST /v1/import       receive a usage submission (replaces that device's totals)
//   GET  /v1/leaderboard  ranked list
//   GET  /                tiny HTML view of the leaderboard
// Run:  node server/server.js   (PORT env optional, default 8787)
import http from "node:http";

const PORT = Number(process.env.PORT || 8787);
const users = new Map(); // key (device_id) -> record

function send(res, code, body, type = "application/json") {
  const data = typeof body === "string" ? body : JSON.stringify(body, null, 2);
  res.writeHead(code, {
    "content-type": type,
    "access-control-allow-origin": "*", // let the leaderboard site fetch this
    "access-control-allow-headers": "content-type, authorization",
  });
  res.end(data);
}

function board() {
  return [...users.values()]
    .sort((a, b) => b.total - a.total)
    .map((u, i) => ({ rank: i + 1, name: u.handle || u.device_id, total: u.total, calls: u.calls, agents: u.agents }));
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") return send(res, 204, "");

  if (req.method === "POST" && req.url === "/v1/import") {
    let raw = "";
    for await (const c of req) raw += c;
    let p;
    try {
      p = JSON.parse(raw);
    } catch {
      return send(res, 400, { error: "invalid json" });
    }
    const key = p.device_id || p.handle || "anon";
    // replace (not add) — a submission is the full 90-day window, so re-runs just update
    users.set(key, {
      device_id: p.device_id,
      handle: p.handle,
      total: p.totals?.total ?? 0,
      calls: p.calls ?? 0,
      agents: p.agents ?? [],
    });
    console.log(`imported ${key}: ${p.totals?.total ?? 0} tokens, ${p.calls ?? 0} calls`);
    return send(res, 200, { ok: true, rank: board().findIndex((r) => (r.name === (p.handle || p.device_id))) + 1 });
  }

  if (req.method === "GET" && req.url.startsWith("/v1/leaderboard")) {
    return send(res, 200, { board: board() });
  }

  if (req.method === "GET" && req.url === "/") {
    const rows = board()
      .map((r) => `<tr><td>${r.rank}</td><td>${r.name}</td><td>${r.total.toLocaleString()}</td><td>${r.calls}</td></tr>`)
      .join("");
    return send(
      res,
      200,
      `<!doctype html><meta charset=utf8><title>AI Usage Leaderboard</title>
       <style>body{font:16px system-ui;max-width:640px;margin:40px auto}td,th{padding:6px 12px;text-align:left;border-bottom:1px solid #ddd}</style>
       <h1>🏆 AI Usage Leaderboard</h1>
       <table><tr><th>#</th><th>Name</th><th>Tokens (in+out)</th><th>Calls</th></tr>${rows || "<tr><td colspan=4>no submissions yet</td></tr>"}</table>
       <p style=color:#888>auto-refreshes every 5s</p><script>setTimeout(()=>location.reload(),5000)</script>`,
      "text/html"
    );
  }

  return send(res, 404, { error: "not found" });
});

server.listen(PORT, () => console.log(`test backend on http://localhost:${PORT}`));
