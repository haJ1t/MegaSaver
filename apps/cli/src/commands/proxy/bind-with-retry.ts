import type { RunningProxy } from "@megasaver/llm-proxy";

export type BindOutcome = { kind: "listening"; running: RunningProxy } | { kind: "already-in-use" };

export type BindWithRetryDeps = {
  startServer: (port: number) => Promise<RunningProxy>;
  sleep: (ms: number) => Promise<void>;
  port: number;
  maxAttempts?: number;
  delayMs?: number;
};

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_DELAY_MS = 300;

function isAddrInUse(e: unknown): boolean {
  return (e as NodeJS.ErrnoException | null)?.code === "EADDRINUSE";
}

// Idempotent bind for a KeepAlive launchd singleton. Try to listen; a persistent
// EADDRINUSE means another instance/process already owns the port, so retry a
// bounded number of times to absorb the launchd respawn release-race, then report
// `already-in-use` (the caller no-ops + exits cleanly). A non-EADDRINUSE bind
// error is a genuine fault and is rethrown so it surfaces.
export async function bindWithRetry(deps: BindWithRetryDeps): Promise<BindOutcome> {
  const maxAttempts = deps.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const delayMs = deps.delayMs ?? DEFAULT_DELAY_MS;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return { kind: "listening", running: await deps.startServer(deps.port) };
    } catch (e) {
      if (!isAddrInUse(e)) throw e;
      if (attempt < maxAttempts) await deps.sleep(delayMs);
    }
  }

  return { kind: "already-in-use" };
}
