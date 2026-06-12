import { type CoreRegistry, createInMemoryCoreRegistry } from "@megasaver/core";
import { describe, expect, it } from "vitest";
import { handleFindSimilarFailures } from "../../src/tools/find-similar-failures.js";
import { handleGetApplicableRules } from "../../src/tools/get-applicable-rules.js";
import { handleConvertFailureToRule } from "../../src/tools/convert-failure-to-rule.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const TS = "2026-06-12T00:00:00.000Z";

function seeded(): CoreRegistry {
  const r = createInMemoryCoreRegistry();
  r.createProject({ id: PROJECT_ID, name: "demo", rootPath: "/tmp/demo", createdAt: TS, updatedAt: TS });
  r.createFailedAttempt({
    id: "a0000000-0000-4000-8000-000000000001",
    projectId: PROJECT_ID,
    sessionId: null,
    task: "fix login auth bug",
    failedStep: "run auth tests",
    relatedFiles: [],
    convertedToRule: false,
    createdAt: TS,
  });
  return r;
}

describe("find_similar_failures", () => {
  it("returns ranked failures for a task", async () => {
    const res = await handleFindSimilarFailures({ registry: seeded() }, { projectId: PROJECT_ID, task: "login auth" });
    expect(res.failures).toHaveLength(1);
  });
  it("rejects unknown project as resource_not_found", async () => {
    await expect(
      handleFindSimilarFailures({ registry: seeded() }, { projectId: "99999999-9999-4999-8999-999999999999", task: "x" }),
    ).rejects.toMatchObject({ code: "resource_not_found" });
  });
  it("rejects invalid input as validation_failed", async () => {
    await expect(handleFindSimilarFailures({ registry: seeded() }, { projectId: PROJECT_ID })).rejects.toMatchObject({
      code: "validation_failed",
    });
  });
});

describe("get_applicable_rules", () => {
  it("returns scored rules with reasons", async () => {
    const r = createInMemoryCoreRegistry();
    r.createProject({ id: PROJECT_ID, name: "demo", rootPath: "/tmp/demo", createdAt: TS, updatedAt: TS });
    r.createProjectRule({
      id: "b0000000-0000-4000-8000-000000000001",
      projectId: PROJECT_ID,
      title: "Migrate first",
      rule: "create a migration before regenerating",
      appliesTo: ["prisma/schema.prisma"],
      evidence: [],
      severity: "warning",
      confidence: "high",
      createdFrom: "manual",
      createdAt: TS,
      updatedAt: TS,
    });
    const res = await handleGetApplicableRules({ registry: r }, { projectId: PROJECT_ID, files: ["prisma/schema.prisma"] });
    expect(res.rules).toHaveLength(1);
    expect(res.rules[0]?.reason).toContain("applies to");
  });
  it("rejects unknown project as resource_not_found", async () => {
    const r = createInMemoryCoreRegistry();
    await expect(handleGetApplicableRules({ registry: r }, { projectId: PROJECT_ID })).rejects.toMatchObject({
      code: "resource_not_found",
    });
  });
});

describe("convert_failure_to_rule", () => {
  const FA_ID = "a0000000-0000-4000-8000-000000000001";
  const RULE_ID = "c0000000-0000-4000-8000-000000000001";
  function seededWithFailure(): CoreRegistry {
    const r = createInMemoryCoreRegistry();
    r.createProject({ id: PROJECT_ID, name: "demo", rootPath: "/tmp/demo", createdAt: TS, updatedAt: TS });
    r.createFailedAttempt({
      id: FA_ID, projectId: PROJECT_ID, sessionId: null, task: "t", failedStep: "s",
      relatedFiles: ["src/db.ts"], convertedToRule: false, createdAt: TS,
    });
    return r;
  }
  const env = (r: CoreRegistry) => ({ registry: r, now: () => TS, newId: () => RULE_ID });

  it("converts a failure into a rule and flips it", async () => {
    const r = seededWithFailure();
    const res = await handleConvertFailureToRule(env(r), { failureId: FA_ID, title: "Migrate", rule: "migrate first", severity: "warning" });
    expect(res).toEqual({ ruleId: RULE_ID, failureId: FA_ID });
    expect(r.getProjectRule(RULE_ID as never)?.createdFrom).toBe("failed_attempt");
    expect(r.getFailedAttempt(FA_ID as never)?.convertedToRule).toBe(true);
  });
  it("rejects an unknown failure as resource_not_found", async () => {
    const r = seededWithFailure();
    await expect(
      handleConvertFailureToRule(env(r), { failureId: "a0000000-0000-4000-8000-000000000009", title: "t", rule: "r", severity: "info" }),
    ).rejects.toMatchObject({ code: "resource_not_found" });
  });
  it("rejects a double-convert as validation_failed", async () => {
    const r = seededWithFailure();
    await handleConvertFailureToRule(env(r), { failureId: FA_ID, title: "t", rule: "r", severity: "info" });
    await expect(
      handleConvertFailureToRule({ registry: r, now: () => TS, newId: () => "c0000000-0000-4000-8000-000000000002" }, { failureId: FA_ID, title: "t", rule: "r", severity: "info" }),
    ).rejects.toMatchObject({ code: "validation_failed" });
  });
});
