import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runToolsAdd } from "../src/commands/tools/add.js";
import { runToolsExplain } from "../src/commands/tools/explain.js";
import { runToolsList } from "../src/commands/tools/list.js";
import { runToolsRoute } from "../src/commands/tools/route.js";

const PROJECT = "demo";
const TOOL_ID = "e0000000-0000-4000-8000-000000000001";

let root: string;
let out: string[];
let err: string[];

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "mega-cli-tools-"));
  out = [];
  err = [];
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  // biome-ignore lint/performance/noDelete: process.env clear semantics require delete
  // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
  delete process.env["MEGA_TEST_TOOL_DEFINITION_ID"];
});

function baseEnv() {
  return {
    storeFlag: root,
    cwd: root,
    home: root,
    xdgDataHome: undefined,
    platform: process.platform,
    localAppData: undefined,
    stdout: (l: string) => out.push(l),
    stderr: (l: string) => err.push(l),
  };
}

async function seedProject(): Promise<void> {
  const { createJsonDirectoryCoreRegistry } = await import("@megasaver/core");
  const registry = createJsonDirectoryCoreRegistry({ rootDir: root });
  registry.createProject({
    id: "11111111-1111-4111-8111-111111111111",
    name: PROJECT,
    rootPath: root,
    createdAt: "2026-06-12T00:00:00.000Z",
    updatedAt: "2026-06-12T00:00:00.000Z",
  } as never);
}

describe("mega tools add", () => {
  it("registers a tool and prints its id", async () => {
    await seedProject();
    // biome-ignore lint/complexity/useLiteralKeys: noPropertyAccessFromIndexSignature
    process.env["MEGA_TEST_TOOL_DEFINITION_ID"] = TOOL_ID;
    const code = await runToolsAdd({
      ...baseEnv(),
      projectName: PROJECT,
      nameFlag: "grep",
      descriptionFlag: "search files",
      categoryFlag: "search",
      riskFlag: "safe",
      keywordFlags: ["search"],
    });
    expect(code).toBe(0);
    expect(out).toEqual([TOOL_ID]);
  });

  it("rejects an invalid category with a clean message", async () => {
    await seedProject();
    const code = await runToolsAdd({
      ...baseEnv(),
      projectName: PROJECT,
      nameFlag: "x",
      descriptionFlag: "x",
      categoryFlag: "network",
      riskFlag: "safe",
    });
    expect(code).toBe(1);
    expect(err.join("\n")).toContain('invalid category "network"');
  });

  it("rejects an invalid risk with a clean message", async () => {
    await seedProject();
    const code = await runToolsAdd({
      ...baseEnv(),
      projectName: PROJECT,
      nameFlag: "x",
      descriptionFlag: "x",
      categoryFlag: "search",
      riskFlag: "high",
    });
    expect(code).toBe(1);
    expect(err.join("\n")).toContain('invalid risk "high"');
  });
});

async function seedTwoTools(): Promise<void> {
  const { createJsonDirectoryCoreRegistry } = await import("@megasaver/core");
  const registry = createJsonDirectoryCoreRegistry({ rootDir: root });
  const clock = (id: string) => ({ now: () => "2026-06-12T00:00:00.000Z", newId: () => id });
  const project = registry.listProjects().find((p) => p.name === PROJECT);
  if (!project) throw new Error("seed project first");
  registry.createToolDefinition(
    project.id,
    {
      name: "grep",
      description: "search files",
      category: "search",
      risk: "safe",
      keywords: ["search"],
    } as never,
    clock("e0000000-0000-4000-8000-000000000001"),
  );
  registry.createToolDefinition(
    project.id,
    {
      name: "ship",
      description: "deploy to production",
      category: "deploy",
      risk: "dangerous",
      keywords: ["deploy"],
    } as never,
    clock("e0000000-0000-4000-8000-000000000002"),
  );
}

describe("mega tools list", () => {
  it("lists registered tools", async () => {
    await seedProject();
    await seedTwoTools();
    const code = await runToolsList({ ...baseEnv(), projectName: PROJECT });
    expect(code).toBe(0);
    expect(out.join("\n")).toContain("grep");
    expect(out.join("\n")).toContain("ship");
  });
});

describe("mega tools route", () => {
  it("allows the safe match and blocks the dangerous deploy tool", async () => {
    await seedProject();
    await seedTwoTools();
    const code = await runToolsRoute({
      ...baseEnv(),
      projectName: PROJECT,
      taskFlag: "search files",
    });
    expect(code).toBe(0);
    const text = out.join("\n");
    expect(text).toContain("allowed");
    expect(text).toContain("grep");
    expect(text).toContain("blocked");
    expect(text).toContain("ship");
    expect(text).toContain("blocked as dangerous/deploy/database");
  });

  it("with no task, allows all safe tools", async () => {
    await seedProject();
    await seedTwoTools();
    const code = await runToolsRoute({ ...baseEnv(), projectName: PROJECT });
    expect(code).toBe(0);
    expect(out.join("\n")).toContain("grep");
  });
});

describe("mega tools explain", () => {
  it("renders per-tool block reasons", async () => {
    await seedProject();
    await seedTwoTools();
    const code = await runToolsExplain({ ...baseEnv(), projectName: PROJECT });
    expect(code).toBe(0);
    const text = out.join("\n");
    expect(text).toContain("routable");
    expect(text).toContain("blocked: category deploy");
  });
});
