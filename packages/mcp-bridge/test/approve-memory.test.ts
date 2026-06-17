import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInMemoryCoreRegistry } from "@megasaver/core";
import {
  EvidenceLedgerError,
  type EvidenceRecordInput,
  appendEvidence,
} from "@megasaver/evidence-ledger";
import { encodeWorkspaceKey } from "@megasaver/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { McpBridgeError } from "../src/errors.js";
import { handleApproveMemory } from "../src/tools/approve-memory.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const MEMORY_ID = "22222222-2222-4222-8222-222222222222";
const APPROVED_ID = "33333333-3333-4333-8333-333333333333";
const DUP_ID = "44444444-4444-4444-8444-444444444444";
const TS = "2026-06-12T00:00:00.000Z";

function seededRegistry(
  over: {
    source?: "agent" | "manual";
    evidenceIds?: string[];
    confidence?: "low" | "medium" | "high";
  } = {},
) {
  const registry = createInMemoryCoreRegistry();
  registry.createProject({
    id: PROJECT_ID,
    name: "demo",
    rootPath: "/tmp/demo",
    createdAt: TS,
    updatedAt: TS,
  });
  registry.createMemoryEntry({
    id: MEMORY_ID,
    projectId: PROJECT_ID,
    sessionId: null,
    scope: "project",
    type: "decision",
    title: "Use strict mode",
    content: "strict mode enabled",
    keywords: [],
    confidence: over.confidence ?? "high",
    source: over.source ?? "agent",
    stale: false,
    approval: "suggested",
    ...(over.evidenceIds !== undefined ? { evidence: over.evidenceIds } : {}),
    createdAt: TS,
    updatedAt: TS,
  });
  return registry;
}

function seededDuplicateRegistry() {
  const registry = createInMemoryCoreRegistry();
  registry.createProject({
    id: PROJECT_ID,
    name: "demo",
    rootPath: "/tmp/demo",
    createdAt: TS,
    updatedAt: TS,
  });
  // An already-approved memory.
  registry.createMemoryEntry({
    id: APPROVED_ID,
    projectId: PROJECT_ID,
    sessionId: null,
    scope: "project",
    type: "decision",
    title: "Use strict mode",
    content: "strict mode enabled",
    keywords: [],
    confidence: "medium",
    source: "manual",
    stale: false,
    approval: "approved",
    createdAt: TS,
    updatedAt: TS,
  });
  // A suggested duplicate with identical title+content.
  registry.createMemoryEntry({
    id: DUP_ID,
    projectId: PROJECT_ID,
    sessionId: null,
    scope: "project",
    type: "decision",
    title: "Use strict mode",
    content: "strict mode enabled",
    keywords: [],
    confidence: "medium",
    source: "manual",
    stale: false,
    approval: "suggested",
    createdAt: TS,
    updatedAt: TS,
  });
  return registry;
}

