import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readSessionDecisionTrace } from "../src/decision-trace.js";

const PROJECT = "11111111-1111-4111-8111-111111111111";
const SESSION = "22222222-2222-4222-8222-222222222222";
const WK = "e02b98f66e82b6b9";
const MEM_A = "33333333-3333-4333-8333-333333333333";
const MEM_B = "44444444-4444-4444-8444-444444444444";
const DIGEST = "a".repeat(64);

function traceLine(
  chunkSetId: string,
  memoryBoost: number,
  extra?: {
    redaction?: { redacted: boolean; secretsRedacted: number };
    rankedByMemoryIds?: string[];
  },
): string {
  return JSON.stringify({
    sessionId: SESSION,
    projectId: PROJECT,
    toolName: "Read",
    createdAt: "2026-07-04T00:00:00.000Z",
    chunkSetId,
    ...(extra?.redaction !== undefined ? { redaction: extra.redaction } : {}),
    ranking: {
      classification: { category: "typescript", confidence: 0.7 },
      decision: "compressed",
      compressor: "typescript",
      engineRanking: true,
      rawTokens: 100,
      returnedTokens: 40,
      candidates: [],
      selected: [
        {
          startLine: 1,
          endLine: 10,
          score: 0.9,
          engine: {
            baseRelevance: 0.7,
            memoryBoost,
            failureHistoryBoost: 0,
            finalScore: 0.9,
          },
        },
      ],
      omitted: [],
      ...(extra?.rankedByMemoryIds !== undefined
        ? { rankedByMemoryIds: extra.rankedByMemoryIds }
        : {}),
    },
  });
}

function evidenceRecord(
  evidenceId: string,
  chunkSetId: string,
  pinnedByMemoryIds: string[],
  highRiskFindings: number,
): Record<string, unknown> {
  return {
    evidenceId,
    workspaceKey: WK,
    sessionRef: { kind: "live", id: SESSION },
    sourceKind: "file",
    sourceRef: { label: "src" },
    classification: "typescript",
    redactionReport: {
      redacted: highRiskFindings > 0,
      highRiskFindings,
      unresolvedHighRisk: false,
    },
    rawDigest: DIGEST,
    returnedDigest: DIGEST,
    redactedRawChunkSetId: chunkSetId,
    returnedChunkRefs: [{ chunkSetId, chunkId: "0" }],
    createdAt: "2026-07-04T00:00:00.000Z",
    expiresAt: null,
    retentionClass: pinnedByMemoryIds.length > 0 ? "pinned" : "session",
    pinnedByMemoryIds,
    status: "available",
    revokedAt: null,
    revocationReason: null,
    policyVersion: "1",
    pipelineVersion: "1",
    transitions: [{ at: "2026-07-04T00:00:00.000Z", kind: "created", actor: "system" }],
  };
}

// Two outputs, each pinned by a DIFFERENT memory via a DIFFERENT chunkSetId.
// A sessionId-only join would attach both memories to both outputs (or the
// wrong one), so the per-output assertions below fail under that mutation.
function seed(): string {
  const root = mkdtempSync(join(tmpdir(), "dtv-"));
  const traceDir = join(root, "stats", PROJECT, `${SESSION}-traces`);
  mkdirSync(traceDir, { recursive: true });
  writeFileSync(
    join(traceDir, "replay-traces.jsonl"),
    `${traceLine("cs1", 0.2)}\n${traceLine("cs2", 0.5)}\n`,
  );
  const evDir = join(root, "evidence", WK);
  mkdirSync(evDir, { recursive: true });
  writeFileSync(
    join(evDir, `${MEM_A}.json`),
    JSON.stringify(evidenceRecord(MEM_A, "cs1", [MEM_A], 1)),
  );
  writeFileSync(
    join(evDir, `${MEM_B}.json`),
    JSON.stringify(evidenceRecord(MEM_B, "cs2", [MEM_B], 0)),
  );
  return root;
}

