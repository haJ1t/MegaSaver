# `compileGlob` Catastrophic Backtracking Fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bound `compileGlob` by refusing to compile globs with more than three crossing quantifiers, so a short pathological glob can no longer hang the policy denylist or `mega context`.

**Architecture:** A counter local to `compileGlob` increments at the two emit sites that can cross `/` (`(?:.*/)?` and `.*`) and throws `GlobCompileError` before `new RegExp` when the count exceeds 3. The `body` string is not touched, so any glob that still compiles produces a **byte-identical** `RegExp` to today's — proven mechanically by a fast-check differential property against a frozen copy of the pre-fix function. The two consumers then take deliberately opposite failure semantics: `parseProjectPermissions` rethrows as `PolicyLoadError` (fail closed), `rankApplicableRules` returns `false` (degrade).

**Tech Stack:** TypeScript strict ESM, vitest, fast-check (already a `packages/policy` devDependency), biome, pnpm workspaces, changesets.

**Spec:** `docs/superpowers/specs/2026-07-25-glob-compile-redos-fix-design.md` — risk **HIGH** (§12: policy denylist core path). Reviewer passes required before merge: `code-reviewer` AND `critic` AND `security-reviewer`.

**Execution context:** worktree `.worktrees/glob-redos` on branch `fix/glob-compile-redos`, created by Task 1. All commands run from the worktree root. Task order is dependency order: 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8.

**Note on the red proof (Task 2):** `packages/policy/vitest.config.ts` already sets `testTimeout: 30_000`. In the red state the pathological match runs for minutes, so the red proof fails as a **30-second timeout**, not an assertion message. That is the expected red — do not "fix" it by shortening the subject.

---

## Task 1: Worktree

**Files:** none (repo setup)

- [ ] **Step 1: Create the worktree and branch**

```bash
git worktree add .worktrees/glob-redos -b fix/glob-compile-redos
```

- [ ] **Step 2: Verify you are on the branch and the tree is clean**

```bash
git -C .worktrees/glob-redos status --short --branch
```

Expected: `## fix/glob-compile-redos` and no modified files.

- [ ] **Step 3: Install and build the workspace inside the worktree**

```bash
cd .worktrees/glob-redos && pnpm install && pnpm build
```

Expected: build succeeds; `packages/policy/dist/index.js` exists.

---

## Task 2: Red proof — the blowup

**Files:**
- Create: `packages/policy/test/compile-glob.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { GlobCompileError, compileGlob } from "../src/secret-paths.js";

// A short, realistic, NON-matching subject. Non-matching is the case that
// backtracks, and it is the common case in project-rule ranking.
const SUBJECT = "packages/core/src/project-rule-ranking.ts";

// Each of these measured >12s against SUBJECT before the cap. Their glob
// lengths (41, 37, 19) are the point: length is not the governing variable,
// the count of crossing quantifiers is.
const PATHOLOGICAL: readonly { name: string; glob: string }[] = [
  { name: "alternating (?:.*/)? and .*", glob: `${"**/**".repeat(8)}x` },
  { name: "crossing quantifiers split by [^/]", glob: `${"**?".repeat(12)}x` },
  { name: "adjacent .* run", glob: `${"*".repeat(18)}x` },
];

describe("compileGlob — pathological globs are refused, not run (§6.1)", () => {
  for (const { name, glob } of PATHOLOGICAL) {
    it(`refuses ${name} (len ${glob.length}) fast`, () => {
      const started = performance.now();
      expect(() => compileGlob(glob).test(SUBJECT)).toThrow(GlobCompileError);
      // The throw alone would not prove the blowup is gone: assert the whole
      // compile+match path returns within a budget far below the old runtime.
      expect(performance.now() - started).toBeLessThan(100);
    });
  }
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm --filter @megasaver/policy exec vitest run test/compile-glob.test.ts
```

