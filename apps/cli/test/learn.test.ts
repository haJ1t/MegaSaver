import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createJsonDirectoryCoreRegistry, initStore } from "@megasaver/core";
import { failedAttemptIdSchema, projectIdSchema } from "@megasaver/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runLearnFromFailure } from "../src/commands/learn.js";

const PROJECT_ID = projectIdSchema.parse("11111111-1111-4111-8111-111111111111");
const FA_ID = failedAttemptIdSchema.parse("a0000000-0000-4000-8000-000000000001");
const TS = "2026-06-12T00:00:00.000Z";

describe("mega learn from-failure", () => {
  let root: string;
  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), "cli-learn-"));
    await initStore(root);
    const r = createJsonDirectoryCoreRegistry({ rootDir: root });
    r.createProject({
      id: PROJECT_ID,
      name: "demo",
      rootPath: "/tmp/demo",
      createdAt: TS,
      updatedAt: TS,
    });
    r.createFailedAttempt({
      id: FA_ID,
      projectId: PROJECT_ID,
      sessionId: null,
      task: "t",
      failedStep: "s",
      relatedFiles: ["src/db.ts"],
      convertedToRule: false,
      createdAt: TS,
    });
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("converts a failure into a rule and prints the rule id", async () => {
    const out: string[] = [];
    const err: string[] = [];
    const code = await runLearnFromFailure({
      idFlag: FA_ID,
      titleFlag: "Migrate first",
      ruleFlag: "create migration",
      severityFlag: "warning",
      storeFlag: root,
      cwd: root,
      home: root,
      xdgDataHome: undefined,
      platform: process.platform,
      localAppData: undefined,
      stdout: (l) => out.push(l),
      stderr: (l) => err.push(l),
      now: () => TS,
      newId: () => "c0000000-0000-4000-8000-000000000001",
    });
    expect(code).toBe(0);
    expect(out[0]).toContain("c0000000-0000-4000-8000-000000000001");
    const r = createJsonDirectoryCoreRegistry({ rootDir: root });
    expect(r.getFailedAttempt(FA_ID)?.convertedToRule).toBe(true);
  });

  it("rejects a double-convert", async () => {
    const mk = () => ({
      idFlag: FA_ID,
      titleFlag: "t",
      ruleFlag: "r",
      severityFlag: "info",
      storeFlag: root,
      cwd: root,
      home: root,
      xdgDataHome: undefined,
      platform: process.platform,
      localAppData: undefined,
      stdout: (_l: string) => {},
      stderr: (_l: string) => {},
      now: () => TS,
    });
    await runLearnFromFailure({ ...mk(), newId: () => "c0000000-0000-4000-8000-000000000001" });
    const err: string[] = [];
    const code = await runLearnFromFailure({
      ...mk(),
      stderr: (l) => err.push(l),
      newId: () => "c0000000-0000-4000-8000-000000000002",
    });
    expect(code).toBe(1);
    expect(err.join("\n").toLowerCase()).toContain("already converted");
  });
});
