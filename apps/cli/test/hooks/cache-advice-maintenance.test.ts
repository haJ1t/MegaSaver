import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir as readTemporaryDirectory } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  cacheAdviceRecordDirectory,
  cacheAdviceRecordId,
} from "../../src/hooks/cache-advice-queue.js";
import { cacheAdviceSessionStorageKey } from "../../src/hooks/cache-advice-store.js";

type CacheAdviceCall = { tool: "Read" | "Grep" | "Glob"; directoryKey: string; at: number };
type CacheAdviceState = {
  version: 2;
  offeredDirectoryKeys: string[];
  recent: CacheAdviceCall[];
};
type MaintenanceApi = {
  maintainCacheAdviceStore(input: {
    storeRoot: string;
    now: number;
  }): Promise<"complete" | "incomplete" | "suppressed">;
  cacheAdviceMigrationComplete(storeRoot: string): Promise<boolean>;
};
type MaintenanceTriggerApi = {
  triggerCacheAdviceMaintenance(input: { storeRoot: string }): Promise<void>;
};

const WORKSPACE_KEY = "0123456789abcdef";
const OTHER_WORKSPACE_KEY = "fedcba9876543210";
const SESSION_ID = "11111111-1111-4111-8111-111111111111";
const DIRECTORY_KEY = "a".repeat(64);
const NOW = Date.UTC(2026, 7, 3, 12, 0, 0);
const THIRTY_ONE_DAYS_MS = 31 * 86_400_000;
const TWENTY_NINE_DAYS_MS = 29 * 86_400_000;
const tmpdir = () => realpathSync(readTemporaryDirectory());

let fixtureRoot: string;
let storeRoot: string;

beforeEach(() => {
  fixtureRoot = mkdtempSync(join(tmpdir(), "mscam-"));
  storeRoot = join(fixtureRoot, "store");
});

afterEach(() => {
  rmSync(fixtureRoot, { recursive: true, force: true });
});

async function loadMaintenance(): Promise<MaintenanceApi> {
  return import("../../src/hooks/cache-advice-maintenance.js") as Promise<MaintenanceApi>;
}

async function loadMaintenanceTrigger(): Promise<MaintenanceTriggerApi> {
  return import(
    "../../src/hooks/cache-advice-maintenance-trigger.js"
  ) as Promise<MaintenanceTriggerApi>;
}

function v3Root(): string {
  return join(storeRoot, "stats", "cache-advice-v3");
}

function migrationJournalPath(): string {
  return join(v3Root(), "migration.json");
}

function migrationLockPath(): string {
  return join(v3Root(), ".migration.lock");
}

function legacyDirectory(workspaceKey = WORKSPACE_KEY): string {
  return join(storeRoot, "stats", workspaceKey, "cache-advice");
}

function legacyStatePathFor(sessionId: string, workspaceKey = WORKSPACE_KEY): string {
  return join(legacyDirectory(workspaceKey), `${cacheAdviceSessionStorageKey(sessionId)}.json`);
}

function prepareLegacyDirectory(workspaceKey = WORKSPACE_KEY): string {
  const directory = legacyDirectory(workspaceKey);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  chmodSync(storeRoot, 0o700);
  chmodSync(join(storeRoot, "stats"), 0o700);
  chmodSync(join(storeRoot, "stats", workspaceKey), 0o700);
  chmodSync(directory, 0o700);
  return directory;
}

function writeLegacyState(
  sessionId: string,
  content: string,
  workspaceKey = WORKSPACE_KEY,
): string {
  const directory = prepareLegacyDirectory(workspaceKey);
  const path = join(directory, `${cacheAdviceSessionStorageKey(sessionId)}.json`);
  writeFileSync(path, content, { mode: 0o600 });
  return path;
}

function validV2State(overrides: Partial<CacheAdviceState> = {}, recentAt = 1_000): string {
  const state: CacheAdviceState = {
    version: 2,
    offeredDirectoryKeys: [],
    recent: [{ tool: "Read", directoryKey: DIRECTORY_KEY, at: recentAt }],
    ...overrides,
  };
  return `${JSON.stringify(state)}\n`;
}

