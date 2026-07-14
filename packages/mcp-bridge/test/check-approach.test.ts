import { type CoreRegistry, createInMemoryCoreRegistry } from "@megasaver/core";
import type { ProjectId } from "@megasaver/shared";
import { describe, expect, it } from "vitest";
import { handleCheckApproach } from "../src/tools/check-approach.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111" as ProjectId;
const NOW = "2026-07-12T10:00:00.000Z";

function buildEnv(isPro: boolean): { registry: CoreRegistry; now: () => string; isPro: boolean } {
  const registry = createInMemoryCoreRegistry();
  registry.createProject({
    id: PROJECT_ID,
    name: "demo",
    rootPath: "/tmp/demo",
    createdAt: NOW,
    updatedAt: NOW,
  });
  registry.createFailedAttempt({
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" as never,
    projectId: PROJECT_ID,
    sessionId: null,
    task: "shard vitest run",
    failedStep: "pnpm vitest --shard 2",
    errorOutput: "unknown option --shard",
    relatedFiles: ["src/run.ts"],
    convertedToRule: false,
    createdAt: "2026-07-11T10:00:00.000Z",
  } as never);
  registry.createFailedAttempt({
    id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" as never,
    projectId: PROJECT_ID,
    sessionId: null,
    task: "shard vitest run old",
    failedStep: "pnpm vitest --shard 9",
    errorOutput: "unknown option --shard",
    relatedFiles: [],
    convertedToRule: false,
    createdAt: "2026-06-01T10:00:00.000Z", // 41d old
  } as never);
  return { registry, now: () => NOW, isPro };
}

describe("check_approach", () => {
  it("returns matches with resolution fields for a Pro caller (full history)", async () => {
    const res = await handleCheckApproach(buildEnv(true), {
      projectId: PROJECT_ID,
      description: "vitest shard run",
    });
    expect(res.matches.length).toBe(2);
    expect(res.upsell).toBeUndefined();
  });
  it("caps free callers to the last 7 days and adds the upsell line", async () => {
    const res = await handleCheckApproach(buildEnv(false), {
      projectId: PROJECT_ID,
      description: "vitest shard run",
    });
    expect(res.matches.length).toBe(1);
    expect(res.upsell).toContain("Pro");
  });
  it("files narrows by relatedFiles intersection", async () => {
    const res = await handleCheckApproach(buildEnv(true), {
      projectId: PROJECT_ID,
      description: "vitest shard run",
      files: ["src/run.ts"],
    });
    expect(res.matches.length).toBe(1);
  });
  it("validation_failed on bad args; resource_not_found on unknown project", async () => {
    await expect(handleCheckApproach(buildEnv(true), { projectId: 42 })).rejects.toMatchObject({
      code: "validation_failed",
    });
    await expect(
      handleCheckApproach(buildEnv(true), {
        projectId: "99999999-9999-4999-8999-999999999999",
        description: "x",
      }),
    ).rejects.toMatchObject({ code: "resource_not_found" });
  });
});
