// Unit tests for Policy PreToolUse Airlock Gate
import type { ProjectId } from "@megasaver/shared";
import { describe, expect, it } from "vitest";
import { evaluateCommand } from "../src/evaluate-command.js";

const PROJECT = "proj-1" as ProjectId;

describe("evaluateCommand with airlock rules", () => {
  it("allows command when no matching airlock rule exists", () => {
    const res = evaluateCommand({
      command: "grep",
      args: ["search", "package.json"],
      project: PROJECT,
      airlockRules: [
        {
          forbiddenPattern: "grep .*--output-format",
          reason: "unexpected argument '--output-format'",
        },
      ],
    });
    expect(res.allowed).toBe(true);
  });

  it("denies command matching a transient airlock negative rule", () => {
    const res = evaluateCommand({
      command: "grep",
      args: ["--output-format", "json", "package.json"],
      project: PROJECT,
      airlockRules: [
        {
          forbiddenPattern: "grep .*--output-format",
          reason: "unexpected argument '--output-format'",
        },
      ],
    });
    expect(res.allowed).toBe(false);
    if (!res.allowed) {
      expect(res.reason).toBe("command_not_allowed");
    }
  });
});

describe("evaluateCommand TTL", () => {
  it("expired airlock rule does not block", () => {
    const now = Date.now();
    const res = evaluateCommand({
      command: "grep",
      args: ["--bad", "x"],
      project: PROJECT,
      airlockRules: [
        {
          forbiddenPattern: "^grep(?:\\s+.*)?--bad(?:\\b|$)",
          reason: "x",
          ruleId: "a",
          sessionId: "s1",
          toolName: "grep",
          createdAt: new Date(now - 7200 * 1000).toISOString(),
          ttlSeconds: 3600,
        },
      ],
      now,
    } as unknown as import("../src/evaluate-command.js").EvaluateCommandInput);
    expect(res.allowed).toBe(true);
  });
  it("broken regex does not throw and does not block", () => {
    const res = evaluateCommand({
      command: "grep",
      args: ["--bad"],
      project: PROJECT,
      airlockRules: [{ forbiddenPattern: "[bad", reason: "x" }],
    } as unknown as import("../src/evaluate-command.js").EvaluateCommandInput);
    expect(res.allowed).toBe(true);
  });
  it("escaped anchored pattern blocks only with word boundary", () => {
    const pat = "^grep(?:\\s+.*)?--bad(?:\\b|$)";
    const blocked = evaluateCommand({
      command: "grep",
      args: ["--bad", "x"],
      project: PROJECT,
      airlockRules: [{ forbiddenPattern: pat, reason: "x" }],
    } as unknown as import("../src/evaluate-command.js").EvaluateCommandInput);
    const allowed = evaluateCommand({
      command: "grep",
      args: ["--badness", "x"],
      project: PROJECT,
      airlockRules: [{ forbiddenPattern: pat, reason: "x" }],
    } as unknown as import("../src/evaluate-command.js").EvaluateCommandInput);
    expect(blocked.allowed).toBe(false);
    expect(allowed.allowed).toBe(true);
  });
});