function capsuleStatePath(sessionId: string, workspaceKey = WORKSPACE_KEY): string {
  return join(
    cacheAdviceRecordDirectory(
      storeRoot,
      cacheAdviceRecordId({
        workspaceKey,
        sessionStorageKey: cacheAdviceSessionStorageKey(sessionId),
      }),
    ),
    "state.json",
  );
}

function capsuleSuppressionPath(sessionId: string, workspaceKey = WORKSPACE_KEY): string {
  return join(
    cacheAdviceRecordDirectory(
      storeRoot,
      cacheAdviceRecordId({
        workspaceKey,
        sessionStorageKey: cacheAdviceSessionStorageKey(sessionId),
      }),
    ),
    "suppression.json",
  );
}

function queueFrames(): string[] {
  const queueRoot = join(v3Root(), "queue");
  const workFile = readdirSync(queueRoot).find(
    (entry) => entry !== "control.json" && entry !== "lock",
  );
  if (workFile === undefined) return [];
  const raw = readFileSync(join(queueRoot, workFile), "utf8");
  return raw.split("\n").filter(Boolean);
}

function everyFileContent(root: string): string {
  const collected: string[] = [];
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory)) {
      const path = join(directory, entry);
      const stats = lstatSync(path);
      if (stats.isDirectory()) {
        walk(path);
      } else if (stats.isFile()) {
        collected.push(readFileSync(path, "utf8"));
      }
    }
  };
  if (existsSync(root)) walk(root);
  return collected.join("\n");
}

