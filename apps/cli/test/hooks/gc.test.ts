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
  function cacheAdviceDirectory(): string {
    const workspace = encodeWorkspaceKey("/cache-advice/project");
    const directory = join(store, "stats", workspace, "cache-advice");
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    return directory;
  }

  function cacheAdviceMarker(): string {
    return join(store, "stats", ".last-cache-advice-gc");
  }

  function cacheAdviceClockCut(): string {
    return join(store, "stats", ".cache-advice-gc-clock-cut");
  }

  function seedEligibleCacheAdviceMarker(): void {
    const marker = cacheAdviceMarker();
    writeFileSync(marker, "", { mode: 0o600 });
    const eligible = new Date(NOW - GC_INTERVAL_MS - 1);
    utimesSync(marker, eligible, eligible);
  }

  async function completeClockCut(start: number): Promise<boolean> {
    const days = OVERLAY_RETENTION_MS / GC_INTERVAL_MS;
    for (let day = 1; day < days; day += 1) {
      await expect(
        maybeRunCacheAdviceGc(store, { now: () => start + day * GC_INTERVAL_MS }),
      ).resolves.toBe(false);
    }
    return maybeRunCacheAdviceGc(store, { now: () => start + days * GC_INTERVAL_MS });
  }

  it("runs on its own daily marker even when content-store GC has not run", async () => {
    rmSync(join(store, "content"), { recursive: true, force: true });
    cacheAdviceDirectory();
    seedEligibleCacheAdviceMarker();

    await expect(maybeRunCacheAdviceGc(store, { now: () => NOW })).resolves.toBe(true);
    await expect(
      maybeRunCacheAdviceGc(store, { now: () => NOW + GC_INTERVAL_MS - 1 }),
    ).resolves.toBe(false);
    await expect(
      maybeRunCacheAdviceGc(store, { now: () => NOW + GC_INTERVAL_MS + 1 }),
    ).resolves.toBe(true);
  });

  it("does not scan while another private cache-advice sweep lock is held", async () => {
    const directory = cacheAdviceDirectory();
    const oldState = join(directory, "held.json");
    const marker = cacheAdviceMarker();
    const sweepLock = join(store, "stats", ".cache-advice-gc.lock");
    writeFileSync(oldState, "legacy raw path state", { mode: 0o600 });
    writeFileSync(marker, "", { mode: 0o600 });
    writeFileSync(sweepLock, "other sweeper", { mode: 0o600 });
    const old = new Date(NOW - 31 * 86_400_000);
    const eligible = new Date(NOW - GC_INTERVAL_MS - 1);
    utimesSync(oldState, old, old);
    utimesSync(marker, eligible, eligible);

    await expect(maybeRunCacheAdviceGc(store, { now: () => NOW })).resolves.toBe(false);

    expect(readFileSync(oldState, "utf8")).toBe("legacy raw path state");
    expect(readFileSync(sweepLock, "utf8")).toBe("other sweeper");
  });

  it("does not replace old session state or locks while its workspace gate is held", async () => {
    const directory = cacheAdviceDirectory();
    const state = join(directory, "old-session.json");
    const lock = join(directory, "old-session.lock");
    const gate = join(directory, ".cache-advice-gc.lock");
    writeFileSync(state, "legacy state", { mode: 0o600 });
    writeFileSync(lock, "abandoned", { mode: 0o600 });
    writeFileSync(gate, "active sweep", { mode: 0o600 });
    const old = new Date(NOW - 31 * 86_400_000);
    utimesSync(state, old, old);
    utimesSync(lock, old, old);
    seedEligibleCacheAdviceMarker();

    await expect(maybeRunCacheAdviceGc(store, { now: () => NOW })).resolves.toBe(false);

    expect(readFileSync(state, "utf8")).toBe("legacy state");
    expect(readFileSync(lock, "utf8")).toBe("abandoned");
  });

  it("cuts a future marker before eventually sweeping legacy state after a full retention window", async () => {
    const directory = cacheAdviceDirectory();
    const legacy = join(directory, "future-marker.json");
    const marker = cacheAdviceMarker();
    writeFileSync(legacy, '{"directory":"/private/legacy-path"}', { mode: 0o600 });
    writeFileSync(marker, "", { mode: 0o600 });
    utimesSync(legacy, new Date(NOW - 31 * 86_400_000), new Date(NOW - 31 * 86_400_000));
    utimesSync(
      marker,
      new Date(NOW + 10 * OVERLAY_RETENTION_MS),
      new Date(NOW + 10 * OVERLAY_RETENTION_MS),
    );

    await expect(maybeRunCacheAdviceGc(store, { now: () => NOW })).resolves.toBe(false);
    expect(readFileSync(legacy, "utf8")).toContain("/private/legacy-path");

    await expect(completeClockCut(NOW)).resolves.toBe(true);
    expect(existsSync(legacy)).toBe(false);
  });

  it("cuts an uninitialized marker before a forward clock jump can delete recent state", async () => {
    const directory = cacheAdviceDirectory();
    const recent = join(directory, "uninitialized-forward-jump.json");
    writeFileSync(recent, "recent", { mode: 0o600 });
    utimesSync(recent, new Date(NOW - 86_400_000), new Date(NOW - 86_400_000));
    const jumped = NOW + OVERLAY_RETENTION_MS + GC_INTERVAL_MS + 1;

    await expect(maybeRunCacheAdviceGc(store, { now: () => jumped })).resolves.toBe(false);
    expect(readFileSync(recent, "utf8")).toBe("recent");
    expect(existsSync(cacheAdviceMarker())).toBe(true);
    expect(existsSync(cacheAdviceClockCut())).toBe(true);

    await expect(completeClockCut(jumped)).resolves.toBe(true);
    expect(existsSync(recent)).toBe(false);
  });

  it("cuts a large forward clock jump instead of prematurely deleting recent state", async () => {
    const directory = cacheAdviceDirectory();
    const recent = join(directory, "forward-jump.json");
    const marker = cacheAdviceMarker();
    writeFileSync(recent, "recent", { mode: 0o600 });
    writeFileSync(marker, "", { mode: 0o600 });
    utimesSync(recent, new Date(NOW - 86_400_000), new Date(NOW - 86_400_000));
    utimesSync(marker, new Date(NOW), new Date(NOW));
    const jumped = NOW + OVERLAY_RETENTION_MS + GC_INTERVAL_MS + 1;

    await expect(maybeRunCacheAdviceGc(store, { now: () => jumped })).resolves.toBe(false);
    expect(readFileSync(recent, "utf8")).toBe("recent");

    await expect(completeClockCut(jumped)).resolves.toBe(true);
    expect(existsSync(recent)).toBe(false);
  });

  it("resets an expired clock cut before a later forward jump can delete recent state", async () => {
    const directory = cacheAdviceDirectory();
    const recent = join(directory, "expired-cut-forward-jump.json");
    const marker = cacheAdviceMarker();
    const clockCut = cacheAdviceClockCut();
    writeFileSync(recent, "recent", { mode: 0o600 });
    writeFileSync(marker, "", { mode: 0o600 });
    writeFileSync(clockCut, "", { mode: 0o600 });
    utimesSync(recent, new Date(NOW - 86_400_000), new Date(NOW - 86_400_000));
    utimesSync(marker, new Date(NOW), new Date(NOW));
    utimesSync(clockCut, new Date(NOW), new Date(NOW));
    const jumped = NOW + OVERLAY_RETENTION_MS + GC_INTERVAL_MS + 1;

    await expect(maybeRunCacheAdviceGc(store, { now: () => jumped })).resolves.toBe(false);
    expect(readFileSync(recent, "utf8")).toBe("recent");
    expect(statSync(clockCut).mtimeMs).toBeGreaterThan(jumped - 1);
  });

  it("does not reclaim a held sweep lock after a large forward clock jump", async () => {
    cacheAdviceDirectory();
    const marker = cacheAdviceMarker();
    const sweepLock = join(store, "stats", ".cache-advice-gc.lock");
    writeFileSync(marker, "", { mode: 0o600 });
    writeFileSync(sweepLock, "other sweeper", { mode: 0o600 });
    utimesSync(marker, new Date(NOW), new Date(NOW));
    utimesSync(sweepLock, new Date(NOW), new Date(NOW));
    const jumped = NOW + OVERLAY_RETENTION_MS + GC_INTERVAL_MS + 1;

    await expect(maybeRunCacheAdviceGc(store, { now: () => jumped })).resolves.toBe(false);
    expect(readFileSync(sweepLock, "utf8")).toBe("other sweeper");
  });

  it("baselines an uninitialized clock before reclaiming an abandoned sweep lock", async () => {
    cacheAdviceDirectory();
    const sweepLock = join(store, "stats", ".cache-advice-gc.lock");
    writeFileSync(sweepLock, "abandoned sweeper", { mode: 0o600 });
    const old = new Date(NOW - 31 * 86_400_000);
    utimesSync(sweepLock, old, old);

    await expect(maybeRunCacheAdviceGc(store, { now: () => NOW })).resolves.toBe(false);
    expect(readFileSync(sweepLock, "utf8")).toBe("abandoned sweeper");
    expect(existsSync(cacheAdviceMarker())).toBe(true);
    expect(existsSync(cacheAdviceClockCut())).toBe(true);

    await expect(completeClockCut(NOW)).resolves.toBe(true);
    expect(existsSync(sweepLock)).toBe(false);
  });

  it("normalizes future entry timestamps before allowing a full retention window to elapse", async () => {
    const directory = cacheAdviceDirectory();
    const futureState = join(directory, "future-entry.json");
    const futureLock = join(directory, "orphan.lock");
    writeFileSync(futureState, "future state", { mode: 0o600 });
    writeFileSync(futureLock, "future lock", { mode: 0o600 });
    const future = new Date(NOW + 10 * OVERLAY_RETENTION_MS);
    utimesSync(futureState, future, future);
    utimesSync(futureLock, future, future);
    seedEligibleCacheAdviceMarker();

    await expect(maybeRunCacheAdviceGc(store, { now: () => NOW })).resolves.toBe(true);
    expect(statSync(futureState).mtimeMs).toBeLessThanOrEqual(NOW);
    expect(statSync(futureLock).mtimeMs).toBeLessThanOrEqual(NOW);

    for (let day = 1; day <= 30; day += 1) {
      await expect(
        maybeRunCacheAdviceGc(store, { now: () => NOW + day * GC_INTERVAL_MS }),
      ).resolves.toBe(true);
    }
    expect(existsSync(futureState)).toBe(true);
    expect(existsSync(futureLock)).toBe(true);

    await expect(
      maybeRunCacheAdviceGc(store, { now: () => NOW + 31 * GC_INTERVAL_MS }),
    ).resolves.toBe(true);
    expect(existsSync(futureState)).toBe(false);
    expect(existsSync(futureLock)).toBe(false);
  });

  it("bounds an incomplete daily sweep and leaves its marker eligible for continuation", async () => {
    const directory = cacheAdviceDirectory();
    const marker = cacheAdviceMarker();
    const oldMarker = new Date(NOW - GC_INTERVAL_MS - 1);
    writeFileSync(marker, "", { mode: 0o600 });
    utimesSync(marker, oldMarker, oldMarker);
    for (let index = 0; index < 160; index += 1) {
      const path = join(directory, `cap-${String(index).padStart(3, "0")}.json`);
      writeFileSync(path, "old", { mode: 0o600 });
      utimesSync(path, new Date(NOW - 31 * 86_400_000), new Date(NOW - 31 * 86_400_000));
    }

    await expect(maybeRunCacheAdviceGc(store, { now: () => NOW })).resolves.toBe(false);

    const remaining = readdirSync(directory).filter((entry) => entry.endsWith(".json"));
    expect(remaining.length).toBeGreaterThan(0);
    expect(statSync(marker).mtimeMs).toBeLessThan(NOW);
  });

  it("preserves 29-day state and lock files but deletes regular entries older than 30 days", async () => {
    const directory = cacheAdviceDirectory();
    const freshState = join(directory, "fresh-state.json");
    const freshLock = join(directory, "fresh-orphan.lock");
    const oldState = join(directory, "old-state.json");
    const oldLock = join(directory, "old-orphan.lock");
    for (const path of [freshState, freshLock, oldState, oldLock]) {
      writeFileSync(path, "fixture", { mode: 0o600 });
    }
    const fresh = new Date(NOW - 29 * 86_400_000);
    const old = new Date(NOW - 31 * 86_400_000);
    utimesSync(freshState, fresh, fresh);
    utimesSync(freshLock, fresh, fresh);
    utimesSync(oldState, old, old);
    utimesSync(oldLock, old, old);
    seedEligibleCacheAdviceMarker();

    await expect(maybeRunCacheAdviceGc(store, { now: () => NOW })).resolves.toBe(true);

    expect(existsSync(freshState)).toBe(true);
    expect(existsSync(freshLock)).toBe(true);
    expect(existsSync(oldState)).toBe(false);
    expect(existsSync(oldLock)).toBe(false);
  });

  it("preserves a 29-day transaction temp but deletes the same owned shape after 31 days", async () => {
    const directory = cacheAdviceDirectory();
    const freshTemp = join(directory, ".11111111-1111-4111-8111-111111111111.tmp");
    const oldTemp = join(directory, ".22222222-2222-4222-8222-222222222222.tmp");
    writeFileSync(freshTemp, "fresh", { mode: 0o600 });
    writeFileSync(oldTemp, "old", { mode: 0o600 });
    const fresh = new Date(NOW - 29 * 86_400_000);
    const old = new Date(NOW - 31 * 86_400_000);
    utimesSync(freshTemp, fresh, fresh);
    utimesSync(oldTemp, old, old);
    seedEligibleCacheAdviceMarker();

    await expect(maybeRunCacheAdviceGc(store, { now: () => NOW })).resolves.toBe(true);

    expect(readFileSync(freshTemp, "utf8")).toBe("fresh");
    expect(existsSync(oldTemp)).toBe(false);
  });

  it("preserves old arbitrary, linked, and non-private temp-looking entries", async () => {
    const directory = cacheAdviceDirectory();
    const arbitrary = join(directory, ".not-owned.tmp");
    const linked = join(directory, ".33333333-3333-4333-8333-333333333333.tmp");
    const nonPrivate = join(directory, ".44444444-4444-4444-8444-444444444444.tmp");
    const target = join(store, "external-temp-target");
    writeFileSync(arbitrary, "arbitrary", { mode: 0o600 });
    writeFileSync(target, "external", { mode: 0o600 });
    symlinkSync(target, linked);
    writeFileSync(nonPrivate, "shared", { mode: 0o644 });
    const old = new Date(NOW - 31 * 86_400_000);
    utimesSync(arbitrary, old, old);
    lutimesSync(linked, old, old);
    utimesSync(nonPrivate, old, old);
    seedEligibleCacheAdviceMarker();

    await expect(maybeRunCacheAdviceGc(store, { now: () => NOW })).resolves.toBe(true);

    expect(readFileSync(arbitrary, "utf8")).toBe("arbitrary");
    expect(lstatSync(linked).isSymbolicLink()).toBe(true);
    expect(readFileSync(target, "utf8")).toBe("external");
    expect(readFileSync(nonPrivate, "utf8")).toBe("shared");
  });

  it("does not delete old state while a fresh session lock marks an active transaction", async () => {
    const directory = cacheAdviceDirectory();
    const state = join(directory, "active.json");
    const lock = join(directory, "active.lock");
    writeFileSync(state, "old state", { mode: 0o600 });
    writeFileSync(lock, "", { mode: 0o600 });
    const old = new Date(NOW - 31 * 86_400_000);
    const fresh = new Date(NOW - 60_000);
    utimesSync(state, old, old);
    utimesSync(lock, fresh, fresh);
    seedEligibleCacheAdviceMarker();

    await expect(maybeRunCacheAdviceGc(store, { now: () => NOW })).resolves.toBe(false);

    expect(readFileSync(state, "utf8")).toBe("old state");
    expect(existsSync(lock)).toBe(true);
  });

  it("skips old symlinks, FIFOs, directories, and unrelated suffixes", async () => {
    const directory = cacheAdviceDirectory();
    const target = join(store, "external-target");
    const linkedState = join(directory, "linked.json");
    const fifoLock = join(directory, "pipe.lock");
    const nestedState = join(directory, "nested.json");
    const unrelated = join(directory, "old.txt");
    writeFileSync(target, "external");
    symlinkSync(target, linkedState);
    const { execFileSync } = await import("node:child_process");
    execFileSync("mkfifo", [fifoLock]);
    mkdirSync(nestedState);
    writeFileSync(unrelated, "keep");
    const old = new Date(NOW - 31 * 86_400_000);
    lutimesSync(linkedState, old, old);
    utimesSync(fifoLock, old, old);
    utimesSync(nestedState, old, old);
    utimesSync(unrelated, old, old);
    seedEligibleCacheAdviceMarker();

    await expect(maybeRunCacheAdviceGc(store, { now: () => NOW })).resolves.toBe(true);

    expect(lstatSync(linkedState).isSymbolicLink()).toBe(true);
    expect(lstatSync(fifoLock).isFIFO()).toBe(true);
    expect(lstatSync(nestedState).isDirectory()).toBe(true);
    expect(readFileSync(target, "utf8")).toBe("external");
    expect(readFileSync(unrelated, "utf8")).toBe("keep");
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
    cacheAdviceDirectory();
    seedEligibleCacheAdviceMarker();

    await expect(maybeRunCacheAdviceGc(store, { now: () => NOW })).resolves.toBe(true);

    expect(readFileSync(pack, "utf8")).toBe("pack");
    expect(readFileSync(claim, "utf8")).toBe("claim");
  });
});
