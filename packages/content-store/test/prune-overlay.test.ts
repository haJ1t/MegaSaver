import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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

let store: string;
beforeEach(() => {
  store = mkdtempSync(join(tmpdir(), "megasaver-prune-ovl-"));
});
afterEach(() => rmSync(store, { recursive: true, force: true }));

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
  return join(store, "content", WK, LIVE, `${chunkSetId}.json`);
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
        chunkSetId: "dddddddd-0000-4000-8000-000000000004",
        projectId,
        sessionId,
        createdAt: OLD,
        source: { kind: "file", path: "x" },
        rawBytes: 1,
        redacted: false,
        chunks: [{ id: "0", startLine: 1, endLine: 1, bytes: 1, text: "x" }],
      },
    });
    const registryPath = join(
      store,
      "content",
      projectId,
      sessionId,
      "dddddddd-0000-4000-8000-000000000004.json",
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
    const { removed } = await pruneOlderThan({ storeRoot: store, olderThan: CUTOFF });
    expect(removed).toBe(1);
    expect(existsSync(join(store, "content", WK, LIVE, "read-index.json"))).toBe(true);
    expect(existsSync(join(store, "content", WK, LIVE, "junk.json"))).toBe(true);
    expect(existsSync(join(store, "content", WK, LIVE))).toBe(true); // not emptied
  });

  it("leaves a valid JSON object that matches neither schema untouched", async () => {
    await seedOverlay("aaaaaaaa-0000-4000-8000-000000000009", YOUNG); // create the dir + keep it non-empty
    const alien = join(store, "content", WK, LIVE, "alien.json");
    writeFileSync(alien, JSON.stringify({ foo: 1, createdAt: OLD }));
    const { removed } = await pruneOlderThan({ storeRoot: store, olderThan: CUTOFF });
    expect(removed).toBe(0);
    expect(existsSync(alien)).toBe(true);
  });
});
