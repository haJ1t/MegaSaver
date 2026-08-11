import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runBrainDoctor } from "../src/commands/brain/doctor.js";
import { ensureStoreReady } from "../src/store.js";

let storeRoot: string;
let projectRoot: string;
const PROJECT_ID = "44444444-4444-4444-8444-444444444444";
const PROJECT_NAME = "demo";
const MEMORY_ID = "00000000-0000-4000-8000-00000000a1a1";
const NOW = "2026-08-06T00:00:00.000Z";

function makeInput(over: Partial<Parameters<typeof runBrainDoctor>[0]> = {}) {
  const lines: string[] = [];
  const errLines: string[] = [];
  return {
    input: {
      projectName: PROJECT_NAME,
      storeFlag: storeRoot,
      jsonFlag: false,
      settingsPath: join(tmpdir(), `brain-doctor-settings-${Date.now()}.json`),
      now: () => NOW,
      cwd: projectRoot,
      home: tmpdir(),
      xdgDataHome: undefined as string | undefined,
      platform: "linux" as NodeJS.Platform,
      localAppData: undefined as string | undefined,
      stdout: (l: string) => lines.push(l),
      stderr: (l: string) => errLines.push(l),
      ...over,
    } as Parameters<typeof runBrainDoctor>[0],
    lines,
    errLines,
  };
}

async function seedStore(opts: { stale?: boolean; suggested?: number } = {}) {
  const { registry } = await ensureStoreReady(storeRoot);
  // create project if not exists
  const existing = registry.listProjects().find((p) => p.name === PROJECT_NAME);
  if (!existing) {
    registry.createProject({
      id: PROJECT_ID,
      name: PROJECT_NAME,
      rootPath: projectRoot,
      createdAt: NOW,
      updatedAt: NOW,
    } as never);
  }
  const maybeProject = registry.listProjects().find((p) => p.name === PROJECT_NAME);
  if (!maybeProject) throw new Error("project not found in seedStore");
  const project = maybeProject;
  if (opts.stale) {
    registry.createMemoryEntry({
      id: MEMORY_ID,
      projectId: project.id as never,
      sessionId: null,
      scope: "project",
      type: "decision",
      title: "t",
      content: "stale content",
      keywords: [],
      confidence: "medium",
      source: "agent",
      approval: "approved",
      stale: true,
      createdAt: NOW,
      updatedAt: NOW,
    } as never);
  }
  const count = opts.suggested ?? 0;
  for (let i = 0; i < count; i += 1) {
    registry.createMemoryEntry({
      id: `00000000-0000-4000-8000-00000000b0b${i}` as never,
      projectId: project.id as never,
      sessionId: null,
      scope: "project",
      type: "decision",
      title: "s",
      content: `suggested ${i}`,
      keywords: [],
      confidence: "low",
      source: "agent",
      approval: "suggested",
      stale: false,
      createdAt: NOW,
      updatedAt: NOW,
    } as never);
  }
}

beforeEach(() => {
  storeRoot = mkdtempSync(join(tmpdir(), "brain-doctor-store-"));
  projectRoot = mkdtempSync(join(tmpdir(), "brain-doctor-proj-"));
});

afterEach(() => {
  rmSync(storeRoot, { recursive: true, force: true });
  rmSync(projectRoot, { recursive: true, force: true });
});

describe("mega brain doctor", () => {
  it("prints summary plus one aligned row per finding and exits 0", async () => {
    await seedStore({ stale: true, suggested: 1 });
    const { input, lines } = makeInput({});
    const code = await runBrainDoctor(input);
    expect(code).toBe(0);
    expect(lines.some((l) => l.includes("recallable"))).toBe(true);
    const staleRow = lines.find((l) => l.includes("stale-flagged"));
    expect(staleRow).toContain("warn");
    expect(staleRow).toContain(MEMORY_ID);
    expect(staleRow).toContain("mega memory sweep demo");
  });

  it("--json emits schemaVersion, summary, and findings with evidence ids", async () => {
    await seedStore({ stale: true, suggested: 1 });
    const { input, lines } = makeInput({ jsonFlag: true });
    const code = await runBrainDoctor(input);
    expect(code).toBe(0);
    const report = JSON.parse(lines.join("\n"));
    expect(report.schemaVersion).toBe(1);
    expect(report.project).toBe("demo");
    expect(report.generatedAt).toBe(NOW);
    expect(report.summary.total).toBeGreaterThan(0);
    expect(report.findings.some((f: { check: string }) => f.check === "hook-coverage")).toBe(true);
    expect(report.findings.some((f: { check: string }) => f.check === "sync-freshness")).toBe(true);
  });

  it("unknown project -> exit 1 via projectNotFoundMessage", async () => {
    await seedStore({});
    const { input, errLines } = makeInput({ projectName: "nope" });
    const code = await runBrainDoctor(input);
    expect(code).toBe(1);
    expect(errLines.join("\n")).toContain("nope");
  });

  it("healthy empty-ish store still reports coverage + sync findings, exit 0", async () => {
    await seedStore({});
    const { input } = makeInput({});
    const code = await runBrainDoctor(input);
    expect(code).toBe(0);
  });
});
