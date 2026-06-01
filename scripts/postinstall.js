#!/usr/bin/env node
// Printed once, right after `npm i -g stravibe`. npm runs install scripts with
// no interactive TTY (and sometimes as root / in CI), so we deliberately do NOT
// prompt or launch a browser here — we just point the user at `stravibe login`.
// This must NEVER fail the install: any error is swallowed and we exit 0.
//
// Opt out with STRAVIBE_NO_POSTINSTALL=1 (and we stay quiet in CI).
try {
  if (process.env.STRAVIBE_NO_POSTINSTALL || process.env.CI) process.exit(0);

  const bold = (s) => (process.stdout.isTTY ? `\x1b[1m${s}\x1b[0m` : s);
  const dim = (s) => (process.stdout.isTTY ? `\x1b[2m${s}\x1b[0m` : s);

  console.log(`
${bold("straVIBE installed.")} Track your AI coding-agent token usage on the leaderboard.

Next step — link your account (GitHub or email):

    ${bold("stravibe login")}

Logging in submits your last 90 days of usage and turns on auto-sync, so every
future Claude Code session is counted automatically.

${dim("Privacy: only token counts, model names, agent names, and timestamps leave your machine.")}
`);
} catch {
  // never block an install over a welcome message
}
process.exit(0);
