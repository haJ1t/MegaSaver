import { describe, expect, it } from "vitest";
import { parseBrainBundle } from "../src/brain-bundle.js";
import { exportBrain } from "../src/brain-export.js";
import { CoreRegistryError } from "../src/errors.js";
import type { MemoryEntry } from "../src/memory-entry.js";
import { createInMemoryCoreRegistry } from "../src/registry.js";

const SECRET = "sk-ant-api03-abcdefghij0123456789";

const NOW = "2026-07-09T12:00:00.000Z";

function seed() {
  const registry = createInMemoryCoreRegistry();
  const project = registry.createProject({
    id: "0f0e0d0c-0b0a-4900-8807-060504030201",
    name: "alpha",
    rootPath: "/tmp/alpha",
    createdAt: NOW,
    updatedAt: NOW,
  } as never);
  const session = registry.createSession({
    id: "44444444-4444-4444-8444-444444444444",
    projectId: project.id,
    agentId: "claude-code",
    riskLevel: "medium",
    title: "s1",
    startedAt: NOW,
    endedAt: null,
  } as never);
  const base: Omit<MemoryEntry, "id" | "approval" | "scope" | "sessionId"> = {
    projectId: project.id,
    type: "decision",
    title: "t",
    content: "plain knowledge",
    keywords: [],
    confidence: "high",
    source: "manual",
    stale: false,
    createdAt: NOW,
    updatedAt: NOW,
  } as never;
  registry.createMemoryEntry({
    ...base,
    id: "11111111-1111-4111-8111-111111111111",
    scope: "project",
    sessionId: null,
    approval: "approved",
  } as MemoryEntry);
  registry.createMemoryEntry({
    ...base,
    id: "11111111-1111-4111-8111-111111111112",
    scope: "project",
    sessionId: null,
    approval: "suggested",
    content: "unreviewed knowledge",
  } as MemoryEntry);
  registry.createMemoryEntry({
    ...base,
    id: "11111111-1111-4111-8111-111111111113",
    scope: "session",
    sessionId: session.id,
    approval: "approved",
    content: "session-tied knowledge",
  } as MemoryEntry);
  registry.createMemoryEntry({
    ...base,
    id: "11111111-1111-4111-8111-111111111114",
    scope: "project",
    sessionId: null,
    approval: "approved",
    content: "token sk-ant-api03-abcdefghij0123456789 leaked here",
  } as MemoryEntry);
  return { registry, project };
}

describe("exportBrain", () => {
  it("exports approved project-scoped memories only", () => {
    const { registry, project } = seed();
    const text = exportBrain({ registry, projectId: project.id, createdAt: NOW });
    const { manifest, payload } = parseBrainBundle(text);
    expect(manifest.counts.memories).toBe(2);
    const contents = payload.memories.map((m) => m.content);
    expect(contents.some((c) => c.includes("unreviewed"))).toBe(false);
    expect(contents.some((c) => c.includes("session-tied"))).toBe(false);
  });

  it("redacts secrets in content and counts findings in the manifest", () => {
    const { registry, project } = seed();
    const text = exportBrain({ registry, projectId: project.id, createdAt: NOW });
    const { manifest, payload } = parseBrainBundle(text);
    expect(text.includes("sk-ant-api03-abcdefghij0123456789")).toBe(false);
    expect(manifest.redactionFindings).toBeGreaterThan(0);
    expect(payload.memories.every((m) => m.content.length > 0)).toBe(true);
  });

  it("names the source project in the manifest", () => {
    const { registry, project } = seed();
    const { manifest } = parseBrainBundle(
      exportBrain({ registry, projectId: project.id, createdAt: NOW }),
    );
    expect(manifest.sourceProject).toEqual({ id: project.id, name: "alpha" });
  });

  it("exports empty knowledge as empty arrays, not an error", () => {
    const registry = createInMemoryCoreRegistry();
    const project = registry.createProject({
      id: "0f0e0d0c-0b0a-4900-8807-060504030202",
      name: "empty",
      rootPath: "/tmp/empty",
      createdAt: NOW,
      updatedAt: NOW,
    } as never);
    const { manifest } = parseBrainBundle(
      exportBrain({ registry, projectId: project.id, createdAt: NOW }),
    );
    expect(manifest.counts).toEqual({ memories: 0, rules: 0, failures: 0 });
  });

  it("redacts secrets in rules and failures too", () => {
    const { registry, project } = seed();
    registry.createProjectRule({
      id: "22222222-2222-4222-8222-222222222221",
      projectId: project.id,
      title: "rule",
      rule: "never commit keys",
      appliesTo: [],
      evidence: [`leaked ${SECRET} in evidence`],
      severity: "critical",
      confidence: "high",
      createdFrom: "manual",
      createdAt: NOW,
      updatedAt: NOW,
    } as never);
    registry.createFailedAttempt({
      id: "33333333-3333-4333-8333-333333333331",
      projectId: project.id,
      sessionId: null,
      task: "deploy",
      failedStep: "auth",
      errorOutput: `auth failed with ${SECRET}`,
      relatedFiles: [],
      convertedToRule: false,
      createdAt: NOW,
    } as never);
    const text = exportBrain({ registry, projectId: project.id, createdAt: NOW });
    const { manifest } = parseBrainBundle(text);
    expect(text.includes(SECRET)).toBe(false);
    expect(manifest.redactionFindings).toBeGreaterThan(1);
    expect(manifest.counts.rules).toBe(1);
    expect(manifest.counts.failures).toBe(1);
  });

  it("redacts secrets hidden in free-text array fields", () => {
    const { registry, project } = seed();
    registry.createMemoryEntry({
      id: "11111111-1111-4111-8111-111111111115",
      projectId: project.id,
      scope: "project",
      sessionId: null,
      type: "decision",
      title: "t",
      content: "plain knowledge",
      keywords: [SECRET],
      relatedFiles: [`src/${SECRET}.ts`],
      relatedSymbols: [`fn_${SECRET}`],
      confidence: "high",
      source: "manual",
      approval: "approved",
      stale: false,
      createdAt: NOW,
      updatedAt: NOW,
    } as never);
    registry.createProjectRule({
      id: "22222222-2222-4222-8222-222222222222",
      projectId: project.id,
      title: "rule",
      rule: "never commit keys",
      appliesTo: [`glob/${SECRET}`],
      evidence: [],
      severity: "critical",
      confidence: "high",
      createdFrom: "manual",
      createdAt: NOW,
      updatedAt: NOW,
    } as never);
    registry.createFailedAttempt({
      id: "33333333-3333-4333-8333-333333333332",
      projectId: project.id,
      sessionId: null,
      task: "deploy",
      failedStep: "auth",
      relatedFiles: [`log/${SECRET}.txt`],
      convertedToRule: false,
      createdAt: NOW,
    } as never);
    const text = exportBrain({ registry, projectId: project.id, createdAt: NOW });
    const { manifest } = parseBrainBundle(text);
    expect(text.includes(SECRET)).toBe(false);
    expect(manifest.redactionFindings).toBeGreaterThan(1);
  });

  it("throws project_not_found for an unknown project", () => {
    const { registry } = seed();
    let thrown: unknown;
    try {
      exportBrain({
        registry,
        projectId: "0f0e0d0c-0b0a-4900-8807-060504030299" as never,
        createdAt: NOW,
      });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(CoreRegistryError);
    expect((thrown as CoreRegistryError).code).toBe("project_not_found");
  });
});