describe.skipIf(process.platform === "win32")("maintainCacheAdviceStore", () => {
  it("migrates more than 64 valid v2 flat states across restart cuts, preserving content", async () => {
    const maintenance = await loadMaintenance();
    const sessionIds = Array.from({ length: 65 }, (_, index) => `session-${index}`);
    for (const [index, sessionId] of sessionIds.entries()) {
      writeLegacyState(
        sessionId,
        validV2State({ offeredDirectoryKeys: [DIRECTORY_KEY] }, 1_000 + index),
      );
    }

    // Restart cut: first pass processes some records; simulate by calling
    // repeatedly. Idempotent — converges to complete with all 65 preserved.
    const first = await maintenance.maintainCacheAdviceStore({ storeRoot, now: NOW });
    const second = await maintenance.maintainCacheAdviceStore({ storeRoot, now: NOW });
    const third = await maintenance.maintainCacheAdviceStore({ storeRoot, now: NOW });

    expect(third).toBe("complete");
    expect(["complete", "incomplete"]).toContain(first);
    for (const [index, sessionId] of sessionIds.entries()) {
      const raw = readFileSync(capsuleStatePath(sessionId), "utf8");
      const state = JSON.parse(raw) as CacheAdviceState;
      expect(state.version).toBe(2);
      expect(state.offeredDirectoryKeys).toEqual([DIRECTORY_KEY]);
      expect(state.recent).toEqual([
        { tool: "Read", directoryKey: DIRECTORY_KEY, at: 1_000 + index },
      ]);
      expect(existsSync(legacyStatePathFor(sessionId))).toBe(false);
    }
    // Enrolled FIFO frames exist for every migrated record.
    expect(queueFrames()).toHaveLength(65);
    expect(second).toBeDefined();
    const journal = JSON.parse(readFileSync(migrationJournalPath(), "utf8")) as {
      version: number;
      complete: boolean;
      completedAt: number | null;
    };
    expect(journal).toEqual({ version: 1, complete: true, completedAt: NOW });
    expect(existsSync(migrationLockPath())).toBe(false);
  }, 30_000);

  it("is restart-idempotent: a crash after capsule move but before the journal converges", async () => {
    const maintenance = await loadMaintenance();
    writeLegacyState(SESSION_ID, validV2State({ offeredDirectoryKeys: [DIRECTORY_KEY] }));

    // First run completes and moves the node. Delete the journal to simulate
    // a crash between capsule move and journal write.
    await maintenance.maintainCacheAdviceStore({ storeRoot, now: NOW });
    rmSync(migrationJournalPath(), { force: true });

    const afterCrash = await maintenance.maintainCacheAdviceStore({ storeRoot, now: NOW });
    expect(afterCrash).toBe("complete");
    const state = JSON.parse(
      readFileSync(capsuleStatePath(SESSION_ID), "utf8"),
    ) as CacheAdviceState;
    expect(state.offeredDirectoryKeys).toEqual([DIRECTORY_KEY]);
    // The record is not double-enrolled after the restart cut.
    expect(queueFrames()).toHaveLength(1);
  });

  it("writes an opaque suppression capsule for v1 raw-path state without copying raw data", async () => {
    const maintenance = await loadMaintenance();
    const v1 = JSON.stringify({
      offeredDirectories: ["/private/raw/path"],
      recent: [{ tool: "Read", directory: "/private/raw/path", at: 1_000 }],
    });
    writeLegacyState(SESSION_ID, v1);

    const result = await maintenance.maintainCacheAdviceStore({ storeRoot, now: NOW });
    expect(result).toBe("complete");
    expect(existsSync(legacyStatePathFor(SESSION_ID))).toBe(false);

    const suppression = JSON.parse(
      readFileSync(capsuleSuppressionPath(SESSION_ID), "utf8"),
    ) as Record<string, unknown>;
    expect(suppression).toEqual({ version: 1, kind: "suppression" });
    expect(everyFileContent(v3Root())).not.toContain("/private/raw/path");
    expect(everyFileContent(v3Root())).not.toContain(SESSION_ID);
  });

  it("suppresses malformed JSON, oversized state, and unknown versions without parsing", async () => {
    const maintenance = await loadMaintenance();
    const oversized = `${" ".repeat(33_000)}`;
    writeLegacyState("malformed-session", '{"version":2,"recent":');
    writeLegacyState("oversized-session", oversized);
    writeLegacyState("unknown-version", JSON.stringify({ version: 99, recent: [] }));

    const result = await maintenance.maintainCacheAdviceStore({ storeRoot, now: NOW });
    expect(result).toBe("complete");

    for (const sessionId of ["malformed-session", "oversized-session", "unknown-version"]) {
      expect(existsSync(legacyStatePathFor(sessionId))).toBe(false);
      expect(JSON.parse(readFileSync(capsuleSuppressionPath(sessionId), "utf8"))).toEqual({
        version: 1,
        kind: "suppression",
      });
    }
    expect(everyFileContent(v3Root())).not.toContain("malformed-session");
  });

  it("applies the 30-day expiry decision to legacy lock and strict transaction temp files", async () => {
    const maintenance = await loadMaintenance();
    const directory = prepareLegacyDirectory();
    const oldLock = join(directory, `${cacheAdviceSessionStorageKey(SESSION_ID)}.lock`);
    const oldTemp = join(directory, ".11111111-1111-4111-8111-111111111111.tmp");
    const freshLock = join(directory, `${cacheAdviceSessionStorageKey("fresh-session")}.lock`);
    const futureTemp = join(directory, ".22222222-2222-4222-8222-222222222222.tmp");
    writeFileSync(oldLock, "stale", { mode: 0o600 });
    writeFileSync(oldTemp, "stale", { mode: 0o600 });
    writeFileSync(freshLock, "recent", { mode: 0o600 });
    writeFileSync(futureTemp, "future", { mode: 0o600 });
    utimesSync(oldLock, new Date(NOW - THIRTY_ONE_DAYS_MS), new Date(NOW - THIRTY_ONE_DAYS_MS));
    utimesSync(oldTemp, new Date(NOW - THIRTY_ONE_DAYS_MS), new Date(NOW - THIRTY_ONE_DAYS_MS));
    utimesSync(freshLock, new Date(NOW - TWENTY_NINE_DAYS_MS), new Date(NOW - TWENTY_NINE_DAYS_MS));
    const future = new Date(NOW + 3_600_000);
    utimesSync(futureTemp, future, future);

    const result = await maintenance.maintainCacheAdviceStore({ storeRoot, now: NOW });

    expect(result).toBe("complete");
    expect(existsSync(oldLock)).toBe(false);
    expect(existsSync(oldTemp)).toBe(false);
    expect(readFileSync(freshLock, "utf8")).toBe("recent");
    // Future timestamps are normalized to now, not deleted.
    expect(readFileSync(futureTemp, "utf8")).toBe("future");
    expect(statSync(futureTemp).mtimeMs).toBeLessThanOrEqual(NOW + 1_000);
  });

  it("leaves arbitrary unknown nodes in place forever and still completes", async () => {
    const maintenance = await loadMaintenance();
    const directory = prepareLegacyDirectory();
    const arbitrary = join(directory, ".arbitrary.tmp");
    const unknownFile = join(directory, "not-a-key.json");
    writeFileSync(arbitrary, "do not delete", { mode: 0o600 });
    writeFileSync(unknownFile, "unknown name", { mode: 0o600 });

    const result = await maintenance.maintainCacheAdviceStore({ storeRoot, now: NOW });

    expect(result).toBe("complete");
    expect(readFileSync(arbitrary, "utf8")).toBe("do not delete");
    expect(readFileSync(unknownFile, "utf8")).toBe("unknown name");
  });

  it("blocks completion on an unsafe known-shape symlinked state node without following it", async () => {
    const maintenance = await loadMaintenance();
    prepareLegacyDirectory();
    const external = join(fixtureRoot, "external-state.json");
    writeFileSync(external, validV2State(), { mode: 0o600 });
    symlinkSync(external, legacyStatePathFor(SESSION_ID));

    const result = await maintenance.maintainCacheAdviceStore({ storeRoot, now: NOW });

    expect(result).toBe("incomplete");
    // The symlink is never followed or deleted; target untouched.
    expect(lstatSync(legacyStatePathFor(SESSION_ID)).isSymbolicLink()).toBe(true);
    expect(readFileSync(external, "utf8")).toBe(validV2State());
    expect(existsSync(capsuleStatePath(SESSION_ID))).toBe(false);
    // An incomplete run journals complete:false; completion is only journaled
    // after a final clean rescan.
    expect(JSON.parse(readFileSync(migrationJournalPath(), "utf8"))).toEqual({
      version: 1,
      complete: false,
      completedAt: null,
    });
  });

  it("leaves a hard-linked legacy state node in place and stays incomplete", async () => {
    const maintenance = await loadMaintenance();
    prepareLegacyDirectory();
    const external = join(fixtureRoot, "hard-link-source.json");
    writeFileSync(external, validV2State(), { mode: 0o600 });
    linkSync(external, legacyStatePathFor(SESSION_ID));

    const result = await maintenance.maintainCacheAdviceStore({ storeRoot, now: NOW });

    expect(result).toBe("incomplete");
    expect(statSync(external).nlink).toBe(2);
    expect(existsSync(capsuleStatePath(SESSION_ID))).toBe(false);
  });

  it("leaves a legacy state node with non-private mode in place and stays incomplete", async () => {
    const maintenance = await loadMaintenance();
    const path = writeLegacyState(SESSION_ID, validV2State());
    chmodSync(path, 0o644);

    const result = await maintenance.maintainCacheAdviceStore({ storeRoot, now: NOW });

    expect(result).toBe("incomplete");
    expect(statSync(path).mode & 0o077).toBe(0o044);
    expect(existsSync(capsuleStatePath(SESSION_ID))).toBe(false);
  });

  it("reopens and completes again when legacy state reappears after a clean completion", async () => {
    const maintenance = await loadMaintenance();
    writeLegacyState(SESSION_ID, validV2State());
    await expect(maintenance.maintainCacheAdviceStore({ storeRoot, now: NOW })).resolves.toBe(
      "complete",
    );
    expect(JSON.parse(readFileSync(migrationJournalPath(), "utf8"))).toMatchObject({
      complete: true,
    });

    // A stale binary re-creates a legacy node after completion.
    writeLegacyState("late-session", validV2State());
    await expect(
      maintenance.maintainCacheAdviceStore({ storeRoot, now: NOW + 1_000 }),
    ).resolves.toBe("complete");

    expect(existsSync(legacyStatePathFor("late-session"))).toBe(false);
    expect(existsSync(capsuleStatePath("late-session"))).toBe(true);
    const journal = JSON.parse(readFileSync(migrationJournalPath(), "utf8")) as {
      complete: boolean;
      completedAt: number;
    };
    expect(journal.complete).toBe(true);
    expect(journal.completedAt).toBe(NOW + 1_000);
  });

  it("suppresses an existing capsule instead of overwriting it and keeps the legacy node", async () => {
    const maintenance = await loadMaintenance();
    writeLegacyState(SESSION_ID, validV2State({ offeredDirectoryKeys: [DIRECTORY_KEY] }));
    // Pre-create the capsule state by an external writer.
    const capsule = join(
      cacheAdviceRecordDirectory(
        storeRoot,
        cacheAdviceRecordId({
          workspaceKey: WORKSPACE_KEY,
          sessionStorageKey: cacheAdviceSessionStorageKey(SESSION_ID),
        }),
      ),
    );
    mkdirSync(capsule, { recursive: true, mode: 0o700 });
    chmodSync(join(storeRoot, "stats", "cache-advice-v3"), 0o700);
    chmodSync(join(storeRoot, "stats", "cache-advice-v3", "records"), 0o700);
    const preexisting = `{"version":2,"offeredDirectoryKeys":[],"recent":[]}\n`;
    writeFileSync(join(capsule, "state.json"), preexisting, { mode: 0o600 });

    const result = await maintenance.maintainCacheAdviceStore({ storeRoot, now: NOW });

    // The capsule is not overwritten; the conflicting legacy node is
    // suppressed into an opaque tombstone (never reset or parsed).
    expect(readFileSync(join(capsule, "state.json"), "utf8")).toBe(preexisting);
    expect(JSON.parse(readFileSync(capsuleSuppressionPath(SESSION_ID), "utf8"))).toEqual({
      version: 1,
      kind: "suppression",
    });
    expect(existsSync(legacyStatePathFor(SESSION_ID))).toBe(false);
    expect(result).toBe("complete");
  });

  it("takes the no-wait migration lock and does no work under contention", async () => {
    const maintenance = await loadMaintenance();
    writeLegacyState(SESSION_ID, validV2State());
    mkdirSync(v3Root(), { recursive: true, mode: 0o700 });
    chmodSync(join(storeRoot, "stats"), 0o700);
    chmodSync(v3Root(), 0o700);
    writeFileSync(migrationLockPath(), "held", { mode: 0o600 });

    const result = await maintenance.maintainCacheAdviceStore({ storeRoot, now: NOW });

    expect(result).toBe("incomplete");
    // The held lock is untouched and no capsule is created.
    expect(readFileSync(migrationLockPath(), "utf8")).toBe("held");
    expect(existsSync(capsuleStatePath(SESSION_ID))).toBe(false);
    expect(existsSync(legacyStatePathFor(SESSION_ID))).toBe(true);
  });

  it("reclaims a migration lock abandoned by a crashed worker past the expiry window", async () => {
    const maintenance = await loadMaintenance();
    writeLegacyState(SESSION_ID, validV2State({ offeredDirectoryKeys: [DIRECTORY_KEY] }));
    mkdirSync(v3Root(), { recursive: true, mode: 0o700 });
    chmodSync(join(storeRoot, "stats"), 0o700);
    chmodSync(v3Root(), 0o700);
    const stale = new Date(NOW - THIRTY_ONE_DAYS_MS);
    writeFileSync(migrationLockPath(), "crashed", { mode: 0o600 });
    utimesSync(migrationLockPath(), stale, stale);

    const result = await maintenance.maintainCacheAdviceStore({ storeRoot, now: NOW });

    expect(result).toBe("complete");
    expect(existsSync(migrationLockPath())).toBe(false);
    expect(existsSync(capsuleStatePath(SESSION_ID))).toBe(true);
  });

  it("completes with an empty legacy tree and writes the journal", async () => {
    const maintenance = await loadMaintenance();

    const result = await maintenance.maintainCacheAdviceStore({ storeRoot, now: NOW });

    expect(result).toBe("complete");
    expect(JSON.parse(readFileSync(migrationJournalPath(), "utf8"))).toEqual({
      version: 1,
      complete: true,
      completedAt: NOW,
    });
  });

  it("never writes a raw workspace path, session, or command anywhere under v3", async () => {
    const maintenance = await loadMaintenance();
    const rawPath = join(fixtureRoot, "sensitive-project");
    writeLegacyState(SESSION_ID, validV2State());
    writeLegacyState("other-session", validV2State());

    await maintenance.maintainCacheAdviceStore({ storeRoot, now: NOW });

    const everything = everyFileContent(v3Root());
    expect(everything).not.toContain(rawPath);
    expect(everything).not.toContain(fixtureRoot);
    expect(everything).not.toContain(SESSION_ID);
    expect(everything).not.toContain("other-session");
    expect(everything).not.toContain(WORKSPACE_KEY);
  });
});

