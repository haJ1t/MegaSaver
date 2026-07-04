import type { RunningProxy } from "@megasaver/llm-proxy";
import type { ProxyRuntimeState } from "@megasaver/proxy-control";

export type BindOutcome =
  | { kind: "listening"; running: RunningProxy }
  | { kind: "already-running"; instanceId: string }
  | { kind: "foreign"; message: string };

export type BindOrDetectDeps = {
  startServer: (port: number) => Promise<RunningProxy>;
  readRuntime: () => ProxyRuntimeState | null;
  probeOurs: (rt: ProxyRuntimeState) => Promise<boolean>;
  isLiveOwner: (rt: ProxyRuntimeState) => boolean;
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

// Confirm the port holder is our live proxy: the cryptographic health probe is
// definitive, so prefer it whenever the runtime advertises a capability; only when
// no capability is recorded do we fall back to pid-liveness. A runtime with a
// capability but a failing probe is NOT ours (foreign / stale), so we never let a
// bare pid-liveness match override a failed probe.
async function ownsPort(rt: ProxyRuntimeState, deps: BindOrDetectDeps): Promise<boolean> {
  if (rt.healthCapability !== "") return deps.probeOurs(rt);
  return deps.isLiveOwner(rt);
}

// Idempotent bind: try to listen; on EADDRINUSE decide who holds the port. If it
// is provably our live proxy → already-running (the caller no-ops). Otherwise the
// prior instance may still be releasing the port (respawn race) → bounded retry.
// After the attempts are exhausted and it is still not ours → foreign, with a
// clear one-line message and no crash. A non-EADDRINUSE bind error is a genuine
// fault and is rethrown so it surfaces.
export async function bindOrDetectRunning(deps: BindOrDetectDeps): Promise<BindOutcome> {
  const maxAttempts = deps.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const delayMs = deps.delayMs ?? DEFAULT_DELAY_MS;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return { kind: "listening", running: await deps.startServer(deps.port) };
    } catch (e) {
      if (!isAddrInUse(e)) throw e;
      const rt = deps.readRuntime();
      if (rt !== null && (await ownsPort(rt, deps))) {
        return { kind: "already-running", instanceId: rt.instanceId };
      }
      if (attempt < maxAttempts) await deps.sleep(delayMs);
    }
  }

  return {
    kind: "foreign",
    message: `port ${deps.port} is held by a non-megasaver process — free it or set MEGASAVER_PROXY_PORT`,
  };
}
