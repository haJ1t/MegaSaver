# `compileGlob` ReDoS Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `compileGlob`'s regex compilation with a non-backtracking glob matcher, so a hostile glob in `.megasaver/permissions.yaml` or `ProjectRule.appliesTo` can neither stall the security gate nor silently fail to deny.

**Architecture:** A new `packages/policy/src/glob-matcher.ts` tokenizes a glob once and matches by NFA simulation — a boolean reachability frontier over path positions, advanced with one left-to-right sweep per token. No backtracking exists by construction. `compileGlob` keeps its name and its call sites, but returns `PathMatcher` (`{ test(path): boolean }`) instead of `RegExp`; all three existing call sites already use only `.test()`.

**Tech Stack:** TypeScript strict/ESM, Vitest, `fast-check` (already a `devDependency` of `@megasaver/policy`), Biome.

**Spec:** `docs/superpowers/specs/2026-07-25-glob-compile-redos-fix-design.md`

---

## File Structure

| Path | Responsibility |
|---|---|
| `packages/policy/src/glob-matcher.ts` | **Create.** `PathMatcher` type, glob tokenizer, NFA matcher, `compileGlobMatcher`. Sole owner of glob semantics. |
| `packages/policy/src/secret-paths.ts` | **Modify.** `compileGlob` delegates to `compileGlobMatcher`; `SECRET_PATH_PATTERNS` retyped. `DENYLIST_GLOBS` and `normalizePath` unchanged. |
| `packages/policy/src/parse-project-permissions.ts` | **Modify.** `ProjectPermissions` pattern arrays retyped `RegExp` → `PathMatcher`. |
| `packages/policy/src/index.ts` | **Modify.** Export the `PathMatcher` type. |
| `packages/policy/test/glob-redos.test.ts` | **Create.** The RED gate: `evaluatePathRead` end-to-end timing + denial, D2, D3. |
| `packages/policy/test/glob-equivalence.test.ts` | **Create.** Frozen LOCKED §9a table + `fast-check` property vs. the old regex. |
| `packages/policy/test/parse-project-permissions.test.ts:12` | **Modify.** One line: `toBeInstanceOf(RegExp)` no longer holds. |
| `packages/core/test/project-rule-ranking.test.ts` | **Modify.** Append the call-site-2 regression. |

---

### Task 1: The RED gate — `evaluatePathRead` under a hostile permissions file

**Files:**
- Test: `packages/policy/test/glob-redos.test.ts` (create)

- [ ] **Step 1: Write the failing test**

```ts
import { projectIdSchema } from "@megasaver/shared";
import { describe, expect, it } from "vitest";
import { evaluatePathRead } from "../src/evaluate-path-read.js";
import { parseProjectPermissions } from "../src/parse-project-permissions.js";

const PROJECT = projectIdSchema.parse("11111111-1111-4111-8111-111111111111");

// Ceiling is ~1000x below the pre-fix cost of these cases, so CI load cannot
// close the gap: an exponential is slow on every attempt. `retry` matches the
// convention in redact-jwt.test.ts.
const CEILING_MS = 250;

function elapsed(run: () => void): number {
  const started = performance.now();
  run();
  return performance.now() - started;
}

describe("evaluatePathRead — hostile project glob cannot stall the gate", () => {
  // The exact shape from the report: nine `**/a` groups then `/x`. Pre-fix this
  // burns seconds inside `.test()` and then returns allowed:true, so the gate
  // neither denies nor signals.
  const permissions = parseProjectPermissions({
    deny: { read: [`${"**/a".repeat(9)}/x`] },
  });

  it("denies a path the hostile glob matches, within the ceiling", { retry: 3 }, () => {
    const path = `${"a/".repeat(9)}x`;
    let result: ReturnType<typeof evaluatePathRead> | undefined;
    const ms = elapsed(() => {
      result = evaluatePathRead({ path, project: PROJECT, permissions });
    });
    expect(result).toEqual({ allowed: false, reason: "secret_path_read" });
    expect(ms).toBeLessThan(CEILING_MS);
  });

  it("allows a non-matching path within the ceiling", { retry: 3 }, () => {
    const path = `${"a/".repeat(40)}b`;
    let result: ReturnType<typeof evaluatePathRead> | undefined;
    const ms = elapsed(() => {
      result = evaluatePathRead({ path, project: PROJECT, permissions });
    });
    expect(result).toEqual({ allowed: true });
    expect(ms).toBeLessThan(CEILING_MS);
  });

  // D1 is not specific to `**/` — a single-segment `*` chain blows up on an
  // ordinary 255-character filename, which is why a `**`-only cap is unsound.
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

describe("compileGlob treats regex metacharacters as literals (D2/D3)", () => {
  // D2: zero wildcards, so no wildcard-count cap could ever catch this.
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

  // D3: reachable with an ordinary filename, no crafted input needed.
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @megasaver/policy exec vitest run test/glob-redos.test.ts`

