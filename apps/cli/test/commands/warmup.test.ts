import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { findProjectByCwd, runWarmup } from "../../src/commands/warmup.js";
import { ensureStoreReady } from "../../src/store.js";

const NOW = "2026-07-12T10:00:00.000Z";
let root: string;
let out: string[];
let err: string[];

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "megasaver-warmup-"));
  out = [];
  err = [];
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

async function seedProject(rootPath: string) {
  const { registry } = await ensureStoreReady(root);
  const project = registry.createProject({
    id: "11111111-1111-4111-8111-111111111111",
    name: "demo",
    rootPath,
    createdAt: NOW,
    updatedAt: NOW,
  } as never);
  return { registry, project };
}

function baseInput(over: Partial<Parameters<typeof runWarmup>[0]> = {}) {
  return {
    storeRoot: root,
    cwd: "/work/demo",
    now: () => Date.parse(NOW),
    json: false,
    write: false,
    gatherDelta: () => null,
    ensureStore: () => ensureStoreReady(root),
    stdout: (l: string) => out.push(l),
    stderr: (l: string) => err.push(l),
    ...over,
  };
}

describe("findProjectByCwd", () => {
  it("picks the longest rootPath match", () => {
    const projects = [{ rootPath: "/work" }, { rootPath: "/work/demo" }] as never[];
    expect(findProjectByCwd(projects as never, "/work/demo/src")).toEqual({
      rootPath: "/work/demo",
    });
    expect(findProjectByCwd(projects as never, "/elsewhere")).toBeNull();
  });
});

describe("runWarmup", () => {
  it("prints a brief for the cwd-resolved project", async () => {
    await seedProject("/work/demo");
    const code = await runWarmup(baseInput());
    expect(code).toBe(0);
    expect(out.join("\n")).toContain("Warm Start — demo");
  });

  it("errors when no project matches cwd", async () => {
    await seedProject("/work/demo");
    const code = await runWarmup(baseInput({ cwd: "/nowhere" }));
    expect(code).toBe(1);
    expect(err.join("\n")).toContain("no project");
  });

  it("--json emits the WarmStartBrief struct", async () => {
    await seedProject("/work/demo");
    await runWarmup(baseInput({ json: true }));
    const parsed = JSON.parse(out.join("\n")) as { mode: string; tokenEstimate: number };
    expect(parsed.mode).toBe("standard");
    expect(parsed.tokenEstimate).toBeGreaterThan(0);
  });

  it("stamps lastSeenAt after printing", async () => {
    await seedProject("/work/demo");
    const { readWarmStartState } = await import("@megasaver/core");
    await runWarmup(baseInput());
    expect(readWarmStartState(root, "11111111-1111-4111-8111-111111111111")).not.toBeNull();
  });

  it("records a WarmStartEvent", async () => {
    await seedProject("/work/demo");
    const { readWarmStartEvents } = await import("@megasaver/core");
    await runWarmup(baseInput());
    const events = readWarmStartEvents({ root }, "11111111-1111-4111-8111-111111111111" as never);
    expect(events.length).toBe(1);
    expect(events[0]?.estimated).toBe(true);
  });
});
