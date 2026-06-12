import {
  type CoreRegistry,
  type ToolDefinitionInput,
  createInMemoryCoreRegistry,
} from "@megasaver/core";
import type { ProjectId } from "@megasaver/shared";
import { describe, expect, it } from "vitest";
import { McpBridgeError } from "../../src/errors.js";
import { handleRouteToolsForTask } from "../../src/tools/route-tools-for-task.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";

function seeded(): CoreRegistry {
  const registry = createInMemoryCoreRegistry();
  registry.createProject({
    id: PROJECT_ID as ProjectId,
    name: "demo",
    rootPath: "/tmp/demo",
    createdAt: "2026-06-12T00:00:00.000Z",
    updatedAt: "2026-06-12T00:00:00.000Z",
  } as Parameters<CoreRegistry["createProject"]>[0]);
  const clock = (id: string) => ({ now: () => "2026-06-12T00:00:00.000Z", newId: () => id });
  registry.createToolDefinition(
    PROJECT_ID as ProjectId,
    {
      name: "grep",
      description: "search files",
      category: "search",
      risk: "safe",
      keywords: ["search"],
    } as ToolDefinitionInput,
    clock("e0000000-0000-4000-8000-000000000001"),
  );
  registry.createToolDefinition(
    PROJECT_ID as ProjectId,
    {
      name: "ship",
      description: "deploy to production",
      category: "deploy",
      risk: "dangerous",
      keywords: ["deploy"],
    } as ToolDefinitionInput,
    clock("e0000000-0000-4000-8000-000000000002"),
  );
  return registry;
}

describe("handleRouteToolsForTask", () => {
  it("returns allowed + blocked + reason for a task", async () => {
    const res = await handleRouteToolsForTask(
      { registry: seeded() },
      {
        projectId: PROJECT_ID,
        task: "search files",
      },
    );
    expect(res.allowedTools.map((t) => t.name)).toEqual(["grep"]);
    expect(res.blockedTools.map((t) => t.name)).toEqual(["ship"]);
    expect(res.reason).toContain("blocked as dangerous/deploy/database");
  });

  it("allows all safe tools when no task is given", async () => {
    const res = await handleRouteToolsForTask({ registry: seeded() }, { projectId: PROJECT_ID });
    expect(res.allowedTools.map((t) => t.name)).toEqual(["grep"]);
    expect(res.blockedTools.map((t) => t.name)).toEqual(["ship"]);
  });

  it("maps unknown project to resource_not_found", async () => {
    await expect(
      handleRouteToolsForTask(
        { registry: createInMemoryCoreRegistry() },
        {
          projectId: PROJECT_ID,
          task: "x",
        },
      ),
    ).rejects.toMatchObject({ code: "resource_not_found" });
  });

  it("rejects bad input with validation_failed", async () => {
    await expect(
      handleRouteToolsForTask({ registry: seeded() }, { task: 5 }),
    ).rejects.toBeInstanceOf(McpBridgeError);
  });
});
