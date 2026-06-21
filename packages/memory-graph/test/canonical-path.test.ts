import { describe, expect, it } from "vitest";
import { canonicalizeFilePath } from "../src/canonical-path.js";

describe("canonicalizeFilePath", () => {
  it("strips wrapping backticks", () => {
    expect(canonicalizeFilePath("`src/x.ts`")).toBe("src/x.ts");
  });
  it("strips wrapping single and double quotes", () => {
    expect(canonicalizeFilePath("'src/x.ts'")).toBe("src/x.ts");
    expect(canonicalizeFilePath('"src/x.ts"')).toBe("src/x.ts");
  });
  it("strips a :line suffix", () => {
    expect(canonicalizeFilePath("src/x.ts:12")).toBe("src/x.ts");
  });
  it("strips a :start-end range (ASCII hyphen and en-dash)", () => {
    expect(canonicalizeFilePath("src/x.ts:25-72")).toBe("src/x.ts");
    expect(canonicalizeFilePath("src/x.ts:25–72")).toBe("src/x.ts");
  });
  it("strips a single leading ./", () => {
    expect(canonicalizeFilePath("./src/x.ts")).toBe("src/x.ts");
  });
  it("composes backtick + :line + leading ./", () => {
    expect(canonicalizeFilePath("`./src/x.ts:12`")).toBe("src/x.ts");
  });
  it("leaves an already-canonical path unchanged", () => {
    expect(canonicalizeFilePath("src/x.ts")).toBe("src/x.ts");
  });
});
