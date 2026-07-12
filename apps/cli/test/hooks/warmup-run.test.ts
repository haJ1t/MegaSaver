import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildWarmupHookOutput } from "../../src/hooks/warmup-run.js";
import { ensureStoreReady } from "../../src/store.js";

const NOW = "2026-07-12T10:00:00.000Z";
let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "megasaver-warmhook-"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

async function seed(rootPath: string) {
  const { registry } = await ensureStoreReady(root);
  registry.createProject({
    id: "11111111-1111-4111-8111-111111111111",
    name: "demo",
    rootPath,
    createdAt: NOW,
    updatedAt: NOW, // strict schema requires this
  } as never);
}

describe("buildWarmupHookOutput", () => {
  it("returns the brief text for a matching project", async () => {
    await seed("/work/demo");
    const text = await buildWarmupHookOutput({
      payload: { session_id: "s1", cwd: "/work/demo", source: "startup" },
      storeRoot: root,
      now: () => Date.parse(NOW),
      gatherDelta: () => null,
    });
    expect(text).toContain("Warm Start — demo");
  });

  it("returns empty string when no project matches (fail-open)", async () => {
    await ensureStoreReady(root);
    const text = await buildWarmupHookOutput({
      payload: { session_id: "s1", cwd: "/nowhere", source: "startup" },
      storeRoot: root,
      now: () => Date.parse(NOW),
      gatherDelta: () => null,
    });
    expect(text).toBe("");
  });

  it("returns empty string on malformed payload (fail-open)", async () => {
    const text = await buildWarmupHookOutput({
      payload: { nope: true },
      storeRoot: root,
      now: () => Date.parse(NOW),
      gatherDelta: () => null,
    });
    expect(text).toBe("");
  });

  it("stamps lastSeenAt on success", async () => {
    await seed("/work/demo");
    const { readWarmStartState } = await import("@megasaver/core");
    await buildWarmupHookOutput({
      payload: { session_id: "s1", cwd: "/work/demo", source: "startup" },
      storeRoot: root,
      now: () => Date.parse(NOW),
      gatherDelta: () => null,
    });
    expect(readWarmStartState(root, "11111111-1111-4111-8111-111111111111")?.lastSeenAt).toBe(NOW);
  });

  it("returns empty string when gatherDelta throws mid-flight (fail-open)", async () => {
    await seed("/work/demo");
    const text = await buildWarmupHookOutput({
      payload: { session_id: "s1", cwd: "/work/demo", source: "startup" },
      storeRoot: root,
      now: () => Date.parse(NOW),
      gatherDelta: () => {
        throw new Error("boom");
      },
    });
    expect(text).toBe("");
  });
});
