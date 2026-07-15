import { randomUUID } from "node:crypto";
import {
  createClaudeRouteAdapter,
  resolveClaudeCodeSettingsPath,
} from "@megasaver/connector-claude-code";
import { type RunningProxy, appendProxyUsage, startProxyServer } from "@megasaver/llm-proxy";
import {
  type ListenerControl,
  type ProcessIdentityAdapter,
  type RouteAdapter,
  type SupervisorDeps,
  nodeProcessIdentity,
  readControlState,
  runStartupRecovery,
  superviseDrive,
  upstreamBaseUrlSchema,
  withTransitionLock,
  writeControlState,
} from "@megasaver/proxy-control";
import { defineCommand } from "citty";
import { readStoreEnv, resolveStorePath } from "../../store.js";
import { type BindWithRetryDeps, bindWithRetry } from "./bind-with-retry.js";

const DEFAULT_PORT = 8787;
const DEFAULT_UPSTREAM = "https://api.anthropic.com";
const MONITOR_MS = 5000;

export type SuperviseHandle = {
  running: RunningProxy;
  listener: ListenerControl;
  instanceId: string;
  capability: string;
};

export type SuperviseResult =
  | { kind: "listening"; handle: SuperviseHandle }
  | { kind: "already-in-use" };

export type RunProxySuperviseInput = {
  port: number;
  upstream: string;
  storeRoot: string;
  stdout: (line: string) => void;
  /** Injectable for tests; defaults to the real server. */
  startServer?: typeof startProxyServer;
  /** Injectable for tests so the bounded retry does not really wait. */
  sleep?: BindWithRetryDeps["sleep"];
};

function defaultSleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// Bind the loopback listener WITH an ownership health capability + usage metering,
// and expose a ListenerControl the supervisor drives. The health capability is a
// fresh in-process secret answered locally and never forwarded upstream. The URL
// shape is re-validated (defense in depth) so no caller can bind a listener that
// forwards the client's auth headers to a hostile origin.
//
// The bind is idempotent for a KeepAlive launchd singleton: a persistent
// EADDRINUSE (another instance/process already owns the port) yields
// `already-in-use` and the redundant spawn/start no-ops; only a genuine
// `listening` result carries a handle the supervisor drives. A non-EADDRINUSE bind
// error is rethrown so it surfaces.
export async function runProxySupervise(input: RunProxySuperviseInput): Promise<SuperviseResult> {
  const start = input.startServer ?? startProxyServer;
  const upstream = upstreamBaseUrlSchema.parse(input.upstream);
  const capability = randomUUID();
  const instanceId = randomUUID();
  let alive = true;

  const startServer = (port: number): Promise<RunningProxy> =>
    start({
      port,
      upstreamBaseUrl: upstream,
      health: { capability, instanceId },
      onUsage: (event) => {
        // Persist is best-effort: a measurement write must never disrupt proxying.
        void appendProxyUsage({ storeRoot: input.storeRoot, event }).catch(() => {});
        const cache = event.cacheReadTokens > 0 ? ` cache=${event.cacheReadTokens}` : "";
        input.stdout(
          `· ${event.model}  in=${event.inputTokens} out=${event.outputTokens}${cache}${event.stream ? " (stream)" : ""}`,
        );
      },
    });

  const outcome = await bindWithRetry({
    startServer,
    sleep: input.sleep ?? defaultSleep,
    port: input.port,
  });

  if (outcome.kind === "already-in-use") {
    return { kind: "already-in-use" };
  }

  const running = outcome.running;
  input.stdout(`mega proxy listening on ${running.url}`);
  input.stdout(`point your agent at it:  export ANTHROPIC_BASE_URL=${running.url}`);
  input.stdout(
    "(only tool/conversation token counts are recorded — never prompts, responses, or keys)",
  );
  const listener: ListenerControl = {
    isAlive: () => alive,
    stop: () => {
      alive = false;
      void running.close();
    },
    healthCheck: () => (alive ? "matching" : "none"),
  };
  return { kind: "listening", handle: { running, listener, instanceId, capability } };
}

