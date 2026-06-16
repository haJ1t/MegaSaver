import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { digestContent } from "../src/digest.js";
import type { EvidenceRecordInput } from "../src/schema.js";
import { memoryEntryIdSchema } from "@megasaver/shared";
import { appendEvidence, explainEvidence, getEvidenceStatus, listEvidenceByWorkspace, loadEvidence, pinEvidence, revokeEvidence, unpinEvidence } from "../src/store.js";

const MEM_ID = memoryEntryIdSchema.parse("00000000-0000-4000-8000-0000000000a1");

let storeRoot: string;
const workspaceKey = "0123456789abcdef";

function input(over: Partial<EvidenceRecordInput> = {}): EvidenceRecordInput {
  return {
    evidenceId: randomUUID(),
    workspaceKey,
    sessionRef: { kind: "durable", id: "s-1" },
    sourceKind: "command",
    sourceRef: { command: "git", args: ["log"] },
    classification: "generic_shell",
    redactionReport: { redacted: true, highRiskFindings: 0, unresolvedHighRisk: false },
    redactedRawContent: "redacted raw text",
    redactedReturnedContent: "redacted returned text",
    redactedRawChunkSetId: "cs-1",
    returnedChunkRefs: [{ chunkSetId: "cs-1", chunkId: "0" }],
    createdAt: "2026-06-16T12:00:00.000Z",
    expiresAt: null,
    retentionClass: "session",
    policyVersion: "1",
    pipelineVersion: "1",
    ...over,
  };
}

beforeEach(() => {
  storeRoot = mkdtempSync(join(tmpdir(), "evidence-ledger-"));
});
afterEach(() => {
  rmSync(storeRoot, { recursive: true, force: true });
});

