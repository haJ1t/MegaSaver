import { randomUUID } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { projectIdSchema, sessionIdSchema } from "@megasaver/shared";
import { afterEach, beforeEach, expect, it } from "vitest";
import type { ChunkSet } from "../src/chunk-set.js";
import { saveChunkSet } from "../src/store.js";
import { describeUnlessWindows } from "./_platform.js";

// A ChunkSet holds the verbatim body of every file the agent read and the full
// transcript of every command it ran. On a shared box a 0644 chunk set hands
// that to any other local account with `cat`.
let storeRoot: string;
const projectId = projectIdSchema.parse(randomUUID());
const sessionId = sessionIdSchema.parse(randomUUID());

function chunkSet(): ChunkSet {
  return {
    chunkSetId: "cs-perm",
    sessionId,
    projectId,
    createdAt: "2026-07-25T12:00:00.000Z",
    source: { kind: "file", path: "/tmp/secret.txt" },
    rawBytes: 64,
    redacted: false,
    chunks: [{ id: "c1", startLine: 1, endLine: 1, bytes: 16, text: "AWS_KEY=hunter2" }],
  } as ChunkSet;
}

function sessionDir(): string {
  return join(storeRoot, "content", projectId, sessionId);
}

beforeEach(() => {
  storeRoot = mkdtempSync(join(tmpdir(), "content-store-perm-"));
});

afterEach(() => {
  rmSync(storeRoot, { recursive: true, force: true });
});

describeUnlessWindows("saveChunkSet permissions", () => {
  it("writes the chunk set owner-only (0600)", async () => {
    await saveChunkSet({ storeRoot, chunkSet: chunkSet() });
    expect(statSync(join(sessionDir(), "cs-perm.json")).mode & 0o777).toBe(0o600);
  });

  it("creates the session dir owner-only (0700)", async () => {
    await saveChunkSet({ storeRoot, chunkSet: chunkSet() });
    expect(statSync(sessionDir()).mode & 0o777).toBe(0o700);
  });

  // mkdir's mode is a no-op on a dir that already exists, so a sibling writer
  // that got there first leaves the dir world-traversable unless we chmod.
  it("repairs a world-readable dir left by an earlier writer", async () => {
    mkdirSync(sessionDir(), { recursive: true });
    chmodSync(sessionDir(), 0o755);
    await saveChunkSet({ storeRoot, chunkSet: chunkSet() });
    expect(statSync(sessionDir()).mode & 0o777).toBe(0o700);
  });
});
