import {
  existsSync,
  lstatSync,
  lutimesSync,
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
import { recordAndFilterOverlayOutput } from "@megasaver/context-gate";
import { encodeWorkspaceKey } from "@megasaver/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GC_INTERVAL_MS, OVERLAY_RETENTION_MS, maybeRunOverlayGc } from "../../src/hooks/gc.js";

const NOW = Date.UTC(2026, 6, 15, 12, 0, 0);
const tmpdir = () => realpathSync(readTemporaryDirectory());

let store: string;
beforeEach(() => {
  store = mkdtempSync(join(tmpdir(), "megasaver-gc-"));
  mkdirSync(join(store, "content"), { recursive: true });
});
afterEach(() => rmSync(store, { recursive: true, force: true }));

describe("maybeRunOverlayGc", () => {
  it("runs on first call, creates the marker, prunes with the 30-day cutoff", async () => {
    const prune = vi.fn(async () => ({ removed: 3 }));
    const ran = await maybeRunOverlayGc(store, { now: () => NOW, prune });
    expect(ran).toBe(true);
    expect(prune).toHaveBeenCalledWith({
      storeRoot: store,
      olderThan: new Date(NOW - OVERLAY_RETENTION_MS),
    });
    expect(existsSync(join(store, "content", ".last-gc"))).toBe(true);
  });

  it("throttles a second call inside the interval", async () => {
    const prune = vi.fn(async () => ({ removed: 0 }));
    await maybeRunOverlayGc(store, { now: () => NOW, prune });
    const ran = await maybeRunOverlayGc(store, { now: () => NOW + 60_000, prune });
    expect(ran).toBe(false);
    expect(prune).toHaveBeenCalledTimes(1);
  });

  it("runs again after the interval elapses", async () => {
    const prune = vi.fn(async () => ({ removed: 0 }));
    await maybeRunOverlayGc(store, { now: () => NOW, prune });
    const ran = await maybeRunOverlayGc(store, { now: () => NOW + GC_INTERVAL_MS + 1, prune });
    expect(ran).toBe(true);
    expect(prune).toHaveBeenCalledTimes(2);
  });

  it("touches the marker BEFORE pruning (stampede guard) and swallows a prune throw", async () => {
    let markerMtimeAtPrune = 0;
    const prune = vi.fn(async () => {
      markerMtimeAtPrune = statSync(join(store, "content", ".last-gc")).mtimeMs;
      throw new Error("boom");
    });
    const ran = await maybeRunOverlayGc(store, { now: () => NOW, prune });
    expect(ran).toBe(false); // a failed prune reports false
    expect(markerMtimeAtPrune).toBeGreaterThan(0); // marker existed before prune ran
  });

  it("returns false without throwing when content/ does not exist", async () => {
    const bare = mkdtempSync(join(tmpdir(), "megasaver-gc-bare-"));
    const prune = vi.fn(async () => ({ removed: 0 }));
    const ran = await maybeRunOverlayGc(bare, { now: () => NOW, prune });
    expect(ran).toBe(false);
    expect(prune).not.toHaveBeenCalled();
    rmSync(bare, { recursive: true, force: true });
  });

  it("D17: sweeps intent files older than retention", async () => {
    const ws = encodeWorkspaceKey("/some/project");
    const dir = join(store, "stats", ws, "intent");
    mkdirSync(dir, { recursive: true });
    const old = join(dir, "aaaa.json");
    const fresh = join(dir, "bbbb.json");
    writeFileSync(old, JSON.stringify({ prompt: "old", ts: 0 }));
    writeFileSync(fresh, JSON.stringify({ prompt: "new", ts: NOW }));
    const past = new Date(NOW - 40 * 86_400_000);
    utimesSync(old, past, past);
    const ran = await maybeRunOverlayGc(store, {
      now: () => NOW,
      prune: async () => ({ removed: 0 }),
    });
    expect(ran).toBe(true);
    expect(existsSync(old)).toBe(false);
    expect(existsSync(fresh)).toBe(true);
  });

  it("sweeps saver-seen files older than retention", async () => {
    const ws = encodeWorkspaceKey("/some/project");
    const dir = join(store, "stats", ws, "saver-seen");
    mkdirSync(dir, { recursive: true });
    const old = join(dir, "aaaa.json");
    const fresh = join(dir, "bbbb.json");
    writeFileSync(old, JSON.stringify({ version: 1, hashes: ["old"] }));
    writeFileSync(fresh, JSON.stringify({ version: 1, hashes: ["new"] }));
    const past = new Date(NOW - 40 * 86_400_000);
    utimesSync(old, past, past);
    const ran = await maybeRunOverlayGc(store, {
      now: () => NOW,
      prune: async () => ({ removed: 0 }),
    });
    expect(ran).toBe(true);
    expect(existsSync(old)).toBe(false);
    expect(existsSync(fresh)).toBe(true);
  });

  it("never deletes task kickoff state through overlay GC", async () => {
    const ws = encodeWorkspaceKey("/task-kickoff/no-auto-cleanup");
    const packDir = join(store, "stats", ws, "task-pack");
    const claimDir = join(store, "stats", "task-kickoff-sessions");
    const oldPack = join(packDir, "session.json");
    const oldClaim = join(claimDir, "session.json");
    mkdirSync(packDir, { recursive: true });
    mkdirSync(claimDir, { recursive: true });
    writeFileSync(oldPack, "pack");
    writeFileSync(oldClaim, "tombstone");
    const past = new Date(NOW - 40 * 86_400_000);
    utimesSync(oldPack, past, past);
    utimesSync(oldClaim, past, past);

    await maybeRunOverlayGc(store, {
      now: () => NOW,
      prune: async () => ({ removed: 0 }),
    });

    expect(existsSync(oldPack)).toBe(true);
    expect(existsSync(oldClaim)).toBe(true);
  });

  it("sweeps the evidence ledger past its retention window", async () => {
    const wk = encodeWorkspaceKey("/some/project");
    const sid = "live-gc-evidence";
    const res = await recordAndFilterOverlayOutput({
      storeRoot: store,
      evidenceStoreRoot: store,
      workspaceKey: wk,
      liveSessionId: sid,
      raw: Array.from({ length: 4_000 }, (_, i) => `ln ${i}`).join("\n"),
      sourceKind: "command",
      label: "cat huge.log",
      mode: "aggressive",
      storeRawOutput: true,
      now: () => new Date(NOW - 40 * 86_400_000).toISOString(),
    });
    expect(res.decision).toBe("compressed");
    const chunkPath = join(store, "content", wk, sid, `${res.chunkSetId}.json`);
    const evidenceDir = join(store, "evidence", wk);
    const evidencePath = join(evidenceDir, readdirSync(evidenceDir)[0] ?? "");
    const before = statSync(evidencePath).size;

    // No-op prune: the chunk must be deleted by the evidence sweep itself.
    const ran = await maybeRunOverlayGc(store, {
      now: () => NOW,
      prune: async () => ({ removed: 0 }),
    });

    expect(ran).toBe(true);
    expect(existsSync(chunkPath)).toBe(false);
    const after = JSON.parse(readFileSync(evidencePath, "utf8"));
    expect(after.status).toBe("retained_metadata_only");
    expect(after.returnedChunkRefs).toEqual([]);
    expect(statSync(evidencePath).size).toBeLessThan(before / 2);
  });

  it("reconciles overlay summaries whose count lags the JSONL (E26 drift)", async () => {
    const wk = encodeWorkspaceKey("/test/proj");
    const id = "live-gc-drift-1";
    const dir = join(store, "stats", wk);
    mkdirSync(dir, { recursive: true });
    const ev = (n: number) =>
      JSON.stringify({
        id: `e${n}`,
        liveSessionId: id,
        workspaceKey: wk,
        createdAt: "2026-07-10T00:00:00.000Z",
        sourceKind: "command",
        label: "echo",
        rawBytes: 1000,
        returnedBytes: 100,
        bytesSaved: 900,
        savingRatio: 0.9,
        summary: "s",
        mode: "balanced",
      });
    writeFileSync(join(dir, `${id}.events.jsonl`), `${ev(1)}\n${ev(2)}\n${ev(3)}\n`);
    writeFileSync(
      join(dir, `${id}.json`),
      JSON.stringify({
        liveSessionId: id,
        eventsTotal: 1,
        rawBytesTotal: 1000,
        returnedBytesTotal: 100,
        bytesSavedTotal: 900,
        savingRatio: 0.9,
        secretsRedactedTotal: 0,
        chunksStoredTotal: 0,
        updatedAt: "2026-07-10T00:00:00.000Z",
      }),
    );
    const prune = vi.fn(async () => ({ removed: 0 }));
    const ran = await maybeRunOverlayGc(store, { now: () => NOW, prune });
    expect(ran).toBe(true);
    const after = JSON.parse(readFileSync(join(dir, `${id}.json`), "utf8"));
    expect(after.eventsTotal).toBe(3);
    expect(after.rebuiltAt).toBeDefined();
  });
});

type CacheAdviceGcModule = {
  maybeRunCacheAdviceGc: (
    storeRoot: string,
    deps?: { now?: () => number; platform?: NodeJS.Platform },
  ) => Promise<boolean>;
};

async function maybeRunCacheAdviceGc(
  storeRoot: string,
  deps?: { now?: () => number; platform?: NodeJS.Platform },
): Promise<boolean> {
  const module = (await import("../../src/hooks/gc.js")) as unknown as CacheAdviceGcModule;
  return module.maybeRunCacheAdviceGc(storeRoot, deps);
}

describe.skipIf(process.platform === "win32")("maybeRunCacheAdviceGc", () => {
  const RECORD_HEX = "0123456789abcdef";

  type QueueModule = {
    cacheAdviceRecordId(input: { workspaceKey: string; sessionStorageKey: string }): string;
    cacheAdviceRecordDirectory(storeRoot: string, recordId: string): string;
    enqueueCacheAdviceRecord(input: {
      storeRoot: string;
      recordId: string;
    }): Promise<"enqueued" | "suppressed">;
  };

  async function loadQueue(): Promise<QueueModule> {
    return import("../../src/hooks/cache-advice-queue.js") as Promise<QueueModule>;
  }

  function v3Root(): string {
    return join(store, "stats", "cache-advice-v3");
  }

  function recordIdFor(index: number): string {
    return `${RECORD_HEX[index % 16]}${String(index).padStart(62, "0")}f`;
  }

  async function seedCapsule(
    recordId: string,
    options: { ageDays: number; lock?: boolean } = { ageDays: 31 },
  ): Promise<string> {
    const queue = await loadQueue();
    await queue.enqueueCacheAdviceRecord({ storeRoot: store, recordId });
    const capsule = queue.cacheAdviceRecordDirectory(store, recordId);
    mkdirSync(capsule, { recursive: true, mode: 0o700 });
    const statePath = join(capsule, "state.json");
    writeFileSync(statePath, '{"version":2,"offeredDirectoryKeys":[],"recent":[]}\n', {
      mode: 0o600,
    });
    const stamp = new Date(NOW - options.ageDays * 86_400_000);
    utimesSync(statePath, stamp, stamp);
    if (options.lock === true) {
      writeFileSync(join(capsule, "state.lock"), "active", { mode: 0o600 });
    }
    return statePath;
  }

  function cacheAdviceMarker(): string {
    return join(v3Root(), ".last-cache-advice-gc");
  }

  function cacheAdviceClockCut(): string {
    return join(v3Root(), ".cache-advice-gc-clock-cut");
  }

  function seedEligibleCacheAdviceMarker(): void {
    mkdirSync(v3Root(), { recursive: true, mode: 0o700 });
    const marker = cacheAdviceMarker();
    writeFileSync(marker, "", { mode: 0o600 });
    const eligible = new Date(NOW - GC_INTERVAL_MS - 1);
    utimesSync(marker, eligible, eligible);
  }

  async function completeClockCut(start: number): Promise<boolean> {
    const days = OVERLAY_RETENTION_MS / GC_INTERVAL_MS;
    for (let day = 1; day < days; day += 1) {
      await maybeRunCacheAdviceGc(store, { now: () => start + day * GC_INTERVAL_MS });
    }
    let result = false;
    for (let pass = 0; pass < 32 && !result; pass += 1) {
      result = await maybeRunCacheAdviceGc(store, {
        now: () => start + (days + pass) * GC_INTERVAL_MS,
      });
    }
    return result;
  }

  // This is a durability integration test: it seeds 73 real capsules and runs
  // ~20 daily sweeps, each frame's deletion fsyncing its parent directory
  // (fair-GC spec §2.2). Under full-suite CPU contention that real I/O exceeds
  // the shared 30 s test timeout, so it carries its own budget.
  it(
    "deletes an expired capsule state behind more than 64 fresh early frames",
    { timeout: 120_000 },
    async () => {
      seedEligibleCacheAdviceMarker();
      for (let index = 0; index < 72; index += 1) {
        await seedCapsule(recordIdFor(index), { ageDays: 1 });
      }
      const expiredPath = await seedCapsule(recordIdFor(72), { ageDays: 31 });

      let completed = false;
      // 73 frames / 8 per batch needs ceil(73 / 8) = 10 batches; each batch
      // needs one eligible daily run plus one stamping run.
      for (let day = 0; day < 20 && !completed; day += 1) {
        completed = await maybeRunCacheAdviceGc(store, {
          now: () => NOW + day * GC_INTERVAL_MS,
        });
      }

      expect(completed).toBe(true);
      expect(existsSync(expiredPath)).toBe(false);
      const fresh = recordIdFor(0);
      const queue = await loadQueue();
      expect(existsSync(join(queue.cacheAdviceRecordDirectory(store, fresh), "state.json"))).toBe(
        true,
      );
    },
  );

  it("keeps continuous producers behind the frozen sweep tail", { timeout: 120_000 }, async () => {
    seedEligibleCacheAdviceMarker();
    const expired = await seedCapsule(recordIdFor(0), { ageDays: 31 });
    for (let index = 1; index <= 7; index += 1) {
      await seedCapsule(recordIdFor(index), { ageDays: 1 });
    }

    await expect(maybeRunCacheAdviceGc(store, { now: () => NOW })).resolves.toBe(false);
    expect(existsSync(expired)).toBe(false);

    // Late producers land behind the frozen tail and cannot starve the sweep.
    for (let index = 8; index < 16; index += 1) {
      await seedCapsule(recordIdFor(index), { ageDays: 31 });
    }
    let completed = false;
    for (let day = 1; day <= 3 && !completed; day += 1) {
      completed = await maybeRunCacheAdviceGc(store, {
        now: () => NOW + day * GC_INTERVAL_MS,
      });
    }
    expect(completed).toBe(true);

    const queue = await loadQueue();
    const late = queue.cacheAdviceRecordDirectory(store, recordIdFor(8));
    expect(existsSync(join(late, "state.json"))).toBe(true);
    expect(statSync(cacheAdviceMarker()).mtimeMs).toBeGreaterThanOrEqual(NOW + GC_INTERVAL_MS - 1);
  });

  it("requeues a capsule whose transaction lock is held and deletes it later", async () => {
    seedEligibleCacheAdviceMarker();
    const locked = await seedCapsule(recordIdFor(0), { ageDays: 31, lock: true });
    const capsule = dirnameOf(locked);

    await expect(maybeRunCacheAdviceGc(store, { now: () => NOW })).resolves.toBe(true);
    expect(existsSync(locked)).toBe(true);

    rmSync(join(capsule, "state.lock"));
    await expect(maybeRunCacheAdviceGc(store, { now: () => NOW + GC_INTERVAL_MS })).resolves.toBe(
      true,
    );
    expect(existsSync(locked)).toBe(false);
  });

  function dirnameOf(path: string): string {
    return path.slice(0, path.length - "/state.json".length);
  }

  it("preserves 29-day state but deletes exactly-older-than-30-day state", async () => {
    seedEligibleCacheAdviceMarker();
    const twentyNine = await seedCapsule(recordIdFor(0), { ageDays: 29 });
    const thirtyOne = await seedCapsule(recordIdFor(1), { ageDays: 31 });

    await expect(maybeRunCacheAdviceGc(store, { now: () => NOW })).resolves.toBe(true);

    expect(existsSync(twentyNine)).toBe(true);
    expect(existsSync(thirtyOne)).toBe(false);
  });

  it("cuts an uninitialized clock before a forward jump can delete recent state", async () => {
    const recent = await seedCapsule(recordIdFor(0), { ageDays: 1 });
    const jumped = NOW + OVERLAY_RETENTION_MS + GC_INTERVAL_MS + 1;

    await expect(maybeRunCacheAdviceGc(store, { now: () => jumped })).resolves.toBe(false);
    expect(existsSync(recent)).toBe(true);
    expect(existsSync(cacheAdviceMarker())).toBe(true);
    expect(existsSync(cacheAdviceClockCut())).toBe(true);

    await expect(completeClockCut(jumped)).resolves.toBe(true);
    expect(existsSync(recent)).toBe(false);
  });

  it("cuts a large forward clock jump instead of prematurely deleting recent state", async () => {
    seedEligibleCacheAdviceMarker();
    const recent = await seedCapsule(recordIdFor(0), { ageDays: 1 });
    writeFileSync(cacheAdviceMarker(), "", { mode: 0o600 });
    utimesSync(cacheAdviceMarker(), new Date(NOW), new Date(NOW));
    const jumped = NOW + OVERLAY_RETENTION_MS + GC_INTERVAL_MS + 1;

    await expect(maybeRunCacheAdviceGc(store, { now: () => jumped })).resolves.toBe(false);
    expect(existsSync(recent)).toBe(true);

    await expect(completeClockCut(jumped)).resolves.toBe(true);
    expect(existsSync(recent)).toBe(false);
  });

  it("normalizes a future capsule timestamp instead of deleting it early", async () => {
    seedEligibleCacheAdviceMarker();
    const queue = await loadQueue();
    const recordId = recordIdFor(0);
    await queue.enqueueCacheAdviceRecord({ storeRoot: store, recordId });
    const capsule = queue.cacheAdviceRecordDirectory(store, recordId);
    mkdirSync(capsule, { recursive: true, mode: 0o700 });
    const futureState = join(capsule, "state.json");
    writeFileSync(futureState, '{"version":2,"offeredDirectoryKeys":[],"recent":[]}\n', {
      mode: 0o600,
    });
    const future = new Date(NOW + 10 * OVERLAY_RETENTION_MS);
    utimesSync(futureState, future, future);

    await expect(maybeRunCacheAdviceGc(store, { now: () => NOW })).resolves.toBe(true);
    expect(statSync(futureState).mtimeMs).toBeLessThanOrEqual(NOW);
    expect(existsSync(futureState)).toBe(true);
  });

  it("suppresses the sweep while another private sweep lock is held", async () => {
    seedEligibleCacheAdviceMarker();
    const expired = await seedCapsule(recordIdFor(0), { ageDays: 31 });
    const sweepLock = join(v3Root(), ".gc.lock");
    writeFileSync(sweepLock, "other sweeper", { mode: 0o600 });

    await expect(maybeRunCacheAdviceGc(store, { now: () => NOW })).resolves.toBe(false);

    expect(existsSync(expired)).toBe(true);
    expect(readFileSync(sweepLock, "utf8")).toBe("other sweeper");
  });

  it("advances over an orphan frame whose capsule was never created", async () => {
    seedEligibleCacheAdviceMarker();
    const queue = await loadQueue();
    await queue.enqueueCacheAdviceRecord({ storeRoot: store, recordId: recordIdFor(0) });
    const expired = await seedCapsule(recordIdFor(1), { ageDays: 31 });

    await expect(maybeRunCacheAdviceGc(store, { now: () => NOW })).resolves.toBe(true);

    expect(existsSync(expired)).toBe(false);
  });

  it("never touches old Task Kickoff claims or packs", async () => {
    const workspace = encodeWorkspaceKey("/task-kickoff/cache-gc-separation");
    const pack = join(store, "stats", workspace, "task-pack", "session.json");
    const claim = join(store, "stats", "task-kickoff-sessions", "session.json");
    mkdirSync(join(store, "stats", workspace, "task-pack"), { recursive: true });
    mkdirSync(join(store, "stats", "task-kickoff-sessions"), { recursive: true });
    writeFileSync(pack, "pack");
    writeFileSync(claim, "claim");
    const old = new Date(NOW - 31 * 86_400_000);
    utimesSync(pack, old, old);
    utimesSync(claim, old, old);
    seedEligibleCacheAdviceMarker();

    await expect(maybeRunCacheAdviceGc(store, { now: () => NOW })).resolves.toBe(true);

    expect(readFileSync(pack, "utf8")).toBe("pack");
    expect(readFileSync(claim, "utf8")).toBe("claim");
  });

  it("does not scan the legacy flat tree from the hook sweep", async () => {
    const workspace = encodeWorkspaceKey("/cache-advice/project");
    const legacyDirectory = join(store, "stats", workspace, "cache-advice");
    mkdirSync(legacyDirectory, { recursive: true, mode: 0o700 });
    const legacy = join(legacyDirectory, "session.json");
    writeFileSync(legacy, "legacy raw path state", { mode: 0o600 });
    const old = new Date(NOW - 31 * 86_400_000);
    utimesSync(legacy, old, old);
    seedEligibleCacheAdviceMarker();

    await expect(maybeRunCacheAdviceGc(store, { now: () => NOW })).resolves.toBe(true);

    expect(readFileSync(legacy, "utf8")).toBe("legacy raw path state");
  });

  it("durably completes the full sweep: expired state deleted, inflight cleared, lock released", async () => {
    seedEligibleCacheAdviceMarker();
    const expired = await seedCapsule(recordIdFor(0), { ageDays: 31 });
    const capsule = dirnameOf(expired);

    await expect(maybeRunCacheAdviceGc(store, { now: () => NOW })).resolves.toBe(true);

    expect(existsSync(expired)).toBe(false);
    // Spec §2.2: the deletion and the control transition must both be durable
    // before the sweep completes — a torn inflight offset or a stale sweep
    // lock would wedge or replay a later pass. Both are only crash-safe when
    // the parent directory fsync follows the unlink.
    const control = JSON.parse(readFileSync(join(v3Root(), "queue", "control.json"), "utf8")) as {
      inflightOffset: number | null;
      lastCompletedAt: number | null;
    };
    expect(control.inflightOffset).toBeNull();
    expect(control.lastCompletedAt).toBe(NOW);
    expect(existsSync(join(v3Root(), ".gc.lock"))).toBe(false);
    expect(existsSync(join(capsule, "state.json"))).toBe(false);
  });
});
