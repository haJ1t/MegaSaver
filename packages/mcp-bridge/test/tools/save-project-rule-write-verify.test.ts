import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type CoreRegistry, createInMemoryCoreRegistry } from "@megasaver/core";
import { type EvidenceRecordInput, appendEvidence } from "@megasaver/evidence-ledger";
import type { ProjectId } from "@megasaver/shared";
import { encodeWorkspaceKey } from "@megasaver/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { handleSaveProjectRule } from "../../src/tools/project-rules.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111" as ProjectId;
const ROOT_PATH = "/tmp/demo";
const TS = "2026-06-11T00:00:00.000Z";
const TS_PLUS_90D = "2026-09-09T00:00:00.000Z";
const EV_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const RULE_ID = "c0000000-0000-4000-8000-000000000099";

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

function seeded(): CoreRegistry {
  const r = createInMemoryCoreRegistry();
  r.createProject({
    id: PROJECT_ID,
    name: "demo",
    rootPath: ROOT_PATH,
    createdAt: TS,
    updatedAt: TS,
  });
  return r;
}

const env = (r: CoreRegistry, storeRoot?: string) => ({
  registry: r,
  now: () => TS,
  newId: () => RULE_ID,
  ...(storeRoot !== undefined ? { storeRoot } : {}),
});

let storeRoot: string;
beforeEach(() => {
  storeRoot = mkdtempSync(join(tmpdir(), "mega-wv-rule-"));
});
afterEach(() => {
  rmSync(storeRoot, { recursive: true, force: true });
});

describe("save_project_rule write gate", () => {
  it("no evidence -> confidence capped low, verification recorded, TTL stamped, never dropped", async () => {
    const registry = seeded();
    const res = await handleSaveProjectRule(env(registry), {
      projectId: PROJECT_ID,
      title: "no npm",
      rule: "use pnpm",
      severity: "warning",
      confidence: "high",
      createdFrom: "manual",
    });
    const rule = registry.getProjectRule(res.id as never);
    expect(rule).not.toBeNull(); // never dropped
    expect(rule?.confidence).toBe("low"); // cap never raises
    expect(rule?.verification?.outcome).toBe("unverified");
    expect(rule?.verification?.reasons).toContain("zero_evidence_pointers");
    expect(rule?.expiresAt).toBe(TS_PLUS_90D);
  });

  it("resolving evidence verifies: caller confidence passes through", async () => {
    await appendEvidence({ storeRoot, redactSourceRef: (r) => r, record: minimalInput(EV_ID) });
    const registry = seeded();
    const res = await handleSaveProjectRule(env(registry, storeRoot), {
      projectId: PROJECT_ID,
      title: "no npm",
      rule: "use pnpm",
      severity: "warning",
      confidence: "high",
      evidence: [EV_ID],
    });
    const rule = registry.getProjectRule(res.id as never);
    expect(rule?.confidence).toBe("high");
    expect(rule?.verification?.outcome).toBe("verified");
    expect(rule?.expiresAt).toBe(TS_PLUS_90D);
  });

  it("explicit expiresAt: null survives the gate (no expiry)", async () => {
    const registry = seeded();
    const res = await handleSaveProjectRule(env(registry), {
      projectId: PROJECT_ID,
      title: "no npm",
      rule: "use pnpm",
      severity: "warning",
      expiresAt: null,
    });
    expect(registry.getProjectRule(res.id as never)?.expiresAt).toBeNull();
  });

  it("an evidence array over the 32-pointer cap is rejected by the schema", async () => {
    const registry = seeded();
    await expect(
      handleSaveProjectRule(env(registry), {
        projectId: PROJECT_ID,
        title: "t",
        rule: "r",
        severity: "info",
        evidence: Array.from(
          { length: 33 },
          (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
        ),
      }),
    ).rejects.toMatchObject({ code: "validation_failed" });
  });

  it("rejects an unknown project as resource_not_found", async () => {
    const registry = seeded();
    await expect(
      handleSaveProjectRule(env(registry), {
        projectId: "99999999-9999-4999-8999-999999999999",
        title: "t",
        rule: "r",
        severity: "info",
      }),
    ).rejects.toMatchObject({ code: "resource_not_found" });
  });
});
