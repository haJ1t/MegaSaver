import { spawn } from "node:child_process";

// Pure: the argv is unit-tested; spawnDaemon just runs it. MEGA_DAEMON_CMD lets
// tests/dev point at a built binary or a stub instead of the global `mega`.
export function daemonSpawnArgs(
  storeRoot: string,
  env: NodeJS.ProcessEnv,
): { cmd: string; args: string[] } {
  // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
  if (env["MEGA_DAEMON_CMD"]) {
    return {
      // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
      cmd: env["MEGA_DAEMON_CMD"],
      args: ["daemon", "serve", "--store", storeRoot],
    };
  }
  const mainScript = process.argv[1];
  if (
    mainScript &&
    (mainScript.endsWith("mega.mjs") ||
      mainScript.endsWith("mega.js") ||
      mainScript.endsWith("cli.ts") ||
      mainScript.endsWith("cli.js"))
  ) {
    return {
      cmd: process.execPath,
      args: [mainScript, "daemon", "serve", "--store", storeRoot],
    };
  }
  return {
    cmd: "mega",
    args: ["daemon", "serve", "--store", storeRoot],
  };
}

// Detached + unref so the daemon outlives the client that spawned it.
export function spawnDaemon(storeRoot: string, env: NodeJS.ProcessEnv = process.env): void {
  const { cmd, args } = daemonSpawnArgs(storeRoot, env);
  try {
    const child = spawn(cmd, args, { detached: true, stdio: "ignore" });
    child.on("error", () => {});
    child.unref();
  } catch {}
}
