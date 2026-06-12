import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runToolsAdd } from "../src/commands/tools/add.js";

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
  process.env.MEGA_TEST_TOOL_DEFINITION_ID = undefined;
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
    process.env.MEGA_TEST_TOOL_DEFINITION_ID = TOOL_ID;
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
