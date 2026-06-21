import { describe, expect, it } from "vitest";
import { AgentOfficeError } from "../src/errors.js";
import {
  agentPath,
  agentsDir,
  assertSafeSegment,
  rolePath,
  rolesDir,
  taskPath,
  tasksDir,
} from "../src/paths.js";

describe("assertSafeSegment", () => {
  it.each(["", ".", "..", "a/b", "a\\b"])("rejects %p", (seg) => {
    expect(() => assertSafeSegment(seg)).toThrow(AgentOfficeError);
  });
  it("accepts a normal segment", () => {
    expect(() => assertSafeSegment("abc-123")).not.toThrow();
  });
});

describe("path builders", () => {
  it("rolePath nests under office/roles", () => {
    expect(rolePath({ storeRoot: "/s", roleId: "r1" })).toBe("/s/office/roles/r1.json");
    expect(rolesDir("/s")).toBe("/s/office/roles");
  });
  it("agentPath nests under office/<wk>/agents", () => {
    expect(agentPath({ storeRoot: "/s", workspaceKey: "wk", officeAgentId: "a1" })).toBe(
      "/s/office/wk/agents/a1.json",
    );
    expect(agentsDir("/s", "wk")).toBe("/s/office/wk/agents");
  });
  it("taskPath nests under office/<wk>/tasks/<agent>", () => {
    expect(
      taskPath({ storeRoot: "/s", workspaceKey: "wk", officeAgentId: "a1", officeTaskId: "t1" }),
    ).toBe("/s/office/wk/tasks/a1/t1.json");
    expect(tasksDir("/s", "wk", "a1")).toBe("/s/office/wk/tasks/a1");
  });
  it("rejects an unsafe id segment", () => {
    expect(() => rolePath({ storeRoot: "/s", roleId: "../escape" })).toThrow(AgentOfficeError);
    expect(() =>
      taskPath({ storeRoot: "/s", workspaceKey: "wk", officeAgentId: "a/b", officeTaskId: "t1" }),
    ).toThrow(AgentOfficeError);
  });
});
