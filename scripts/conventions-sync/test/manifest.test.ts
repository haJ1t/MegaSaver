import { describe, expect, expectTypeOf, it } from "vitest";
import {
  CONSUMERS,
  CONSUMER_IDS,
  type ConsumerId,
  MODES,
  type Mode,
  isConsumerId,
  isMode,
} from "../src/manifest.ts";

describe("manifest MODES", () => {
  it("MODES is tuple in canonical order", () => {
    expect(MODES).toEqual(["check", "write", "list"]);
  });

  it("isMode narrows known values", () => {
    expect(isMode("check")).toBe(true);
    expect(isMode("write")).toBe(true);
    expect(isMode("list")).toBe(true);
    expect(isMode("nope")).toBe(false);
    expect(isMode("")).toBe(false);
  });

  it("Mode resolves to the closed union", () => {
    expectTypeOf<Mode>().toEqualTypeOf<"check" | "write" | "list">();
  });
});

describe("manifest CONSUMERS", () => {
  it("CONSUMER_IDS derives from CONSUMERS in launch order", () => {
    expect(CONSUMER_IDS).toEqual(CONSUMERS.map((c) => c.id));
  });

  it("CONSUMERS launch-order is frozen", () => {
    expect(CONSUMERS.map((c) => c.id)).toEqual([
      "claude-md",
      "agents-md",
      "cursor-context",
      "cursor-conventions",
      "cursor-discipline",
    ]);
  });

  it("CONSUMERS paths map to the five real consumer files", () => {
    expect(CONSUMERS.map((c) => c.path)).toEqual([
      "CLAUDE.md",
      "AGENTS.md",
      ".cursor/rules/mega-context.mdc",
      ".cursor/rules/mega-conventions.mdc",
      ".cursor/rules/mega-discipline.mdc",
    ]);
  });

  it("claude-md consumer declares the 14 §0–§13 blocks in document order", () => {
    const claude = CONSUMERS.find((c) => c.id === "claude-md");
    expect(claude?.path).toBe("CLAUDE.md");
    expect(claude?.blocks.map((b) => b.id)).toEqual([
      "wiki-first",
      "mission",
      "repo-layout",
      "stack-and-commands",
      "process-discipline",
      "skill-routing",
      "agent-routing",
      "multi-agent-dogfood",
      "code-conventions",
      "definition-of-done",
      "git-and-commits",
      "language",
      "risk-modes",
      "anti-patterns",
    ]);
    expect(claude?.blocks.map((b) => b.source)).toEqual([
      "wiki-first.md",
      "mission.md",
      "repo-layout.md",
      "stack-and-commands.md",
      "process-discipline.md",
      "skill-routing.md",
      "agent-routing.md",
      "multi-agent-dogfood.md",
      "code-conventions.md",
      "definition-of-done.md",
      "git-and-commits.md",
      "language.md",
      "risk-modes.md",
      "anti-patterns.md",
    ]);
  });

  it("every block references a non-empty source path", () => {
    for (const c of CONSUMERS) {
      for (const b of c.blocks) {
        expect(b.id.length).toBeGreaterThan(0);
        expect(b.source).toMatch(/\.md$/);
      }
    }
  });

  it("isConsumerId narrows known ids", () => {
    expect(isConsumerId("agents-md")).toBe(true);
    expect(isConsumerId("cursor-context")).toBe(true);
    expect(isConsumerId("nope")).toBe(false);
  });

  it("ConsumerId resolves to the closed union", () => {
    expectTypeOf<ConsumerId>().toEqualTypeOf<
      "claude-md" | "agents-md" | "cursor-context" | "cursor-conventions" | "cursor-discipline"
    >();
  });
});
