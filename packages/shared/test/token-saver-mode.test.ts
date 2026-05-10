import { describe, expect, it } from "vitest";
import {
  type TokenSaverMode,
  modeToBudget,
  tokenSaverModeSchema,
} from "../src/token-saver-mode.js";

describe("tokenSaverModeSchema", () => {
  it("parses 'aggressive'", () => {
    expect(tokenSaverModeSchema.parse("aggressive")).toBe("aggressive");
  });

  it("parses 'balanced'", () => {
    expect(tokenSaverModeSchema.parse("balanced")).toBe("balanced");
  });

  it("parses 'safe'", () => {
    expect(tokenSaverModeSchema.parse("safe")).toBe("safe");
  });

  it("rejects an unknown mode literal", () => {
    expect(tokenSaverModeSchema.safeParse("yolo").success).toBe(false);
  });

  it("rejects the empty string", () => {
    expect(tokenSaverModeSchema.safeParse("").success).toBe(false);
  });

  it("rejects a non-string value", () => {
    expect(tokenSaverModeSchema.safeParse(42).success).toBe(false);
  });

  it("exposes options in AA3 alphabetic order", () => {
    expect(tokenSaverModeSchema.options).toEqual(["aggressive", "balanced", "safe"]);
  });
});

describe("modeToBudget", () => {
  it("maps 'aggressive' to 4_000 bytes", () => {
    expect(modeToBudget("aggressive")).toBe(4_000);
  });

  it("maps 'balanced' to 12_000 bytes", () => {
    expect(modeToBudget("balanced")).toBe(12_000);
  });

  it("maps 'safe' to 32_000 bytes", () => {
    expect(modeToBudget("safe")).toBe(32_000);
  });

  it("returns a strictly monotonic non-decreasing budget across alphabetic order", () => {
    const ordered: TokenSaverMode[] = [...tokenSaverModeSchema.options];
    const budgets = ordered.map((mode) => modeToBudget(mode));
    for (let i = 1; i < budgets.length; i += 1) {
      // budgets[0]=4000, budgets[1]=12000, budgets[2]=32000 — strictly increasing.
      expect(budgets[i]).toBeGreaterThan(budgets[i - 1] ?? 0);
    }
  });
});
