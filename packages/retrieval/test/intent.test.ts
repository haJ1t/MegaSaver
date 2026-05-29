import { describe, expect, it } from "vitest";
import { type DeriveIntentInput, deriveIntent } from "../src/intent.js";

describe("deriveIntent precedence (spec §12c)", () => {
  it("1) explicit: trimmed non-empty intent wins over everything", () => {
    const input: DeriveIntentInput = {
      intent: "  fix the auth bug  ",
      sessionTitle: "Session about logging",
      recentMemory: ["something else"],
      source: { kind: "file", path: "/a/b/c.ts" },
    };
    const result = deriveIntent(input);
    expect(result.source).toBe("explicit");
    expect(result.query).toBe("fix the auth bug");
    expect(result.keywords).toEqual(["fix", "the", "auth", "bug"]);
  });

  it("explicit: whitespace-only intent does not win", () => {
    const result = deriveIntent({ intent: "   ", sessionTitle: "Real Title" });
    expect(result.source).toBe("session-title");
  });

  it("2) session-title: used when no explicit intent", () => {
    const result = deriveIntent({
      sessionTitle: "Refactor Parser",
      recentMemory: ["older note"],
    });
    expect(result.source).toBe("session-title");
    expect(result.query).toBe("Refactor Parser");
    expect(result.keywords).toEqual(["refactor", "parser"]);
  });

  it("3) recent-memory: joins most-recent N=3 entries", () => {
    const result = deriveIntent({
      recentMemory: ["alpha", "beta", "gamma", "delta"],
    });
    expect(result.source).toBe("recent-memory");
    expect(result.keywords).toContain("alpha");
    expect(result.keywords).toContain("beta");
    expect(result.keywords).toContain("gamma");
    expect(result.keywords).not.toContain("delta");
  });

  it("4) command: command name + first arg", () => {
    const result = deriveIntent({
      source: { kind: "command", command: "git", args: ["status", "--short"] },
    });
    expect(result.source).toBe("command");
    expect(result.keywords).toContain("git");
    expect(result.keywords).toContain("status");
  });

  it("5) file-path: basename minus extension", () => {
    const result = deriveIntent({
      source: { kind: "file", path: "/src/auth/login-handler.ts" },
    });
    expect(result.source).toBe("file-path");
    expect(result.query).toContain("login-handler");
    expect(result.query).not.toContain(".ts");
  });

  it("6) auto: no signal yields empty query and keywords", () => {
    const result = deriveIntent({});
    expect(result.source).toBe("auto");
    expect(result.query).toBe("");
    expect(result.keywords).toEqual([]);
  });

  it("keywords are lowercased, deduped, empty tokens dropped", () => {
    const result = deriveIntent({ intent: "Cat cat DOG, cat!! dog" });
    expect(result.keywords).toEqual(["cat", "dog"]);
  });

  it("is deterministic for identical input", () => {
    const input: DeriveIntentInput = { intent: "deterministic query here" };
    expect(deriveIntent(input)).toEqual(deriveIntent(input));
  });
});