describe("handleApproveMemory", () => {
  it("approves a suggested memory and returns id + approval", async () => {
    const registry = seededRegistry({ source: "manual", confidence: "medium" });
    const result = await handleApproveMemory(
      { registry, storeRoot: "", now: () => TS },
      { memoryEntryId: MEMORY_ID, approval: "approved" },
    );
    expect(result.id).toBe(MEMORY_ID);
    expect(result.approval).toBe("approved");
    const stored = registry.getMemoryEntry(MEMORY_ID as never);
    expect(stored?.approval).toBe("approved");
  });

  it("rejects a memory", async () => {
    const registry = seededRegistry();
    const result = await handleApproveMemory(
      { registry, storeRoot: "", now: () => TS },
      { memoryEntryId: MEMORY_ID, approval: "rejected" },
    );
    expect(result.approval).toBe("rejected");
    expect(registry.getMemoryEntry(MEMORY_ID as never)?.approval).toBe("rejected");
  });

  it("defaults to approved when approval is omitted", async () => {
    const registry = seededRegistry({ source: "manual", confidence: "medium" });
    const result = await handleApproveMemory(
      { registry, storeRoot: "", now: () => TS },
      { memoryEntryId: MEMORY_ID },
    );
    expect(result.approval).toBe("approved");
  });

  it("throws resource_not_found for a missing id", async () => {
    const registry = seededRegistry();
    await expect(
      handleApproveMemory(
        { registry, storeRoot: "", now: () => TS },
        { memoryEntryId: "99999999-9999-4999-8999-999999999999" },
      ),
    ).rejects.toMatchObject({ code: "resource_not_found" });
  });

  it("throws validation_failed for empty memoryEntryId", async () => {
    const registry = seededRegistry();
    await expect(
      handleApproveMemory({ registry, storeRoot: "", now: () => TS }, { memoryEntryId: "" }),
    ).rejects.toMatchObject({ code: "validation_failed" });
  });

  it("is idempotent — re-approving does not churn updatedAt", async () => {
    const registry = seededRegistry({ source: "manual", confidence: "medium" });
    const FIRST = "2026-06-12T01:00:00.000Z";
    await handleApproveMemory(
      { registry, storeRoot: "", now: () => FIRST },
      { memoryEntryId: MEMORY_ID },
    );
    const afterFirst = registry.getMemoryEntry(MEMORY_ID as never);
    expect(afterFirst?.approval).toBe("approved");
    expect(afterFirst?.updatedAt).toBe(FIRST);

    // No-op re-approve with a LATER clock must not advance updatedAt.
    const LATER = "2026-06-12T02:00:00.000Z";
    const result = await handleApproveMemory(
      { registry, storeRoot: "", now: () => LATER },
      { memoryEntryId: MEMORY_ID },
    );
    expect(result.approval).toBe("approved");
    expect(registry.getMemoryEntry(MEMORY_ID as never)?.updatedAt).toBe(FIRST);
  });

  it("throws validation_failed for unknown approval value", async () => {
    const registry = seededRegistry();
    await expect(
      handleApproveMemory(
        { registry, storeRoot: "", now: () => TS },
        { memoryEntryId: MEMORY_ID, approval: "maybe" },
      ),
    ).rejects.toMatchObject({ code: "validation_failed" });
  });

  it("rejects approval: suggested — cannot reverse a memory out of the gate", async () => {
    const registry = seededRegistry();
    await expect(
      handleApproveMemory(
        { registry, storeRoot: "", now: () => TS },
        { memoryEntryId: MEMORY_ID, approval: "suggested" },
      ),
    ).rejects.toMatchObject({ code: "validation_failed" });
  });

  it("rejects extra fields via strict schema", async () => {
    const registry = seededRegistry();
    await expect(
      handleApproveMemory(
        { registry, storeRoot: "", now: () => TS },
        { memoryEntryId: MEMORY_ID, extra: "oops" },
      ),
    ).rejects.toMatchObject({ code: "validation_failed" });
  });
});

describe("approve_memory validation gate (adversarial)", () => {
  it("refuses to approve an agent memory with no evidence (stays suggested, returns reasons)", async () => {
    const registry = seededRegistry(); // seeds a suggested agent memory with no evidence
    const result = await handleApproveMemory(
      { registry, storeRoot: "", now: () => TS },
      { memoryEntryId: MEMORY_ID, approval: "approved" },
    );
    expect(result.approval).toBe("suggested"); // NOT approved
    expect(result.validation?.status).toBe("quarantined");
    expect(result.validation?.reasons).toContain("missing_evidence");
    expect(registry.getMemoryEntry(MEMORY_ID as never)?.approval).toBe("suggested");
  });

  it("approves a human-curated memory with no conflicts", async () => {
    const registry = seededRegistry({ source: "manual", confidence: "medium", evidenceIds: [] });
    const result = await handleApproveMemory(
      { registry, storeRoot: "", now: () => TS },
      { memoryEntryId: MEMORY_ID, approval: "approved" },
    );
    expect(result.approval).toBe("approved");
  });

  it("a reject decision still rejects regardless of validation", async () => {
    const registry = seededRegistry();
    const result = await handleApproveMemory(
      { registry, storeRoot: "", now: () => TS },
      { memoryEntryId: MEMORY_ID, approval: "rejected" },
    );
    expect(result.approval).toBe("rejected");
  });

  it("approving an exact duplicate of an approved memory REJECTS it (no second approved row) — spec §8", async () => {
    // Seed an already-approved memory + a suggested duplicate with the same title+content.
    const registry = seededDuplicateRegistry();
    const before = registry
      .listMemoryEntries(PROJECT_ID)
      .filter((m) => m.approval === "approved").length;
    const result = await handleApproveMemory(
      { registry, storeRoot: "", now: () => TS },
      { memoryEntryId: DUP_ID, approval: "approved" },
    );
    expect(result.approval).toBe("rejected");
    expect(result.conflict?.outcome).toBe("duplicate");
    const after = registry
      .listMemoryEntries(PROJECT_ID)
      .filter((m) => m.approval === "approved").length;
    expect(after).toBe(before); // duplicate did NOT create a second approved row
  });
});

