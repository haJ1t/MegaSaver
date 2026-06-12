import { describe, expect, it } from "vitest";
import { rankApplicableRules } from "../src/project-rule-ranking.js";
import type { ProjectRule } from "../src/project-rule.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
function rule(over: Partial<ProjectRule> & { id: string }): ProjectRule {
  return {
    id: over.id,
    projectId: PROJECT_ID as ProjectRule["projectId"],
    title: over.title ?? "title",
    rule: over.rule ?? "do the thing",
    appliesTo: over.appliesTo ?? [],
    evidence: over.evidence ?? [],
    severity: over.severity ?? "info",
    confidence: over.confidence ?? "medium",
    createdFrom: over.createdFrom ?? "manual",
    createdAt: "2026-06-12T00:00:00.000Z",
    updatedAt: "2026-06-12T00:00:00.000Z",
  } as ProjectRule;
}

describe("rankApplicableRules", () => {
  it("ranks a path-matching rule above a pure text match", () => {
    const db = rule({
      id: "b0000000-0000-4000-8000-000000000001",
      title: "migrate",
      appliesTo: ["src/db/"],
    });
    const txt = rule({
      id: "b0000000-0000-4000-8000-000000000002",
      title: "migrate prisma schema",
      rule: "regenerate client",
    });
    const out = rankApplicableRules([db, txt], {
      task: "migrate prisma",
      files: ["src/db/schema.ts"],
    });
    expect(out[0]?.rule.id).toBe(db.id);
    expect(out[0]?.reason).toContain("applies to src/db/schema.ts");
  });

  it("drops zero-score rules when a filter is present", () => {
    const r = rule({
      id: "b0000000-0000-4000-8000-000000000001",
      title: "navbar",
      rule: "ui only",
      appliesTo: ["src/ui/"],
    });
    expect(
      rankApplicableRules([r], { task: "database migration", files: ["src/db/x.ts"] }),
    ).toEqual([]);
  });

  it("with no filter returns all sorted by severity then id", () => {
    const info = rule({ id: "b0000000-0000-4000-8000-000000000001", severity: "info" });
    const crit = rule({ id: "b0000000-0000-4000-8000-000000000002", severity: "critical" });
    const out = rankApplicableRules([info, crit], {});
    expect(out.map((x) => x.rule.id)).toEqual([crit.id, info.id]);
    expect(out[0]?.reason).toBe("no task filter");
  });

  it("rejects an empty-string file", () => {
    expect(() =>
      rankApplicableRules([rule({ id: "b0000000-0000-4000-8000-000000000001" })], { files: [""] }),
    ).toThrow();
  });
});
