import { describe, expect, it } from "vitest";
import { runDietRules } from "../../src/prompt/coach.js";

describe("runDietRules", () => {
  it("repeated mentions fires", () => {
    const prompt = "read src/a.ts and src/a.ts and src/a.ts please ".repeat(10) + "x".repeat(100);
    const res = runDietRules(prompt);
    expect(res?.rule).toBe("repeated_mentions");
  });

  it("scaffolding fires", () => {
    const prompt = "please kindly could you please " + "x".repeat(200);
    const res = runDietRules(prompt);
    expect(res?.rule).toBe("scaffolding");
  });

  it("short prompt no suggestion", () => {
    expect(runDietRules("hi")).toBeNull();
  });

  it("pasted error fires", () => {
    const prompt = "error " + "at foo (src/a.ts:10:5)\n".repeat(20) + "x".repeat(500);
    const res = runDietRules(prompt);
    expect(res?.rule).toBe("pasted_error");
  });
});
