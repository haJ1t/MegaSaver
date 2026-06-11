import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  failedAttemptIdSchema,
  projectIdSchema,
  projectRuleIdSchema,
  sessionIdSchema,
} from "@megasaver/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CoreRegistryError } from "../src/errors.js";
import { createJsonDirectoryCoreRegistry } from "../src/json-directory-registry.js";
import { type CoreRegistry, createInMemoryCoreRegistry } from "../src/registry.js";

const PROJECT_ID = projectIdSchema.parse("11111111-1111-4111-8111-111111111111");
const SECOND_PROJECT_ID = projectIdSchema.parse("33333333-3333-4333-8333-333333333333");
const RULE_ID = projectRuleIdSchema.parse("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
const FA_ID = failedAttemptIdSchema.parse("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
const SESSION_ID = sessionIdSchema.parse("22222222-2222-4222-8222-222222222222");
const TS = "2026-06-11T00:00:00.000Z";

const project = {
  id: PROJECT_ID,
  name: "demo",
  rootPath: "/tmp/demo",
  createdAt: TS,
  updatedAt: TS,
} as const;

const secondProject = {
  id: SECOND_PROJECT_ID,
  name: "demo2",
  rootPath: "/tmp/demo2",
  createdAt: TS,
  updatedAt: TS,
} as const;

const rule = {
  id: RULE_ID,
  projectId: PROJECT_ID,
  title: "r",
  rule: "do x",
  appliesTo: ["src/db/"],
  evidence: [],
  severity: "warning",
  confidence: "high",
  createdFrom: "manual",
  createdAt: TS,
  updatedAt: TS,
} as const;

const failure = {
  id: FA_ID,
  projectId: PROJECT_ID,
  sessionId: null,
  task: "t",
  failedStep: "s",
  relatedFiles: [],
  convertedToRule: false,
  createdAt: TS,
} as const;

function suite(name: string, make: () => CoreRegistry) {
  describe(`${name}: rules + failed attempts`, () => {
    it("creates, gets, and lists a project rule", () => {
      const r = make();
      r.createProject(project);
      expect(r.createProjectRule(rule)).toEqual(rule);
      expect(r.getProjectRule(RULE_ID)).toEqual(rule);
      expect(r.listProjectRules(PROJECT_ID)).toEqual([rule]);
    });

    it("rejects a duplicate rule id", () => {
      const r = make();
      r.createProject(project);
      r.createProjectRule(rule);
      expect(() => r.createProjectRule(rule)).toThrow(CoreRegistryError);
    });

    it("rejects a rule for an unknown project", () => {
      const r = make();
      expect(() => r.createProjectRule(rule)).toThrowError(/project_not_found|does not exist/);
    });

    it("returns null for a missing rule", () => {
      const r = make();
      r.createProject(project);
      expect(r.getProjectRule(RULE_ID)).toBeNull();
    });

    it("creates, gets, and lists a failed attempt", () => {
      const r = make();
      r.createProject(project);
      expect(r.createFailedAttempt(failure)).toEqual(failure);
      expect(r.getFailedAttempt(FA_ID)).toEqual(failure);
      expect(r.listFailedAttempts(PROJECT_ID)).toEqual([failure]);
    });

    it("validates the session on a session-scoped failed attempt", () => {
      const r = make();
      r.createProject(project);
      expect(() => r.createFailedAttempt({ ...failure, sessionId: SESSION_ID })).toThrowError(
        /session_not_found|does not exist/,
      );
    });

    it("rejects a rule whose id collides across projects", () => {
      const r = make();
      r.createProject(project);
      r.createProject(secondProject);
      r.createProjectRule(rule);
      expect(() => r.createProjectRule({ ...rule, projectId: SECOND_PROJECT_ID })).toThrowError(
        expect.objectContaining({ code: "project_rule_already_exists" }),
      );
    });

    it("rejects a failed attempt whose id collides across projects", () => {
      const r = make();
      r.createProject(project);
      r.createProject(secondProject);
      r.createFailedAttempt(failure);
      expect(() =>
        r.createFailedAttempt({ ...failure, projectId: SECOND_PROJECT_ID }),
      ).toThrowError(expect.objectContaining({ code: "failed_attempt_already_exists" }));
    });
  });
}

suite("in-memory", () => createInMemoryCoreRegistry());

describe("json-directory", () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "reg-p4-"));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });
  suite("json", () => createJsonDirectoryCoreRegistry({ rootDir: root }));
});
