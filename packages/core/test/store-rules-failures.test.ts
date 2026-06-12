import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { projectIdSchema } from "@megasaver/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  readFailedAttemptsForProject,
  readProjectRulesForProject,
  resolveStorePaths,
  writeFailedAttemptsForProject,
  writeProjectRulesForProject,
} from "../src/json-directory-store.js";

const PROJECT_ID = projectIdSchema.parse("11111111-1111-4111-8111-111111111111");
const TS = "2026-06-11T00:00:00.000Z";

const rule = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  projectId: PROJECT_ID,
  title: "r",
  rule: "do x",
  appliesTo: [],
  evidence: [],
  severity: "info",
  confidence: "low",
  createdFrom: "manual",
  createdAt: TS,
  updatedAt: TS,
} as const;

const failure = {
  id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  projectId: PROJECT_ID,
  sessionId: null,
  task: "t",
  failedStep: "s",
  relatedFiles: [],
  convertedToRule: false,
  createdAt: TS,
} as const;

describe("rule + failed-attempt store helpers", () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "store-p4-"));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("round-trips project rules per project", () => {
    const paths = resolveStorePaths(root);
    expect(readProjectRulesForProject(paths, PROJECT_ID)).toEqual([]);
    writeProjectRulesForProject(paths, PROJECT_ID, [rule]);
    expect(readProjectRulesForProject(paths, PROJECT_ID)).toEqual([rule]);
  });

  it("round-trips failed attempts per project", () => {
    const paths = resolveStorePaths(root);
    expect(readFailedAttemptsForProject(paths, PROJECT_ID)).toEqual([]);
    writeFailedAttemptsForProject(paths, PROJECT_ID, [failure]);
    expect(readFailedAttemptsForProject(paths, PROJECT_ID)).toEqual([failure]);
  });

  it("deletes the project-rules file when written empty", () => {
    const paths = resolveStorePaths(root);
    const filePath = join(paths.projectRulesDir, `${PROJECT_ID}.jsonl`);
    writeProjectRulesForProject(paths, PROJECT_ID, [rule]);
    expect(existsSync(filePath)).toBe(true);
    writeProjectRulesForProject(paths, PROJECT_ID, []);
    expect(existsSync(filePath)).toBe(false);
    expect(readProjectRulesForProject(paths, PROJECT_ID)).toEqual([]);
  });

  it("deletes the failed-attempts file when written empty", () => {
    const paths = resolveStorePaths(root);
    const filePath = join(paths.failedAttemptsDir, `${PROJECT_ID}.jsonl`);
    writeFailedAttemptsForProject(paths, PROJECT_ID, [failure]);
    expect(existsSync(filePath)).toBe(true);
    writeFailedAttemptsForProject(paths, PROJECT_ID, []);
    expect(existsSync(filePath)).toBe(false);
    expect(readFailedAttemptsForProject(paths, PROJECT_ID)).toEqual([]);
  });
});
