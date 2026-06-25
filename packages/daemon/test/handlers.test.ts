import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { excerptHandler, expandHandler } from "../src/handlers.js";

let store: string;
beforeEach(() => {
  store = mkdtempSync(join(tmpdir(), "daemon-handlers-"));
});
afterEach(() => {
  rmSync(store, { recursive: true, force: true });
});

const bigRaw = Array.from({ length: 400 }, (_, i) => `line ${i} lorem ipsum dolor sit amet`).join(
  "\n",
);

describe("excerptHandler", () => {
  it("400s on an invalid body", async () => {
    const res = await excerptHandler(store, { workspaceKey: "ws" });
    expect(res.status).toBe(400);
  });

  it("compresses + stores a large output and returns a chunkSetId", async () => {
    const res = await excerptHandler(store, {
      workspaceKey: "ws",
      liveSessionId: "live1",
      raw: bigRaw,
      sourceKind: "command",
      label: "run tests",
      mode: "aggressive",
      storeRawOutput: true,
    });
    expect(res.status).toBe(200);
    expect(res.json.decision).toBe("compressed");
    expect(typeof res.json.chunkSetId).toBe("string");
    expect(res.json.returnedBytes).toBeLessThan(res.json.rawBytes);
  });

  it("rejects a path-traversal workspaceKey without writing outside the store", async () => {
    const res = await excerptHandler(store, {
      workspaceKey: "../escape",
      liveSessionId: "x",
      raw: bigRaw,
      sourceKind: "command",
      label: "l",
      mode: "aggressive",
      // storeRawOutput:false is the unguarded stats-write path the POC abused.
      storeRawOutput: false,
    });
    expect(res.status).toBe(400);
    expect(existsSync(join(store, "..", "escape"))).toBe(false);
  });
});

describe("expandHandler", () => {
  it("round-trips a stored chunk produced by excerpt", async () => {
    const ex = await excerptHandler(store, {
      workspaceKey: "ws",
      liveSessionId: "live1",
      raw: bigRaw,
      sourceKind: "command",
      label: "run tests",
      mode: "aggressive",
      storeRawOutput: true,
    });
    const res = await expandHandler(store, {
      workspaceKey: "ws",
      liveSessionId: "live1",
      chunkSetId: ex.json.chunkSetId,
      chunkId: "0",
    });
    expect(res.status).toBe(200);
    expect(res.json.chunk.text).toContain("line 0");
  });

  it("404s on a missing chunk set", async () => {
    const res = await expandHandler(store, {
      workspaceKey: "ws",
      liveSessionId: "live1",
      chunkSetId: "missing",
      chunkId: "0",
    });
    expect(res.status).toBe(404);
  });

  it("400s on a path-traversal chunkSetId", async () => {
    const res = await expandHandler(store, {
      workspaceKey: "ws",
      liveSessionId: "live1",
      chunkSetId: "..",
      chunkId: "0",
    });
    expect(res.status).toBe(400);
  });
});
