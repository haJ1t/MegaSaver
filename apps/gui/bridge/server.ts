import { randomUUID } from "node:crypto";
import { argv } from "node:process";
import { fileURLToPath } from "node:url";
import { startGuiBridge } from "./start.js";
import { resolveBridgeStorePath } from "./store-path.js";

// Re-export the boot helpers so existing bridge consumers (tests, dev tooling)
// keep importing them from ./server; the canonical definitions moved to
// ./start so the `mega gui` bundle never pulls this module's entrypoint guard.
export { createBridgeServer, deriveGuiOrigins } from "./start.js";

const DEFAULT_PORT = 5174;

function readEnv(key: string): string | undefined {
  const value = process.env[key];
  return value === undefined || value.length === 0 ? undefined : value;
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
