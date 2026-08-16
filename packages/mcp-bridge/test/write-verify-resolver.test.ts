import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type EvidenceRecordInput, appendEvidence, revokeEvidence } from "@megasaver/evidence-ledger";
import { encodeWorkspaceKey } from "@megasaver/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveWritePointers } from "../src/write-verify-resolver.js";

const ROOT_PATH = "/tmp/demo";
const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_PROJECT_ID = "66666666-6666-4666-8666-666666666666";
const SESSION_ID = "99999999-9999-4999-8999-999999999999";
const TS = "2026-08-01T00:00:00.000Z";
const EV_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const MISSING_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const CS_ID = `cs-${"a".repeat(32)}`;
const CS_MISSING = `cs-${"b".repeat(32)}`;
const WORKSPACE_KEY = encodeWorkspaceKey(ROOT_PATH);

function minimalInput(evidenceId: string): EvidenceRecordInput {
  return {
    evidenceId,
    workspaceKey: WORKSPACE_KEY,
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
  storeRoot = mkdtempSync(join(tmpdir(), "mega-wv-resolver-"));
});
afterEach(() => {
  rmSync(storeRoot, { recursive: true, force: true });
});

describe("resolveWritePointers", () => {
  it("resolves a present ledger id and reports a missing one", async () => {
    await appendEvidence({ storeRoot, redactSourceRef: (r) => r, record: minimalInput(EV_ID) });
    const res = await resolveWritePointers({
      storeRoot,
      evidence: [EV_ID, MISSING_ID],
      projectRootPath: ROOT_PATH,
      projectId: PROJECT_ID,
      sessionId: SESSION_ID,
    });
    expect(res.resolutions).toEqual([
      { pointer: EV_ID, kind: "ledger", resolved: true },
      { pointer: MISSING_ID, kind: "ledger", resolved: false, reason: "evidence_not_found" },
    ]);
    expect(res.resolverUnavailable).toBe(false);
    expect(res.hasRevoked).toBe(false);
  });

  it("a revoked record resolves but raises the hard flag", async () => {
    await appendEvidence({ storeRoot, redactSourceRef: (r) => r, record: minimalInput(EV_ID) });
    await revokeEvidence({
      storeRoot,
      workspaceKey: WORKSPACE_KEY,
      evidenceId: EV_ID,
      reason: "policy_change",
      deleteChunk: async () => {},
      now: new Date(TS),
    });
    const res = await resolveWritePointers({
      storeRoot,
      evidence: [EV_ID],
      projectRootPath: ROOT_PATH,
      projectId: PROJECT_ID,
      sessionId: SESSION_ID,
    });
    expect(res.hasRevoked).toBe(true);
    expect(res.resolutions[0]?.resolved).toBe(true);
  });

  it("finds a same-project chunk-set id on disk and misses an absent one", async () => {
    mkdirSync(join(storeRoot, "content", PROJECT_ID, SESSION_ID), { recursive: true });
    writeFileSync(join(storeRoot, "content", PROJECT_ID, SESSION_ID, `${CS_ID}.json`), "{}");
    const res = await resolveWritePointers({
      storeRoot,
      evidence: [CS_ID, CS_MISSING],
      projectRootPath: ROOT_PATH,
      projectId: PROJECT_ID,
      sessionId: SESSION_ID,
    });
    expect(res.resolutions).toEqual([
      { pointer: CS_ID, kind: "chunk_set", resolved: true },
      { pointer: CS_MISSING, kind: "chunk_set", resolved: false, reason: "chunk_set_not_found" },
    ]);
  });

  it("a chunk-set id from ANOTHER project is a hard cross_workspace flag, never resolved", async () => {
    mkdirSync(join(storeRoot, "content", OTHER_PROJECT_ID, SESSION_ID), { recursive: true });
    writeFileSync(join(storeRoot, "content", OTHER_PROJECT_ID, SESSION_ID, `${CS_ID}.json`), "{}");
    const res = await resolveWritePointers({
      storeRoot,
      evidence: [CS_ID],
      projectRootPath: ROOT_PATH,
      projectId: PROJECT_ID,
      sessionId: SESSION_ID,
    });
    expect(res.hasCrossWorkspace).toBe(true);
    expect(res.resolutions).toEqual([
      { pointer: CS_ID, kind: "chunk_set", resolved: false, reason: "cross_workspace" },
    ]);
  });

  it("an overlay-layout chunk set in the SAME workspace resolves", async () => {
    mkdirSync(join(storeRoot, "content", WORKSPACE_KEY, SESSION_ID), { recursive: true });
    writeFileSync(join(storeRoot, "content", WORKSPACE_KEY, SESSION_ID, `${CS_ID}.json`), "{}");
    const res = await resolveWritePointers({
      storeRoot,
      evidence: [CS_ID],
      projectRootPath: ROOT_PATH,
      projectId: PROJECT_ID,
      sessionId: SESSION_ID,
    });
    expect(res.hasCrossWorkspace).toBe(false);
    expect(res.resolutions).toEqual([{ pointer: CS_ID, kind: "chunk_set", resolved: true }]);
  });

  it("an overlay chunk set in ANOTHER workspace is a cross_workspace hard flag", async () => {
    mkdirSync(join(storeRoot, "content", "deadbeefdeadbeef", SESSION_ID), { recursive: true });
    writeFileSync(join(storeRoot, "content", "deadbeefdeadbeef", SESSION_ID, `${CS_ID}.json`), "{}");
    const res = await resolveWritePointers({
      storeRoot,
      evidence: [CS_ID],
      projectRootPath: ROOT_PATH,
      projectId: PROJECT_ID,
      sessionId: SESSION_ID,
    });
    expect(res.hasCrossWorkspace).toBe(true);
    expect(res.resolutions).toEqual([
      { pointer: CS_ID, kind: "chunk_set", resolved: false, reason: "cross_workspace" },
    ]);
  });

  it("a non-UUID ledger candidate is invalid_pointer with no ledger IO", async () => {
    const res = await resolveWritePointers({
      storeRoot,
      evidence: ["../etc/passwd", "not a uuid"],
      projectRootPath: ROOT_PATH,
      projectId: PROJECT_ID,
      sessionId: SESSION_ID,
    });
    expect(res.resolutions).toEqual([
      { pointer: "../etc/passwd", kind: "ledger", resolved: false, reason: "invalid_pointer" },
      { pointer: "not a uuid", kind: "ledger", resolved: false, reason: "invalid_pointer" },
    ]);
    expect(res.hasCrossWorkspace).toBe(false);
  });

  it("skips possible-supersedes lineage notes entirely", async () => {
    const res = await resolveWritePointers({
      storeRoot,
      evidence: ["possible-supersedes:xyz"],
      projectRootPath: ROOT_PATH,
      projectId: PROJECT_ID,
      sessionId: SESSION_ID,
    });
    expect(res.resolutions).toEqual([]);
  });

  it("no storeRoot -> every pointer unresolved with resolver_unavailable", async () => {
    const res = await resolveWritePointers({
      storeRoot: undefined,
      evidence: [EV_ID, CS_ID],
      projectRootPath: ROOT_PATH,
      projectId: PROJECT_ID,
      sessionId: SESSION_ID,
    });
    expect(res.resolverUnavailable).toBe(true);
    expect(res.resolutions).toEqual([
      { pointer: EV_ID, kind: "ledger", resolved: false, reason: "resolver_unavailable" },
      { pointer: CS_ID, kind: "chunk_set", resolved: false, reason: "resolver_unavailable" },
    ]);
  });
});
