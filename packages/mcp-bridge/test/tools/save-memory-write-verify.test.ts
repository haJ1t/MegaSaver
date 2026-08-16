import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type CoreRegistry, createInMemoryCoreRegistry } from "@megasaver/core";
import { type EvidenceRecordInput, appendEvidence } from "@megasaver/evidence-ledger";
import type { MemoryEntryId, ProjectId } from "@megasaver/shared";
import { encodeWorkspaceKey } from "@megasaver/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { handleApproveMemory } from "../../src/tools/approve-memory.js";
import { handleSaveMemory } from "../../src/tools/save-memory.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111" as ProjectId;
const ROOT_PATH = "/tmp/demo";
const TS = "2026-06-11T00:00:00.000Z";
const TS_PLUS_90D = "2026-09-09T00:00:00.000Z";
const EV_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const MISSING_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function seededRegistry(): CoreRegistry {
  const registry = createInMemoryCoreRegistry();
  registry.createProject({
    id: PROJECT_ID,
    name: "demo",
    rootPath: ROOT_PATH,
    createdAt: TS,
    updatedAt: TS,
  });
  return registry;
}

function idFactory(): () => string {
  const ids = ["cccccccc-cccc-4ccc-8ccc-cccccccccccc", "dddddddd-dddd-4ddd-8ddd-dddddddddddd"];
  let i = 0;
  return () => ids[i++] ?? "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
}

function minimalInput(evidenceId: string): EvidenceRecordInput {
  return {
    evidenceId,
    workspaceKey: encodeWorkspaceKey(ROOT_PATH),
    sessionRef: null,
    sourceKind: "command",
    sourceRef: { label: "test" },
    classification: "test",
    redactionReport: { redacted: false, highRiskFindings: 0, unresolvedHighRisk: false },
    redactedRawChunkSetId: "cset-0000",
    returnedChunkRefs: [],
    createdAt: TS,
    expiresAt: null,
    retentionClass: "transient",
    policyVersion: "1.0",
    pipelineVersion: "1.0",
    redactedRawContent: "raw content",
    redactedReturnedContent: "returned content",
  };
}

let storeRoot: string;
beforeEach(() => {
  storeRoot = mkdtempSync(join(tmpdir(), "mega-wv-save-"));
});
afterEach(() => {
  rmSync(storeRoot, { recursive: true, force: true });
});

