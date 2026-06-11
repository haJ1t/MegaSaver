import { type CoreRegistry, createInMemoryCoreRegistry } from "@megasaver/core";
import { describe, expect, it } from "vitest";
import { handleRecordFailedAttempt } from "../../src/tools/failed-attempts.js";

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
