import { existsSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { projectIdSchema, sessionIdSchema } from "@megasaver/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { pruneOlderThan, saveChunkSet, saveOverlayChunkSet } from "../src/store.js";

const WK = "7da3a87ecc581dd6";
const LIVE = "11111111-1111-4111-8111-111111111111";
const OLD = "2026-01-01T00:00:00.000Z";
const YOUNG = "2026-07-09T00:00:00.000Z";
const CUTOFF = new Date("2026-06-01T00:00:00.000Z");
const REGISTRY_ID = "dddddddd-0000-4000-8000-000000000004";

let store: string;
beforeEach(() => {
  store = mkdtempSync(join(tmpdir(), "megasaver-prune-ovl-"));
});
afterEach(() => rmSync(store, { recursive: true, force: true }));

// The store is write-once, so on disk a file's mtime IS its createdAt. Fixtures
// that backdate only the body describe a store that cannot occur, and prune
// reads mtime first to avoid parsing every retained body.
function backdate(path: string, createdAt: string): string {
  const stamp = new Date(createdAt);
  utimesSync(path, stamp, stamp);
  return path;
}

async function seedOverlay(chunkSetId: string, createdAt: string): Promise<string> {
  await saveOverlayChunkSet({
    storeRoot: store,
    chunkSet: {
      chunkSetId,
      workspaceKey: WK,
      liveSessionId: LIVE,
      createdAt,
      source: { kind: "command", command: "x", args: [] },
      rawBytes: 1,
      redacted: false,
      chunks: [{ id: "0", startLine: 1, endLine: 1, bytes: 1, text: "x" }],
    },
  });
  return backdate(join(store, "content", WK, LIVE, `${chunkSetId}.json`), createdAt);
}

describe("pruneOlderThan — overlay layout (C14)", () => {
  it("deletes an old overlay set and keeps a young one", async () => {
    const oldPath = await seedOverlay("aaaaaaaa-0000-4000-8000-000000000001", OLD);
    const youngPath = await seedOverlay("aaaaaaaa-0000-4000-8000-000000000002", YOUNG);
    const { removed } = await pruneOlderThan({ storeRoot: store, olderThan: CUTOFF });
    expect(removed).toBe(1);
    expect(existsSync(oldPath)).toBe(false);
    expect(existsSync(youngPath)).toBe(true);
  });

  it("removes emptied session and workspace dirs but never content/ itself", async () => {
    await seedOverlay("aaaaaaaa-0000-4000-8000-000000000001", OLD);
    await pruneOlderThan({ storeRoot: store, olderThan: CUTOFF });
    expect(existsSync(join(store, "content", WK, LIVE))).toBe(false);
    expect(existsSync(join(store, "content", WK))).toBe(false);
    expect(existsSync(join(store, "content"))).toBe(true);
  });

  it("survives the .last-gc marker file and stray non-dirs at both levels", async () => {
    const oldPath = await seedOverlay("aaaaaaaa-0000-4000-8000-000000000001", OLD);
    writeFileSync(join(store, "content", ".last-gc"), "");
    writeFileSync(join(store, "content", WK, ".DS_Store"), "junk");
    const { removed } = await pruneOlderThan({ storeRoot: store, olderThan: CUTOFF });
    expect(removed).toBe(1);
    expect(existsSync(oldPath)).toBe(false);
    expect(existsSync(join(store, "content", ".last-gc"))).toBe(true);
  });

  it("prunes both overlay and registry sets in one sweep (F4 mixed store)", async () => {
    const overlayPath = await seedOverlay("aaaaaaaa-0000-4000-8000-000000000001", OLD);
    const projectId = projectIdSchema.parse("bbbbbbbb-0000-4000-8000-000000000002");
    const sessionId = sessionIdSchema.parse("cccccccc-0000-4000-8000-000000000003");
    await saveChunkSet({
      storeRoot: store,
      chunkSet: {
        chunkSetId: REGISTRY_ID,
        projectId,
        sessionId,
        createdAt: OLD,
        source: { kind: "file", path: "x" },
        rawBytes: 1,
        redacted: false,
        chunks: [{ id: "0", startLine: 1, endLine: 1, bytes: 1, text: "x" }],
      },
    });
    const registryPath = backdate(
      join(store, "content", projectId, sessionId, `${REGISTRY_ID}.json`),
      OLD,
    );
    const { removed } = await pruneOlderThan({ storeRoot: store, olderThan: CUTOFF });
    expect(removed).toBe(2);
    expect(existsSync(overlayPath)).toBe(false);
    expect(existsSync(registryPath)).toBe(false);
  });

  it("leaves an unknown/corrupt json untouched and keeps a dir holding read-index.json", async () => {
    await seedOverlay("aaaaaaaa-0000-4000-8000-000000000001", OLD);
    writeFileSync(join(store, "content", WK, LIVE, "read-index.json"), "{}");
    writeFileSync(join(store, "content", WK, LIVE, "junk.json"), "not json");
    // Old enough to be a delete candidate, so the schema guard is what spares it.
    backdate(join(store, "content", WK, LIVE, "junk.json"), OLD);
    const { removed } = await pruneOlderThan({ storeRoot: store, olderThan: CUTOFF });
    expect(removed).toBe(1);
    expect(existsSync(join(store, "content", WK, LIVE, "read-index.json"))).toBe(true);
    expect(existsSync(join(store, "content", WK, LIVE, "junk.json"))).toBe(true);
    expect(existsSync(join(store, "content", WK, LIVE))).toBe(true); // not emptied
  });

  // The one deliberate divergence from the parse-every-file form, pinned so it is
  // a decision and not a surprise: age is taken from mtime, so a set written or
  // rewritten AFTER the cutoff survives even when its body claims an older
  // createdAt. Retention means "keep 30 days of what is on disk", and mtime is
  // what the disk says — a re-write (the content-derived chunkSetId path rewrites
  // the same file) moves both stamps together in the real store. The conservative
  // direction: this can only retain a file for another sweep, never delete early.
  it("keeps a set whose body claims an old createdAt but was written after the cutoff", async () => {
    const path = await seedOverlay("aaaaaaaa-0000-4000-8000-00000000000a", OLD);
    const now = new Date();
    utimesSync(path, now, now);
    const { removed } = await pruneOlderThan({ storeRoot: store, olderThan: CUTOFF });
    expect(removed).toBe(0);
    expect(existsSync(path)).toBe(true);
  });

  it("leaves a valid JSON object that matches neither schema untouched", async () => {
    await seedOverlay("aaaaaaaa-0000-4000-8000-000000000009", YOUNG); // create the dir + keep it non-empty
    const alien = join(store, "content", WK, LIVE, "alien.json");
    writeFileSync(alien, JSON.stringify({ foo: 1, createdAt: OLD }));
    backdate(alien, OLD); // delete candidate by age; only the schema guard spares it
    const { removed } = await pruneOlderThan({ storeRoot: store, olderThan: CUTOFF });
    expect(removed).toBe(0);
    expect(existsSync(alien)).toBe(true);
  });
});
