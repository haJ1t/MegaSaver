import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type CoreRegistry, createInMemoryCoreRegistry } from "@megasaver/core";
import type { ProjectId } from "@megasaver/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { handleGetWarmStartBrief } from "../src/tools/get-warm-start-brief.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111" as ProjectId;
const TS = "2026-06-11T00:00:00.000Z";

let storeRoot: string;
beforeEach(() => {
  storeRoot = mkdtempSync(join(tmpdir(), "mcp-warm-start-"));
});
afterEach(() => rmSync(storeRoot, { recursive: true, force: true }));

function buildEnv(): { registry: CoreRegistry; storeRoot: string; now: () => string } {
  const registry = createInMemoryCoreRegistry();
  registry.createProject({
    id: PROJECT_ID,
    name: "demo",
    rootPath: "/tmp/demo",
    createdAt: TS,
    updatedAt: TS,
  });
  return { registry, storeRoot, now: () => "2026-07-12T10:00:00.000Z" };
}

describe("get_warm_start_brief", () => {
  it("returns a WarmStartBrief for a project", async () => {
    const env = buildEnv();
    const result = await handleGetWarmStartBrief(env, { projectId: PROJECT_ID });
    expect(result.brief.text).toContain("Warm Start");
    expect(result.brief.tokenEstimate).toBeGreaterThanOrEqual(0);
  });

  it("rejects bad args with validation_failed", async () => {
    const env = buildEnv();
    await expect(handleGetWarmStartBrief(env, { projectId: 42 })).rejects.toMatchObject({
      code: "validation_failed",
    });
  });

  it("resource_not_found for an unknown project", async () => {
    const env = buildEnv();
    await expect(
      handleGetWarmStartBrief(env, { projectId: "99999999-9999-4999-8999-999999999999" }),
    ).rejects.toMatchObject({ code: "resource_not_found" });
  });
});
