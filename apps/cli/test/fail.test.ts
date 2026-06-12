import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createJsonDirectoryCoreRegistry, initStore } from "@megasaver/core";
import { projectIdSchema } from "@megasaver/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runFailRecord } from "../src/commands/fail/record.js";

const PROJECT_ID = projectIdSchema.parse("11111111-1111-4111-8111-111111111111");
const TS = "2026-06-12T00:00:00.000Z";

function baseInput(root: string, out: string[], err: string[]) {
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

describe("mega fail record", () => {
  let root: string;
  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), "cli-fail-"));
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

  it("records a failure and prints its id", async () => {
    const out: string[] = [];
    const err: string[] = [];
    const code = await runFailRecord({
      ...baseInput(root, out, err),
      taskFlag: "fix login",
      failedStepFlag: "auth test",
      newId: () => "a0000000-0000-4000-8000-000000000001",
    });
    expect(code).toBe(0);
    expect(out[0]).toBe("a0000000-0000-4000-8000-000000000001");
  });

  it("warns when a similar prior failure exists", async () => {
    const out: string[] = [];
    const err: string[] = [];
    await runFailRecord({
      ...baseInput(root, out, err),
      taskFlag: "fix login auth",
      failedStepFlag: "auth test",
      newId: () => "a0000000-0000-4000-8000-000000000001",
    });
    await runFailRecord({
      ...baseInput(root, out, err),
      taskFlag: "fix login auth again",
      failedStepFlag: "auth test",
      newId: () => "a0000000-0000-4000-8000-000000000002",
    });
    expect(err.some((l) => l.toLowerCase().includes("similar"))).toBe(true);
  });
});