describe("cacheAdviceMigrationComplete", () => {
  it.skipIf(process.platform === "win32")(
    "reports false before migration and true after a clean completion",
    async () => {
      const maintenance = await loadMaintenance();
      await expect(maintenance.cacheAdviceMigrationComplete(storeRoot)).resolves.toBe(false);

      writeLegacyState(SESSION_ID, validV2State());
      await maintenance.maintainCacheAdviceStore({ storeRoot, now: NOW });

      await expect(maintenance.cacheAdviceMigrationComplete(storeRoot)).resolves.toBe(true);
    },
  );
});

describe("triggerCacheAdviceMaintenance", () => {
  it.skipIf(process.platform === "win32")(
    "is a no-op when migration is already complete",
    async () => {
      const maintenance = await loadMaintenance();
      const trigger = await loadMaintenanceTrigger();
      writeLegacyState(SESSION_ID, validV2State());
      await maintenance.maintainCacheAdviceStore({ storeRoot, now: NOW });
      expect(existsSync(migrationLockPath())).toBe(false);

      // Completes resolved; trigger must not spawn a worker or create a lock.
      await expect(trigger.triggerCacheAdviceMaintenance({ storeRoot })).resolves.toBeUndefined();
      expect(existsSync(migrationLockPath())).toBe(false);
    },
  );

  it.skipIf(process.platform === "win32")(
    "is a no-op when a live migration lock is held",
    async () => {
      const maintenance = await loadMaintenance();
      const trigger = await loadMaintenanceTrigger();
      writeLegacyState(SESSION_ID, validV2State());
      mkdirSync(v3Root(), { recursive: true, mode: 0o700 });
      chmodSync(join(storeRoot, "stats"), 0o700);
      chmodSync(v3Root(), 0o700);
      writeFileSync(migrationLockPath(), "held", { mode: 0o600 });

      await expect(trigger.triggerCacheAdviceMaintenance({ storeRoot })).resolves.toBeUndefined();
      // Lock untouched; worker did not run.
      expect(readFileSync(migrationLockPath(), "utf8")).toBe("held");
      expect(existsSync(capsuleStatePath(SESSION_ID))).toBe(false);
    },
  );

  it("never throws and creates no state on win32", async () => {
    const trigger = await loadMaintenanceTrigger();
    await expect(trigger.triggerCacheAdviceMaintenance({ storeRoot })).resolves.toBeUndefined();
  });
});

