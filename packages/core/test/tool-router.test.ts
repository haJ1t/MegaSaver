import { describe, expect, it } from "vitest";
import type { ToolDefinition } from "../src/tool-definition.js";
import { isBlockedTool, routeToolsForTask } from "../src/tool-router.js";

let seq = 0;
function tool(over: Partial<ToolDefinition>): ToolDefinition {
  seq += 1;
  return {
    id: `e0000000-0000-4000-8000-${String(seq).padStart(12, "0")}` as ToolDefinition["id"],
    projectId: "11111111-1111-4111-8111-111111111111" as ToolDefinition["projectId"],
    name: "tool",
    description: "a tool",
    category: "search",
    risk: "safe",
    inputSchema: null,
    outputSchema: null,
    keywords: [],
    createdAt: "2026-06-12T00:00:00.000Z",
    ...over,
  };
}

describe("isBlockedTool", () => {
  it("blocks risk=dangerous in any category", () => {
    expect(isBlockedTool(tool({ category: "search", risk: "dangerous" }))).toBe(true);
  });
  it("blocks category dangerous/deploy/database regardless of risk", () => {
    expect(isBlockedTool(tool({ category: "dangerous", risk: "safe" }))).toBe(true);
    expect(isBlockedTool(tool({ category: "deploy", risk: "safe" }))).toBe(true);
    expect(isBlockedTool(tool({ category: "database", risk: "medium" }))).toBe(true);
  });
  it("does not block safe/medium tools in the six routable categories", () => {
    for (const category of ["filesystem", "search", "git", "test", "package", "browser"] as const) {
      expect(isBlockedTool(tool({ category, risk: "safe" }))).toBe(false);
      expect(isBlockedTool(tool({ category, risk: "medium" }))).toBe(false);
    }
  });
});

describe("routeToolsForTask", () => {
  it("with no task, allows all non-blocked tools and lists the blocked ones", () => {
    const grep = tool({ name: "grep", category: "search" });
    const deploy = tool({ name: "ship", category: "deploy" });
    const res = routeToolsForTask([grep, deploy], undefined);
    expect(res.allowedTools.map((t) => t.id)).toEqual([grep.id]);
    expect(res.blockedTools.map((t) => t.id)).toEqual([deploy.id]);
    expect(res.reason).toBe(
      "no task filter — 1 safe tool(s) allowed; 1 blocked as dangerous/deploy/database",
    );
  });

  it("with a task, allows only score>0 non-blocked tools by descending score", () => {
    const grep = tool({ name: "grep", description: "search files for a pattern", keywords: ["search"] });
    const fmt = tool({ name: "prettier", description: "format code", category: "package" });
    const res = routeToolsForTask([grep, fmt], "search files for the login pattern");
    expect(res.allowedTools.map((t) => t.id)).toEqual([grep.id]);
    // fmt is non-blocked but irrelevant (score 0): omitted from BOTH lists.
    expect(res.blockedTools).toEqual([]);
    expect(res.reason).toBe(
      "1 tool(s) matched 'search files for the login pattern'; 0 blocked as dangerous/deploy/database; 1 not relevant",
    );
  });

  it("NEVER promotes a dangerous tool into allowedTools even on a strong text match", () => {
    const dropDb = tool({
      name: "drop-database",
      description: "drop the production database immediately",
      category: "database",
      risk: "dangerous",
      keywords: ["database", "drop"],
    });
    const res = routeToolsForTask([dropDb], "drop the production database");
    expect(res.allowedTools).toEqual([]);
    expect(res.blockedTools.map((t) => t.id)).toEqual([dropDb.id]);
    expect(res.reason).toBe(
      "no tools matched 'drop the production database'; 1 blocked as dangerous/deploy/database; 0 not relevant",
    );
  });

  it("breaks score ties by id and is stable", () => {
    const a = tool({ id: "e0000000-0000-4000-8000-0000000000a1" as ToolDefinition["id"], name: "alpha", description: "same words here", keywords: [] });
    const b = tool({ id: "e0000000-0000-4000-8000-0000000000b2" as ToolDefinition["id"], name: "beta", description: "same words here", keywords: [] });
    const res = routeToolsForTask([b, a], "same words here");
    expect(res.allowedTools.map((t) => t.id)).toEqual([a.id, b.id]);
  });

  it("empty tool set yields empty lists", () => {
    const res = routeToolsForTask([], "anything");
    expect(res.allowedTools).toEqual([]);
    expect(res.blockedTools).toEqual([]);
    expect(res.reason).toBe(
      "no tools matched 'anything'; 0 blocked as dangerous/deploy/database; 0 not relevant",
    );
  });
});
