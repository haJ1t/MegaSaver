import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendRule, initStore } from "@megasaver/core";
import { createJsonDirectoryCoreRegistry } from "@megasaver/core";
import type { ProjectId, ProjectRuleId } from "@megasaver/shared";
import { describe, expect, it } from "vitest";
import { handleGetApplicableRules } from "../src/tools/get-applicable-rules.js";

describe("get_applicable_rules airlock merge", () => {
  it("returns airlockRules alongside rules", async () => {
    const store = mkdtempSync(join(tmpdir(), "mcp-air-"));
    await initStore(store);
    const registry = createJsonDirectoryCoreRegistry({ rootDir: store });
    const projectId = "11111111-1111-4111-8111-111111111111";
    const nowIso = new Date().toISOString();
    registry.createProject({
      id: projectId as unknown as ProjectId,
      name: "p",
      rootPath: store,
      createdAt: nowIso,
      updatedAt: nowIso,
    });
    await appendRule(store, {
      ruleId: "airlock-1",
      sessionId: "sess1",
      toolName: "rg",
      forbiddenPattern: "^rg(?:\\s+.*)?--bad(?:\\b|$)",
      reason: "bad",
      createdAt: new Date().toISOString(),
      ttlSeconds: 3600,
    });
    // Seed a real project rule so BM25 doesn't get topN=0 on empty corpus
    registry.createProjectRule({
      id: "11111111-1111-4111-8111-111111111112" as unknown as ProjectRuleId,
      projectId: projectId as unknown as ProjectId,
      title: "fix",
      rule: "always fix",
      appliesTo: [],
      evidence: [],
      severity: "info",
      confidence: "medium",
      createdFrom: "manual",
      createdAt: nowIso,
      updatedAt: nowIso,
    } as unknown as Parameters<typeof registry.createProjectRule>[0]);
    const res = await handleGetApplicableRules(
      {
        registry,
        now: () => new Date().toISOString(),
        storeRoot: store,
        sessionId: "sess1",
      } as unknown as Parameters<typeof handleGetApplicableRules>[0],
      { projectId, task: "fix", files: [] },
    );
    expect(res).toHaveProperty("airlockRules");
    expect(
      (res as unknown as { airlockRules: unknown[] }).airlockRules.length,
    ).toBeGreaterThanOrEqual(1);
    rmSync(store, { recursive: true, force: true });
  });
});
