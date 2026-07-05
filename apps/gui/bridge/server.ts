import { randomUUID } from "node:crypto";
import { type Server, createServer } from "node:http";
import { argv } from "node:process";
import { fileURLToPath } from "node:url";
import { DEFAULT_DEV_ORIGINS } from "./cors.js";
import type { BridgeHandler } from "./handler.js";
import { startGuiBridge } from "./start.js";
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

// The dev script exports MEGASAVER_GUI_TOKEN so vite and the bridge share one
// token; absent that (a bare bridge start), mint a per-process random one.
export function resolveGuiToken(env: NodeJS.ProcessEnv): string {
  // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
  const fromEnv = env["MEGASAVER_GUI_TOKEN"];
  return fromEnv !== undefined && fromEnv.length > 0 ? fromEnv : randomUUID();
}

// The token handed to the handler — the /api wall is ALWAYS armed, in dev and
// distribution alike. No env disables it: the dev script exports a shared
// MEGASAVER_GUI_TOKEN so the frontend (which now attaches it) still reaches /api,
// and a bare bridge start mints a per-process random token.
export function resolveGuiAuthToken(env: NodeJS.ProcessEnv): string {
  return resolveGuiToken(env);
}

// Superset allowlist: the bridge's own serving origins PLUS the vite dev origins
// (5173). One list works in both modes — packaged (same-origin on `port`) and
// dev (vite on 5173 proxying to the bridge) — so there is no mode flag to keep
// in sync.
export function deriveGuiOrigins(port: number): readonly string[] {
  return [`http://127.0.0.1:${port}`, `http://localhost:${port}`, ...DEFAULT_DEV_ORIGINS];
}

async function main(): Promise<void> {
  const storeDir = resolveBridgeStorePath({
    storeOverride: readEnv("MEGASAVER_GUI_STORE"),
    home: readEnv("HOME") ?? readEnv("USERPROFILE"),
    xdgDataHome: readEnv("XDG_DATA_HOME"),
    platform: process.platform,
    localAppData: readEnv("LOCALAPPDATA"),
  });

  const portRaw = readEnv("MEGASAVER_GUI_BRIDGE_PORT");
  const port = portRaw ? Number.parseInt(portRaw, 10) : DEFAULT_PORT;
  // The dev script exports MEGASAVER_GUI_TOKEN so vite + bridge share one token;
  // resolveGuiAuthToken preserves that (and the wall stays always-on).
  const token = resolveGuiAuthToken(process.env);

  const { server, url } = await startGuiBridge({ storeDir, port, token });
  process.stdout.write(`mega-saver bridge listening on ${url}\n`);
  process.stdout.write(`store: ${storeDir}\n`);

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