Expected: FAIL. The import of `GlobCompileError` fails to resolve first (`SyntaxError: The requested module '../src/secret-paths.js' does not provide an export named 'GlobCompileError'`). That is the correct first red.

---

## Task 3: The cap

**Files:**
- Modify: `packages/policy/src/secret-paths.ts:26-55`
- Modify: `packages/policy/src/index.ts:26`

- [ ] **Step 1: Add the constant and the error class above `compileGlob`**

Insert immediately before the existing `compileGlob` definition in `packages/policy/src/secret-paths.ts`:

```ts
// Crossing quantifiers — `(?:.*/)?` and `.*` — can span `/`, so N of them in
// one pattern make a FAILING match explore ~C(m+N-1, N-1) partitions of an
// m-char subject. Measured worst case per count across adversarial shapes and
// 41/128/256-char subjects: 1→0.37ms, 2→1.34ms, 3→57ms, 4→252ms, 5→unbounded
// (>10s). Every DENYLIST_GLOBS entry needs at most 2, so 3 leaves one slot of
// headroom and still admits `**/a/**/b/**`. `[^/]*` is deliberately NOT counted:
// it cannot cross `/`, the scanner never emits two adjacently, and 32 of them
// measure 0.10ms.
const MAX_CROSSING_QUANTIFIERS = 3;

export class GlobCompileError extends Error {
  readonly glob: string;
  readonly crossingQuantifiers: number;

  constructor(glob: string, crossingQuantifiers: number) {
    super(
      `Glob has ${crossingQuantifiers} crossing quantifiers (max ${MAX_CROSSING_QUANTIFIERS}): ${glob}`,
    );
    this.name = "GlobCompileError";
    this.glob = glob;
    this.crossingQuantifiers = crossingQuantifiers;
  }
}
```

- [ ] **Step 2: Add the counter to `compileGlob`**

Replace the body of `compileGlob` with the version below. Only three lines
change: `let crossing = 0;`, `crossing += 1;`, and the throw. **The `body`
string is built exactly as before** — that is what makes an accepted glob
compile byte-identically.

```ts
export function compileGlob(glob: string): RegExp {
  let body = "";
  let crossing = 0;
  for (let i = 0; i < glob.length; i += 1) {
    const char = glob[i];
    if (char === "*") {
      if (glob[i + 1] === "*") {
        crossing += 1;
        // `**/` matches zero-or-more leading segments (standard glob
        // semantics), so a root-level secret file (`.env`, `id_rsa`)
        // is denied, not just a directory-prefixed one. A bare `**`
        // not followed by `/` still maps to `.*`.
        if (glob[i + 2] === "/") {
          body += "(?:.*/)?";
          i += 2;
        } else {
          body += ".*";
          i += 1;
        }
      } else {
        body += "[^/]*";
      }
    } else if (char === "?") {
      body += "[^/]";
    } else if (char === ".") {
      body += "\\.";
    } else {
      body += char;
    }
  }
  if (crossing > MAX_CROSSING_QUANTIFIERS) {
    throw new GlobCompileError(glob, crossing);
  }
  return new RegExp(`^${body}$`, "i");
}
```

- [ ] **Step 3: Export the error from the package entry**

In `packages/policy/src/index.ts`, replace line 26:

```ts
export { compileGlob } from "./secret-paths.js";
```

with:

```ts
export { compileGlob, GlobCompileError } from "./secret-paths.js";
```

- [ ] **Step 4: Run the red proof to verify it passes**

```bash
pnpm --filter @megasaver/policy exec vitest run test/compile-glob.test.ts
```

Expected: PASS, 3 tests, completing in well under a second.

- [ ] **Step 5: Commit**

