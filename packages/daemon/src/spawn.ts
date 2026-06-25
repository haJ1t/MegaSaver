import { spawn } from "node:child_process";

// Pure: the argv is unit-tested; spawnDaemon just runs it. MEGA_DAEMON_CMD lets
// tests/dev point at a built binary or a stub instead of the global `mega`.
export function daemonSpawnArgs(
  storeRoot: string,
  env: NodeJS.ProcessEnv,
): { cmd: string; args: string[] } {
  return {
    // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
    cmd: env["MEGA_DAEMON_CMD"] ?? "mega",
    args: ["daemon", "serve", "--store", storeRoot],
  };
}

// Detached + unref so the daemon outlives the client that spawned it.
export function spawnDaemon(storeRoot: string, env: NodeJS.ProcessEnv = process.env): void {
  const { cmd, args } = daemonSpawnArgs(storeRoot, env);
  const child = spawn(cmd, args, { detached: true, stdio: "ignore" });
  child.unref();
}
