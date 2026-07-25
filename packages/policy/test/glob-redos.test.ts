import { projectIdSchema } from "@megasaver/shared";
import { describe, expect, it } from "vitest";
import { type EvaluatePathReadResult, evaluatePathRead } from "../src/evaluate-path-read.js";
import { PolicyLoadError, parseProjectPermissions } from "../src/parse-project-permissions.js";

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
    let result: EvaluatePathReadResult | undefined;
    const ms = elapsed(() => {
      result = evaluatePathRead({ path, project: PROJECT, permissions: starChain });
    });
    // Asserting the verdict too: a timing-only test passes against a matcher
    // whose test() is `() => false`, which is the same silent fail-open the
    // stall produces. `*a`x5 + "x" needs a trailing x; this path is all 'a'.
    expect(result).toEqual({ allowed: true });
    expect(ms).toBeLessThan(CEILING_MS);
  });
});

describe("compileGlob treats regex metacharacters as literals", () => {
  // Zero wildcards, so no wildcard-count cap could ever catch this one.
  it("a zero-wildcard regex-shaped glob is inert", { retry: 3 }, () => {
    const permissions = parseProjectPermissions({ deny: { read: ["(a+)+b"] } });
    let result: EvaluatePathReadResult | undefined;
    const ms = elapsed(() => {
      result = evaluatePathRead({ path: "a".repeat(28), project: PROJECT, permissions });
    });
    // "inert" is the actual claim, so assert it: as a literal filename the glob
    // matches nothing here. Without this the test passes on a dead matcher.
    expect(result).toEqual({ allowed: true });
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
    ["**/report{2}.csv", "x/report{2}.csv"],
    ["**/a|b.log", "x/a|b.log"],
    ["**/dollar$.txt", "x/dollar$.txt"],
    ["**/caret^.txt", "x/caret^.txt"],
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

describe("parseProjectPermissions — fail closed on globs the matcher cannot bound", () => {
  it("rejects a glob longer than the cap rather than matching it slowly", () => {
    expect(() =>
      parseProjectPermissions({ deny: { read: ["*".repeat(257)] } }),
    ).toThrow(PolicyLoadError);
  });

  it("accepts a glob exactly at the cap", () => {
    const permissions = parseProjectPermissions({
      deny: { read: [`${"a".repeat(255)}*`] },
    });
    expect(permissions.denyReadPatterns).toHaveLength(1);
  });

  it("rejects more globs than the cap", () => {
    expect(() =>
      parseProjectPermissions({ deny: { read: new Array(257).fill("*.pem") } }),
    ).toThrow(PolicyLoadError);
  });

  // Bracket expressions ARE glob syntax and the previous regex-backed matcher
  // honoured them. Reading them as literals would narrow the deny set with no
  // signal, so they are refused outright — fail closed, not fail quiet.
  const brackets = ["**/[sS]ecrets/**", "**/*.[pk]em", "**/id_rsa[0-9]", "**/a]b"];
  for (const glob of brackets) {
    it(`rejects the bracket glob ${glob}`, () => {
      expect(() => parseProjectPermissions({ deny: { read: [glob] } })).toThrow(
        PolicyLoadError,
      );
    });
  }
});

// Found by the security review, not by the original report: on the previous
// implementation every `**/`-prefixed glob compiled to `(?:.*/)?`, and `.` in a
// non-`s`-flag JS regex does not match a line terminator. A path carrying one in
// a directory segment therefore slipped 13 of the 15 LOCKED entries. These are
// legal POSIX filename bytes. The NFA matcher has no such carve-out; pinned here
// so a future rewrite cannot quietly reopen it.
describe("evaluatePathRead — line terminators in a path segment cannot bypass the denylist", () => {
  const terminators: ReadonlyArray<readonly [string, string]> = [
    ["\\n", "home\nx/id_rsa"],
    ["\\r", "home\rx/.ssh/key"],
    ["U+2028", "home x/credentials.json"],
    ["U+2029", "home x/server.pem"],
  ];

  for (const [label, path] of terminators) {
    it(`denies a path containing ${label}`, () => {
      expect(evaluatePathRead({ path, project: PROJECT })).toEqual({
        allowed: false,
        reason: "secret_path_read",
      });
    });
  }
});