Expected: FAIL. The three timing tests exceed 250 ms (the report's shape measured 6,047 ms end-to-end; `*a`×5 measured 58,529 ms and will hit the 30 s `testTimeout` in `packages/policy/vitest.config.ts`). The metachar tests fail on `allowed: true` instead of the expected denial. **Record the actual numbers — they are the reproduction evidence required by §12.**

- [ ] **Step 3: Commit the red test**

```bash
git add packages/policy/test/glob-redos.test.ts
git commit -m "test(policy): red gate for compileGlob ReDoS + metachar injection"
```

---

### Task 2: The linear matcher

**Files:**
- Create: `packages/policy/src/glob-matcher.ts`

- [ ] **Step 1: Write the implementation**

```ts
// Glob matching WITHOUT a regex. `compileGlob` used to build a RegExp from
// untrusted glob text, which made chained wildcards backtrack exponentially
// (`*a`x5 = 58s on a 255-char path) and let regex metacharacters through raw,
// so a zero-wildcard glob like `(a+)+b` was itself a ReDoS. Matching here is an
// NFA simulation: a boolean reachability frontier advanced once per token, so
// there is no backtracking to blow up — O(tokens x path length), always.
// See docs/superpowers/specs/2026-07-25-glob-compile-redos-fix-design.md.

export type PathMatcher = { test(path: string): boolean };

type Token =
  | { readonly kind: "literal"; readonly ch: string }
  | { readonly kind: "any" }
  | { readonly kind: "star" }
  | { readonly kind: "globstar" }
  | { readonly kind: "globstarSlash" };

// Token boundaries mirror the previous regex translation exactly: `**/` is one
// token consuming three characters, a bare `**` consumes two, `*` and `?` one.
// EVERY other character — including every regex metacharacter — is a literal.
function tokenize(glob: string): readonly Token[] {
  const tokens: Token[] = [];
  for (let i = 0; i < glob.length; i += 1) {
    const char = glob[i] as string;
    if (char === "*") {
      if (glob[i + 1] === "*") {
        if (glob[i + 2] === "/") {
          tokens.push({ kind: "globstarSlash" });
          i += 2;
        } else {
          tokens.push({ kind: "globstar" });
          i += 1;
        }
      } else {
        tokens.push({ kind: "star" });
      }
    } else if (char === "?") {
      tokens.push({ kind: "any" });
    } else {
      tokens.push({ kind: "literal", ch: char });
    }
  }
  return tokens;
}

function matches(tokens: readonly Token[], path: string): boolean {
  const n = path.length;
  let cur = new Uint8Array(n + 1);
  let next = new Uint8Array(n + 1);
  cur[0] = 1;

  for (const token of tokens) {
    next.fill(0);
    let live = false;

    if (token.kind === "literal" || token.kind === "any") {
      for (let i = 0; i < n; i += 1) {
        if (cur[i] === 0) continue;
        const ch = path[i] as string;
        if (token.kind === "literal" ? ch === token.ch : ch !== "/") {
          next[i + 1] = 1;
          live = true;
        }
      }
    } else if (token.kind === "star" || token.kind === "globstar") {
      // A run reachable from any live start. `star` cannot cross a separator,
      // so its run clears at each `/`; `globstar` never clears.
      let active = false;
      for (let i = 0; i <= n; i += 1) {
        if (cur[i] === 1) active = true;
        if (active) {
          next[i] = 1;
          live = true;
        }
        if (token.kind === "star" && i < n && path[i] === "/") active = false;
      }
    } else {
      // `**/` — zero or more COMPLETE leading segments: either empty, or any
      // run from a live start that ends on a separator.
      let seen = false;
      for (let i = 0; i <= n; i += 1) {
        if (cur[i] === 1) {
          next[i] = 1;
          live = true;
        }
        if (seen && i > 0 && path[i - 1] === "/") {
          next[i] = 1;
          live = true;
        }
        if (cur[i] === 1) seen = true;
      }
    }

    if (!live) return false;
    const swap = cur;
    cur = next;
    next = swap;
  }

  return cur[n] === 1;
}

// Case-insensitive, matching the `i` flag the compiled regex carried. The glob
// folds once at compile time, the path on each call.
export function compileGlobMatcher(glob: string): PathMatcher {
  const tokens = tokenize(glob.toLowerCase());
  return { test: (path: string): boolean => matches(tokens, path.toLowerCase()) };
}
```

- [ ] **Step 2: Wire it into `compileGlob`**

Modify `packages/policy/src/secret-paths.ts`. Replace the whole `compileGlob` function body (lines 26-55) and the `SECRET_PATH_PATTERNS` type on line 57:

```ts
import { type PathMatcher, compileGlobMatcher } from "./glob-matcher.js";

// Exported for parse-project-permissions.ts so project deny.read/write
// globs reuse the SAME matcher as SECRET_PATH_PATTERNS — no second glob
// engine, identical `..`/backslash/case semantics (permissions-yaml §4.1, I4).
export function compileGlob(glob: string): PathMatcher {
  return compileGlobMatcher(glob);
}

export const SECRET_PATH_PATTERNS: readonly PathMatcher[] = DENYLIST_GLOBS.map(compileGlob);
```

Also update the module header comment on lines 1-4: the denylist is no longer "compiled into anchored, case-insensitive regexes". Replace with:

```ts
// epic §9a — LOCKED, case-insensitive secret-path denylist. Compiled
// once at module load into anchored PathMatchers. Order of `**` before
// `*` in the tokenizer matters: the `**` token must be consumed before
// the single-`*` rule runs.
```

- [ ] **Step 3: Retype `ProjectPermissions`**

Modify `packages/policy/src/parse-project-permissions.ts`. Change the import on line 2 and the type on lines 30-34:

```ts
import { type PathMatcher, compileGlob } from "./secret-paths.js";
```

```ts
export type ProjectPermissions = {
  denyReadPatterns: readonly PathMatcher[];
  denyWritePatterns: readonly PathMatcher[];
  denyCommands: readonly string[];
};
```

`secret-paths.ts` must re-export the type for that import to resolve — add to `packages/policy/src/secret-paths.ts`:

```ts
export type { PathMatcher } from "./glob-matcher.js";
```

- [ ] **Step 4: Export the public type**

Modify `packages/policy/src/index.ts` line 26:

```ts
export { compileGlob, type PathMatcher } from "./secret-paths.js";
```

- [ ] **Step 5: Fix the one test that asserts the old return type**

Modify `packages/policy/test/parse-project-permissions.test.ts` line 12. Replace:

```ts
    expect(perms.denyReadPatterns[0]).toBeInstanceOf(RegExp);
```

with:

```ts
    expect(typeof perms.denyReadPatterns[0]?.test).toBe("function");
```

- [ ] **Step 6: Run the red gate to verify it now passes**

Run: `pnpm --filter @megasaver/policy exec vitest run test/glob-redos.test.ts`
Expected: PASS, all cases, well under the 250 ms ceiling.

- [ ] **Step 7: Run the whole policy suite for regressions**

Run: `pnpm --filter @megasaver/policy test`
Expected: PASS. Pay attention to `evaluate-path-read.test.ts` — it exercises all 15 LOCKED §9a globs against 26 fixture paths and is the primary guard that denylist semantics did not move.

- [ ] **Step 8: Commit**

```bash
git add packages/policy/src/glob-matcher.ts packages/policy/src/secret-paths.ts \
        packages/policy/src/parse-project-permissions.ts packages/policy/src/index.ts \
        packages/policy/test/parse-project-permissions.test.ts
git commit -m "fix(policy): match globs with a linear NFA, not a regex"
```

---

### Task 3: Prove the LOCKED §9a denylist did not move

**Files:**
- Create: `packages/policy/test/glob-equivalence.test.ts`

- [ ] **Step 1: Write the equivalence test**

```ts
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { compileGlob } from "../src/secret-paths.js";

// The pre-fix implementation, frozen verbatim as the equivalence oracle. It is
// NOT imported from src — it no longer exists there. Keeping the old body here
// is what makes "the LOCKED §9a denylist still decides every path the same way"
// a checkable claim rather than an assertion.
function legacyCompileGlob(glob: string): RegExp {
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

const DENYLIST_GLOBS = [
  "**/.env",
  "**/.env.*",
  "**/.ssh/**",
  "**/.aws/credentials",
  "**/.aws/config",
  "**/.gcp/**",
  "**/.azure/**",
  "**/private_keys/**",
  "**/secrets/**",
  "**/id_rsa",
  "**/id_ed25519",
  "**/*.pem",
  "**/*.key",
  "**/credentials.json",
  "**/service-account*.json",
] as const;

const PATHS = [
  ".env",
  "a/.env",
  "a/b/.env",
  "a/.env.local",
  ".env.local",
  "x.env",
  ".envx",
  ".ssh/id_rsa",
  "home/u/.ssh/known_hosts",
  "home/u/.ssh/x/y/z",
  ".ssh",
  ".ssh/",
  "home/.aws/credentials",
  "home/.aws/config",
  "home/.aws/configx",
  "home/.gcp/keys/k.json",
  "home/.azure/t.json",
  "vault/private_keys/s.key",
  "app/secrets/db.txt",
  "secrets/db.txt",
  "home/.ssh/id_rsa",
  "id_rsa",
  "id_ed25519",
  "certs/server.pem",
  "server.pem",
  "certs/server.key",
  "config/credentials.json",
  "credentials.json",
  "config/service-account-prod.json",
  "service-account.json",
  "src/index.ts",
  "README.md",
  "",
  "/",
  "a//b",
] as const;

describe("compileGlob — LOCKED §9a denylist verdicts are unchanged", () => {
  for (const glob of DENYLIST_GLOBS) {
    it(`${glob} decides every fixture path identically`, () => {
      const legacy = legacyCompileGlob(glob);
      const matcher = compileGlob(glob);
      for (const path of PATHS) {
        expect({ path, hit: matcher.test(path) }).toEqual({
          path,
          hit: legacy.test(path),
        });
      }
    });
  }
});

describe("compileGlob — property equivalence on metachar-free input", () => {
  // Restricted to the alphabet where the two implementations are SUPPOSED to
  // agree. Outside it they diverge on purpose: that divergence is the D2/D3 fix
  // and is pinned by glob-redos.test.ts instead.
  const globChars = fc.constantFrom(..."ab.-_/*?".split(""));
  const pathChars = fc.constantFrom(..."ab.-_/".split(""));

  it("agrees with the frozen regex on random globs and paths", () => {
    fc.assert(
      fc.property(
        fc.stringOf(globChars, { maxLength: 12 }),
        fc.stringOf(pathChars, { maxLength: 20 }),
        (glob, path) => {
          expect(compileGlob(glob).test(path)).toBe(legacyCompileGlob(glob).test(path));
        },
      ),
      { numRuns: 20_000 },
    );
  });
});
```

- [ ] **Step 2: Run it**

Run: `pnpm --filter @megasaver/policy exec vitest run test/glob-equivalence.test.ts`
Expected: PASS. A property failure here means the matcher changed denylist semantics — `fast-check` prints the shrunk counterexample; fix the matcher, never the oracle.

- [ ] **Step 3: Commit**

```bash
git add packages/policy/test/glob-equivalence.test.ts
git commit -m "test(policy): pin glob matcher equivalence to the frozen regex"
```

---

### Task 4: Close the third call site (`@megasaver/core`)

**Files:**
- Modify: `packages/core/test/project-rule-ranking.test.ts`

`rankApplicableRules` compiles `ProjectRule.appliesTo` per call inside a ranking loop with no cache (`packages/core/src/project-rule-ranking.ts:18`). It needs no source change — it routes through the same fixed `compileGlob` — but it needs a regression test so a future revert is caught here too.

- [ ] **Step 1: Read the existing test file to match its fixture style**

Run: `sed -n '1,40p' packages/core/test/project-rule-ranking.test.ts`

Build the rule fixture with whatever helper that file already uses. Do not invent a new shape.

- [ ] **Step 2: Append the regression**

```ts
describe("rankApplicableRules — hostile appliesTo glob cannot stall ranking", () => {
  it("ranks within a bounded time against a wildcard-chain glob", () => {
    const rules = [makeRule({ appliesTo: [`${"*a".repeat(5)}x`] })];
    const started = performance.now();
    rankApplicableRules(rules, { files: ["a".repeat(255)] });
    expect(performance.now() - started).toBeLessThan(250);
  });
});
```

Replace `makeRule` with the file's actual fixture helper and match its required `ProjectRule` fields.

- [ ] **Step 3: Run it**

Run: `pnpm --filter @megasaver/core exec vitest run test/project-rule-ranking.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/core/test/project-rule-ranking.test.ts
git commit -m "test(core): bound rule-ranking against a hostile appliesTo glob"
```

---

### Task 5: Full verification + changeset

**Files:**
- Create: `.changeset/glob-matcher-redos.md`

- [ ] **Step 1: Run the full gate**

Run: `pnpm verify`
Expected: EXIT 0 — `biome check`, `tsc -b --noEmit`, `vitest run`, and `conventions:check` all green.

- [ ] **Step 2: Write the changeset**

```markdown
---
"@megasaver/policy": minor
---

Match path globs with a linear NFA instead of a compiled regex.

`compileGlob` built a `RegExp` from untrusted glob text, which made chained
wildcards backtrack exponentially (`*a`x5 against a 255-character path: 58,529
ms) and passed regex metacharacters through unescaped — so a zero-wildcard glob
`(a+)+b` was itself a ReDoS at 1,130 ms on 28 characters, and an ordinary deny
rule like `**/a+b.txt` silently failed to match `x/a+b.txt`.

`compileGlob` now returns a `PathMatcher` (`{ test(path): boolean }`) rather
than a `RegExp`. Every character that is not `*`, `**`, `**/`, or `?` is matched
literally. Verdicts for the LOCKED §9a denylist are unchanged, pinned by a
frozen fixture table and a 20,000-run property test against the previous
implementation.
```

- [ ] **Step 3: Commit**

```bash
git add .changeset/glob-matcher-redos.md
git commit -m "chore: changeset for policy glob matcher fix"
```

---

### Task 6: Review + wiki (§12 CRITICAL tier)

- [ ] **Step 1: Dispatch reviewers in one message** — `code-reviewer`, `critic`, and `security-reviewer`, each in a fresh context (author ≠ reviewer, §13). The security reviewer must independently attack the matcher for super-linear behaviour rather than reading the diff only.

- [ ] **Step 2: Apply findings**, re-running `pnpm verify` after each change.

- [ ] **Step 3: Update the wiki.** `wiki/concepts/unbounded-run-redos.md` currently describes one shape — an unbounded greedy run followed by a required literal. This defect is a **different** shape (ambiguous quantifier chaining, plus metacharacter injection into a regex built from untrusted input) and the page must say so rather than absorbing it into the existing table. Update `wiki/entities/policy.md` with the new `compileGlob` contract, and append to `wiki/log.md`.

---

## Self-Review

**Spec coverage:** §2 D1 → Task 1 tests 1-3; D2 → Task 1 metachar describe; D3 → Task 1 literal cases. §2b call site 1 → Task 1 (via `parseProjectPermissions`); call site 2 → Task 4; call site 3 → Task 3. §4 fix → Task 2. §5 equivalence → Task 3. §6 test plan → Tasks 1, 4. §7 DoD → Tasks 5, 6. §3 rejected alternatives need no task. No gaps.

**Placeholder scan:** Task 4 Step 2 deliberately defers the fixture helper name to the existing file and says so explicitly, with a command to read it first — that is a lookup, not a TBD. No other deferred content.

**Type consistency:** `PathMatcher` is defined in Task 2 Step 1 and used identically in Steps 2, 3, 4 and in Task 3. `compileGlobMatcher` (the implementation) and `compileGlob` (the stable public name) are distinct throughout by design.