// Verify McpBridgeError is importable at test boundary
void McpBridgeError;

// ── Evidence-port integration tests (slice 3b) ─────────────────────────────
// These tests require a real on-disk evidence ledger in a tmp dir. They pass
// `storeRoot` to handleApproveMemory and seed EvidenceRecord fixtures to
// exercise resolver behaviour: unresolvedSecret, revoked, cross-workspace, happy.

const ROOT_PATH = "/projects/demo";
const WORKSPACE_KEY = encodeWorkspaceKey(ROOT_PATH);
const EV_ID_1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

// Minimal valid EvidenceRecordInput for a clean (approved, not revoked) record.
function minimalInput(evidenceId: string, workspaceKey: string): EvidenceRecordInput {
  return {
    evidenceId,
    workspaceKey: workspaceKey as ReturnType<typeof encodeWorkspaceKey>,
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

function seededRegistryWithEvidence(evidenceIds: string[], rootPath = ROOT_PATH) {
  const registry = createInMemoryCoreRegistry();
  registry.createProject({
    id: PROJECT_ID,
    name: "demo",
    rootPath,
    createdAt: TS,
    updatedAt: TS,
  });
  registry.createMemoryEntry({
    id: MEMORY_ID,
    projectId: PROJECT_ID,
    sessionId: null,
    scope: "project",
    type: "decision",
    title: "Use strict mode",
    content: "strict mode enabled",
    keywords: [],
    confidence: "high",
    source: "agent",
    stale: false,
    approval: "suggested",
    evidence: evidenceIds,
    createdAt: TS,
    updatedAt: TS,
  });
  return registry;
}

describe("approve_memory — evidence-port integration (slice 3b)", () => {
  let storeRoot: string;

  beforeEach(() => {
    storeRoot = join(tmpdir(), `ms-test-${crypto.randomUUID()}`);
    mkdirSync(storeRoot, { recursive: true });
  });

  afterEach(() => {
    rmSync(storeRoot, { recursive: true, force: true });
  });

  it("approves when evidence exists, workspace matches, not revoked, no secret", async () => {
    await appendEvidence({ storeRoot, record: minimalInput(EV_ID_1, WORKSPACE_KEY) });
    const registry = seededRegistryWithEvidence([EV_ID_1]);
    const result = await handleApproveMemory(
      { registry, storeRoot, now: () => TS },
      { memoryEntryId: MEMORY_ID, approval: "approved" },
    );
    expect(result.approval).toBe("approved");
    expect(result.validation).toBeUndefined();
  });

  it("rejects approval when referenced evidence has unresolvedHighRisk", async () => {
    // appendEvidence rejects unresolvedHighRisk at write time (fail-closed invariant).
    // Write the fixture directly as raw JSON to exercise the read-side resolver gate.
    const keyDir = join(storeRoot, "evidence", WORKSPACE_KEY);
    mkdirSync(keyDir, { recursive: true });
    const fixture = {
      evidenceId: EV_ID_1,
      workspaceKey: WORKSPACE_KEY,
      sessionRef: null,
      sourceKind: "command",
      sourceRef: { label: "test" },
      classification: "test",
      redactionReport: { redacted: true, highRiskFindings: 1, unresolvedHighRisk: true },
      rawDigest: "a".repeat(64),
      returnedDigest: "b".repeat(64),
      redactedRawChunkSetId: "cset-0001",
      returnedChunkRefs: [],
      createdAt: TS,
      expiresAt: null,
      retentionClass: "transient",
      pinnedByMemoryIds: [],
      status: "available",
      revokedAt: null,
      revocationReason: null,
      policyVersion: "1.0",
      pipelineVersion: "1.0",
      transitions: [{ at: TS, kind: "created", actor: "system" }],
    };
    writeFileSync(join(keyDir, `${EV_ID_1}.json`), JSON.stringify(fixture));
    const registry = seededRegistryWithEvidence([EV_ID_1]);
    const result = await handleApproveMemory(
      { registry, storeRoot, now: () => TS },
      { memoryEntryId: MEMORY_ID, approval: "approved" },
    );
    expect(result.approval).toBe("suggested");
    expect(result.validation?.status).toBe("rejected");
    expect(result.validation?.reasons).toContain("unresolved_secret");
  });

  it("rejects approval when evidence is revoked", async () => {
    // Revoked records have nulled digests + scrubbed sourceRef (spec §revoked constraints).
    const keyDir = join(storeRoot, "evidence", WORKSPACE_KEY);
    mkdirSync(keyDir, { recursive: true });
    const fixture = {
      evidenceId: EV_ID_1,
      workspaceKey: WORKSPACE_KEY,
      sessionRef: null,
      sourceKind: "command",
      sourceRef: { label: "redacted" },
      classification: "test",
      redactionReport: { redacted: false, highRiskFindings: 0, unresolvedHighRisk: false },
      rawDigest: null,
      returnedDigest: null,
      redactedRawChunkSetId: null,
      returnedChunkRefs: [],
      createdAt: TS,
      expiresAt: null,
      retentionClass: "transient",
      pinnedByMemoryIds: [],
      status: "revoked",
      revokedAt: TS,
      revocationReason: "user_requested_purge",
      policyVersion: "1.0",
      pipelineVersion: "1.0",
      transitions: [
        { at: TS, kind: "created", actor: "system" },
        { at: TS, kind: "revoked", actor: "human" },
      ],
    };
    writeFileSync(join(keyDir, `${EV_ID_1}.json`), JSON.stringify(fixture));
    const registry = seededRegistryWithEvidence([EV_ID_1]);
    const result = await handleApproveMemory(
      { registry, storeRoot, now: () => TS },
      { memoryEntryId: MEMORY_ID, approval: "approved" },
    );
    expect(result.approval).toBe("suggested");
    expect(result.validation?.status).toBe("rejected");
    expect(result.validation?.reasons).toContain("revoked_evidence");
  });

  it("rejects approval when evidence belongs to a different workspace", async () => {
    // Seed the evidence under the WRONG workspace key (different rootPath).
    // The resolver catches workspace_mismatch from loadEvidence.
    const otherRootPath = "/projects/other";
    const otherKey = encodeWorkspaceKey(otherRootPath);
    const otherKeyDir = join(storeRoot, "evidence", otherKey);
    mkdirSync(otherKeyDir, { recursive: true });
    const fixture = {
      evidenceId: EV_ID_1,
      workspaceKey: otherKey,
      sessionRef: null,
      sourceKind: "command",
      sourceRef: { label: "test" },
      classification: "test",
      redactionReport: { redacted: false, highRiskFindings: 0, unresolvedHighRisk: false },
      rawDigest: "a".repeat(64),
      returnedDigest: "b".repeat(64),
      redactedRawChunkSetId: "cset-0002",
      returnedChunkRefs: [],
      createdAt: TS,
      expiresAt: null,
      retentionClass: "transient",
      pinnedByMemoryIds: [],
      status: "available",
      revokedAt: null,
      revocationReason: null,
      policyVersion: "1.0",
      pipelineVersion: "1.0",
      transitions: [{ at: TS, kind: "created", actor: "system" }],
    };
    writeFileSync(join(otherKeyDir, `${EV_ID_1}.json`), JSON.stringify(fixture));

    // The registry's project rootPath is ROOT_PATH → WORKSPACE_KEY.
    // loadEvidence is called with WORKSPACE_KEY → path points to WORKSPACE_KEY dir (not found)
    // OR the record is missing → treated as not_found. Either way, no evidence resolution.
    // To actually test cross-workspace: seed the record at WORKSPACE_KEY path but with
    // the wrong workspaceKey field in the JSON — that triggers workspace_mismatch in readRecord.
    const correctKeyDir = join(storeRoot, "evidence", WORKSPACE_KEY);
    mkdirSync(correctKeyDir, { recursive: true });
    const mismatchedFixture = { ...fixture, workspaceKey: otherKey };
    writeFileSync(join(correctKeyDir, `${EV_ID_1}.json`), JSON.stringify(mismatchedFixture));

    const registry = seededRegistryWithEvidence([EV_ID_1]);
    const result = await handleApproveMemory(
      { registry, storeRoot, now: () => TS },
      { memoryEntryId: MEMORY_ID, approval: "approved" },
    );
    expect(result.approval).toBe("suggested");
    expect(result.validation?.status).toBe("rejected");
    expect(result.validation?.reasons).toContain("cross_workspace_evidence");
  });
});
