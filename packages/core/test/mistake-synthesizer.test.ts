// Unit tests for MistakeSynthesizer (Instant Tool Failure Airlock)
import { describe, expect, it } from "vitest";
import { escapeRegExp, synthesizeMistakeRule } from "../src/mistake-synthesizer.js";

describe("synthesizeMistakeRule", () => {
  it("returns null when command succeeded without error", () => {
    const rule = synthesizeMistakeRule({
      sessionId: "sess-1",
      toolName: "rg",
      rawCommand: "rg search src/",
      exitCode: 0,
      stderr: "",
    });
    expect(rule).toBeNull();
  });

  it("synthesizes a negative rule when stderr contains an unrecognized option", () => {
    const rule = synthesizeMistakeRule({
      sessionId: "sess-1",
      toolName: "rg",
      rawCommand: "rg --output-format json pattern",
      exitCode: 2,
      stderr: "error: unexpected argument '--output-format' found\n",
    });

    expect(rule).not.toBeNull();
    expect(rule?.toolName).toBe("rg");
    expect(rule?.forbiddenPattern).toContain("--output-format");
    expect(rule?.reason).toContain("unexpected argument");
  });

  it("synthesizes a negative rule for unknown flag format", () => {
    const rule = synthesizeMistakeRule({
      sessionId: "sess-2",
      toolName: "git",
      rawCommand: "git status --unknown-flag",
      exitCode: 128,
      stderr: "error: unknown option `unknown-flag'\n",
    });

    expect(rule).not.toBeNull();
    expect(rule?.forbiddenPattern).toContain("unknown-flag");
  });

  it("escapes regex metachars in flag", () => {
    const rule = synthesizeMistakeRule({
      sessionId: "s1",
      toolName: "rg",
      rawCommand: "rg --a+b",
      exitCode: 2,
      stderr: "error: unexpected argument '--a+b' found",
    });
    expect(rule).not.toBeNull();
    expect(rule!.forbiddenPattern).toContain("\\+");
    expect(() => new RegExp(rule!.forbiddenPattern, "i")).not.toThrow();
  });
  it("pattern is anchored ^tool and ends with word boundary", () => {
    const rule = synthesizeMistakeRule({
      sessionId: "s1",
      toolName: "rg",
      rawCommand: "rg --bad",
      exitCode: 2,
      stderr: "error: unexpected argument '--bad' found",
    });
    expect(rule!.forbiddenPattern.startsWith("^rg")).toBe(true);
    expect(rule!.forbiddenPattern).toMatch(/\\b\|\$/);
  });
  it("escapeRegExp escapes all metachars", () => {
    expect(escapeRegExp("a+b*c")).toBe("a\\+b\\*c");
  });
});
