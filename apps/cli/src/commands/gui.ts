import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import { resolveShippedGuiDistDir, startGuiBridge } from "@megasaver/gui/bridge";
import { defineCommand } from "citty";
import { mapErrorToCliMessage } from "../errors.js";
import { readStoreEnv, resolveStorePath } from "../store.js";

export type RunGuiInput = {
  port: number;
  open: boolean;
  storeFlag: string | undefined;
  cwd: string;
  home: string;
  xdgDataHome: string | undefined;
  platform: NodeJS.Platform;
  localAppData: string | undefined;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
  /** Override for tests; defaults to the shipped GUI dist beside the bundle. */
  distDir?: string;
  /** Override for tests; defaults to crypto.randomUUID. */
  newToken?: () => string;
  /** Override for tests; defaults to the OS-native opener. */
  openBrowser?: (url: string) => void;
};

export type RunGuiResult = {
  server: Server;
  url: string;
  port: number;
  token: string;
  stop: () => Promise<void>;
};

// Best-effort browser open: the printed URL is the guaranteed path, so a failed
// spawn is silent. The OS opener detaches (unref) so Ctrl-C on `mega gui` only
// stops the bridge, not the browser.
function openInBrowser(url: string): void {
  const platform = process.platform;
  const [cmd, args] =
    platform === "darwin"
      ? ["open", [url]]
      : platform === "win32"
        ? ["cmd", ["/c", "start", "", url]]
        : ["xdg-open", [url]];
  try {
    const child = spawn(cmd, args, { stdio: "ignore", detached: true });
    child.on("error", () => {});
    child.unref();
  } catch {
    // The URL is already printed; opening is a convenience, never a hard failure.
  }
}

// CRITICAL SECURITY: this function ALWAYS mints a token and passes it to
// startGuiBridge. There is no branch that starts the packaged GUI without auth —
// no flag, no env can disable the /api wall.
export async function runGui(input: RunGuiInput): Promise<RunGuiResult> {
  const storeDir = resolveStorePath(input);
  const token = (input.newToken ?? randomUUID)();
  const distDir = input.distDir ?? resolveShippedGuiDistDir(import.meta.url);

  const { server, url, port } = await startGuiBridge({
    storeDir,
    port: input.port,
    token,
    distDir,
  });

  input.stdout(`Mega Saver GUI: ${url}`);
  input.stdout(`store: ${storeDir}`);

  if (input.open) (input.openBrowser ?? openInBrowser)(url);

  const stop = (): Promise<void> => new Promise<void>((resolve) => server.close(() => resolve()));

  return { server, url, port, token, stop };
}

export const guiCommand = defineCommand({
  meta: {
    name: "gui",
    description: "Serve the Mega Saver GUI locally (loopback + token) and open it in the browser.",
  },
  args: {
    port: {
      type: "string",
      description: "Port to bind (default: an ephemeral free port).",
    },
    open: {
      type: "boolean",
      default: true,
      description: "Open the GUI in the browser. Use --no-open to skip.",
    },
    store: { type: "string", description: "Override store directory." },
  },
  async run({ args }) {
    const portArg = typeof args.port === "string" ? Number.parseInt(args.port, 10) : Number.NaN;
    const port = Number.isInteger(portArg) && portArg >= 0 ? portArg : 0;

    let result: RunGuiResult;
    try {
      result = await runGui({
        port,
        open: args.open !== false,
        ...readStoreEnv(typeof args.store === "string" ? args.store : undefined),
        stdout: (line) => console.log(line),
        stderr: (line) => console.error(line),
      });
    } catch (err) {
      const cli = mapErrorToCliMessage(err, { kind: "store" });
      console.error(cli.message);
      process.exitCode = cli.exitCode;
      return;
    }

    // Foreground: keep the process alive until Ctrl-C. The bound server keeps the
    // event loop busy; the signal handlers close it and exit.
    const shutdown = (signal: string): void => {
      console.error(`\ngui: received ${signal}, shutting down`);
      void result.stop().then(() => process.exit(0));
      setTimeout(() => process.exit(0), 1000).unref();
    };
    process.on("SIGINT", () => shutdown("SIGINT"));
    process.on("SIGTERM", () => shutdown("SIGTERM"));
  },
});
