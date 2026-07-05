import { randomUUID } from "node:crypto";
import { type Server, createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { createLauncherRegistry, ensurePredefinedRoles } from "@megasaver/agent-office";
import { createClaudeCodeLauncher } from "@megasaver/connector-claude-code";
import { createJsonDirectoryCoreRegistry, initStore } from "@megasaver/core";
import { DEFAULT_MCP_ARGS, DEFAULT_MCP_COMMAND } from "@megasaver/mcp-bridge";
import { DEFAULT_DEV_ORIGINS } from "./cors.js";
import { type BridgeHandler, createBridgeHandler } from "./handler.js";
import { createMcpOps } from "./mcp-ops.js";
import { ensureOfficeProject } from "./routes/office.js";

// Loopback-only bind: the bridge is a local control plane, never exposed on the
// LAN. Lives here (not server.ts) so this module — the one `mega gui` inlines —
// never pulls server.ts's entrypoint boot guard into the CLI bundle.
export function createBridgeServer(handler: BridgeHandler, port: number): Server {
  const server = createServer(handler);
  server.listen(port, "127.0.0.1");
  return server;
}

// Superset allowlist: the bridge's own serving origins PLUS the vite dev origins
// (5173). One list works in both modes — packaged (same-origin on `port`) and
// dev (vite on 5173 proxying to the bridge) — so there is no mode flag to keep
// in sync.
export function deriveGuiOrigins(port: number): readonly string[] {
  return [`http://127.0.0.1:${port}`, `http://localhost:${port}`, ...DEFAULT_DEV_ORIGINS];
}

export interface StartGuiBridgeOptions {
  /** Resolved store directory (the caller — CLI or dev server.ts — owns store resolution). */
  storeDir: string;
  /** Listen port; pass 0 for an ephemeral port (tests, `--port 0`). */
  port: number;
  /** Bearer token guarding /api. `mega gui` ALWAYS passes one; dev passes the
   *  shared token. Omitted only by callers that mint their own — never packaged. */
  token?: string;
  /** Built GUI dist to serve for non-/api GETs. Absent → JSON-only bridge. */
  distDir?: string;
  /** CORS allowlist. Absent → derived from the actual serving port (+ dev origins). */
  origins?: readonly string[];
  /** Read HOME/USERPROFILE for mcp-ops config paths; defaults to process.env. */
  env?: NodeJS.ProcessEnv;
}

export interface StartedGuiBridge {
  server: Server;
  /** Tokenized URL a browser can open: http://127.0.0.1:<port>/?token=<t>. */
  url: string;
  port: number;
  token: string;
}

function readHome(env: NodeJS.ProcessEnv): string {
  // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
  return env["HOME"] ?? env["USERPROFILE"] ?? "";
}

// Single source of truth for booting the bridge — the full registry/office
// setup, handler build (token + distDir), and loopback bind. server.ts main()
// (dev) and `mega gui` (packaged) both call this so the boot sequence never
// forks. Resolves once the server is listening so the returned url carries the
// real port (important when port is 0).
export async function startGuiBridge(opts: StartGuiBridgeOptions): Promise<StartedGuiBridge> {
  const env = opts.env ?? process.env;
  const token = opts.token ?? randomUUID();
  const home = readHome(env);

  await initStore(opts.storeDir);
  const registry = createJsonDirectoryCoreRegistry({ rootDir: opts.storeDir });

  const mcpOps = createMcpOps({
    registry,
    home,
    command: DEFAULT_MCP_COMMAND,
    args: [...DEFAULT_MCP_ARGS],
  });
  const launcherRegistry = createLauncherRegistry([createClaudeCodeLauncher()]);
  // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
  const allowFull = env["MEGA_OFFICE_ALLOW_FULL"] === "1";

  ensureOfficeProject(registry, () => new Date().toISOString());
  await ensurePredefinedRoles({
    storeRoot: opts.storeDir,
    now: () => new Date().toISOString(),
    newId: () => randomUUID(),
  });

  // Bind FIRST, then learn the real port so the CORS allowlist matches the
  // origin the browser is actually served from. Deriving origins from opts.port
  // would produce `http://127.0.0.1:0` under `--port 0` and 403 every same-origin
  // write. The request listener is attached after the port is known.
  const server = createServer();
  server.listen(opts.port, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const boundPort = (server.address() as AddressInfo).port;

  const handler = createBridgeHandler({
    storePath: opts.storeDir,
    registry,
    mcpOps,
    office: { coreRegistry: registry, registry: launcherRegistry, allowFull },
    token,
    origins: opts.origins ?? deriveGuiOrigins(boundPort),
    ...(opts.distDir !== undefined ? { distDir: opts.distDir } : {}),
  });
  server.on("request", handler);

  const url = `http://127.0.0.1:${boundPort}/?token=${token}`;
  return { server, url, port: boundPort, token };
}
