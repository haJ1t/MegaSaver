import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { encodeWorkspaceKey } from "@megasaver/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadFailureSnapshot, pickNewestSessionId } from "../../src/commands/failures/snapshot.js";

let store: string;
let cwd: string;
let wk: string;

beforeEach(() => {
  store = mkdtempSync(join(tmpdir(), "megasaver-failures-snap-store-"));
  cwd = mkdtempSync(join(tmpdir(), "megasaver-failures-snap-cwd-"));
  wk = encodeWorkspaceKey(cwd);
});
afterEach(() => {
  rmSync(store, { recursive: true, force: true });
  rmSync(cwd, { recursive: true, force: true });
});

function overlayRow(over: Record<string, unknown>): string {
  return `${JSON.stringify({
    id: "evt-1",
    liveSessionId: "sess-a",
    workspaceKey: wk,
    createdAt: "2026-08-06T10:00:00.000Z",
    sourceKind: "command",
    label: "pnpm test",
    rawBytes: 100,
    returnedBytes: 40,
    bytesSaved: 60,
    savingRatio: 0.6,
    summary: "1 kept",
    ...over,
  })}\n`;
}

function seedSession(sid: string, lastCreatedAt: string): void {
  const dir = join(store, "stats", wk);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, `${sid}.events.jsonl`),
    overlayRow({ liveSessionId: sid, createdAt: lastCreatedAt }),
  );
}

describe("pickNewestSessionId", () => {
  it("picks by last-event createdAt, never mtime", () => {
    seedSession("sess-old", "2026-08-06T11:00:00.000Z");
    seedSession("sess-new", "2026-08-06T11:30:00.000Z");
    expect(pickNewestSessionId(store, wk)).toBe("sess-new");
  });

  it("returns undefined when the workspace has no event files", () => {
    expect(pickNewestSessionId(store, wk)).toBeUndefined();
  });
});

describe("loadFailureSnapshot degradation", () => {
  it("degrades every absent store to []/undefined, never throws", async () => {
    const snap = await loadFailureSnapshot({ storeRoot: store, cwd });
    expect(snap.liveSessionId).toBeUndefined();
    expect(snap.events).toEqual([]);
    expect(snap.chunkSets).toEqual([]);
    expect(snap.readIndex).toBeUndefined();
    expect(snap.capsule).toBeUndefined();
    expect(snap.refs).toBeUndefined();
  });

  it("loads events for the explicit session and scans provided input", async () => {
    seedSession("sess-a", "2026-08-06T10:00:00.000Z");
    const contentDir = join(store, "content", wk, "sess-a");
    mkdirSync(contentDir, { recursive: true });
    writeFileSync(
      join(contentDir, "read-index.json"),
      JSON.stringify({ deadbeef: { contentHash: "c".repeat(64), chunkSetId: "cs-1" } }),
    );
    const snap = await loadFailureSnapshot({
      storeRoot: store,
      cwd,
      liveSessionId: "sess-a",
      inputText: "touched src/a.ts",
    });
    expect(snap.events).toHaveLength(1);
    expect(snap.readIndex).toBeDefined();
    expect(snap.capsule).toBeUndefined();
    expect(snap.refs?.pathRefs).toEqual(["src/a.ts"]);
  });

  it("v1 hardcodes chunkSets [] and capsule undefined (compaction-guard amendment)", async () => {
    seedSession("sess-a", "2026-08-06T10:00:00.000Z");
    const snap = await loadFailureSnapshot({ storeRoot: store, cwd, liveSessionId: "sess-a" });
    expect(snap.chunkSets).toEqual([]);
    expect(snap.capsule).toBeUndefined();
  });
});