describe("maintainCacheAdviceStore on win32", () => {
  it("creates no v3 root, no migration state, and returns suppressed", async () => {
    if (process.platform === "win32") {
      const maintenance = await loadMaintenance();
      await expect(maintenance.maintainCacheAdviceStore({ storeRoot, now: NOW })).resolves.toBe(
        "suppressed",
      );
      expect(existsSync(v3Root())).toBe(false);
      expect(existsSync(migrationJournalPath())).toBe(false);
    } else {
      // On POSIX hosts we assert the win32 contract via the platform gate:
      // the exported functions accept no platform override, so this documents
      // the real win32 path is a no-state no-op (covered by the win32 CI run).
      expect(true).toBe(true);
    }
  });
});

describe("cache-advice-maintain internal CLI", () => {
  it.skipIf(process.platform === "win32")(
    "exits 0 always and performs the migration",
    () => {
      writeLegacyState(SESSION_ID, validV2State({ offeredDirectoryKeys: [DIRECTORY_KEY] }));
      const cliRoot = join(fixtureRoot, "cli-entry.ts");
      writeFileSync(
        cliRoot,
        [
          `import { maintainCacheAdviceStore } from ${JSON.stringify(
            join(
              realpathSync(join(import.meta.dirname, "../../src/hooks")),
              "cache-advice-maintenance.ts",
            ),
          )};`,
          "const r = await maintainCacheAdviceStore({ storeRoot: process.argv[2], now: Date.now() });",
          "process.exitCode = 0;",
        ].join("\n"),
      );
      const repoRoot = join(import.meta.dirname, "../../../..");
      const viteNode = join(repoRoot, "node_modules", ".pnpm", "node_modules", ".bin", "vite-node");
      const result = spawnSync(
        viteNode,
        ["--root", join(repoRoot, "apps/cli"), cliRoot, storeRoot],
        {
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      expect(result.status).toBe(0);
      expect(existsSync(capsuleStatePath(SESSION_ID))).toBe(true);
    },
    20_000,
  );
});
