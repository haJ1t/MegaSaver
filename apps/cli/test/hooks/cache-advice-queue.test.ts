import {
  chmodSync,
  existsSync,
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
import { createServer } from "node:net";
import { tmpdir as readTemporaryDirectory } from "node:os";
import { basename, dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cacheAdviceSessionStorageKey } from "../../src/hooks/cache-advice-store.js";

type CacheAdviceCall = { tool: "Read" | "Grep" | "Glob"; directoryKey: string; at: number };
type CacheAdviceState = {
  version: 2;
  offeredDirectoryKeys: string[];
  recent: CacheAdviceCall[];
};
type CacheAdviceStoreApi = {
  transactCacheAdvice(input: {
    storeRoot: string;
    workspaceKey: string;
    sessionId: string;
    call: CacheAdviceCall;
    platform?: NodeJS.Platform;
  }): Promise<"advise" | "recorded" | "suppressed">;
};
type CacheAdviceQueueApi = {
  CACHE_ADVICE_QUEUE_ROOT: string;
  cacheAdviceRecordId(input: { workspaceKey: string; sessionStorageKey: string }): string;
  enqueueCacheAdviceRecord(input: {
    storeRoot: string;
    recordId: string;
  }): Promise<"enqueued" | "suppressed">;
  claimCacheAdviceQueueHead(input: {
    storeRoot: string;
    now: number;
  }): Promise<{ recordId: string; freshStart: boolean } | "suppressed" | "complete">;
  requeueCacheAdviceRecord(input: {
    storeRoot: string;
    recordId: string;
  }): Promise<"requeued" | "suppressed">;
};

const WORKSPACE_KEY = "0123456789abcdef";
const SESSION_ID = "11111111-1111-4111-8111-111111111111";
const SESSION_STORAGE_KEY = cacheAdviceSessionStorageKey(SESSION_ID);
const DIRECTORY_KEY = "a".repeat(64);
const NOW = Date.UTC(2026, 7, 3, 12, 0, 0);
const tmpdir = () => realpathSync(readTemporaryDirectory());

let fixtureRoot: string;
let storeRoot: string;

beforeEach(() => {
  fixtureRoot = mkdtempSync(join(tmpdir(), "mscaq-"));
  storeRoot = join(fixtureRoot, "store");
});

afterEach(() => {
  rmSync(fixtureRoot, { recursive: true, force: true });
});

async function loadStore(): Promise<CacheAdviceStoreApi> {
  return import("../../src/hooks/cache-advice-store.js") as Promise<CacheAdviceStoreApi>;
}

async function loadQueue(): Promise<CacheAdviceQueueApi> {
  return import("../../src/hooks/cache-advice-queue.js") as Promise<CacheAdviceQueueApi>;
}

type MaintenanceApi = {
  maintainCacheAdviceStore(input: {
    storeRoot: string;
    now: number;
  }): Promise<"complete" | "incomplete" | "suppressed">;
};

async function loadMaintenance(): Promise<MaintenanceApi> {
  return import("../../src/hooks/cache-advice-maintenance.js") as Promise<MaintenanceApi>;
}

function legacyStateDirectory(): string {
  return join(storeRoot, "stats", WORKSPACE_KEY, "cache-advice");
}

function legacyStatePath(): string {
  return join(legacyStateDirectory(), `${SESSION_STORAGE_KEY}.json`);
}

function validState(): string {
  const state: CacheAdviceState = {
    version: 2,
    offeredDirectoryKeys: [],
    recent: [{ tool: "Read", directoryKey: DIRECTORY_KEY, at: 1_000 }],
  };
  return `${JSON.stringify(state)}\n`;
}

function validCall(at = 2_000): CacheAdviceCall {
  return { tool: "Grep", directoryKey: DIRECTORY_KEY, at };
}

function legacyStatePathFor(sessionId: string): string {
  return join(legacyStateDirectory(), `${cacheAdviceSessionStorageKey(sessionId)}.json`);
}

async function withSocketAt(path: string, run: () => Promise<void>): Promise<void> {
  const server = createServer();
  // macOS sun_path is shorter than some target paths: chdir to the parent
  // and bind the short basename so the kernel accepts the node.
  const priorCwd = process.cwd();
  process.chdir(dirname(path));
  await new Promise<void>((resolveListening, reject) => {
    server.once("error", reject);
    server.listen(basename(path), resolveListening);
  });
  process.chdir(priorCwd);
  try {
    await run();
  } finally {
    await new Promise<void>((resolveClosed) => server.close(() => resolveClosed()));
  }
}

function seededLegacyState(content = validState()): void {
  mkdirSync(legacyStateDirectory(), { recursive: true, mode: 0o700 });
  chmodSync(storeRoot, 0o700);
  chmodSync(join(storeRoot, "stats"), 0o700);
  chmodSync(join(storeRoot, "stats", WORKSPACE_KEY), 0o700);
  chmodSync(legacyStateDirectory(), 0o700);
  writeFileSync(legacyStatePath(), content, { mode: 0o600 });
}

function expectedRecordDirectory(recordId: string): string {
  return join(
    storeRoot,
    "stats",
    "cache-advice-v3",
    "records",
    recordId.slice(0, 2),
    recordId.slice(2, 4),
    recordId,
  );
}

function readQueueFrames(): string[] {
  const root = join(storeRoot, "stats", "cache-advice-v3");
  const queueRoot = join(root, "queue");
  const queueFile = readdirSync(queueRoot).find(
    (entry) => entry !== "control.json" && entry !== "lock",
  );
  expect(queueFile).toBeDefined();
  const raw = readFileSync(join(queueRoot, queueFile ?? ""), "utf8");
  const head = JSON.parse(readFileSync(join(queueRoot, "control.json"), "utf8")).headOffset;
  expect(head).toBeGreaterThanOrEqual(0);
  expect(head).toBeLessThanOrEqual(raw.length);
  return raw.slice(head).split("\n").filter(Boolean);
}

describe.skipIf(process.platform === "win32")("cache advice queue v3", () => {
  it("derives opaque domain-separated record ids and distinct capsule paths", async () => {
    const queue = await loadQueue();
    const first = queue.cacheAdviceRecordId({
      workspaceKey: WORKSPACE_KEY,
      sessionStorageKey: SESSION_STORAGE_KEY,
    });
    const second = queue.cacheAdviceRecordId({
      workspaceKey: "fedcba9876543210",
      sessionStorageKey: SESSION_STORAGE_KEY,
    });

    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(second).toMatch(/^[0-9a-f]{64}$/);
    expect(first).not.toBe(second);
    expect(first).not.toContain(WORKSPACE_KEY);
    expect(first).not.toContain(SESSION_STORAGE_KEY);
    expect(expectedRecordDirectory(first)).not.toBe(expectedRecordDirectory(second));
  });

  it("enqueues one fixed opaque frame under contention-safe exclusive control", async () => {
    const queue = await loadQueue();
    const recordId = queue.cacheAdviceRecordId({
      workspaceKey: WORKSPACE_KEY,
      sessionStorageKey: SESSION_STORAGE_KEY,
    });

    await expect(queue.enqueueCacheAdviceRecord({ storeRoot, recordId })).resolves.toBe("enqueued");
    await expect(queue.enqueueCacheAdviceRecord({ storeRoot, recordId })).resolves.toBe("enqueued");

    const root = join(storeRoot, "stats", "cache-advice-v3");
    const queueRoot = join(root, "queue");
    const entries = readdirSync(queueRoot).sort();
    expect(entries).toEqual(["control.json", "work-1.jsonl"]);
    expect(readQueueFrames()).toEqual([JSON.stringify({ recordId })]);
    expect(JSON.parse(readFileSync(join(queueRoot, "control.json"), "utf8"))).toMatchObject({
      version: 1,
      headOffset: 0,
      inflightOffset: null,
      sweepStopOffset: null,
      lastCompletedAt: null,
      clockCutAt: null,
    });
    expect(statSync(join(root, "queue", "control.json")).mode & 0o077).toBe(0);
    expect(existsSync(join(queueRoot, "lock"))).toBe(false);
  });

  it("suppresses unsafe queue metadata instead of following or replacing it", async () => {
    const queue = await loadQueue();
    const recordId = queue.cacheAdviceRecordId({
      workspaceKey: WORKSPACE_KEY,
      sessionStorageKey: SESSION_STORAGE_KEY,
    });
    const queueRoot = join(storeRoot, "stats", "cache-advice-v3", "queue");
    mkdirSync(queueRoot, { recursive: true, mode: 0o700 });
    chmodSync(storeRoot, 0o700);
    chmodSync(join(storeRoot, "stats"), 0o700);
    chmodSync(join(storeRoot, "stats", "cache-advice-v3"), 0o700);
    chmodSync(queueRoot, 0o700);
    const external = join(fixtureRoot, "control-target");
    writeFileSync(external, "untouched");
    symlinkSync(external, join(queueRoot, "control.json"));

    await expect(queue.enqueueCacheAdviceRecord({ storeRoot, recordId })).resolves.toBe(
      "suppressed",
    );
    expect(readFileSync(external, "utf8")).toBe("untouched");
  });

  it("claims only the opaque head, freezes a full first sweep, and requeues fresh work", async () => {
    const queue = await loadQueue();
    const ids = Array.from({ length: 10 }, (_, index) => `${String(index).padStart(62, "0")}aa`);
    const head = ids[0];
    expect(head).toBeDefined();
    for (const recordId of ids) {
      await expect(queue.enqueueCacheAdviceRecord({ storeRoot, recordId })).resolves.toBe(
        "enqueued",
      );
    }

    await expect(queue.claimCacheAdviceQueueHead({ storeRoot, now: NOW })).resolves.toEqual({
      recordId: head,
      freshStart: true,
    });
    await expect(queue.requeueCacheAdviceRecord({ storeRoot, recordId: head ?? "" })).resolves.toBe(
      "requeued",
    );

    const frames = readQueueFrames();
    expect(frames.at(-1)).toBe(JSON.stringify({ recordId: head }));
    const control = JSON.parse(
      readFileSync(join(storeRoot, "stats", "cache-advice-v3", "queue", "control.json"), "utf8"),
    );
    expect(control.sweepStopOffset).toBeGreaterThan(0);
    expect(control.inflightOffset).toBeNull();
    expect(control.headOffset).toBeGreaterThan(0);
    expect(readQueueFrames()).toHaveLength(10);
  });

  it("recovers a claimed head after a simulated crash before requeue or delete", async () => {
    const queue = await loadQueue();
    const recordId = queue.cacheAdviceRecordId({
      workspaceKey: WORKSPACE_KEY,
      sessionStorageKey: SESSION_STORAGE_KEY,
    });
    await queue.enqueueCacheAdviceRecord({ storeRoot, recordId });
    await expect(queue.claimCacheAdviceQueueHead({ storeRoot, now: NOW })).resolves.toEqual({
      recordId,
      freshStart: true,
    });

    await expect(queue.claimCacheAdviceQueueHead({ storeRoot, now: NOW + 1_000 })).resolves.toEqual(
      { recordId, freshStart: true },
    );
    await expect(queue.requeueCacheAdviceRecord({ storeRoot, recordId })).resolves.toBe("requeued");
    await expect(queue.claimCacheAdviceQueueHead({ storeRoot, now: NOW + 2_000 })).resolves.toEqual(
      { recordId, freshStart: true },
    );
  });

  it("moves a valid flat v2 snapshot into an enrolled capsule and keeps advising once", async () => {
    seededLegacyState();
    const store = await loadStore();

    // Task 4: the hook no longer migrates inline. While migration is
    // incomplete and the legacy flat directory exists, advice is suppressed
    // and every legacy node stays untouched for the off-hook maintainer.
    await expect(
      store.transactCacheAdvice({
        storeRoot,
        workspaceKey: WORKSPACE_KEY,
        sessionId: SESSION_ID,
        call: validCall(),
      }),
    ).resolves.toBe("suppressed");
    expect(existsSync(legacyStatePath())).toBe(true);

    const maintenance = await loadMaintenance();
    await expect(maintenance.maintainCacheAdviceStore({ storeRoot, now: NOW })).resolves.toBe(
      "complete",
    );

    const queue = await loadQueue();
    const recordId = queue.cacheAdviceRecordId({
      workspaceKey: WORKSPACE_KEY,
      sessionStorageKey: SESSION_STORAGE_KEY,
    });
    const capsuleDirectory = expectedRecordDirectory(recordId);
    expect(readFileSync(join(capsuleDirectory, "state.json"), "utf8")).toContain(DIRECTORY_KEY);
    expect(existsSync(legacyStatePath())).toBe(false);
    expect(readQueueFrames()).toEqual([JSON.stringify({ recordId })]);

    // After the maintainer completes, the hook advises exactly once more.
    await expect(
      store.transactCacheAdvice({
        storeRoot,
        workspaceKey: WORKSPACE_KEY,
        sessionId: SESSION_ID,
        call: validCall(),
      }),
    ).resolves.toBe("advise");
    await expect(
      store.transactCacheAdvice({
        storeRoot,
        workspaceKey: WORKSPACE_KEY,
        sessionId: SESSION_ID,
        call: validCall(3_000),
      }),
    ).resolves.toBe("recorded");
    expect(readQueueFrames()).toEqual([JSON.stringify({ recordId })]);
  });

  it("fences malformed legacy state for the maintainer, leaving it untouched", async () => {
    seededLegacyState('{"version":2,"recent":');
    const store = await loadStore();

    await expect(
      store.transactCacheAdvice({
        storeRoot,
        workspaceKey: WORKSPACE_KEY,
        sessionId: SESSION_ID,
        call: validCall(),
      }),
    ).resolves.toBe("suppressed");
    expect(readFileSync(legacyStatePath(), "utf8")).toBe('{"version":2,"recent":');
    expect(existsSync(join(storeRoot, "stats", "cache-advice-v3"))).toBe(false);
  });

  it("keeps a socket legacy node fenced for the off-hook maintainer", async () => {
    const socketSession = "legacy-socket";
    mkdirSync(legacyStateDirectory(), { recursive: true, mode: 0o700 });
    chmodSync(storeRoot, 0o700);
    chmodSync(join(storeRoot, "stats"), 0o700);
    chmodSync(join(storeRoot, "stats", WORKSPACE_KEY), 0o700);
    chmodSync(legacyStateDirectory(), 0o700);
    const store = await loadStore();

    await withSocketAt(legacyStatePathFor(socketSession), async () => {
      await expect(
        store.transactCacheAdvice({
          storeRoot,
          workspaceKey: WORKSPACE_KEY,
          sessionId: socketSession,
          call: validCall(),
        }),
      ).resolves.toBe("suppressed");
      expect(statSync(legacyStatePathFor(socketSession)).isSocket()).toBe(true);
      expect(existsSync(join(storeRoot, "stats", "cache-advice-v3"))).toBe(false);
    });
  });

  it("keeps queue writes bounded and suppresses a full work log", async () => {
    const queue = await loadQueue();
    const queueRoot = join(storeRoot, "stats", "cache-advice-v3", "queue");
    mkdirSync(queueRoot, { recursive: true, mode: 0o700 });
    chmodSync(storeRoot, 0o700);
    chmodSync(join(storeRoot, "stats"), 0o700);
    chmodSync(join(storeRoot, "stats", "cache-advice-v3"), 0o700);
    chmodSync(queueRoot, 0o700);
    const fullFrame = `${"x".repeat(1_048_500)}\n`;
    writeFileSync(join(queueRoot, "work-1.jsonl"), fullFrame, { mode: 0o600 });
    writeFileSync(
      join(queueRoot, "control.json"),
      JSON.stringify({
        version: 1,
        headOffset: 0,
        inflightOffset: null,
        sweepStopOffset: null,
        lastCompletedAt: null,
        clockCutAt: null,
      }),
      { mode: 0o600 },
    );
    const recordId = queue.cacheAdviceRecordId({
      workspaceKey: WORKSPACE_KEY,
      sessionStorageKey: SESSION_STORAGE_KEY,
    });

    await expect(queue.enqueueCacheAdviceRecord({ storeRoot, recordId })).resolves.toBe(
      "suppressed",
    );
    expect(statSync(join(queueRoot, "work-1.jsonl")).size).toBe(Buffer.byteLength(fullFrame));
  });

  it("uses only POSIX private nodes and no Windows queue state", async () => {
    const queue = await loadQueue();
    const store = await loadStore();
    const recordId = queue.cacheAdviceRecordId({
      workspaceKey: WORKSPACE_KEY,
      sessionStorageKey: SESSION_STORAGE_KEY,
    });

    await expect(
      store.transactCacheAdvice({
        storeRoot,
        workspaceKey: WORKSPACE_KEY,
        sessionId: SESSION_ID,
        call: validCall(),
        platform: "win32",
      }),
    ).resolves.toBe("suppressed");
    expect(existsSync(storeRoot)).toBe(false);

    mkdirSync(join(storeRoot, "stats", "cache-advice-v3"), {
      recursive: true,
      mode: 0o700,
    });
    const marker = join(storeRoot, "stats", "cache-advice-v3", "queue");
    writeFileSync(marker, "not a directory", { mode: 0o600 });
    await expect(queue.enqueueCacheAdviceRecord({ storeRoot, recordId })).resolves.toBe(
      "suppressed",
    );
    expect(readFileSync(marker, "utf8")).toBe("not a directory");
  });

  it("preserves arbitrary legacy temporary files during v2 migration", async () => {
    seededLegacyState();
    const arbitrary = join(legacyStateDirectory(), ".arbitrary.tmp");
    writeFileSync(arbitrary, "do not delete", { mode: 0o600 });
    const store = await loadStore();

    await expect(
      store.transactCacheAdvice({
        storeRoot,
        workspaceKey: WORKSPACE_KEY,
        sessionId: SESSION_ID,
        call: validCall(),
      }),
    ).resolves.toBe("suppressed");
    expect(readFileSync(arbitrary, "utf8")).toBe("do not delete");

    const maintenance = await loadMaintenance();
    await expect(maintenance.maintainCacheAdviceStore({ storeRoot, now: NOW })).resolves.toBe(
      "complete",
    );

    await expect(
      store.transactCacheAdvice({
        storeRoot,
        workspaceKey: WORKSPACE_KEY,
        sessionId: SESSION_ID,
        call: validCall(),
      }),
    ).resolves.toBe("advise");
    expect(readFileSync(arbitrary, "utf8")).toBe("do not delete");
  });

  it("keeps migrated future timestamps under GC clock control", async () => {
    seededLegacyState();
    const future = new Date(NOW + 40 * 86_400_000 + 61_001);
    const state = JSON.parse(validState()) as CacheAdviceState;
    state.recent[0] = { tool: "Read", directoryKey: DIRECTORY_KEY, at: future.getTime() };
    writeFileSync(legacyStatePath(), `${JSON.stringify(state)}\n`, { mode: 0o600 });
    utimesSync(legacyStatePath(), future, future);
    const migratedFuture = NOW + 40 * 86_400_000 + 61_000;
    const store = await loadStore();

    await expect(
      store.transactCacheAdvice({
        storeRoot,
        workspaceKey: WORKSPACE_KEY,
        sessionId: SESSION_ID,
        call: validCall(migratedFuture),
      }),
    ).resolves.toBe("suppressed");

    const maintenance = await loadMaintenance();
    await expect(
      maintenance.maintainCacheAdviceStore({ storeRoot, now: migratedFuture }),
    ).resolves.toBe("complete");

    await expect(
      store.transactCacheAdvice({
        storeRoot,
        workspaceKey: WORKSPACE_KEY,
        sessionId: SESSION_ID,
        call: validCall(migratedFuture),
      }),
    ).resolves.toBe("advise");

    const queue = await loadQueue();
    const recordId = queue.cacheAdviceRecordId({
      workspaceKey: WORKSPACE_KEY,
      sessionStorageKey: SESSION_STORAGE_KEY,
    });
    const migrated = join(expectedRecordDirectory(recordId), "state.json");
    expect(statSync(migrated).mtimeMs).toBeLessThanOrEqual(migratedFuture);
  });
});
