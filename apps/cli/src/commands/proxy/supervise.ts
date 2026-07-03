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
  superviseDrive,
  upstreamBaseUrlSchema,
  withTransitionLock,
} from "@megasaver/proxy-control";
import { defineCommand } from "citty";
import { readStoreEnv, resolveStorePath } from "../../store.js";

const DEFAULT_PORT = 8787;
const DEFAULT_UPSTREAM = "https://api.anthropic.com";
const MONITOR_MS = 5000;

export type SuperviseHandle = {
  running: RunningProxy;
  listener: ListenerControl;
  instanceId: string;
  capability: string;
};

export type RunProxySuperviseInput = {
  port: number;
  upstream: string;
  storeRoot: string;
  stdout: (line: string) => void;
  /** Injectable for tests; defaults to the real server. */
  startServer?: typeof startProxyServer;
};

// Bind the loopback listener WITH an ownership health capability + usage metering,
// and expose a ListenerControl the supervisor drives. The health capability is a
// fresh in-process secret; the self-check trusts our own live listener (the HMAC
// endpoint exists so a DIFFERENT supervisor can verify this one, not for a
// self-probe). The URL shape is re-validated (defense in depth) so no caller can
// bind a listener that forwards the client's auth headers to a hostile origin.
export async function runProxySupervise(input: RunProxySuperviseInput): Promise<SuperviseHandle> {
  const start = input.startServer ?? startProxyServer;
  const upstream = upstreamBaseUrlSchema.parse(input.upstream);
  const capability = randomUUID();
  const instanceId = randomUUID();
  let alive = true;
  const running = await start({
    port: input.port,
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
  return { running, listener, instanceId, capability };
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
};

export type SupervisorRuntime = { stop: () => Promise<void> };

// The long-running supervisor: bind the listener, then reconcile desired↔actual
// on a fixed cadence. Each tick runs the state machine under the transition lock
// (serialized against `mega proxy start/stop` and the GUI), so the route is
// actually applied/verified — this is what turns a persisted enable intent into a
// live route and keeps it healthy, closing the "healthy but unrouted" gap.
export async function runSupervisor(input: RunSupervisorInput): Promise<SupervisorRuntime> {
  const handle = await runProxySupervise({
    port: input.port,
    upstream: input.upstream,
    storeRoot: input.storeRoot,
    stdout: input.stdout,
    ...(input.startServer ? { startServer: input.startServer } : {}),
  });
  const identity = input.identity ?? nodeProcessIdentity;
  const now = input.now ?? Date.now;
  const self = identity.self();
  const deps: SupervisorDeps = {
    storeRoot: input.storeRoot,
    route: input.route ?? createClaudeRouteAdapter(input.settingsPath),
    listener: handle.listener,
    ownedUrl: input.ownedUrl,
    instanceId: handle.instanceId,
    processStartToken: self.processStartToken,
    bootId: self.bootId,
    now,
  };

  const tick = (): void => {
    // A concurrent CLI/GUI writer holding the lock ("locked") just means this
    // tick is skipped; the next one picks the state up.
    withTransitionLock(input.storeRoot, now(), "supervisor", () => superviseDrive(deps), identity);
  };
  tick();
  const timer = setInterval(tick, input.monitorMs ?? MONITOR_MS);
  if (typeof timer.unref === "function") timer.unref();

  return {
    stop: async () => {
      clearInterval(timer);
      handle.listener.stop();
      await handle.running.close();
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
    const runtime = await runSupervisor({
      port,
      upstream: parsed.data,
      storeRoot,
      ownedUrl: `http://127.0.0.1:${port}`,
      settingsPath: resolveClaudeCodeSettingsPath(),
      stdout: (line) => console.log(line),
    });

    // Drain on termination: stop only our own listener; never touch a foreign
    // route. The LaunchAgent restarts us; the persisted state is the source of
    // truth on the next boot.
    const shutdown = () => {
      void runtime.stop().then(() => process.exit(0));
    };
    process.once("SIGTERM", shutdown);
    process.once("SIGINT", shutdown);
    // The listener + monitor interval keep the event loop alive until a signal.
  },
});
