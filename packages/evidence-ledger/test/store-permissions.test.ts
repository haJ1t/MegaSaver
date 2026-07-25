import { randomUUID } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { workspaceKeySchema } from "@megasaver/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { EvidenceRecordInput } from "../src/schema.js";
import { appendEvidence } from "../src/store.js";

// NTFS ignores POSIX mode bits, so these assertions are POSIX-only.
const describeUnlessWindows = process.platform === "win32" ? describe.skip : describe;

let storeRoot: string;
const workspaceKey = workspaceKeySchema.parse("0123456789abcdef");
const evidenceId = randomUUID();

function input(): EvidenceRecordInput {
  return {
    evidenceId,
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
    createdAt: "2026-07-25T12:00:00.000Z",
    expiresAt: null,
    retentionClass: "session",
    policyVersion: "1",
    pipelineVersion: "1",
  };
}

const workspaceDir = () => join(storeRoot, "evidence", workspaceKey);
const append = () => appendEvidence({ storeRoot, redactSourceRef: (ref) => ref, record: input() });

beforeEach(() => {
  storeRoot = mkdtempSync(join(tmpdir(), "evidence-ledger-perm-"));
});

afterEach(() => {
  rmSync(storeRoot, { recursive: true, force: true });
});

describeUnlessWindows("appendEvidence permissions", () => {
  it("writes the record owner-only (0600) in an owner-only (0700) dir", async () => {
    await append();
    expect(statSync(join(workspaceDir(), `${evidenceId}.json`)).mode & 0o777).toBe(0o600);
    expect(statSync(workspaceDir()).mode & 0o777).toBe(0o700);
  });

  it("repairs a world-readable dir left by an earlier writer", async () => {
    mkdirSync(workspaceDir(), { recursive: true });
    chmodSync(workspaceDir(), 0o755);
    await append();
    expect(statSync(workspaceDir()).mode & 0o777).toBe(0o700);
  });
});
