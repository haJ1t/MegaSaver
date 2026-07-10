import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { encodeWorkspaceKey } from "@megasaver/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GC_INTERVAL_MS, OVERLAY_RETENTION_MS, maybeRunOverlayGc } from "../../src/hooks/gc.js";

const NOW = Date.UTC(2026, 6, 15, 12, 0, 0);

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