export type RunSupervisorInput = {
  port: number;
  upstream: string;
  storeRoot: string;
  ownedUrl: string;
  settingsPath: string;
  stdout: (line: string) => void;
  startServer?: typeof startProxyServer;
  route?: RouteAdapter;
  identity?: ProcessIdentityAdapter;
  now?: () => number;
  monitorMs?: number;
  sleep?: BindWithRetryDeps["sleep"];
};

export type SupervisorRuntime = { stop: () => Promise<void> };

// A live listener started + monitor running, or a terminal no-op: `already-in-use`
// (another instance/process already owns the port). The caller exits 0 on
// `already-in-use` and keeps the event loop alive only for `listening`.
export type SupervisorStartResult =
  | { kind: "listening"; runtime: SupervisorRuntime }
  | { kind: "already-in-use" };

// The long-running supervisor: bind the listener, then reconcile desired↔actual
// on a fixed cadence. Each tick runs the state machine under the transition lock
// (serialized against `mega proxy start/stop` and the GUI), so the route is
// actually applied/verified — this is what turns a persisted enable intent into a
// live route and keeps it healthy, closing the "healthy but unrouted" gap.
export async function runSupervisor(input: RunSupervisorInput): Promise<SupervisorStartResult> {
  const result = await runProxySupervise({
    port: input.port,
    upstream: input.upstream,
    storeRoot: input.storeRoot,
    stdout: input.stdout,
    ...(input.startServer ? { startServer: input.startServer } : {}),
    ...(input.sleep ? { sleep: input.sleep } : {}),
  });
  // A second binder is a no-op, not a monitor: never drive the state machine when
  // we did not bind the port, so we cannot stomp the live owner's route/lease.
  if (result.kind === "already-in-use") {
    return { kind: "already-in-use" };
  }
  const handle = result.handle;
  const identity = input.identity ?? nodeProcessIdentity;
  const now = input.now ?? Date.now;
  const self = identity.self();
  const deps: SupervisorDeps = {
    storeRoot: input.storeRoot,
    route:
      input.route ??
      createClaudeRouteAdapter(input.settingsPath, {
        // A custom upstream is genuinely non-first-party: asserting otherwise
        // would leak client attribution/beta behavior to a third-party origin.
        // Origin-compare, matching the credential-forwarding gate: a trailing
        // slash or case difference must not silently disable the flag.
        assumeFirstParty: new URL(input.upstream).origin === new URL(DEFAULT_UPSTREAM).origin,
      }),
    listener: handle.listener,
    ownedUrl: input.ownedUrl,
    instanceId: handle.instanceId,
    processStartToken: self.processStartToken,
    bootId: self.bootId,
    now,
  };

  const tick = (): void => {
    try {
      // A concurrent CLI/GUI writer holding the lock ("locked") just means this
      // tick is skipped; the next one picks the state up.
      withTransitionLock(
        input.storeRoot,
        now(),
        "supervisor",
        () => superviseDrive(deps),
        identity,
      );
    } catch {
      // A monitor tick must NEVER crash the daemon (e.g. a transient route I/O
      // error). Record it as a diagnostic and keep the loop alive; the next tick
      // re-reconciles. Best-effort — a failed record must not throw either.
      try {
        const c = readControlState(input.storeRoot);
        const at = new Date(now()).toISOString();
        writeControlState(input.storeRoot, {
          ...c,
          lastError: { code: "runtime_failed", detail: null, at },
          updatedAt: at,
        });
      } catch {
        /* best-effort */
      }
    }
  };
  // Boot recovery: drive any transition a crashed predecessor left mid-flight to a
  // fixpoint via the pure recovery matrix before the first live tick advances a
  // fresh enable.
  withTransitionLock(
    input.storeRoot,
    now(),
    "supervisor",
    () => runStartupRecovery(deps),
    identity,
  );
  tick();
  const timer = setInterval(tick, input.monitorMs ?? MONITOR_MS);
  if (typeof timer.unref === "function") timer.unref();

  return {
    kind: "listening",
    runtime: {
      stop: async () => {
        clearInterval(timer);
        handle.listener.stop();
        await handle.running.close();
      },
    },
  };
}

