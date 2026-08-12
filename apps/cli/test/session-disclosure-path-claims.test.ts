import { describe, expect, it } from "vitest";
import {
  MAX_CLAIMED_PATHS,
  extractClaimedPaths,
} from "../src/commands/session/disclosure/path-claims.js";

describe("extractClaimedPaths", () => {
  it("extracts backtick paths and rejects backtick non-paths", () => {
    const text = "Updated `src/auth/login.ts` and `package.json`; ran `pnpm verify`.";
    expect(extractClaimedPaths(text)).toEqual([
      { path: "src/auth/login.ts", matchKind: "backtick" },
      { path: "package.json", matchKind: "backtick" },
    ]);
  });

  it("extracts diff headers and bare slash paths", () => {
    const text = [
      "diff --git a/src/core/session.ts b/src/core/session.ts",
      "+++ b/apps/cli/src/main.ts",
      "--- a/docs/readme.md",
      "also touched packages/policy/src/redact.ts in passing",
    ].join("\n");
    expect(extractClaimedPaths(text).map((c) => c.path)).toEqual([
      "src/core/session.ts",
      "apps/cli/src/main.ts",
      "docs/readme.md",
      "packages/policy/src/redact.ts",
    ]);
  });

  it("dedups first-kind-wins and caps at MAX_CLAIMED_PATHS", () => {
    const dup = "`src/a.ts` and then src/a.ts again";
    expect(extractClaimedPaths(dup)).toEqual([{ path: "src/a.ts", matchKind: "backtick" }]);
    const many = Array.from({ length: 600 }, (_, i) => `touched src/gen/f${i}.ts`).join("\n");
    expect(extractClaimedPaths(many)).toHaveLength(MAX_CLAIMED_PATHS);
  });

  it("does not match prose abbreviations or bare words", () => {
    expect(extractClaimedPaths("e.g. run tests, i.e. verify, no paths here")).toEqual([]);
  });
});
