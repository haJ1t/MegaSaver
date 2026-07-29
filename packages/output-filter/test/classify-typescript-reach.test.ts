import { describe, expect, it } from "vitest";
import { classifyOutput, isConfidentClassification } from "../src/classify.js";

// B7: a bare `error TSxxxx:` mention is not evidence of tsc output. Only the
// positioned form (file(line,col): / file:line:col - error) or a tsc-ish
// command may route into the typescript compressor.

describe("classifyOutput — typescript over-reach (B7)", () => {
  it("a fetched issue page quoting an error is NOT confident typescript", () => {
    const page = [
      "# Bug: Cannot find name 'x' after upgrade",
      "",
      "Reporter says the build fails with `error TS2304: Cannot find name 'x'`.",
      "Maintainer asked for a repro. Long discussion follows with code samples,",
      "workarounds, and several more mentions like error TS2339 and error TS7006.",
    ].join("\n");
    const c = classifyOutput({ text: page, source: "fetch" });
    expect(isConfidentClassification(c)).toBe(false);
    expect(c.category).not.toBe("typescript");
  });

  it("loose mention alone stays below the confidence floor even with Found", () => {
    const c = classifyOutput({
      text: "docs: the compiler prints `error TS5023` then `Found 3 errors` in this example",
    });
    expect(isConfidentClassification(c)).toBe(false);
  });

  it("real positioned tsc output alone remains confident", () => {
    const c = classifyOutput({
      text: "src/a.ts(1,1): error TS2304: Cannot find name 'x'.\nFound 1 error in 1 file.",
    });
    expect(c.category).toBe("typescript");
    expect(isConfidentClassification(c)).toBe(true);
  });

  it("pretty positioned form alone remains confident", () => {
    const c = classifyOutput({
      text: "src/a.ts:10:5 - error TS2322: Type 'string' is not assignable to type 'number'.",
    });
    expect(c.category).toBe("typescript");
    expect(isConfidentClassification(c)).toBe(true);
  });

  it("a tsc command corroborates a loose-only output", () => {
    const c = classifyOutput({
      command: "pnpm typecheck",
      text: "error TS18002: no inputs were found.\nFound 1 error.",
    });
    expect(c.category).toBe("typescript");
    expect(isConfidentClassification(c)).toBe(true);
  });
});
