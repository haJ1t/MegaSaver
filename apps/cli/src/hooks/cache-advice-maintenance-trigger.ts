import { spawn } from "node:child_process";
import { realpathSync } from "node:fs";
import { join } from "node:path";
import { cacheAdviceMigrationComplete } from "./cache-advice-migration-journal.js";
import { effectivePosixUserId, privateFileSnapshot } from "./cache-advice-private-node.js";

const OVERLAY_RETENTION_MS = 30 * 86_400_000;

function resolveMaintenanceCliEntry(): string | undefined {
  const argv1 = process.argv[1];
  if (argv1 === undefined || argv1 === "") return undefined;
  if (argv1.startsWith("/")) return argv1;
  try {
    return realpathSync(argv1);
  } catch {
    return undefined;
  }
}

// Single-flight, detached, best-effort. Never throws: a failure to spawn is a
// safe false negative. The store path is passed only via --store; it is never
// logged or persisted anywhere else.
export async function triggerCacheAdviceMaintenance(input: { storeRoot: string }): Promise<void> {
  if (process.platform === "win32") return;
  try {
    if (await cacheAdviceMigrationComplete(input.storeRoot)) return;
    const uid = effectivePosixUserId();
    const lockPath = join(input.storeRoot, "stats", "cache-advice-v3", ".migration.lock");
    // Single-flight: a live lock suppresses a duplicate worker. A lock older
    // than the 30-day expiry window is stale (crashed worker) and does not
    // suppress; the maintainer reclaims it under its own acquire discipline.
    const lock = await privateFileSnapshot(lockPath, uid);
    if (lock !== undefined && Date.now() - lock.mtimeMs < OVERLAY_RETENTION_MS) return;
    const entry = resolveMaintenanceCliEntry();
    if (entry === undefined) return;
    const child = spawn(
      process.execPath,
      [entry, "hooks", "cache-advice-maintain", "--store", input.storeRoot],
      {
        // POSIX-only by the early return above; detach so the worker outlives
        // the hook process. Typed as a literal to satisfy exactOptional checks.
        detached: true as boolean,
        stdio: "ignore",
        windowsHide: true,
      },
    );
    child.on("error", () => undefined);
    child.unref();
  } catch {
    // Best-effort trigger: never propagate.
  }
}
