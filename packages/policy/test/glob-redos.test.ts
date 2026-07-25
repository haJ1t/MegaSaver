import { projectIdSchema } from "@megasaver/shared";
import { describe, expect, it } from "vitest";
import { type EvaluatePathReadResult, evaluatePathRead } from "../src/evaluate-path-read.js";
import { parseProjectPermissions } from "../src/parse-project-permissions.js";

const PROJECT = projectIdSchema.parse("11111111-1111-4111-8111-111111111111");

// Ceiling sits ~1000x below the pre-fix cost of these cases, so CI load cannot
// close the gap: an exponential is slow on every attempt. `retry` matches the
// convention established by the redact-jwt timing gates.
const CEILING_MS = 250;

function elapsed(run: () => void): number {
  const started = performance.now();
  run();
  return performance.now() - started;
}

describe("evaluatePathRead — hostile project glob cannot stall the gate", () => {
  // The exact shape from the report: nine `**/a` groups then `/x`. Pre-fix this
  // burns seconds inside .test() and then returns allowed:true — the gate
  // neither denies nor signals.
  const permissions = parseProjectPermissions({
    deny: { read: [`${"**/a".repeat(9)}/x`] },
  });

  it("denies a path the hostile glob matches, within the ceiling", { retry: 3 }, () => {
    const path = `${"a/".repeat(9)}x`;
    let result: EvaluatePathReadResult | undefined;
    const ms = elapsed(() => {
      result = evaluatePathRead({ path, project: PROJECT, permissions });
    });
    expect(result).toEqual({ allowed: false, reason: "secret_path_read" });
    expect(ms).toBeLessThan(CEILING_MS);
  });

  it("allows a non-matching path within the ceiling", { retry: 3 }, () => {
    const path = `${"a/".repeat(40)}b`;
    let result: EvaluatePathReadResult | undefined;
    const ms = elapsed(() => {
      result = evaluatePathRead({ path, project: PROJECT, permissions });
    });
    expect(result).toEqual({ allowed: true });
    expect(ms).toBeLessThan(CEILING_MS);
  });

  // The blowup is not specific to `**/`. A single-`*` chain explodes on an
  // ordinary 255-character filename, which is why a `**`-counting cap is
  // unsound.
  it("survives a single-`*` chain against a 255-char filename", { retry: 3 }, () => {
    const starChain = parseProjectPermissions({
      deny: { read: [`${"*a".repeat(5)}x`] },
    });
    const path = "a".repeat(255);
    const ms = elapsed(() => {
      evaluatePathRead({ path, project: PROJECT, permissions: starChain });
    });
    expect(ms).toBeLessThan(CEILING_MS);
  });
});

describe("compileGlob treats regex metacharacters as literals", () => {
  // Zero wildcards, so no wildcard-count cap could ever catch this one.
  it("a zero-wildcard regex-shaped glob is inert", { retry: 3 }, () => {
    const permissions = parseProjectPermissions({ deny: { read: ["(a+)+b"] } });
    const ms = elapsed(() => {
      evaluatePathRead({ path: "a".repeat(28), project: PROJECT, permissions });
    });
    expect(ms).toBeLessThan(CEILING_MS);
  });

  it("matches a literal filename containing regex metacharacters", () => {
    const permissions = parseProjectPermissions({ deny: { read: ["(a+)+b"] } });
    expect(evaluatePathRead({ path: "(a+)+b", project: PROJECT, permissions })).toEqual({
      allowed: false,
      reason: "secret_path_read",
    });
  });

  // Reachable with an ordinary filename — no crafted input needed. A deny rule
  // that silently does not deny is the same end state as the stall.
  const literalCases: ReadonlyArray<readonly [string, string]> = [
    ["**/a+b.txt", "x/a+b.txt"],
    ["**/file(1).txt", "x/file(1).txt"],
    ["**/[draft].md", "x/[draft].md"],
    ["**/report{2}.csv", "x/report{2}.csv"],
    ["**/a|b.log", "x/a|b.log"],
  ];

  for (const [glob, path] of literalCases) {
    it(`denies ${path} via ${glob}`, () => {
      const permissions = parseProjectPermissions({ deny: { read: [glob] } });
      expect(evaluatePathRead({ path, project: PROJECT, permissions })).toEqual({
        allowed: false,
        reason: "secret_path_read",
      });
    });
  }
});