describe("save_memory write gate", () => {
  it("agent save citing a dead evidence id persists suggested/low with a quarantined sidecar", async () => {
    const registry = seededRegistry();
    const result = await handleSaveMemory(
      { registry, storeRoot, now: () => TS, newId: idFactory() },
      {
        projectId: PROJECT_ID,
        scope: "project",
        content: "auth uses JWT",
        confidence: "high",
        approval: "approved",
        evidence: [MISSING_ID],
      },
    );
    const stored = registry.getMemoryEntry(result.id as MemoryEntryId);
    expect(stored?.approval).toBe("suggested");
    expect(stored?.confidence).toBe("low");
    expect(stored?.expiresAt).toBe(TS_PLUS_90D);
    const sidecar = registry.getMemoryValidation(result.id as MemoryEntryId);
    expect(sidecar?.validationStatus).toBe("quarantined");
    expect(sidecar?.validatedBy).toBe("system");
    expect(sidecar?.reasons).toContain("evidence_not_found");
  });

  it("agent save with resolving evidence is verified: caller approval + confidence pass through", async () => {
    await appendEvidence({ storeRoot, redactSourceRef: (r) => r, record: minimalInput(EV_ID) });
    const registry = seededRegistry();
    const result = await handleSaveMemory(
      { registry, storeRoot, now: () => TS, newId: idFactory() },
      {
        projectId: PROJECT_ID,
        scope: "project",
        content: "auth uses JWT",
        confidence: "high",
        approval: "approved",
        evidence: [EV_ID],
      },
    );
    const stored = registry.getMemoryEntry(result.id as MemoryEntryId);
    expect(stored?.approval).toBe("approved");
    expect(stored?.confidence).toBe("high");
    expect(registry.getMemoryValidation(result.id as MemoryEntryId)?.validationStatus).toBe(
      "valid",
    );
  });

  it("explicit expiresAt: null on a gated write means no expiry", async () => {
    const registry = seededRegistry();
    const result = await handleSaveMemory(
      { registry, storeRoot, now: () => TS, newId: idFactory() },
      { projectId: PROJECT_ID, scope: "project", content: "x", expiresAt: null },
    );
    expect(registry.getMemoryEntry(result.id as MemoryEntryId)?.expiresAt).toBeNull();
  });

  it("missing storeRoot fails closed for trust, open for persistence (resolver_unavailable)", async () => {
    const registry = seededRegistry();
    const result = await handleSaveMemory(
      { registry, now: () => TS, newId: idFactory() },
      { projectId: PROJECT_ID, scope: "project", content: "x", evidence: [EV_ID] },
    );
    const stored = registry.getMemoryEntry(result.id as MemoryEntryId);
    expect(stored?.approval).toBe("suggested");
    expect(stored?.confidence).toBe("low");
    expect(registry.getMemoryValidation(result.id as MemoryEntryId)?.reasons).toContain(
      "resolver_unavailable",
    );
  });

  it("caller source is boundary-forced: manual/test_failure cannot dodge the gate", async () => {
    const registry = seededRegistry();
    const newId = idFactory();
    for (const source of ["manual", "test_failure"] as const) {
      const result = await handleSaveMemory(
        { registry, storeRoot, now: () => TS, newId },
        {
          projectId: PROJECT_ID,
          scope: "project",
          content: `dodgy claim ${source}`,
          source,
          confidence: "high",
          approval: "approved",
        },
      );
      const stored = registry.getMemoryEntry(result.id as MemoryEntryId);
      expect(stored?.source).toBe("agent");
      expect(stored?.approval).toBe("suggested");
      expect(stored?.confidence).toBe("low");
      expect(stored?.expiresAt).toBe(TS_PLUS_90D);
    }
  });

  it("an evidence array over the 32-pointer cap is rejected by the schema", async () => {
    const registry = seededRegistry();
    await expect(
      handleSaveMemory(
        { registry, storeRoot, now: () => TS, newId: idFactory() },
        {
          projectId: PROJECT_ID,
          scope: "project",
          content: "x",
          evidence: Array.from(
            { length: 33 },
            (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
          ),
        },
      ),
    ).rejects.toThrow();
  });

  it("anchor capture failure downgrades a cited-file write instead of verifying silently", async () => {
    await appendEvidence({ storeRoot, redactSourceRef: (r) => r, record: minimalInput(EV_ID) });
    const registry = seededRegistry();
    const result = await handleSaveMemory(
      {
        registry,
        storeRoot,
        now: () => TS,
        newId: idFactory(),
        execGit: () => {
          throw new Error("git gone");
        },
      },
      {
        projectId: PROJECT_ID,
        scope: "project",
        content: "auth uses JWT",
        confidence: "high",
        approval: "approved",
        evidence: [EV_ID],
        relatedFiles: ["src/auth.ts"],
      },
    );
    const stored = registry.getMemoryEntry(result.id as MemoryEntryId);
    expect(stored?.approval).toBe("suggested");
    expect(stored?.confidence).toBe("medium");
    const sidecar = registry.getMemoryValidation(result.id as MemoryEntryId);
    expect(sidecar?.validationStatus).toBe("needs_approval");
    expect(sidecar?.reasons).toContain("anchor_dropped:src/auth.ts");
  });

  it("approve composition: a verified gate-written entry still approves", async () => {
    await appendEvidence({ storeRoot, redactSourceRef: (r) => r, record: minimalInput(EV_ID) });
    const registry = seededRegistry();
    const saved = await handleSaveMemory(
      { registry, storeRoot, now: () => TS, newId: idFactory() },
      {
        projectId: PROJECT_ID,
        scope: "project",
        content: "auth uses JWT",
        confidence: "high",
        approval: "approved",
        evidence: [EV_ID],
      },
    );
    const res = await handleApproveMemory(
      { registry, now: () => TS, storeRoot },
      { memoryEntryId: saved.id as MemoryEntryId },
    );
    expect(res.approval).toBe("approved");
  });

  it("approve composition: a zero-evidence gated entry is quarantined missing_evidence", async () => {
    const registry = seededRegistry();
    const saved = await handleSaveMemory(
      { registry, storeRoot, now: () => TS, newId: idFactory() },
      { projectId: PROJECT_ID, scope: "project", content: "auth uses JWT" },
    );
    const res = await handleApproveMemory(
      { registry, now: () => TS, storeRoot },
      { memoryEntryId: saved.id as MemoryEntryId },
    );
    expect(res.validation?.status).toBe("quarantined");
    expect(res.validation?.reasons).toContain("missing_evidence");
  });

  it("a deduped save writes no second sidecar", async () => {
    await appendEvidence({ storeRoot, redactSourceRef: (r) => r, record: minimalInput(EV_ID) });
    const registry = seededRegistry();
    const env = { registry, storeRoot, now: () => TS, newId: idFactory() };
    const input = {
      projectId: PROJECT_ID,
      scope: "project" as const,
      content: "auth uses JWT",
      title: "auth uses JWT",
      confidence: "high" as const,
      approval: "approved" as const,
      evidence: [EV_ID],
    };
    const first = await handleSaveMemory(env, input);
    const before = registry.getMemoryValidation(first.id as MemoryEntryId);
    const second = await handleSaveMemory(env, input);
    expect(second.deduped?.existingId).toBe(first.id);
    expect(registry.getMemoryValidation(first.id as MemoryEntryId)).toEqual(before);
  });
});