```bash
git add packages/policy/src/secret-paths.ts packages/policy/src/index.ts packages/policy/test/compile-glob.test.ts
git commit -m "fix(policy): bound compileGlob crossing quantifiers

A 17-char glob cost 3s and a 19-char glob did not terminate: N crossing
quantifiers make a failing match explore ~C(m+N-1, N-1) partitions. Cap the
count at 3 rather than rewriting the matcher, so every accepted glob still
compiles to a byte-identical RegExp and a denylist bypass stays impossible
by construction."
```

---

## Task 4: Boundary and shipped-denylist tests

**Files:**
- Modify: `packages/policy/test/compile-glob.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `packages/policy/test/compile-glob.test.ts`:

```ts
import { SECRET_PATH_PATTERNS } from "../src/secret-paths.js";

describe("compileGlob — cap boundary (§6.3)", () => {
  it("accepts exactly 3 crossing quantifiers", () => {
    expect(() => compileGlob("**/**/**/x")).not.toThrow();
  });

  it("rejects 4 crossing quantifiers", () => {
    expect(() => compileGlob("**/**/**/**/x")).toThrow(GlobCompileError);
  });

  it("reports the observed count on the error", () => {
    try {
      compileGlob("**/**/**/**/x");
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(GlobCompileError);
      expect((error as GlobCompileError).crossingQuantifiers).toBe(4);
    }
  });

  it("does not count `*` — segment-bounded globs of any depth compile", () => {
    expect(() => compileGlob("src/*/*/*/*.ts")).not.toThrow();
    expect(() => compileGlob(`${"*/".repeat(32)}*x`)).not.toThrow();
  });

  it("does not count `?`", () => {
    expect(() => compileGlob(`${"?".repeat(64)}x`)).not.toThrow();
  });
});

