import { type CoreRegistry, createInMemoryCoreRegistry } from "@megasaver/core";
import { describe, expect, it } from "vitest";
import { handleRecordFailedAttempt } from "../../src/tools/failed-attempts.js";
import { handleGetProjectRules, handleSaveProjectRule } from "../../src/tools/project-rules.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const TS = "2026-06-11T00:00:00.000Z";

function seededRegistry(): CoreRegistry {
  const registry = createInMemoryCoreRegistry();
  registry.createProject({
    id: PROJECT_ID,
    name: "demo",
    rootPath: "/tmp/demo",
    createdAt: TS,
    updatedAt: TS,
  });
  return registry;
}

const newId = () => "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

describe("record_failed_attempt", () => {
  it("records a failed attempt and returns its id", async () => {
    const registry = seededRegistry();
    const res = await handleRecordFailedAttempt(
      { registry, now: () => TS, newId },
      {
        projectId: PROJECT_ID,
        task: "fix login bug",
        failedStep: "run auth tests",
        errorOutput: "401",
        relatedFiles: ["src/middleware/auth.ts"],
      },
    );
    expect(res.id).toBe("cccccccc-cccc-4ccc-8ccc-cccccccccccc");
    const stored = registry.getFailedAttempt(res.id as never);
    expect(stored?.failedStep).toBe("run auth tests");
    expect(stored?.convertedToRule).toBe(false);
  });

  it("rejects an unknown project as resource_not_found", async () => {
    const registry = seededRegistry();
    await expect(
      handleRecordFailedAttempt(
        { registry, now: () => TS, newId },
        { projectId: "99999999-9999-4999-8999-999999999999", task: "t", failedStep: "s" },
      ),
    ).rejects.toMatchObject({ code: "resource_not_found" });
  });

  it("rejects invalid input as validation_failed", async () => {
    const registry = seededRegistry();
    await expect(
      handleRecordFailedAttempt(
        { registry, now: () => TS, newId },
        { projectId: PROJECT_ID, task: "t" },
      ),
    ).rejects.toMatchObject({ code: "validation_failed" });
  });
});

describe("save_project_rule + get_project_rules", () => {
  it("saves a rule and returns its id", async () => {
    const registry = seededRegistry();
    const res = await handleSaveProjectRule(
      { registry, now: () => TS, newId },
      {
        projectId: PROJECT_ID,
        title: "Migrate first",
        rule: "Create a migration before regenerating the client.",
        severity: "warning",
        appliesTo: ["prisma/schema.prisma"],
      },
    );
    expect(res.id).toBe("cccccccc-cccc-4ccc-8ccc-cccccccccccc");
    expect(registry.getProjectRule(res.id as never)?.severity).toBe("warning");
  });

  it("lists all rules when no filter is given", async () => {
    const registry = seededRegistry();
    await handleSaveProjectRule(
      { registry, now: () => TS, newId },
      { projectId: PROJECT_ID, title: "t", rule: "r", severity: "info", appliesTo: ["src/db/"] },
    );
    const res = await handleGetProjectRules({ registry }, { projectId: PROJECT_ID });
    expect(res.rules).toHaveLength(1);
  });

  it("filters rules by files via appliesTo prefix", async () => {
    const registry = seededRegistry();
    const ids = ["d0000000-0000-4000-8000-000000000001", "d0000000-0000-4000-8000-000000000002"];
    let i = 0;
    const seqId = () => ids[i++] ?? "d0000000-0000-4000-8000-000000000009";
    await handleSaveProjectRule(
      { registry, now: () => TS, newId: seqId },
      { projectId: PROJECT_ID, title: "db", rule: "r", severity: "info", appliesTo: ["src/db/"] },
    );
    await handleSaveProjectRule(
      { registry, now: () => TS, newId: seqId },
      { projectId: PROJECT_ID, title: "ui", rule: "r", severity: "info", appliesTo: ["src/ui/"] },
    );
    const res = await handleGetProjectRules(
      { registry },
      { projectId: PROJECT_ID, files: ["src/db/schema.ts"] },
    );
    expect(res.rules.map((r) => r.title)).toEqual(["db"]);
  });

  it("rejects an unknown project as resource_not_found", async () => {
    const registry = seededRegistry();
    await expect(
      handleGetProjectRules({ registry }, { projectId: "99999999-9999-4999-8999-999999999999" }),
    ).rejects.toMatchObject({ code: "resource_not_found" });
  });
});
