import { describe, expect, it } from "vitest";
import { exportBrain } from "../src/brain-export.js";
import { importBrain } from "../src/brain-import.js";
import type { MemoryEntry } from "../src/memory-entry.js";
import { type CoreRegistry, createInMemoryCoreRegistry } from "../src/registry.js";

const NOW = "2026-07-09T12:00:00.000Z";
let seq = 0;
const newId = () => `aaaaaaaa-0000-4000-8000-${String(++seq).padStart(12, "0")}`;

function makeProject(registry: CoreRegistry, id: string, name: string) {
  return registry.createProject({
    id,
    name,
    rootPath: `/tmp/${name}`,
    createdAt: NOW,
    updatedAt: NOW,
  } as never);
}

function seedSource() {
  const registry = createInMemoryCoreRegistry();
  const project = makeProject(registry, "0f0e0d0c-0b0a-4900-8807-060504030201", "alpha");
  registry.createMemoryEntry({
    id: "11111111-1111-4111-8111-111111111111",
    projectId: project.id,
    sessionId: null,
    scope: "project",
    type: "decision",
    title: "t",
    content: "ndjson bundles",
    keywords: [],
    confidence: "high",
    source: "agent",
    approval: "approved",
    stale: false,
    createdAt: NOW,
    updatedAt: NOW,
    supersedesId: "11111111-1111-4111-8111-111111111110",
  } as MemoryEntry);
  registry.createProjectRule({
    id: "22222222-2222-4222-8222-222222222222",
    projectId: project.id,
    title: "no raw logs",
    rule: "Never paste raw build logs.",
    appliesTo: [],
    evidence: [],
    severity: "warning",
    confidence: "high",
    createdFrom: "manual",
    createdAt: NOW,
    updatedAt: NOW,
  } as never);
  registry.createFailedAttempt({
    id: "33333333-3333-4333-8333-333333333333",
    projectId: project.id,
    sessionId: null,
    task: "import",
    failedStep: "hash",
    relatedFiles: [],
    convertedToRule: false,
    createdAt: NOW,
  } as never);
  return exportBrain({ registry, projectId: project.id, createdAt: NOW });
}

function targetRegistry() {
  const registry = createInMemoryCoreRegistry();
  const project = makeProject(registry, "0f0e0d0c-0b0a-4900-8807-060504030299", "beta");
  return { registry, project };
}

describe("importBrain", () => {
  it("imports memories as suggested with new ids, target projectId, provenance evidence, no supersedesId", () => {
    const bundleText = seedSource();
    const { registry, project } = targetRegistry();
    const report = importBrain({ registry, projectId: project.id, bundleText, newId });
    expect(report.imported).toEqual({ memories: 1, rules: 1, failures: 1 });
    const [m] = registry.listMemoryEntries(project.id);
    expect(m?.approval).toBe("suggested");
    expect(m?.projectId).toBe(project.id);
    expect(m?.id).not.toBe("11111111-1111-4111-8111-111111111111");
    expect(m?.source).toBe("agent");
    expect(m?.evidence).toContain("brain-import:alpha");
    expect(m?.supersedesId).toBeUndefined();
    const [rule] = registry.listProjectRules(project.id);
    expect(rule?.projectId).toBe(project.id);
    const [f] = registry.listFailedAttempts(project.id);
    expect(f?.sessionId).toBeNull();
  });

  it("skips exact duplicates and counts them", () => {
    const bundleText = seedSource();
    const { registry, project } = targetRegistry();
    importBrain({ registry, projectId: project.id, bundleText, newId });
    const report = importBrain({ registry, projectId: project.id, bundleText, newId });
    expect(report.imported).toEqual({ memories: 0, rules: 0, failures: 0 });
    expect(report.skipped).toEqual({ memories: 1, rules: 1, failures: 1 });
    expect(registry.listMemoryEntries(project.id)).toHaveLength(1);
  });

  it("propagates BrainBundleError on tampered payload without writing anything", () => {
    const bundleText = seedSource().replace("ndjson bundles", "ndjson bundlez");
    const { registry, project } = targetRegistry();
    expect(() => importBrain({ registry, projectId: project.id, bundleText, newId })).toThrowError(
      /hash mismatch|corrupted/i,
    );
    expect(registry.listMemoryEntries(project.id)).toHaveLength(0);
  });

  it("throws on unknown target project", () => {
    const bundleText = seedSource();
    const registry = createInMemoryCoreRegistry();
    expect(() =>
      importBrain({
        registry,
        projectId: "0f0e0d0c-0b0a-4900-8807-060504039999" as never,
        bundleText,
        newId,
      }),
    ).toThrowError(/not found|not exist/i);
  });
});
