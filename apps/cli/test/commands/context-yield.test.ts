import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runContextYield } from "../../src/commands/context/yield.js";
import { ensureStoreReady } from "../../src/store.js";

let storeRoot: string;
let projectRoot: string;

beforeEach(() => {
  storeRoot = mkdtempSync(join(tmpdir(), "cli-yield-store-"));
  projectRoot = mkdtempSync(join(tmpdir(), "cli-yield-proj-"));
});

afterEach(() => {
  rmSync(storeRoot, { recursive: true, force: true });
  rmSync(projectRoot, { recursive: true, force: true });
});

async function createProject() {
  const { registry } = await ensureStoreReady(storeRoot);
  const project = registry.createProject({
    id: "22222222-2222-4222-8222-222222222222",
    name: "yield-it",
    rootPath: projectRoot,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  } as never);
  // create 3 memories
  for (let i = 0; i < 3; i += 1) {
    registry.createMemoryEntry({
      id: `00000000-0000-4000-8000-00000000000${i}`,
      projectId: project.id,
      sessionId: null,
      scope: "project",
      type: "decision",
      title: `mem ${i}`,
      content: `memory content ${i} handles stripe checkout`,
      keywords: [],
      confidence: "medium",
      source: "manual",
      approval: "approved",
      stale: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      relatedFiles: i === 0 ? ["src/a.ts"] : [],
    } as never);
  }
  return project;
}

describe("mega context yield", () => {
  it("json parses and freeloaders sorted", async () => {
    await createProject();
    const out: string[] = [];
    const code = await runContextYield({
      cwd: projectRoot,
      home: tmpdir(),
      storeFlag: storeRoot,
      platform: "linux" as NodeJS.Platform,
      windowFlag: "7d",
      json: true,
      stdout: (l) => out.push(l),
      stderr: () => {},
    });
    expect(code).toBe(0);
    const parsed = JSON.parse(out.join(""));
    expect(parsed).toHaveProperty("rows");
    expect(parsed).toHaveProperty("honestNote");
    expect(parsed.rows).toHaveLength(3);
    // all freeloaders since no readIndex/diff evidence
    expect(parsed.rows[0].tier).toBe("FREELOADER");
  });

  it("no project -> exit 1", async () => {
    const err: string[] = [];
    const code = await runContextYield({
      cwd: projectRoot,
      home: tmpdir(),
      storeFlag: storeRoot,
      platform: "linux" as NodeJS.Platform,
      json: false,
      stdout: () => {},
      stderr: (l) => err.push(l),
    });
    expect(code).toBe(1);
    expect(err.join("")).toContain("no registered project");
  });

  it("window >30d -> exit 1", async () => {
    await createProject();
    const err: string[] = [];
    const code = await runContextYield({
      cwd: projectRoot,
      home: tmpdir(),
      storeFlag: storeRoot,
      platform: "linux" as NodeJS.Platform,
      windowFlag: "31d",
      json: false,
      stdout: () => {},
      stderr: (l) => err.push(l),
    });
    expect(code).toBe(1);
    expect(err.join("")).toContain("window must be");
  });

  it("empty injected -> no memories message", async () => {
    const { registry } = await ensureStoreReady(storeRoot);
    registry.createProject({
      id: "33333333-3333-4333-8333-333333333333",
      name: "empty-yield",
      rootPath: projectRoot,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } as never);
    const out: string[] = [];
    const code = await runContextYield({
      cwd: projectRoot,
      home: tmpdir(),
      storeFlag: storeRoot,
      platform: "linux" as NodeJS.Platform,
      json: false,
      stdout: (l) => out.push(l),
      stderr: () => {},
    });
    expect(code).toBe(0);
    expect(out.join("\n")).toContain("no memories");
  });

  it("human table contains headers", async () => {
    await createProject();
    const out: string[] = [];
    await runContextYield({
      cwd: projectRoot,
      home: tmpdir(),
      storeFlag: storeRoot,
      platform: "linux" as NodeJS.Platform,
      json: false,
      stdout: (l) => out.push(l),
      stderr: () => {},
    });
    expect(out.join("\n")).toContain("Context yield audit");
    expect(out.join("\n")).toContain("honestNote");
  });
});
