import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createJsonDirectoryCoreRegistry, initStore } from "@megasaver/core";
import { projectIdSchema } from "@megasaver/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runRulesAdd } from "../src/commands/rules/add.js";
import { runRulesApply } from "../src/commands/rules/apply.js";

const PROJECT_ID = projectIdSchema.parse("11111111-1111-4111-8111-111111111111");
const TS = "2026-06-12T00:00:00.000Z";

function base(root: string, out: string[], err: string[]) {
  return {
    projectName: "demo",
    storeFlag: root,
    cwd: root,
    home: root,
    xdgDataHome: undefined,
    platform: process.platform,
    localAppData: undefined,
    stdout: (l: string) => out.push(l),
    stderr: (l: string) => err.push(l),
    now: () => TS,
  };
}

describe("mega rules add + apply", () => {
  let root: string;
  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), "cli-rules-"));
    await initStore(root);
    createJsonDirectoryCoreRegistry({ rootDir: root }).createProject({
      id: PROJECT_ID,
      name: "demo",
      rootPath: "/tmp/demo",
      createdAt: TS,
      updatedAt: TS,
    });
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("adds a rule then applies it by files", async () => {
    const out: string[] = [];
    const err: string[] = [];
    await runRulesAdd({
      ...base(root, out, err),
      titleFlag: "Migrate first",
      ruleFlag: "create a migration",
      severityFlag: "warning",
      appliesToFlags: ["prisma/"],
      newId: () => "b0000000-0000-4000-8000-000000000001",
    });
    const applyOut: string[] = [];
    const applyErr: string[] = [];
    const code = await runRulesApply({
      ...base(root, applyOut, applyErr),
      taskFlag: undefined,
      filesFlags: ["prisma/schema.prisma"],
    });
    expect(code).toBe(0);
    expect(applyOut.join("\n")).toContain("Migrate first");
  });
});