describe("appendEvidence / loadEvidence", () => {
  it("computes digests from the passed post-redaction content (caller supplies none)", async () => {
    const rec = input();
    await appendEvidence({ storeRoot, record: rec });
    const loaded = await loadEvidence({ storeRoot, workspaceKey, evidenceId: rec.evidenceId });
    expect(loaded.rawDigest).toBe(digestContent("redacted raw text"));
    expect(loaded.returnedDigest).toBe(digestContent("redacted returned text"));
    expect(loaded.status).toBe("available");
    expect(loaded.transitions).toHaveLength(1);
    expect(loaded.transitions[0]).toMatchObject({ kind: "created" });
  });

  it("getEvidenceStatus returns the current status", async () => {
    const rec = input();
    await appendEvidence({ storeRoot, record: rec });
    expect(await getEvidenceStatus({ storeRoot, workspaceKey, evidenceId: rec.evidenceId })).toBe("available");
  });

  it("append-only: appending the same evidenceId twice throws already_exists", async () => {
    const rec = input();
    await appendEvidence({ storeRoot, record: rec });
    await expect(appendEvidence({ storeRoot, record: rec })).rejects.toMatchObject({ code: "already_exists" });
  });

  it("rejects a retentionClass of pinned at append (pin only via pinEvidence)", async () => {
    await expect(
      appendEvidence({ storeRoot, record: input({ retentionClass: "pinned" }) }),
    ).rejects.toMatchObject({ code: "schema_invalid" });
  });

  it("rejects input whose redactionReport has unresolved high-risk findings", async () => {
    await expect(
      appendEvidence({
        storeRoot,
        record: input({ redactionReport: { redacted: true, highRiskFindings: 1, unresolvedHighRisk: true } }),
      }),
    ).rejects.toMatchObject({ code: "schema_invalid" });
  });

  it("loadEvidence on a missing id throws not_found", async () => {
    await expect(loadEvidence({ storeRoot, workspaceKey, evidenceId: randomUUID() })).rejects.toMatchObject({
      code: "not_found",
    });
  });

  it("read asserts the loaded record's workspaceKey matches the requested one", async () => {
    const rec = input();
    await appendEvidence({ storeRoot, record: rec });
    // Reading the same id under a different (valid) workspace key must not return it.
    await expect(
      loadEvidence({ storeRoot, workspaceKey: "ffffffffffffffff", evidenceId: rec.evidenceId }),
    ).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("listEvidenceByWorkspace", () => {
  it("lists newest-first and filters by status", async () => {
    const a = input({ createdAt: "2026-06-16T12:00:00.000Z" });
    const b = input({ createdAt: "2026-06-16T13:00:00.000Z" });
    await appendEvidence({ storeRoot, record: a });
    await appendEvidence({ storeRoot, record: b });
    const all = await listEvidenceByWorkspace({ storeRoot, workspaceKey });
    expect(all.map((r) => r.evidenceId)).toEqual([b.evidenceId, a.evidenceId]);
    expect(await listEvidenceByWorkspace({ storeRoot, workspaceKey, filters: { status: "available" } })).toHaveLength(2);
    expect(await listEvidenceByWorkspace({ storeRoot, workspaceKey, filters: { status: "revoked" } })).toHaveLength(0);
  });

  it("returns an empty array for an unknown workspace", async () => {
    expect(await listEvidenceByWorkspace({ storeRoot, workspaceKey: "ffffffffffffffff" })).toEqual([]);
  });
});

describe("pin / unpin (session <-> pinned)", () => {
  it("pin from session sets pinned + records memoryId on the transition", async () => {
    const rec = input();
    await appendEvidence({ storeRoot, record: rec });
    await pinEvidence({ storeRoot, workspaceKey, evidenceId: rec.evidenceId, memoryId: MEM_ID });
    const loaded = await loadEvidence({ storeRoot, workspaceKey, evidenceId: rec.evidenceId });
    expect(loaded.retentionClass).toBe("pinned");
    expect(loaded.pinnedByMemoryIds).toEqual([MEM_ID]);
    const last = loaded.transitions.at(-1);
    expect(last).toMatchObject({ kind: "pinned", memoryId: MEM_ID });
  });

  it("pin is idempotent for the same memory id", async () => {
    const rec = input();
    await appendEvidence({ storeRoot, record: rec });
    await pinEvidence({ storeRoot, workspaceKey, evidenceId: rec.evidenceId, memoryId: MEM_ID });
    await pinEvidence({ storeRoot, workspaceKey, evidenceId: rec.evidenceId, memoryId: MEM_ID });
    expect((await loadEvidence({ storeRoot, workspaceKey, evidenceId: rec.evidenceId })).pinnedByMemoryIds).toEqual([
      MEM_ID,
    ]);
  });

  it("unpin of the last memory returns retentionClass to session", async () => {
    const rec = input();
    await appendEvidence({ storeRoot, record: rec });
    await pinEvidence({ storeRoot, workspaceKey, evidenceId: rec.evidenceId, memoryId: MEM_ID });
    await unpinEvidence({ storeRoot, workspaceKey, evidenceId: rec.evidenceId, memoryId: MEM_ID });
    const loaded = await loadEvidence({ storeRoot, workspaceKey, evidenceId: rec.evidenceId });
    expect(loaded.pinnedByMemoryIds).toEqual([]);
    expect(loaded.retentionClass).toBe("session");
  });

  it("rejects pinning a non-session record (manual_hold)", async () => {
    const rec = input({ retentionClass: "manual_hold" });
    await appendEvidence({ storeRoot, record: rec });
    await expect(
      pinEvidence({ storeRoot, workspaceKey, evidenceId: rec.evidenceId, memoryId: MEM_ID }),
    ).rejects.toMatchObject({ code: "invalid_transition" });
  });
});

describe("revoke / explain (secret purge)", () => {
  it("PURGES a planted secret from sourceRef, nulls digests, drops the chunk ref, calls delete port", async () => {
    const rec = input({
      sourceRef: { command: "curl -H 'Authorization: Bearer sk-live-SECRET' https://api/x", url: "https://h?token=SECRET" },
      redactedRawChunkSetId: "cs-9",
    });
    await appendEvidence({ storeRoot, record: rec });
    const deleted: string[] = [];
    await revokeEvidence({
      storeRoot,
      workspaceKey,
      evidenceId: rec.evidenceId,
      reason: "secret_false_negative",
      deleteChunk: async (id) => {
        deleted.push(id);
      },
      now: new Date("2026-06-16T13:00:00.000Z"),
    });
    const loaded = await loadEvidence({ storeRoot, workspaceKey, evidenceId: rec.evidenceId });
    expect(loaded.status).toBe("revoked");
    expect(loaded.revocationReason).toBe("secret_false_negative");
    expect(loaded.revokedAt).toBe("2026-06-16T13:00:00.000Z");
    expect(loaded.rawDigest).toBeNull();
    expect(loaded.returnedDigest).toBeNull();
    expect(loaded.redactedRawChunkSetId).toBeNull();
    // The secret is GONE from the on-disk record entirely.
    expect(loaded.sourceRef).toEqual({ label: "redacted" });
    expect(JSON.stringify(loaded)).not.toContain("SECRET");
    expect(deleted).toEqual(["cs-9"]);
    expect(loaded.transitions.at(-1)).toMatchObject({ kind: "revoked" });
  });

  it("revoke of a pinned record clears pins and resets retentionClass off pinned", async () => {
    const rec = input();
    await appendEvidence({ storeRoot, record: rec });
    await pinEvidence({ storeRoot, workspaceKey, evidenceId: rec.evidenceId, memoryId: MEM_ID });
    await revokeEvidence({
      storeRoot,
      workspaceKey,
      evidenceId: rec.evidenceId,
      reason: "user_requested_purge",
      deleteChunk: async () => {},
      now: new Date("2026-06-16T14:00:00.000Z"),
    });
    const loaded = await loadEvidence({ storeRoot, workspaceKey, evidenceId: rec.evidenceId });
    expect(loaded.pinnedByMemoryIds).toEqual([]);
    expect(loaded.retentionClass).not.toBe("pinned");
  });

  it("swallows a failing delete port (best-effort) but still tombstones", async () => {
    const rec = input({ redactedRawChunkSetId: "cs-9" });
    await appendEvidence({ storeRoot, record: rec });
    await revokeEvidence({
      storeRoot,
      workspaceKey,
      evidenceId: rec.evidenceId,
      reason: "user_requested_purge",
      deleteChunk: async () => {
        throw new Error("disk gone");
      },
      now: new Date("2026-06-16T14:00:00.000Z"),
    });
    expect(await getEvidenceStatus({ storeRoot, workspaceKey, evidenceId: rec.evidenceId })).toBe("revoked");
  });

  it("revoke is idempotent", async () => {
    const rec = input();
    await appendEvidence({ storeRoot, record: rec });
    const run = () =>
      revokeEvidence({
        storeRoot,
        workspaceKey,
        evidenceId: rec.evidenceId,
        reason: "policy_change",
        deleteChunk: async () => {},
        now: new Date("2026-06-16T14:00:00.000Z"),
      });
    await run();
    await run();
    expect((await loadEvidence({ storeRoot, workspaceKey, evidenceId: rec.evidenceId })).status).toBe("revoked");
  });

  it("explain reports raw availability before and after revoke", async () => {
    const rec = input();
    await appendEvidence({ storeRoot, record: rec });
    expect(await explainEvidence({ storeRoot, workspaceKey, evidenceId: rec.evidenceId })).toMatchObject({
      status: "available",
      rawExpandable: true,
    });
    await revokeEvidence({
      storeRoot,
      workspaceKey,
      evidenceId: rec.evidenceId,
      reason: "secret_false_negative",
      deleteChunk: async () => {},
      now: new Date("2026-06-16T15:00:00.000Z"),
    });
    expect(await explainEvidence({ storeRoot, workspaceKey, evidenceId: rec.evidenceId })).toMatchObject({
      status: "revoked",
      rawExpandable: false,
      revocationReason: "secret_false_negative",
    });
  });
});
