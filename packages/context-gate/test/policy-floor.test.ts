import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clampModeToFloor, readPolicyModeFloor } from "../src/policy-floor.js";

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "megasaver-policy-"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const writePolicy = (dir: string, body: string) => {
  mkdirSync(join(dir, ".megasaver"), { recursive: true });
  writeFileSync(join(dir, ".megasaver", "policy.json"), body);
};

describe("readPolicyModeFloor", () => {
  it("reads the floor from <dir>/.megasaver/policy.json", () => {
    writePolicy(root, JSON.stringify({ modeFloor: "balanced" }));
    expect(readPolicyModeFloor(root)).toBe("balanced");
  });
  it("walks up from a nested cwd", () => {
    writePolicy(root, JSON.stringify({ modeFloor: "safe" }));
    const nested = join(root, "packages", "core", "src");
    mkdirSync(nested, { recursive: true });
    expect(readPolicyModeFloor(nested)).toBe("safe");
  });
  it("no file -> null", () => {
    expect(readPolicyModeFloor(root)).toBeNull();
  });
  it("malformed JSON -> null (fail-open)", () => {
    writePolicy(root, "{not json");
    expect(readPolicyModeFloor(root)).toBeNull();
  });
  it("unknown keys / bad floor value -> null (strict schema, fail-open)", () => {
    writePolicy(root, JSON.stringify({ modeFloor: "aggressive" }));
    expect(readPolicyModeFloor(root)).toBeNull();
    writePolicy(root, JSON.stringify({ modeFloor: "balanced", extra: 1 }));
    expect(readPolicyModeFloor(root)).toBeNull();
  });
});

describe("clampModeToFloor", () => {
  it("clamps only below the floor", () => {
    expect(clampModeToFloor("aggressive", "balanced")).toBe("balanced");
    expect(clampModeToFloor("balanced", "balanced")).toBe("balanced");
    expect(clampModeToFloor("safe", "balanced")).toBe("safe");
    expect(clampModeToFloor("aggressive", "safe")).toBe("safe");
    expect(clampModeToFloor("balanced", "safe")).toBe("safe");
  });
});
