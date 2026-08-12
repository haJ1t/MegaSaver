import { describe, expect, it } from "vitest";
import { normalizeClaimedPath } from "../src/commands/session/disclosure/normalize.js";
import { reconcileDisclosure } from "../src/commands/session/disclosure/reconcile.js";

describe("normalizeClaimedPath", () => {
  const CWD = "/Users/dev/repo";
  it("strips quotes, line:col suffixes, ./ and backslashes", () => {
    expect(normalizeClaimedPath("./src/a.ts:12:5", CWD)).toBe("src/a.ts");
    expect(normalizeClaimedPath('"src\\b.ts"', CWD)).toBe("src/b.ts");
  });
  it("relativizes cwd-absolute, drops foreign absolute and escapes", () => {
    expect(normalizeClaimedPath("/Users/dev/repo/src/a.ts", CWD)).toBe("src/a.ts");
    expect(normalizeClaimedPath("/etc/passwd", CWD)).toBeNull();
    expect(normalizeClaimedPath("../outside.ts", CWD)).toBeNull();
    expect(normalizeClaimedPath("C:/other/x.ts", CWD)).toBeNull();
  });
  it("drops secret-shaped candidates via redact", () => {
    const jwtish =
      "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U";
    expect(normalizeClaimedPath(`config/${jwtish}.pem`, CWD)).toBeNull();
  });
});

describe("reconcileDisclosure", () => {
  it("computes both diffs, sorted and deduped", () => {
    const report = reconcileDisclosure({
      claimed: ["src/b.ts", "src/a.ts", "src/a.ts", "docs/x.md"],
      observed: ["src/a.ts", "pnpm-lock.yaml", "src/c.ts"],
    });
    expect(report).toEqual({
      claimed: ["docs/x.md", "src/a.ts", "src/b.ts"],
      observed: ["pnpm-lock.yaml", "src/a.ts", "src/c.ts"],
      undisclosed: ["pnpm-lock.yaml", "src/c.ts"],
      phantom: ["docs/x.md", "src/b.ts"],
    });
  });
});
