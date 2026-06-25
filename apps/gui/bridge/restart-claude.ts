import { spawn } from "node:child_process";

// ponytail: macOS desktop only — this app targets darwin. Quit the Claude
// desktop app, then relaunch its binary with the proxy env so the fresh session
// (and the agent it spawns) routes through the local proxy. The current
// conversation dies on quit — the caller confirms first.
const CLAUDE_BIN = "/Applications/Claude.app/Contents/MacOS/Claude";

// Loopback-only guard: baseUrl is interpolated into a shell command, so reject
// anything that isn't our own proxy url to foreclose injection.
const LOOPBACK = /^http:\/\/127\.0\.0\.1:\d+$/;

export function buildRestartScript(baseUrl: string, bin = CLAUDE_BIN): string {
  if (!LOOPBACK.test(baseUrl)) throw new Error(`refusing non-loopback base url: ${baseUrl}`);
  // ponytail: sleep 2 covers single-instance lock release after quit; bump if
  // relaunch ever races a not-fully-exited app. Detached + backgrounded so it
  // outlives the bridge if the bridge is a child of the quitting app.
  return `osascript -e 'tell application "Claude" to quit'; sleep 2; ANTHROPIC_BASE_URL='${baseUrl}' '${bin}' >/dev/null 2>&1 &`;
}

export function restartClaude(baseUrl: string): void {
  const child = spawn("bash", ["-lc", buildRestartScript(baseUrl)], {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
}
