import { describe, expect, it } from "vitest";
import { runDietRules } from "../../src/prompt/coach.js";

describe("prompt coach", () => {
  it("detects repeated", () => {
    const p = `read src/a.ts src/a.ts src/a.ts ${"x".repeat(100)}`;
    expect(runDietRules(p)?.rule).toBe("repeated_mentions");
  });
  it("short prompt null", () => {
    expect(runDietRules("hi")).toBeNull();
  });
});
