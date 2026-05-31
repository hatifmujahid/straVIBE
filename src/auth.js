import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { deviceId } from "./identity.js";

const credDir = path.join(os.homedir(), ".stravibe");
const credPath = path.join(credDir, "credentials.json");

export function loadCreds() {
  try {
    return JSON.parse(fs.readFileSync(credPath, "utf8"));
  } catch {
    return null;
  }
}
export function saveCreds(creds) {
  fs.mkdirSync(credDir, { recursive: true });
  fs.writeFileSync(credPath, JSON.stringify(creds, null, 2), { mode: 0o600 });
}
export function clearCreds() {
  try {
    fs.rmSync(credPath);
  } catch {}
}

function openBrowser(url) {
  const platform = process.platform;
  if (platform === "win32") spawn("cmd", ["/c", "start", "", url], { detached: true, stdio: "ignore" }).unref();
  else if (platform === "darwin") spawn("open", [url], { detached: true, stdio: "ignore" }).unref();
  else spawn("xdg-open", [url], { detached: true, stdio: "ignore" }).unref();
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Device-authorization login. The backend owns the actual GitHub/Google OAuth;
 * the CLI just opens the browser and polls for a token.
 *
 * >>> SEAM AWAITING YOUR BACKEND'S AUTH CONTRACT <<<
 *   POST {api}/auth/cli/start  { device_id, provider } -> { user_code, verification_url, device_code, interval }
 *   POST {api}/auth/cli/poll   { device_code }         -> 202 (pending) | 200 { token, user }
 *
 * @param {object} opts
 * @param {string} opts.api       backend base url
 * @param {string} [opts.provider] "github" | "google" hint for the login page
 */
export async function login({ api, provider }) {
  if (!api) throw new Error("login requires --api <backend-url>");

  const startRes = await fetch(`${api}/auth/cli/start`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ device_id: deviceId(), provider: provider || null }),
  });
  if (!startRes.ok) throw new Error(`auth start failed: ${startRes.status}`);
  const { user_code, verification_url, device_code, interval = 3 } = await startRes.json();

  console.log(`\nTo link your account, a browser will open at:`);
  console.log(`  ${verification_url}`);
  if (user_code) console.log(`Enter this code if asked: ${user_code}\n`);
  openBrowser(verification_url);

  const deadline = Date.now() + 5 * 60 * 1000;
  while (Date.now() < deadline) {
    await sleep(interval * 1000);
    const pollRes = await fetch(`${api}/auth/cli/poll`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ device_code }),
    });
    if (pollRes.status === 202) continue; // still pending
    if (!pollRes.ok) throw new Error(`auth poll failed: ${pollRes.status}`);
    const { token, user } = await pollRes.json();
    saveCreds({ api, token, user, device_id: deviceId() });
    return user;
  }
  throw new Error("login timed out — please re-run `stravibe login`");
}
