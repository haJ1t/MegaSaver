import { describe, expect, it } from "vitest";
import {
  type ProjectRule,
  projectRuleSchema,
  ruleCreatedFromSchema,
  ruleSeveritySchema,
} from "../src/project-rule.js";

const RULE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const WORKSPACE_KEY = "ws-abc123";
const TS = "2026-06-11T00:00:00.000Z";

const valid = {
  id: RULE_ID,
  workspaceKey: WORKSPACE_KEY,
  title: "Migrate before regenerate",
  rule: "When changing Prisma schema, create a migration and regenerate the client.",
  appliesTo: ["prisma/schema.prisma", "src/db/"],
  evidence: ["Failed test on 2026-06-11: stale Prisma client."],
  severity: "warning",
  confidence: "high",
  createdFrom: "failed_attempt",
  createdAt: TS,
  updatedAt: TS,
};

describe("projectRuleSchema", () => {
  it("parses a valid rule", () => {
    const parsed: ProjectRule = projectRuleSchema.parse(valid);
    expect(parsed.severity).toBe("warning");
    expect(parsed.appliesTo).toEqual(["prisma/schema.prisma", "src/db/"]);
  });

  it("defaults appliesTo and evidence to empty arrays", () => {
    const { appliesTo, evidence, ...rest } = valid;
    const parsed = projectRuleSchema.parse(rest);
    expect(parsed.appliesTo).toEqual([]);
    expect(parsed.evidence).toEqual([]);
  });

  it("rejects an empty rule body", () => {
    expect(() => projectRuleSchema.parse({ ...valid, rule: "" })).toThrow();
  });

  it("rejects an unknown key (strict)", () => {
    expect(() => projectRuleSchema.parse({ ...valid, extra: 1 })).toThrow();
  });

  it("severity and createdFrom are closed enums", () => {
    expect(ruleSeveritySchema.options).toEqual(["info", "warning", "critical"]);
    expect(ruleCreatedFromSchema.options).toEqual(["manual", "failed_attempt", "test_failure"]);
    expect(() => projectRuleSchema.parse({ ...valid, severity: "fatal" })).toThrow();
  });
});
