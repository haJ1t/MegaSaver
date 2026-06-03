import type { CoreRegistry } from "@megasaver/core";
import { type McpBridge, type McpBridgeConfig, createBridge } from "@megasaver/mcp-bridge";
import { defineCommand } from "citty";
import { ensureStoreReady, resolveStorePath } from "../../store.js";

export type RunMcpServeDeps = {
  // Resolves the store root + a CoreRegistry. Injected so the unit
  // test never touches disk; production builds a JsonDirectoryCoreRegistry
  // exactly as `mega output exec` does.
  resolveStore: () => Promise<{ storeRoot: string; registry: CoreRegistry }>;
  // Injected createBridge so the test asserts the config + controls
  // start/stop without a real StdioServerTransport.
  createBridge: (config: McpBridgeConfig) => McpBridge;
  // Holds the process alive until stdin closes / SIGINT / SIGTERM.
  // Injected so the unit test resolves immediately (no real stdin
  // attach, no hanging event loop).
  waitForShutdown: () => Promise<void>;
  stderr: (line: string) => void;
  transportFactory?: McpBridgeConfig["transportFactory"];
};

// Long-running stdio server entry: an agent spawns `mega mcp serve`
// and speaks MCP over its stdio. Builds the bridge, starts it, then
// blocks on `waitForShutdown` (the real StdioServerTransport holds
// the event loop; we add a clean shutdown on stdin-end / signal),
// and always stops the bridge on the way out. Returns 0 on a clean
// shutdown, 1 if the transport fails. NO `--json` (it is not a
// one-shot command).
export async function runMcpServe(deps: RunMcpServeDeps): Promise<0 | 1> {
  const { storeRoot, registry } = await deps.resolveStore();
  const bridge = deps.createBridge({
    transport: "stdio",
    storeRoot,
    registry,
    ...(deps.transportFactory !== undefined ? { transportFactory: deps.transportFactory } : {}),
  });
  await bridge.start();
  try {
    await deps.waitForShutdown();
    return 0;
  } catch (err) {
    deps.stderr(`error: mcp serve failed: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  } finally {
    await bridge.stop();
  }
}

// Resolves when stdin reaches EOF or the process receives SIGINT /
// SIGTERM, so the supervising agent can shut the bridge down cleanly.
function waitForStdioShutdown(): Promise<void> {
  return new Promise<void>((resolve) => {
    const done = (): void => {
      process.stdin.off("end", done);
      process.off("SIGINT", done);
      process.off("SIGTERM", done);
      resolve();
    };
    process.stdin.once("end", done);
    process.once("SIGINT", done);
    process.once("SIGTERM", done);
  });
}

export const mcpServeCommand = defineCommand({
  meta: {
    name: "serve",
    description: "Run the Mega Saver MCP bridge over stdio (long-running).",
  },
  args: {
    store: { type: "string", description: "Override store directory." },
  },
  async run({ args }) {
    const code = await runMcpServe({
      resolveStore: async () => {
        const storeRoot = resolveStorePath({
          storeFlag: typeof args.store === "string" ? args.store : undefined,
          cwd: process.cwd(),
          // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
          home: process.env["HOME"] ?? "",
          // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
          xdgDataHome: process.env["XDG_DATA_HOME"],
        });
        const { registry } = await ensureStoreReady(storeRoot);
        return { storeRoot, registry };
      },
      createBridge,
      waitForShutdown: waitForStdioShutdown,
      stderr: (line) => console.error(line),
    });
    if (code !== 0) process.exitCode = code;
  },
});
