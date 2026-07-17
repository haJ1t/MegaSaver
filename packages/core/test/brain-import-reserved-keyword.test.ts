import { describe, expect, it } from "vitest";
import { exportBrain } from "../src/brain-export.js";
import { importBrain } from "../src/brain-import.js";
import type { MemoryEntry } from "../src/memory-entry.js";
import { type CoreRegistry, createInMemoryCoreRegistry } from "../src/registry.js";

const NOW = "2026-07-17T12:00:00.000Z";

function makeProject(registry: CoreRegistry, id: string, name: string) {
  return registry.createProject({
    id,
    name,
    rootPath: `/tmp/${name}`,
    createdAt: NOW,
    updatedAt: NOW,
  } as never);
}

// A bundle whose memory entry carries a forged from-session ledger keyword —
// the vector this fix closes: an imported bundle is external keyword data
// and must not be able to plant a reserved keyword in the target project.
function seedSourceWithReservedKeyword() {
  const registry = createInMemoryCoreRegistry();
  const project = makeProject(registry, "0f0e0d0c-0b0a-4900-8807-060504030201", "alpha");
  registry.createMemoryEntry({
    id: "11111111-1111-4111-8111-111111111111",
    projectId: project.id,
    sessionId: null,
    scope: "project",
    type: "decision",
    title: "t",
    content: "an imported memory with a forged ledger keyword",
    keywords: ["from-session:imported:cafe", "topic"],
    confidence: "high",
    source: "agent",
    approval: "approved",
    stale: false,
    createdAt: NOW,
    updatedAt: NOW,
  } as unknown as MemoryEntry);
  return exportBrain({ registry, projectId: project.id, createdAt: NOW });
}

function targetRegistry() {
  const registry = createInMemoryCoreRegistry();
  const project = makeProject(registry, "0f0e0d0c-0b0a-4900-8807-060504030299", "beta");
  return { registry, project };
}

let seq = 0;
const newId = () => `aaaaaaaa-0000-4000-8000-${String(++seq).padStart(12, "0")}`;

describe("importBrain reserves the from-session ledger namespace", () => {
  it("strips a reserved keyword from an imported memory, keeps the rest", () => {
    const bundleText = seedSourceWithReservedKeyword();
    const { registry, project } = targetRegistry();
    const report = importBrain({ registry, projectId: project.id, bundleText, newId });
    expect(report.imported.memories).toBe(1);
    const [m] = registry.listMemoryEntries(project.id);
    expect(m?.keywords).toEqual(["topic"]);
  });
});