export const proxySuperviseCommand = defineCommand({
  meta: {
    name: "supervise",
    description:
      "Internal foreground supervisor (LaunchAgent target): bind the listener, meter usage, and reconcile the route.",
  },
  args: {
    port: { type: "string", description: `Local port (default ${DEFAULT_PORT}).` },
    upstream: { type: "string", description: `Upstream base URL (default ${DEFAULT_UPSTREAM}).` },
    "confirm-credential-forwarding": {
      type: "boolean",
      default: false,
      description:
        "Required to point --upstream at a non-default origin (acknowledges the client's API key is forwarded there).",
    },
    store: { type: "string", description: "Override store directory." },
  },
  async run({ args }) {
    const portArg = typeof args.port === "string" ? Number.parseInt(args.port, 10) : DEFAULT_PORT;
    const port = Number.isFinite(portArg) ? portArg : DEFAULT_PORT;
    const upstream = typeof args.upstream === "string" ? args.upstream : DEFAULT_UPSTREAM;

    const parsed = upstreamBaseUrlSchema.safeParse(upstream);
    if (!parsed.success) {
      console.error(
        "mega proxy supervise: invalid --upstream (must be https:// or a loopback origin, no userinfo/path/query).",
      );
      process.exitCode = 1;
      return;
    }
    // Forwarding the client's auth headers to any origin other than the default
    // Anthropic API is a credential-forwarding action; gate it behind an explicit
    // acknowledgement so a stray/hostile --upstream cannot silently exfiltrate the
    // operator's API key.
    const targetOrigin = new URL(parsed.data).origin;
    const isDefaultOrigin = targetOrigin === new URL(DEFAULT_UPSTREAM).origin;
    if (!isDefaultOrigin && !args["confirm-credential-forwarding"]) {
      console.error(
        `mega proxy supervise: --upstream ${targetOrigin} forwards the client's API key to a non-default origin. Re-run with --confirm-credential-forwarding to acknowledge.`,
      );
      process.exitCode = 1;
      return;
    }

    const storeRoot = resolveStorePath(
      readStoreEnv(typeof args.store === "string" ? args.store : undefined),
    );

    // The idempotent bind can fail terminally (port persistently in use); catching
    // here is what turns launchd's EADDRINUSE crash-loop into a clean decision —
    // never a raw stack / unhandled rejection. A non-EADDRINUSE fault still
    // surfaces here as a non-zero exit.
    let result: SupervisorStartResult;
    try {
      result = await runSupervisor({
        port,
        upstream: parsed.data,
        storeRoot,
        ownedUrl: `http://127.0.0.1:${port}`,
        settingsPath: resolveClaudeCodeSettingsPath(),
        stdout: (line) => console.log(line),
      });
    } catch (e) {
      console.error(
        `mega proxy supervise: failed to start the proxy: ${e instanceof Error ? e.message : String(e)}`,
      );
      process.exitCode = 1;
      return;
    }

    // Another instance/process already owns the port. On a KeepAlive launchd
    // singleton a persistent EADDRINUSE means respawning is futile, so exit 0 —
    // the plist's KeepAlive{SuccessfulExit:false} does NOT respawn a clean exit,
    // which stops the crash-loop. One clear line, no retry loop, no stack trace.
    if (result.kind === "already-in-use") {
      console.error(
        `mega proxy supervise: port ${port} already in use — another instance or process owns it; this supervisor is exiting. If the proxy is unexpectedly down, check what holds :${port}.`,
      );
      process.exitCode = 0;
      return;
    }

    const runtime = result.runtime;
    // A signal is an intentional stop (operator Ctrl-C, `launchctl bootout` for
    // uninstall, or logout). Stop ONLY our own listener; never touch the route
    // (the persisted control state stays authoritative). We exit 0: under the
    // plist's KeepAlive{SuccessfulExit:false} a clean exit is NOT auto-relaunched,
    // which is what we want for an intentional stop — launchd re-runs us on the
    // next RunAtLoad (login) if the service is still installed.
    const shutdown = () => {
      void runtime.stop().then(() => process.exit(0));
    };
    process.once("SIGTERM", shutdown);
    process.once("SIGINT", shutdown);
    // The listener + monitor interval keep the event loop alive until a signal.
  },
});
