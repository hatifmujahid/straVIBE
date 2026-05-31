import os from "node:os";
import { createHash } from "node:crypto";

/**
 * Stable, anonymous machine id (no PII). Used to correlate a device across runs
 * and to link it to an OAuth identity on first login.
 */
export function deviceId() {
  const seed = `${os.hostname()}::${os.homedir()}::${os.userInfo().username}`;
  return "d_" + createHash("sha256").update(seed).digest("hex").slice(0, 24);
}
