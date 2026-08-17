import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listOverlayChunkSets, saveOverlayChunkSet } from "@megasaver/content-store";
import { encodeWorkspaceKey } from "@megasaver/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { capsulePath, workStateCapsuleSchema } from "../../src/hooks/capsule.js";
import { runCapsuleHook } from "../../src/hooks/capsule-run.js";
import { captureIntent } from "../../src/hooks/intent-run.js";

let storeRoot: string;
const cwd = "/some/project";
const wk = encodeWorkspaceKey(cwd);
const sid = "sess-1";
const NOW = Date.parse("2026-08-06T12:00:00.000Z");

beforeEach(() => {
  storeRoot = mkdtempSync(join(tmpdir(), "capsule-run-"));
});
afterEach(() => {
  rmSync(storeRoot, { recursive: true, force: true });
});

async function seedFileRead(chunkSetId: string, path: string): Promise<void> {
  await saveOverlayChunkSet({
    storeRoot,
    chunkSet: {
      chunkSetId,
      liveSessionId: sid,
      workspaceKey: wk,
      createdAt: "2026-08-06T10:00:00.000Z",
      source: { kind: "file", path },
      rawBytes: 5,
      redacted: true,
      chunks: [{ id: "c0", startLine: 0, endLine: 1, bytes: 5, text: "hello" }],
    },
  });
}

describe("runCapsuleHook", () => {
  it("writes a schema-valid capsule from store state and the intent record", async () => {
    await seedFileRead("cs-1", "src/a.ts");
    captureIntent(storeRoot, { prompt: "fix auth", cwd, session_id: sid }, () => NOW - 60_000);
    const capsule = await runCapsuleHook({
      payload: { session_id: sid, cwd, trigger: "auto", hook_event_name: "PreCompact" },
      storeRoot,
      now: () => NOW,
      list: listOverlayChunkSets,
    });
    expect(capsule).not.toBeNull();
    const onDisk = workStateCapsuleSchema.parse(
      JSON.parse(readFileSync(capsulePath(storeRoot, wk, sid), "utf8")),
    );
    expect(onDisk.filesTouched).toEqual([
      { path: "src/a.ts", chunkSetId: "cs-1", createdAt: "2026-08-06T10:00:00.000Z" },
    ]);
    expect(onDisk.intent).toEqual({ prompt: "fix auth", ts: NOW - 60_000 });
    expect(onDisk.trigger).toBe("auto");
  });

  it("fails open: malformed payload writes nothing and returns null", async () => {
    const capsule = await runCapsuleHook({
      payload: { nope: true },
      storeRoot,
      now: () => NOW,
      list: listOverlayChunkSets,
    });
    expect(capsule).toBeNull();
    expect(existsSync(capsulePath(storeRoot, wk, sid))).toBe(false);
  });

  it("fails open: an unsafe session_id never becomes a path segment", async () => {
    const capsule = await runCapsuleHook({
      payload: { session_id: "../evil", cwd },
      storeRoot,
      now: () => NOW,
      list: listOverlayChunkSets,
    });
    expect(capsule).toBeNull();
  });

  it("fails open: a throwing store listing writes nothing and returns null", async () => {
    const capsule = await runCapsuleHook({
      payload: { session_id: sid, cwd },
      storeRoot,
      now: () => NOW,
      list: async () => {
        throw new Error("store exploded");
      },
    });
    expect(capsule).toBeNull();
    expect(existsSync(capsulePath(storeRoot, wk, sid))).toBe(false);
  });
});
