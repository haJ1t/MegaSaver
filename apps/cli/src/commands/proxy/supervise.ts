import { type RunningProxy, appendProxyUsage, startProxyServer } from "@megasaver/llm-proxy";
import { defineCommand } from "citty";
import { readStoreEnv, resolveStorePath } from "../../store.js";

const DEFAULT_PORT = 8787;
const DEFAULT_UPSTREAM = "https://api.anthropic.com";

export type RunProxySuperviseInput = {
  port: number;
  upstream: string;
  storeRoot: string;
  stdout: (line: string) => void;
  /** Injectable for tests; defaults to the real server. */
  startServer?: typeof startProxyServer;
};

export async function runProxySupervise(input: RunProxySuperviseInput): Promise<RunningProxy> {
  const start = input.startServer ?? startProxyServer;
  const running = await start({
    port: input.port,
    upstreamBaseUrl: input.upstream,
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
  return running;
}

export const proxySuperviseCommand = defineCommand({
  meta: {
    name: "supervise",
    description:
      "Internal foreground supervisor (LaunchAgent target): bind the listener + meter usage.",
  },
  args: {
    port: { type: "string", description: `Local port (default ${DEFAULT_PORT}).` },
    upstream: { type: "string", description: `Upstream base URL (default ${DEFAULT_UPSTREAM}).` },
    store: { type: "string", description: "Override store directory." },
  },
  async run({ args }) {
    const portArg = typeof args.port === "string" ? Number.parseInt(args.port, 10) : DEFAULT_PORT;
    const port = Number.isFinite(portArg) ? portArg : DEFAULT_PORT;
    const upstream = typeof args.upstream === "string" ? args.upstream : DEFAULT_UPSTREAM;
    const storeRoot = resolveStorePath(
      readStoreEnv(typeof args.store === "string" ? args.store : undefined),
    );
    await runProxySupervise({
      port,
      upstream,
      storeRoot,
      stdout: (line) => console.log(line),
    });
    // The listening server keeps the event loop alive; the process stays up until
    // the operator stops it (Ctrl-C). Nothing further to do here.
  },
});