describe("readSessionDecisionTrace", () => {
  it("joins trace and evidence by chunkSetId at output granularity", () => {
    const root = seed();
    const t = readSessionDecisionTrace(
      { root },
      { projectId: PROJECT, sessionId: SESSION, workspaceKey: WK },
    );
    expect(t.outputs).toHaveLength(2);

    const byChunkSet = new Map(t.outputs.map((o) => [o.chunkSetId, o]));
    const o1 = byChunkSet.get("cs1");
    const o2 = byChunkSet.get("cs2");

    expect(o1?.decision).toBe("compressed");
    expect(o1?.selected[0]?.engine.memoryBoost).toBe(0.2);
    expect(o1?.memory?.rankedByMemoryIds).toEqual([MEM_A]);
    expect(o1?.redaction?.highRiskFindings).toBe(1);
    expect(o1?.evidencePresent).toBe(true);

    // Right memory on the right output — the sessionId-only-join killer.
    expect(o2?.memory?.rankedByMemoryIds).toEqual([MEM_B]);
    expect(o2?.selected[0]?.engine.memoryBoost).toBe(0.5);
    expect(o2?.redaction?.highRiskFindings).toBe(0);
  });

  it("surfaces inline redaction from a registry-only trace with no evidence dir (Slice A)", () => {
    const root = mkdtempSync(join(tmpdir(), "dtv-inline-"));
    const traceDir = join(root, "stats", PROJECT, `${SESSION}-traces`);
    mkdirSync(traceDir, { recursive: true });
    writeFileSync(
      join(traceDir, "replay-traces.jsonl"),
      `${traceLine("cs1", 0.2, { redaction: { redacted: true, secretsRedacted: 2 } })}\n`,
    );

    const t = readSessionDecisionTrace(
      { root },
      { projectId: PROJECT, sessionId: SESSION, workspaceKey: WK },
    );
    expect(t.outputs).toHaveLength(1);
    const o = t.outputs[0];
    expect(o?.redaction?.redacted).toBe(true);
    expect(o?.redaction?.highRiskFindings).toBe(2);
    expect(o?.evidencePresent).toBe(true);
  });

  it("surfaces inline rankedByMemoryIds from a registry-only trace with no evidence dir (Slice C)", () => {
    const root = mkdtempSync(join(tmpdir(), "dtv-inline-mem-"));
    const traceDir = join(root, "stats", PROJECT, `${SESSION}-traces`);
    mkdirSync(traceDir, { recursive: true });
    writeFileSync(
      join(traceDir, "replay-traces.jsonl"),
      `${traceLine("cs1", 0.2, { rankedByMemoryIds: [MEM_A] })}\n`,
    );

    const t = readSessionDecisionTrace(
      { root },
      { projectId: PROJECT, sessionId: SESSION, workspaceKey: WK },
    );
    expect(t.outputs).toHaveLength(1);
    expect(t.outputs[0]?.memory?.rankedByMemoryIds).toEqual([MEM_A]);
    expect(t.outputs[0]?.evidencePresent).toBe(true);
  });

  it("prefers inline rankedByMemoryIds over a legacy evidence record for the same chunkSet", () => {
    // Both a legacy evidence pin (MEM_B, keyed by cs1) AND an inline id (MEM_A)
    // exist for the same output. Inline is the ranking-causal truth and wins.
    const root = mkdtempSync(join(tmpdir(), "dtv-inline-wins-"));
    const traceDir = join(root, "stats", PROJECT, `${SESSION}-traces`);
    mkdirSync(traceDir, { recursive: true });
    writeFileSync(
      join(traceDir, "replay-traces.jsonl"),
      `${traceLine("cs1", 0.2, { rankedByMemoryIds: [MEM_A] })}\n`,
    );
    const evDir = join(root, "evidence", WK);
    mkdirSync(evDir, { recursive: true });
    writeFileSync(
      join(evDir, `${MEM_B}.json`),
      JSON.stringify(evidenceRecord(MEM_B, "cs1", [MEM_B], 0)),
    );

    const t = readSessionDecisionTrace(
      { root },
      { projectId: PROJECT, sessionId: SESSION, workspaceKey: WK },
    );
    expect(t.outputs).toHaveLength(1);
    expect(t.outputs[0]?.memory?.rankedByMemoryIds).toEqual([MEM_A]);
    expect(t.outputs[0]?.evidencePresent).toBe(true);
  });

  it("falls back to the legacy evidence pin when only an evidence record exists (Slice-1 fixture)", () => {
    // No inline rankedByMemoryIds on the trace → the reader still joins the
    // evidence pin, mapping ev.pinnedByMemoryIds → the surfaced rankedByMemoryIds.
    const root = seed();
    const t = readSessionDecisionTrace(
      { root },
      { projectId: PROJECT, sessionId: SESSION, workspaceKey: WK },
    );
    const byChunkSet = new Map(t.outputs.map((o) => [o.chunkSetId, o]));
    expect(byChunkSet.get("cs1")?.memory?.rankedByMemoryIds).toEqual([MEM_A]);
    expect(byChunkSet.get("cs2")?.memory?.rankedByMemoryIds).toEqual([MEM_B]);
  });

  it("marks evidencePresent false when no evidence matches (orphan trace, not dropped)", () => {
    const root = seed();
    const t = readSessionDecisionTrace(
      { root },
      { projectId: PROJECT, sessionId: SESSION, workspaceKey: "deadbeefdeadbeef" },
    );
    expect(t.outputs).toHaveLength(2);
    expect(t.outputs.every((o) => o.evidencePresent === false)).toBe(true);
    expect(t.outputs[0]?.memory).toBeNull();
    expect(t.outputs[0]?.redaction).toBeNull();
  });
});
