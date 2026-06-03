import { createServer } from "node:http";
import { createJsonDirectoryCoreRegistry, initStore } from "@megasaver/core";
import { createBridgeHandler } from "./handler.js";
import { createMcpOps } from "./mcp-ops.js";
import { resolveBridgeStorePath } from "./store-path.js";

const DEFAULT_PORT = 5174;

function readEnv(key: string): string | undefined {
  const value = process.env[key];
  return value === undefined || value.length === 0 ? undefined : value;
}

async function main(): Promise<void> {
  const storeDir = resolveBridgeStorePath({
    storeOverride: readEnv("MEGASAVER_GUI_STORE"),
    home: readEnv("HOME"),
    xdgDataHome: readEnv("XDG_DATA_HOME"),
  });

  await initStore(storeDir);
  const registry = createJsonDirectoryCoreRegistry({ rootDir: storeDir });

  const mcpOps = createMcpOps({
    registry,
    home: readEnv("HOME") ?? "",
    command: "mega-mcp",
  });
  const handler = createBridgeHandler({ registry, storePath: storeDir, mcpOps });
  const server = createServer(handler);

  const portRaw = readEnv("MEGASAVER_GUI_BRIDGE_PORT");
  const port = portRaw ? Number.parseInt(portRaw, 10) : DEFAULT_PORT;
  server.listen(port, () => {
    process.stdout.write(`mega-saver bridge listening on http://localhost:${port}\n`);
    process.stdout.write(`store: ${storeDir}\n`);
  });

  const shutdown = (signal: string): void => {
    process.stdout.write(`\nbridge: received ${signal}, shutting down\n`);
    server.close(() => {
      process.exit(0);
    });
    // Hard fallback if the server never closes (e.g. hung connection).
    setTimeout(() => {
      process.stderr.write("[bridge] forced shutdown after 1s grace period\n");
      process.exit(0);
    }, 1000).unref();
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((err: unknown) => {
  process.stderr.write(`bridge failed: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
