import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { failedAttemptIdSchema, projectIdSchema } from "@megasaver/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CoreRegistryError } from "../src/errors.js";
import { createJsonDirectoryCoreRegistry } from "../src/json-directory-registry.js";
import { type CoreRegistry, createInMemoryCoreRegistry } from "../src/registry.js";

const PROJECT_ID = projectIdSchema.parse("11111111-1111-4111-8111-111111111111");
const FA_ID = failedAttemptIdSchema.parse("a0000000-0000-4000-8000-000000000001");
const TS = "2026-06-12T00:00:00.000Z";
const RULE_ID = "c0000000-0000-4000-8000-000000000001";

const project = { id: PROJECT_ID, name: "demo", rootPath: "/tmp/demo", createdAt: TS, updatedAt: TS } as const;
const failure = {
  id: FA_ID,
  projectId: PROJECT_ID,
  sessionId: null,
  task: "fix login bug",
  failedStep: "run auth tests",
  errorOutput: "401",
  relatedFiles: ["src/middleware/auth.ts"],
  convertedToRule: false,
  createdAt: TS,
} as const;
const clock = { now: () => TS, newId: () => RULE_ID };

function suite(name: string, make: () => CoreRegistry) {
  describe(`${name}: forge registry`, () => {
    it("updateFailedAttempt patches mutable fields", () => {
      const r = make();
      r.createProject(project);
      r.createFailedAttempt(failure);
      const updated = r.updateFailedAttempt(FA_ID, { resolution: "use <=" });
      expect(updated.resolution).toBe("use <=");
    });

    it("updateFailedAttempt throws on missing", () => {
      const r = make();
      expect(() => r.updateFailedAttempt(FA_ID, { resolution: "x" })).toThrowError(/failed_attempt_not_found|does not exist/);
    });

    it("searchFailedAttempts scopes to project and ranks by text", () => {
      const r = make();
      r.createProject(project);
      r.createFailedAttempt(failure);
      expect(r.searchFailedAttempts(PROJECT_ID, { text: "login auth" }).map((f) => f.id)).toEqual([FA_ID]);
    });

    it("convertFailureToRule creates a seeded rule and flips the failure (atomic)", () => {
      const r = make();
      r.createProject(project);
      r.createFailedAttempt(failure);
      const { rule, failure: flipped } = r.convertFailureToRule(
        FA_ID,
        { title: "Migrate first", rule: "create migration", severity: "warning" },
        clock,
      );
      expect(rule.createdFrom).toBe("failed_attempt");
      expect(rule.appliesTo).toEqual(["src/middleware/auth.ts"]); // defaulted from relatedFiles
      expect(rule.evidence.some((e) => e.includes(FA_ID))).toBe(true);
      expect(flipped.convertedToRule).toBe(true);
      expect(r.getProjectRule(rule.id as never)?.id).toBe(RULE_ID);
      expect(r.getFailedAttempt(FA_ID)?.convertedToRule).toBe(true);
    });

    it("convertFailureToRule rejects a double-convert", () => {
      const r = make();
      r.createProject(project);
      r.createFailedAttempt(failure);
      r.convertFailureToRule(FA_ID, { title: "t", rule: "r", severity: "info" }, clock);
      expect(() =>
        r.convertFailureToRule(FA_ID, { title: "t", rule: "r", severity: "info" }, { now: () => TS, newId: () => "c0000000-0000-4000-8000-000000000002" }),
      ).toThrowError(/failed_attempt_already_converted|already converted/);
    });

    it("convertFailureToRule throws on missing failure", () => {
      const r = make();
      r.createProject(project);
      expect(() => r.convertFailureToRule(FA_ID, { title: "t", rule: "r", severity: "info" }, clock)).toThrowError(/failed_attempt_not_found|does not exist/);
    });
  });
}

suite("in-memory", () => createInMemoryCoreRegistry());

describe("json-directory", () => {
  let root: string;
  beforeEach(() => { root = mkdtempSync(join(tmpdir(), "reg-p5-")); });
  afterEach(() => { rmSync(root, { recursive: true, force: true }); });
  suite("json", () => createJsonDirectoryCoreRegistry({ rootDir: root }));
});
