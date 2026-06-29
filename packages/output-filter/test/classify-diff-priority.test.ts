import { describe, expect, it } from "vitest";
import { classifyOutput } from "../src/classify.js";

// A real git diff whose body happens to contain `error TS####` text (e.g. a
// diff that adds a tsc-diagnostic test fixture) must classify as `diff`, not
// `typescript` — the `diff --git`/`@@` structural anchor is unambiguous.
const DIFF_WITH_TS_TEXT = [
  "diff --git a/x.test.ts b/x.test.ts",
  "index 1111111..2222222 100644",
  "--- a/x.test.ts",
  "+++ b/x.test.ts",
  "@@ -1,3 +1,4 @@",
  ' const sample = "src/a.ts(3,5): error TS2345: bad";',
  '+const more = "error TS1006: another";',
  " export const ok = true;",
  " // Found 2 errors.",
].join("\n");

// Genuine tsc compiler output (no diff anchor) must still classify typescript.
const REAL_TSC = [
  "src/a.ts(3,5): error TS2345: Argument of type 'string'.",
  "src/b.ts(10,1): error TS1006: A type expected.",
  "Found 2 errors.",
].join("\n");

describe("classify diff vs typescript priority", () => {
  it("classifies a git diff containing error-TS text as diff, not typescript", () => {
    const c = classifyOutput({ command: "git diff", text: DIFF_WITH_TS_TEXT });
    expect(c.category).toBe("diff");
  });

  it("classifies a diff body anchor as diff even with no command", () => {
    const c = classifyOutput({ text: DIFF_WITH_TS_TEXT });
    expect(c.category).toBe("diff");
  });

  it("still classifies real tsc output as typescript", () => {
    const c = classifyOutput({ command: "tsc", text: REAL_TSC });
    expect(c.category).toBe("typescript");
  });

  it("still classifies tsc output without a command as typescript", () => {
    const c = classifyOutput({ text: REAL_TSC });
    expect(c.category).toBe("typescript");
  });
});
