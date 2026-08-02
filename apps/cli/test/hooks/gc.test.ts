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
  maybeRunCacheAdviceGc: (storeRoot: string, deps?: { now?: () => number }) => Promise<boolean>;
};

async function maybeRunCacheAdviceGc(
  storeRoot: string,
  deps?: { now?: () => number },
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

  it("runs on its own daily marker even when content-store GC has not run", async () => {
    rmSync(join(store, "content"), { recursive: true, force: true });
    cacheAdviceDirectory();

    await expect(maybeRunCacheAdviceGc(store, { now: () => NOW })).resolves.toBe(true);
    await expect(
      maybeRunCacheAdviceGc(store, { now: () => NOW + GC_INTERVAL_MS - 1 }),
    ).resolves.toBe(false);
    await expect(
      maybeRunCacheAdviceGc(store, { now: () => NOW + GC_INTERVAL_MS + 1 }),
    ).resolves.toBe(true);
  });

  it("preserves 29-day state and lock files but deletes regular entries older than 30 days", async () => {
    const directory = cacheAdviceDirectory();
    const freshState = join(directory, "fresh.json");
    const freshLock = join(directory, "fresh.lock");
    const oldState = join(directory, "old.json");
    const oldLock = join(directory, "old.lock");
    for (const path of [freshState, freshLock, oldState, oldLock]) {
      writeFileSync(path, "fixture", { mode: 0o600 });
    }
    const fresh = new Date(NOW - 29 * 86_400_000);
    const old = new Date(NOW - 31 * 86_400_000);
    utimesSync(freshState, fresh, fresh);
    utimesSync(freshLock, fresh, fresh);
    utimesSync(oldState, old, old);
    utimesSync(oldLock, old, old);

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

    await expect(maybeRunCacheAdviceGc(store, { now: () => NOW })).resolves.toBe(true);

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

    await expect(maybeRunCacheAdviceGc(store, { now: () => NOW })).resolves.toBe(true);

    expect(readFileSync(pack, "utf8")).toBe("pack");
    expect(readFileSync(claim, "utf8")).toBe("claim");
  });
});
