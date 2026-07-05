import { randomUUID } from "node:crypto";
import { type Server, createServer } from "node:http";
import { argv } from "node:process";
import { fileURLToPath } from "node:url";
import { createLauncherRegistry, ensurePredefinedRoles } from "@megasaver/agent-office";
import { createClaudeCodeLauncher } from "@megasaver/connector-claude-code";
import { createJsonDirectoryCoreRegistry, initStore } from "@megasaver/core";
import { DEFAULT_MCP_ARGS, DEFAULT_MCP_COMMAND } from "@megasaver/mcp-bridge";
import { type BridgeHandler, createBridgeHandler } from "./handler.js";
import { createMcpOps } from "./mcp-ops.js";
import { ensureOfficeProject } from "./routes/office.js";
import { resolveBridgeStorePath } from "./store-path.js";

const DEFAULT_PORT = 5174;

function readEnv(key: string): string | undefined {
  const value = process.env[key];
  return value === undefined || value.length === 0 ? undefined : value;
}

// Loopback-only bind: the bridge is a local control plane, never exposed on the
// LAN. Reused by `mega gui` (Slice C) to start the packaged server the same way.
export function createBridgeServer(handler: BridgeHandler, port: number): Server {
  const server = createServer(handler);
  server.listen(port, "127.0.0.1");
  return server;
}

async function main(): Promise<void> {
  const storeDir = resolveBridgeStorePath({
    storeOverride: readEnv("MEGASAVER_GUI_STORE"),
    home: readEnv("HOME") ?? readEnv("USERPROFILE"),
    xdgDataHome: readEnv("XDG_DATA_HOME"),
    platform: process.platform,
    localAppData: readEnv("LOCALAPPDATA"),
  });

  await initStore(storeDir);
  const registry = createJsonDirectoryCoreRegistry({ rootDir: storeDir });

  const mcpOps = createMcpOps({
    registry,
    home: readEnv("HOME") ?? readEnv("USERPROFILE") ?? "",
    // Runnable launch entry so a GUI-initiated install writes a config the
    // agent can actually spawn (`mega mcp serve`), reusing the CLI defaults
    // hoisted to @megasaver/mcp-bridge (no apps/gui → apps/cli import).
    command: DEFAULT_MCP_COMMAND,
    args: [...DEFAULT_MCP_ARGS],
  });
  const launcherRegistry = createLauncherRegistry([createClaudeCodeLauncher()]);
  const allowFull = readEnv("MEGA_OFFICE_ALLOW_FULL") === "1";
  // Seed the office Core project before serving: supervisor-created sessions
  // require it to exist, else every office task fails with project_not_found.
  ensureOfficeProject(registry, () => new Date().toISOString());
  // Seed the predefined role roster (idempotent) so the office shows ready-made
  // roles on first run; a no-op once any role exists.
  await ensurePredefinedRoles({
    storeRoot: storeDir,
    now: () => new Date().toISOString(),
    newId: () => randomUUID(),
  });
  const handler = createBridgeHandler({
    storePath: storeDir,
    registry,
    mcpOps,
    office: { coreRegistry: registry, registry: launcherRegistry, allowFull },
  });

  const portRaw = readEnv("MEGASAVER_GUI_BRIDGE_PORT");
  const port = portRaw ? Number.parseInt(portRaw, 10) : DEFAULT_PORT;
  const server = createBridgeServer(handler, port);
  server.once("listening", () => {
    process.stdout.write(`mega-saver bridge listening on http://127.0.0.1:${port}\n`);
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

// Only boot when run as the entrypoint; importing this module (tests, the
// `mega gui` command reusing createBridgeServer) must not start a server.
const isEntrypoint = argv[1] !== undefined && fileURLToPath(import.meta.url) === argv[1];
if (isEntrypoint) {
  main().catch((err: unknown) => {
    process.stderr.write(`bridge failed: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });
}
