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
      "agents-md",
      "cursor-context",
      "cursor-conventions",
      "cursor-discipline",
    ]);
  });

  it("CONSUMERS paths map to the four real consumer files", () => {
    expect(CONSUMERS.map((c) => c.path)).toEqual([
      "AGENTS.md",
      ".cursor/rules/mega-context.mdc",
      ".cursor/rules/mega-conventions.mdc",
      ".cursor/rules/mega-discipline.mdc",
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
      "agents-md" | "cursor-context" | "cursor-conventions" | "cursor-discipline"
    >();
  });
});