describe("SECRET_PATH_PATTERNS — shipped denylist stays under the cap (§6.2)", () => {
  // SECRET_PATH_PATTERNS is built at module load. Without this test, adding a
  // 4-crossing-quantifier entry to DENYLIST_GLOBS would fail at IMPORT time in
  // production rather than here.
  it("every shipped pattern compiled", () => {
    expect(SECRET_PATH_PATTERNS).toHaveLength(15);
    for (const pattern of SECRET_PATH_PATTERNS) {
      expect(pattern).toBeInstanceOf(RegExp);
    }
  });

  it("still denies the paths it is there to deny", () => {
    const denied = (p: string) => SECRET_PATH_PATTERNS.some((re) => re.test(p));
    expect(denied(".env")).toBe(true);
    expect(denied("srv/app/.env.production")).toBe(true);
    expect(denied("home/u/.ssh/id_rsa")).toBe(true);
    expect(denied("a/b/c/service-account-prod.json")).toBe(true);
    expect(denied("packages/core/src/index.ts")).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they pass**

```bash
pnpm --filter @megasaver/policy exec vitest run test/compile-glob.test.ts
```

Expected: PASS, 10 tests. (These are green immediately — they pin behaviour the
cap must not break, and would have gone red on a wrong cap or a miscount.)

- [ ] **Step 3: Commit**

```bash
git add packages/policy/test/compile-glob.test.ts
git commit -m "test(policy): pin compileGlob cap boundary and shipped denylist"
```

---

## Task 5: Differential property — zero semantic drift

**Files:**
- Create: `packages/policy/test/compile-glob.property.test.ts`

This is the security-critical test. It converts the spec's central claim —
"every accepted glob compiles exactly as before" — from an argument into a
measurement.

- [ ] **Step 1: Write the test**

```ts
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { GlobCompileError, compileGlob } from "../src/secret-paths.js";

// Frozen byte-for-byte copy of compileGlob as it stood BEFORE the cap
// (packages/policy/src/secret-paths.ts @ 61efb28b). Do not refactor or
// "tidy" this: its only job is to be the pre-fix oracle.
function compileGlobPreFix(glob: string): RegExp {
  let body = "";
  for (let i = 0; i < glob.length; i += 1) {
    const char = glob[i];
    if (char === "*") {
      if (glob[i + 1] === "*") {
        if (glob[i + 2] === "/") {
          body += "(?:.*/)?";
          i += 2;
        } else {
          body += ".*";
          i += 1;
        }
      } else {
        body += "[^/]*";
      }
    } else if (char === "?") {
      body += "[^/]";
    } else if (char === ".") {
      body += "\\.";
    } else {
      body += char;
    }
  }
  return new RegExp(`^${body}$`, "i");
}

const GLOB_CHARS = ["*", "?", "/", ".", "a", "b", "-", "_"];

const globArb = fc.string({
  minLength: 0,
  maxLength: 24,
  unit: fc.constantFrom(...GLOB_CHARS),
});

describe("compileGlob — accepted globs are unchanged by the cap (§6.6)", () => {
  it("compiles byte-identically to the pre-fix implementation", () => {
    fc.assert(
      fc.property(globArb, (glob) => {
        let compiled: RegExp;
        try {
          compiled = compileGlob(glob);
        } catch (error) {
          // Over the cap: refused by design, nothing to compare.
          if (error instanceof GlobCompileError) return;
          throw error;
        }
        const reference = compileGlobPreFix(glob);
        // Source equality is strictly stronger than behavioural equality:
        // identical source + identical flags means identical matching.
        expect(compiled.source).toBe(reference.source);
        expect(compiled.flags).toBe(reference.flags);
      }),
      { numRuns: 5000 },
    );
  });

  it("only ever refuses globs the pre-fix version would have compiled slowly", () => {
    fc.assert(
      fc.property(globArb, (glob) => {
        try {
          compileGlob(glob);
        } catch (error) {
          expect(error).toBeInstanceOf(GlobCompileError);
          expect((error as GlobCompileError).crossingQuantifiers).toBeGreaterThan(3);
        }
      }),
      { numRuns: 5000 },
    );
  });
});
```

- [ ] **Step 2: Run the test**

```bash
pnpm --filter @megasaver/policy exec vitest run test/compile-glob.property.test.ts
```

Expected: PASS, 2 tests, 10,000 total cases.

- [ ] **Step 3: Commit**

```bash
git add packages/policy/test/compile-glob.property.test.ts
git commit -m "test(policy): differential property proves cap changes no accepted glob"
```

---

## Task 6: `parseProjectPermissions` fails closed

**Files:**
- Modify: `packages/policy/src/parse-project-permissions.ts:2,47-59`
- Modify: `packages/policy/test/parse-project-permissions.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `packages/policy/test/parse-project-permissions.test.ts`:

```ts
describe("parseProjectPermissions — pathological glob is a load failure (§6.4)", () => {
  it("deny.read with an over-cap glob ⇒ PolicyLoadError, not a raw GlobCompileError", () => {
    expect(() =>
      parseProjectPermissions({ deny: { read: [`${"**/**".repeat(8)}x`] } }),
    ).toThrow(PolicyLoadError);
  });

  it("deny.write with an over-cap glob ⇒ PolicyLoadError", () => {
    expect(() =>
      parseProjectPermissions({ deny: { write: [`${"**/**".repeat(8)}x`] } }),
    ).toThrow(PolicyLoadError);
  });

  it("an under-cap glob still compiles normally", () => {
    const perms = parseProjectPermissions({ deny: { read: ["**/a/**/b/**"] } });
    expect(perms.denyReadPatterns).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
pnpm --filter @megasaver/policy exec vitest run test/parse-project-permissions.test.ts
```

Expected: FAIL — the first two throw `GlobCompileError`, which is not a
`PolicyLoadError`.

- [ ] **Step 3: Wrap the compile calls**

In `packages/policy/src/parse-project-permissions.ts`, change the import on
line 2:

```ts
import { GlobCompileError, compileGlob } from "./secret-paths.js";
```

Then replace the return block at the end of `parseProjectPermissions`:

```ts
  const { deny } = result.data;
  try {
    return {
      denyReadPatterns: deny.read.map((glob) => compileGlob(glob)),
      denyWritePatterns: deny.write.map((glob) => compileGlob(glob)),
      denyCommands: deny.commands,
    };
  } catch (error) {
    // A glob the matcher refuses is a malformed permissions file, handled the
    // same way as a bad shape: the gate fails closed (I3), never silently open.
    if (error instanceof GlobCompileError) {
      throw new PolicyLoadError("invalid project permissions glob", { cause: error });
    }
    throw error;
  }
```

- [ ] **Step 4: Run to verify it passes**

```bash
pnpm --filter @megasaver/policy exec vitest run test/parse-project-permissions.test.ts
```

Expected: PASS, all tests in the file.

- [ ] **Step 5: Commit**

```bash
git add packages/policy/src/parse-project-permissions.ts packages/policy/test/parse-project-permissions.test.ts
git commit -m "fix(policy): map refused permissions glob to PolicyLoadError"
```

---

## Task 7: `rankApplicableRules` degrades instead of throwing

**Files:**
- Modify: `packages/core/src/project-rule-ranking.ts:1,15-21`
- Modify: `packages/core/test/project-rule-ranking.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `packages/core/test/project-rule-ranking.test.ts`. It already has a
module-level `rule()` factory (line 6) and UUID-shaped ids — reuse both; do not
add a second factory.

```ts
describe("rankApplicableRules — pathological glob is skipped, not fatal (§6.5)", () => {
  it("still ranks the other rules when one rule has an over-cap glob", () => {
    const poison = rule({
      id: "b0000000-0000-4000-8000-0000000000f1",
      title: "poison",
      appliesTo: [`${"**/**".repeat(8)}x`],
    });
    const healthy = rule({
      id: "b0000000-0000-4000-8000-0000000000f2",
      title: "healthy",
      appliesTo: ["packages/core/**"],
    });

    const started = performance.now();
    const out = rankApplicableRules([poison, healthy], {
      files: ["packages/core/src/project-rule-ranking.ts"],
    });

    expect(out.map((r) => r.rule.id)).toEqual([healthy.id]);
    expect(performance.now() - started).toBeLessThan(100);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
pnpm --filter @megasaver/core exec vitest run test/project-rule-ranking.test.ts
```

Expected: FAIL — `GlobCompileError` propagates out of `rankApplicableRules`.

- [ ] **Step 3: Catch in `appliesToMatches`**

In `packages/core/src/project-rule-ranking.ts`, change line 1:

```ts
import { GlobCompileError, compileGlob } from "@megasaver/policy";
```

and replace `appliesToMatches`:

```ts
function appliesToMatches(glob: string, file: string): boolean {
  if (glob.length === 0) return false;
  if (glob.includes("*") || glob.includes("?")) {
    try {
      return compileGlob(glob).test(file);
    } catch (error) {
      // Ranking is a scoring heuristic, not a gate. Store reads are already
      // fail-closed per FILE (json-directory-store.ts parseEntity), so letting
      // this propagate would take down `mega context` and `rules list` for the
      // whole project because one stored rule has a silly glob. Skip the glob.
      if (error instanceof GlobCompileError) return false;
      throw error;
    }
  }
  return file.startsWith(glob) || glob.startsWith(file);
}
```

- [ ] **Step 4: Run to verify it passes**

```bash
pnpm --filter @megasaver/core exec vitest run test/project-rule-ranking.test.ts
```

Expected: PASS, all tests in the file.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/project-rule-ranking.ts packages/core/test/project-rule-ranking.test.ts
git commit -m "fix(core): skip rules whose appliesTo glob the matcher refuses"
```

---

## Task 8: Changeset, full verify, review

**Files:**
- Create: `.changeset/glob-compile-redos.md`

- [ ] **Step 1: Write the changeset**

```markdown
---
"@megasaver/policy": minor
"@megasaver/core": patch
---

Bound `compileGlob` so a short pathological glob can no longer hang the policy
denylist or `mega context`.

`**` and `**/` compile to quantifiers that can cross `/`. N of them in one
pattern make a **failing** match explore ~C(m+N-1, N-1) partitions of an m-char
subject, and a failing match is the common case in project-rule ranking.
Measured before the fix, against a 41-char subject: a 17-character glob took
3,135 ms and a 19-character glob did not terminate. Glob *length* was never the
governing variable, so a length cap would not have helped.

`compileGlob` now counts those crossing quantifiers and throws the new
`GlobCompileError` above 3 (measured worst case per count: 3 → 57 ms,
4 → 252 ms, 5 → unbounded). Every shipped denylist pattern needs at most 2.

Deliberately *not* a matcher rewrite: the counter does not touch the emitted
pattern, so any glob that still compiles produces a byte-identical `RegExp` and
a denylist bypass is impossible by construction. A fast-check differential
property asserts this against a frozen pre-fix copy over 5,000 generated globs.

Consumer behaviour differs by duty: `parseProjectPermissions` rethrows as
`PolicyLoadError` (security gate, fails closed), while `rankApplicableRules`
skips the glob (scoring heuristic, degrades).
```

- [ ] **Step 2: Run the full gate**

```bash
pnpm verify
```

Expected: biome, `tsc --noEmit`, and the full vitest run all green.

- [ ] **Step 3: Capture reproduction evidence for the verifier**

```bash
pnpm --filter @megasaver/policy exec vitest run test/compile-glob.test.ts test/compile-glob.property.test.ts --reporter=verbose
```

Expected: 12 tests passing. Keep this output — §9 item 5 requires it, and the
red-proof timings are the evidence that the DoS is gone.

- [ ] **Step 4: Commit**

```bash
git add .changeset/glob-compile-redos.md
git commit -m "chore: changeset for compileGlob quantifier cap"
```

- [ ] **Step 5: Reviewer passes (§12 HIGH — all three required, fresh contexts)**

Dispatch in one message so they run concurrently. Author and reviewer must
never share an active context.

- `code-reviewer` — correctness and repo conventions across the four changed source files.
- `critic` — adversarial. Point it specifically at whether cap 3 is defensible, whether excluding `[^/]*` from the count is safe, and whether the differential property actually proves what §4c claims.
- `security-reviewer` — denylist-bypass hunt. It must independently reproduce the §1a and §4b measurements and attack the cap with its own shapes rather than trusting the numbers in the spec.

- [ ] **Step 6: Apply review feedback**

Use `superpowers:receiving-code-review`. Amend the spec first when a finding
changes the design, then the code — same order the JWT ReDoS fix used.

---

## Self-review notes

- **Spec coverage.** §5a → Task 3; §5b → Task 6; §5c → Task 7; §6.1 → Task 2; §6.2/§6.3 → Task 4; §6.4 → Task 6; §6.5 → Task 7; §6.6 → Task 5; §6.7 (existing suites stay green) → Task 8 Step 2; §8 → Task 8.
- **Naming consistency.** `MAX_CROSSING_QUANTIFIERS`, `GlobCompileError`, and the field `crossingQuantifiers` are used identically in Tasks 3, 4, 5, 6, 7 and the changeset.
- **Helper verified.** Task 7 Step 1 reuses the `rule()` factory that already exists at `packages/core/test/project-rule-ranking.test.ts:6` and follows the file's UUID-shaped id convention. Checked against the file, not assumed.
- **Red states are real.** Task 2 goes red on a missing export, Task 6 on `GlobCompileError` not being a `PolicyLoadError`, Task 7 on the error propagating. Task 4's cases are green on arrival by design — they are regression pins for the cap value and the shipped denylist, not red-proof steps, and the plan says so rather than dressing them up as TDD.
