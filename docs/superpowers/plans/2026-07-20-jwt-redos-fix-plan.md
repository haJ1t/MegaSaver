# `jwt` Detector ReDoS Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add one lookbehind to the LOCKED `jwt` detector in `@megasaver/policy` so it is linear instead of quadratic, and land the paperwork the lock requires — the §5a lock-table amendment, the three edits to the unexecuted sibling extension plan, a changeset that states the behavior change, and the corrected severity record in the wiki.

**Architecture:** One line changes in `packages/policy/src/redaction-patterns.ts`. No signature changes: `redact`, `redactWithFindings`, `redactForLedger`, and `RedactResult` are untouched, the finding name stays `jwt`, and no consumer needs an edit. Safety rests on three assertions landing in the same branch: a structural gate on `pattern.source`, a wall-clock gate at the one rung where the separation is four orders of magnitude, and a 14-case equivalence corpus whose expected outputs are captured from the *old* pattern outside the repo and committed as byte literals.

**Tech Stack:** TypeScript strict ESM, Zod (pattern-table validation at module load), vitest, biome, pnpm workspaces.

**Spec:** `docs/superpowers/specs/2026-07-20-jwt-redos-fix-design.md` — risk **CRITICAL** (§12: evidence-preserving redaction core consumed by every redaction sink). Architect pass **APPROVE_WITH_FIXES** and security-reviewer pass **APPROVE_WITH_FIXES**, both applied to the spec before this plan was written.

**Execution context:** worktree `.worktrees/jwt-redos` on branch `fix/jwt-redos`, created by Task 1. All commands run from the worktree root. Task order is dependency order: 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8.

**Scratchpad (never in the repo):** `/private/tmp/claude-501/-Users-halitozger-Desktop-MegaSaver/10f63fff-dcd2-405d-938b-5e719f5b1c34/scratchpad`. Task 2's capture script lives there and is never committed.

---

## Load-bearing facts (verified against source while writing this plan, not assumed)

- `REDACTION_PATTERNS` is **not** exported from `packages/policy/src/index.ts`. Tests import from `../src/redaction-patterns.js` directly. Do not add an index export.
- The `jwt` entry is at `packages/policy/src/redaction-patterns.ts:50-53`; the pattern itself is line **51**. `bearer_token` is index 5, `jwt` is index 6 — which is why §6.1's assertions are pattern-level, not through `redact()`.
- `packages/policy` does **not** typecheck its tests: the script is `tsc -b --noEmit` and `tsconfig.json` excludes `test`. `tsconfig.test.json` exists and is correct but nothing invokes it. **Task 1 wires it**, matching `packages/core`, `apps/cli`, `packages/context-gate`, `packages/context-pruner`, and `packages/indexer`. See the note in Task 1 for why this belongs here and not deferred.
- `vitest.config.ts` sets `testTimeout: 30_000`. With the *old* pattern a single 313 KiB seed measures ~8.3 s, so each timing seed must be its own `it()` — three seeds in one `it()` would hit the timeout and produce an ambiguous RED.
- The §5a lock table in `docs/superpowers/specs/2026-05-10-bb3-policy-design.md` runs lines **309–319**; the `jwt` row is line **316** and the table's last row (`db_url`) is line **319**. Line 320 is blank and line 321 begins `Order is application order`. The footnote goes between them.
- `wiki/log.md` is `type: append-only` with new entries at the bottom. The existing `[2026-07-20] plan` entry carries the original overstatement ("reachable from ordinary base64-heavy logs"). It is **not** edited; Task 8 appends a superseding entry that names it.

---

> **Measurements below were reproduced on this machine (Node 22, darwin) before this plan was written.** The equivalence corpus returned 14 SAME / 0 DIFF, the trade-off shapes returned 3 DIFF as designed, and the timing table reproduced the spec's numbers within noise. The expected outputs quoted in the steps are observed, not predicted. Task 2 re-runs the capture inside the worktree so the evidence is attached to the branch.

| pattern | seed | 313 KiB |
|---|---|---|
| old | `eyJaA0` | 8,374.17 ms |
| old | `-eyJaA` | 8,241.42 ms |
| old | `_eyJaA` | 8,185.81 ms |
| fixed | `eyJaA0` | 0.45 ms |
| fixed | `-eyJaA` | 0.15 ms |
| fixed | `_eyJaA` | 0.19 ms |
| narrowed to `(?<![A-Za-z0-9])` | `eyJaA0` | 0.46 ms |
| narrowed to `(?<![A-Za-z0-9])` | `-eyJaA` | **7,494.07 ms** |
| narrowed to `(?<![A-Za-z0-9])` | `_eyJaA` | **7,560.99 ms** |

The last three rows are why §6.2 seeds three strings: the narrowing a future maintainer would make to undo §5's trade-off leaves the first seed at 0.46 ms and sails through any ceiling.

---

### Task 1: Worktree, typecheck wiring, green baseline

**Files:**
- Modify: `packages/policy/package.json` (the `typecheck` script only)

**Why the typecheck wiring belongs in this plan, explicitly.** It is a one-line edit and it would be defensible to skip it. It is included because this branch commits a test file whose entire value is byte-literal expected strings and a narrowed `RedactionPattern | undefined` on a CRITICAL redaction path, and `pnpm verify` must actually typecheck that file rather than only run it. The sibling extension plan's Task 1 also wires this line (its header fact list says so); because §8 recommends **this** fix lands first, doing it here means the sibling's step would no longer find its old string. That divergence is recorded as a fourth item in Task 7 alongside §8's three. It gets its own commit so the security fix stays a one-line diff.

---

- [ ] **Step 1: Create the worktree.**

```
cd /Users/halitozger/Desktop/MegaSaver
git worktree add .worktrees/jwt-redos -b fix/jwt-redos main
cd /Users/halitozger/Desktop/MegaSaver/.worktrees/jwt-redos
pnpm install --frozen-lockfile
```

Expected: `Preparing worktree (new branch 'fix/jwt-redos')`, then pnpm resolves from the existing store. All later commands in this plan run from `/Users/halitozger/Desktop/MegaSaver/.worktrees/jwt-redos`.

- [ ] **Step 2: Confirm the baseline is green before touching anything.**

```
pnpm --filter @megasaver/policy test
```

Expected: all existing policy suites pass — `redact.test.ts`, `redact-pii.test.ts`, `redact-unstructured.test.ts`, `redact.property.test.ts`, `deny-code.test.ts`, `dependency-graph.test.ts`, `evaluate-command.test.ts`, `evaluate-path-read.test.ts`, `parse-project-permissions.test.ts`, `pii-validators.test.ts`. If anything is already red, stop — this plan assumes a green baseline.

- [ ] **Step 3: Wire the test tsconfig into the package typecheck script.**

In `packages/policy/package.json`, replace:

```json
    "typecheck": "tsc -b --noEmit",
```

with:

```json
    "typecheck": "tsc -b --noEmit && tsc -p tsconfig.test.json --noEmit",
```

- [ ] **Step 4: Verify the wiring passes against unmodified tests.**

```
pnpm --filter @megasaver/policy typecheck
```

Expected: exit 0, no output. If this fails, the existing tests have latent type errors — fix those in this commit before proceeding, since every later step depends on this gate being meaningful.

- [ ] **Step 5: Commit.**

```
git add packages/policy/package.json
git status --short
git commit -m "chore(policy): typecheck policy tests"
```

Expected: `git status --short` shows only `M packages/policy/package.json` staged.

---

### Task 2: Capture the old pattern's outputs as reproduction evidence

**Files:** none in the repo. The script lives in the scratchpad and is never committed.

Spec §6.1 is explicit: the old quadratic pattern must **not** be compiled inside a committed test. Running it once here produces (a) the byte-literal expected strings Task 6 commits and (b) the old-vs-new differential and timing table that the CRITICAL chain's verifier and `omc:tracer` passes consume as reproduction evidence.

---

- [ ] **Step 1: Write the capture script in the scratchpad.**

```
mkdir -p /private/tmp/claude-501/-Users-halitozger-Desktop-MegaSaver/10f63fff-dcd2-405d-938b-5e719f5b1c34/scratchpad
cat > /private/tmp/claude-501/-Users-halitozger-Desktop-MegaSaver/10f63fff-dcd2-405d-938b-5e719f5b1c34/scratchpad/capture-jwt-redos.mjs <<'SCRIPT'
const OLD = /eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g;
const NEW = /(?<![A-Za-z0-9_-])eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g;
const NARROWED = /(?<![A-Za-z0-9])eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g;
const REPLACEMENT = "eyJ[REDACTED]";

const SAMPLE_JWT = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4";
const jwtOf = (h, p, s) =>
  `eyJhbGciOiJIUzI1NiJ9${"H".repeat(h)}.eyJzdWIiOiIxMjM0NTY3ODkwIn0${"P".repeat(p)}.${"S".repeat(s)}`;

const CASES = [
  ["hs256_minimal", SAMPLE_JWT],
  ["rs256_typical", jwtOf(40, 120, 342)],
  ["rs512_large_sig", jwtOf(40, 120, 684)],
  ["id_token_8kb_payload", jwtOf(40, 8192, 342)],
  ["payload_16kb", jwtOf(40, 16384, 342)],
  ["x5c_header_3kb", jwtOf(3072, 120, 342)],
  ["carrier_equals", `token=${SAMPLE_JWT}`],
  ["carrier_colon", `token:${SAMPLE_JWT}`],
  ["carrier_dquote", `"${SAMPLE_JWT}"`],
  ["carrier_semicolon", `a=1;${SAMPLE_JWT}`],
  ["carrier_space", `token ${SAMPLE_JWT}`],
  ["carrier_newline", `line1\n${SAMPLE_JWT}`],
  ["carrier_start_of_string", `${SAMPLE_JWT} trailing`],
  ["bearer_header", `Authorization: Bearer ${SAMPLE_JWT}`],
];

console.log("=== §6.1 equivalence corpus: OLD vs NEW ===");
let diffs = 0;
for (const [name, input] of CASES) {
  const o = input.replace(OLD, REPLACEMENT);
  const n = input.replace(NEW, REPLACEMENT);
  if (o !== n) diffs += 1;
  console.log(
    `${o === n ? "SAME" : "DIFF"}  ${name.padEnd(24)} in=${String(input.length).padStart(5)}B  expected=${JSON.stringify(o)}`,
  );
}
console.log(`cases=${CASES.length}  diffs=${diffs}`);

console.log("\n=== §5 accepted trade-off: OLD vs NEW (must all DIFF) ===");
for (const [name, input] of [
  ["session_glued", `session-${SAMPLE_JWT}`],
  ["id_token_glued", `id_token_${SAMPLE_JWT}`],
  ["base64url_glued", `A9zQ${SAMPLE_JWT}`],
]) {
  console.log(`${name}`);
  console.log(`  old=${JSON.stringify(input.replace(OLD, REPLACEMENT))}`);
  console.log(`  new=${JSON.stringify(input.replace(NEW, REPLACEMENT))}`);
}

console.log("\n=== §6.2 timing at 313 KiB (single run each) ===");
const SEEDS = ["eyJaA0", "-eyJaA", "_eyJaA"];
for (const [label, re] of [["old", OLD], ["fixed", NEW], ["narrowed", NARROWED]]) {
  for (const seed of SEEDS) {
    const input = seed.repeat(Math.ceil((313 * 1024) / seed.length));
    const started = performance.now();
    input.replace(re, REPLACEMENT);
    const ms = performance.now() - started;
    console.log(`${label.padEnd(9)} seed=${JSON.stringify(seed).padEnd(9)} ${ms.toFixed(2)} ms`);
  }
}
SCRIPT
```

- [ ] **Step 2: Run it and keep the full output.**

```
node /private/tmp/claude-501/-Users-halitozger-Desktop-MegaSaver/10f63fff-dcd2-405d-938b-5e719f5b1c34/scratchpad/capture-jwt-redos.mjs
```

Expected — the equivalence block, verbatim:

```
=== §6.1 equivalence corpus: OLD vs NEW ===
SAME  hs256_minimal            in=   67B  expected="eyJ[REDACTED]"
SAME  rs256_typical            in=  551B  expected="eyJ[REDACTED]"
SAME  rs512_large_sig          in=  893B  expected="eyJ[REDACTED]"
SAME  id_token_8kb_payload     in= 8623B  expected="eyJ[REDACTED]"
SAME  payload_16kb             in=16815B  expected="eyJ[REDACTED]"
SAME  x5c_header_3kb           in= 3583B  expected="eyJ[REDACTED]"
SAME  carrier_equals           in=   73B  expected="token=eyJ[REDACTED]"
SAME  carrier_colon            in=   73B  expected="token:eyJ[REDACTED]"
SAME  carrier_dquote           in=   69B  expected="\"eyJ[REDACTED]\""
SAME  carrier_semicolon        in=   71B  expected="a=1;eyJ[REDACTED]"
SAME  carrier_space            in=   73B  expected="token eyJ[REDACTED]"
SAME  carrier_newline          in=   73B  expected="line1\neyJ[REDACTED]"
SAME  carrier_start_of_string  in=   76B  expected="eyJ[REDACTED] trailing"
SAME  bearer_header            in=   89B  expected="Authorization: Bearer eyJ[REDACTED]"
cases=14  diffs=0
```

Then three `DIFF`-shaped trade-off blocks where every `new=` line shows the token surviving in cleartext, and a timing block matching the table at the top of this plan (`old` ≈ 8,200–8,400 ms on all three seeds; `fixed` ≤ 0.5 ms on all three; `narrowed` ≈ 0.5 ms on `eyJaA0` but ≈ 7,500 ms on `-eyJaA` and `_eyJaA`).

**Gate:** `diffs=0` is mandatory. A non-zero count means the corpus or the fix diverged from the spec's §2 invariant — stop and reconcile before writing any test.

- [ ] **Step 3: Record the evidence.**

Paste the full stdout into the branch's evidence notes (the PR body, or the verifier hand-off). It is the reproduction evidence the CRITICAL chain requires: it demonstrates the vulnerability (8,374 ms), demonstrates the fix (0.45 ms), pins the equivalence, and shows the §5 loss is exactly three shapes and nothing else. Nothing from this step is committed.

---

### Task 3: Failing tests — structural gate + timing regression (§6.2)

**Files:**
- Create: `packages/policy/test/redact-jwt.test.ts`

---

- [ ] **Step 1: Write the failing test file.**

Create `packages/policy/test/redact-jwt.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { REDACTION_PATTERNS } from "../src/redaction-patterns.js";

const jwtEntry = REDACTION_PATTERNS.find((entry) => entry.name === "jwt");
if (jwtEntry === undefined) throw new Error("jwt detector missing from REDACTION_PATTERNS");

const apply = (input: string): string => input.replace(jwtEntry.pattern, jwtEntry.replacement);

describe("jwt detector — ReDoS structural gate (fix spec §6.2)", () => {
  it("is left-boundary gated by the base64url lookbehind", () => {
    expect(jwtEntry.pattern.source.startsWith("(?<![A-Za-z0-9_-])")).toBe(true);
  });
});

// Wall clock is kept ONLY at 313 KiB: 8,374 ms broken vs 0.45 ms fixed is four
// orders of magnitude, wide enough to survive a Windows runner's GC or AV pause.
// The 39 KiB rung was dropped — its ceiling would sit 2.3x under the broken value.
const CEILING_MS = 500;
const SCALE_KIB = 313;

// Three seeds, not one. Narrowing the lookbehind to (?<![A-Za-z0-9]) — the exact
// edit that would undo the §5 trade-off — leaves 'eyJaA0' at 0.46 ms while
// '-eyJaA' costs 7,494 ms and '_eyJaA' costs 7,561 ms. Without the last two the
// quadratic can return with CI green.
const SEEDS = ["eyJaA0", "-eyJaA", "_eyJaA"] as const;

describe("jwt detector — ReDoS timing regression (fix spec §6.2)", () => {
  for (const seed of SEEDS) {
    it(`stays under ${CEILING_MS} ms on ${SCALE_KIB} KiB of ${JSON.stringify(seed)}`, () => {
      const input = seed.repeat(Math.ceil((SCALE_KIB * 1024) / seed.length));
      const started = performance.now();
      apply(input);
      expect(performance.now() - started).toBeLessThan(CEILING_MS);
    });
  }
});
```

- [ ] **Step 2: Run it and confirm RED.**

```
pnpm --filter @megasaver/policy test -- redact-jwt
```

**This run takes ~25 seconds** — each of the three timing tests spends ~8.3 s inside the quadratic pattern. That is expected; each `it()` stays well under vitest's 30 s `testTimeout`, so the failures are ceiling failures rather than timeouts.

Expected: 4 failed, 0 passed.

- `is left-boundary gated by the base64url lookbehind` → `AssertionError: expected false to be true`
- each of the three timing tests → `AssertionError: expected 8374.17 to be less than 500` (the number varies per seed and machine; the shape does not)

**Gate:** if any timing test *passes* here, the pattern in the worktree is not the shipped one — stop and check `git diff`.

---

### Task 4: Failing tests — §5 trade-off non-match assertions (§6.3)

**Files:**
- Modify: `packages/policy/test/redact-jwt.test.ts`

Written before the fix so the assertions are genuinely RED against shipped behavior — they are the only assertions in this plan that observe the intended behavior *change*, and asserting them after the fix would prove nothing.

---

- [ ] **Step 1: Append the non-match block.**

Append to the end of `packages/policy/test/redact-jwt.test.ts`:

```ts
const SAMPLE_JWT = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4";

// These three are the ACCEPTED loss from the fix spec §5, not a gap. A JWT
// preceded directly by [A-Za-z0-9_-] no longer redacts. Do not "fix" them by
// narrowing the lookbehind to (?<![A-Za-z0-9]): that restores the first two and
// restores the quadratic with them (7,494 ms and 7,561 ms at 313 KiB). The
// hybrid alternation that recovers both was measured at 125x the simple fix and
// rejected in the same section.
describe("jwt detector — accepted §5 trade-off, do not narrow the lookbehind", () => {
  const glued: ReadonlyArray<readonly [string, string]> = [
    ["a session- prefix", `session-${SAMPLE_JWT}`],
    ["an id_token_ prefix", `id_token_${SAMPLE_JWT}`],
    ["a random base64url run", `A9zQ${SAMPLE_JWT}`],
  ];

  for (const [label, input] of glued) {
    it(`leaves a JWT glued to ${label} untouched`, () => {
      expect(apply(input)).toBe(input);
    });
  }
});
```

- [ ] **Step 2: Run it and confirm RED.**

```
pnpm --filter @megasaver/policy test -- redact-jwt
```

Expected: 7 failed, 0 passed — the four from Task 3 plus these three. Each new failure reads:

```
AssertionError: expected 'session-eyJ[REDACTED]' to be 'session-eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxM…'
```

with `id_token_eyJ[REDACTED]` and `A9zQeyJ[REDACTED]` for the other two. That is the shipped quadratic pattern matching across the glue, exactly as measured in Task 2.

---

### Task 5: The fix — one lookbehind, its WHY comment, and the lock record

**Files:**
- Modify: `packages/policy/src/redaction-patterns.ts`
- Modify: `docs/superpowers/specs/2026-05-10-bb3-policy-design.md`

Spec §7 requires the §5a lock-table amendment in the **same commit** as the regex change, so both land here.

---

- [ ] **Step 1: Apply the fix with its WHY comment.**

In `packages/policy/src/redaction-patterns.ts`, replace lines 49–53:

```ts
  {
    name: "jwt",
    pattern: /eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
    replacement: "eyJ[REDACTED]",
  },
```

with:

```ts
  {
    // The lookbehind is a performance guard, not a matcher. Without it, every
    // `eyJ` inside a dotless base64url run is a start position that greedily
    // scans to end-of-input before failing `\.` — O(n) starts x O(n) length,
    // 8.4 s at 313 KiB. Rejecting glued starts collapses that to O(1).
    // Accepted cost (spec 2026-07-20 §5): a JWT preceded directly by
    // [A-Za-z0-9_-] no longer redacts, so `session-<jwt>` and `id_token_<jwt>`
    // stay in cleartext. Narrowing the class to [A-Za-z0-9] recovers those two
    // and reintroduces the full quadratic — see test/redact-jwt.test.ts.
    name: "jwt",
    pattern: /(?<![A-Za-z0-9_-])eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
    replacement: "eyJ[REDACTED]",
  },
```

- [ ] **Step 2: Run the tests and confirm GREEN.**

```
pnpm --filter @megasaver/policy test -- redact-jwt
```

Expected: 7 passed, 0 failed, and the whole file now completes in well under a second — the three timing tests drop from ~8.3 s each to sub-millisecond, so total runtime falls from ~25 s to under 1 s. That runtime collapse is itself the fix's smoke evidence.

- [ ] **Step 3: Confirm no existing suite regressed.**

```
pnpm --filter @megasaver/policy test
```

Expected: every existing suite still passes untouched, including `redact.test.ts:11`, which carries `eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4` at start-of-string — a preserved carrier per §5.

- [ ] **Step 4: Amend the §5a lock table.**

In `docs/superpowers/specs/2026-05-10-bb3-policy-design.md`, replace line 316:

```
| jwt               | `eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+` | `eyJ[REDACTED]`            |
```

with:

```
| jwt †             | `(?<![A-Za-z0-9_-])eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+` | `eyJ[REDACTED]` |
```

- [ ] **Step 5: Add the footnote under the table.**

The table's last row is `db_url` on line 319 and line 320 is blank. Insert the footnote as a new paragraph on line 320, so line 321's blank line separates it from `Order is application order`:

```
† `jwt` amended 2026-07-20 by
[[docs/superpowers/specs/2026-07-20-jwt-redos-fix-design]] — a leading
lookbehind was added to remove a quadratic ReDoS (8.4 s at 313 KiB). The
behavior difference is intended and scoped by that spec §5: a JWT preceded
directly by a base64url character, including `-` and `_`, no longer redacts.
The lock otherwise stands; amend this row, never rewrite it silently.
```

- [ ] **Step 6: Lint and typecheck.**

```
pnpm --filter @megasaver/policy lint:fix
pnpm --filter @megasaver/policy typecheck
```

Expected: biome reports the files as formatted (the pattern line is 88 characters, inside the repo's 100 `lineWidth`), and typecheck exits 0 — now covering `test/` because of Task 1.

- [ ] **Step 7: Commit.**

```
git add packages/policy/src/redaction-patterns.ts packages/policy/test/redact-jwt.test.ts docs/superpowers/specs/2026-05-10-bb3-policy-design.md
git status --short
git commit -m "fix(policy): make jwt detector linear" -m "Every eyJ inside a dotless base64url run was a start position that scanned to end-of-input before failing the mandatory separator: O(n) starts x O(n) length, measured 8,374 ms on 313 KiB against 'eyJaA0'.repeat(n). A leading (?<![A-Za-z0-9_-]) rejects glued starts before any scanning, taking the same input to 0.45 ms. Accepted and recorded in the design spec §5: a JWT preceded directly by a base64url character, including - and _, no longer redacts, so session-<jwt> and id_token_<jwt> stay in cleartext; narrowing the class to recover them reintroduces the quadratic at 7,494 ms. The BB3 §5a lock table is amended in this commit because it records the pattern verbatim and is where the lock is declared."
```

Expected: `git status --short` shows exactly three paths staged. Subject is 37 characters, inside the 50-character limit.

---

### Task 6: Equivalence corpus with the captured byte literals (§6.1)

**Files:**
- Modify: `packages/policy/test/redact-jwt.test.ts`

**This test does not have a RED phase, by design.** Its whole purpose is that the fix changed nothing here — it is green before and after. The RED evidence for equivalence is Task 2's `diffs=0` line, produced by running the old pattern outside the repo. The old pattern is deliberately not compiled into this file (§6.1): a 7.5-second regex living under a 30-second `testTimeout` is a trap for the first contributor who appends a many-start case.

---

- [ ] **Step 1: Append the equivalence corpus.**

Append to the end of `packages/policy/test/redact-jwt.test.ts`:

```ts
const jwtOf = (headerPad: number, payloadPad: number, sigLen: number): string => {
  const header = `eyJhbGciOiJIUzI1NiJ9${"H".repeat(headerPad)}`;
  const payload = `eyJzdWIiOiIxMjM0NTY3ODkwIn0${"P".repeat(payloadPad)}`;
  return `${header}.${payload}.${"S".repeat(sigLen)}`;
};

// Expected values were captured by running the PRE-FIX quadratic pattern over
// these same inputs outside the repo (fix spec §6.1) and frozen as literals, so
// the old pattern never enters CI. Assertions are pattern-level, not through
// redact(): bearer_token sits at index 5 and jwt at index 6, so in the real
// pipeline bearer_token consumes the Authorization case before jwt sees it.
const EQUIVALENCE: ReadonlyArray<readonly [string, string, string]> = [
  ["hs256_minimal", SAMPLE_JWT, "eyJ[REDACTED]"],
  ["rs256_typical", jwtOf(40, 120, 342), "eyJ[REDACTED]"],
  ["rs512_large_sig", jwtOf(40, 120, 684), "eyJ[REDACTED]"],
  ["id_token_8kb_payload", jwtOf(40, 8192, 342), "eyJ[REDACTED]"],
  ["payload_16kb", jwtOf(40, 16384, 342), "eyJ[REDACTED]"],
  ["x5c_header_3kb", jwtOf(3072, 120, 342), "eyJ[REDACTED]"],
  ["carrier_equals", `token=${SAMPLE_JWT}`, "token=eyJ[REDACTED]"],
  ["carrier_colon", `token:${SAMPLE_JWT}`, "token:eyJ[REDACTED]"],
  ["carrier_dquote", `"${SAMPLE_JWT}"`, '"eyJ[REDACTED]"'],
  ["carrier_semicolon", `a=1;${SAMPLE_JWT}`, "a=1;eyJ[REDACTED]"],
  ["carrier_space", `token ${SAMPLE_JWT}`, "token eyJ[REDACTED]"],
  ["carrier_newline", `line1\n${SAMPLE_JWT}`, "line1\neyJ[REDACTED]"],
  ["carrier_start_of_string", `${SAMPLE_JWT} trailing`, "eyJ[REDACTED] trailing"],
  ["bearer_header", `Authorization: Bearer ${SAMPLE_JWT}`, "Authorization: Bearer eyJ[REDACTED]"],
];

describe("jwt detector — output frozen against the pre-fix pattern (fix spec §6.1)", () => {
  for (const [label, input, expected] of EQUIVALENCE) {
    it(`redacts ${label} byte-identically to the pre-fix pattern`, () => {
      expect(apply(input)).toBe(expected);
    });
  }
});
```

- [ ] **Step 2: Run and confirm GREEN.**

```
pnpm --filter @megasaver/policy test -- redact-jwt
```

Expected: 21 passed, 0 failed (1 structural + 3 timing + 3 non-match + 14 equivalence), completing in under a second.

- [ ] **Step 3: Prove the corpus is not vacuous.**

A corpus of all-identical expected strings is worth nothing if `apply` silently no-ops. Temporarily change `carrier_equals`'s expected value from `"token=eyJ[REDACTED]"` to `"token=NOPE"`, re-run, and confirm exactly one failure:

```
AssertionError: expected 'token=eyJ[REDACTED]' to be 'token=NOPE'
```

Then restore the literal and re-run to 21 passed. Do not commit the mutated value.

- [ ] **Step 4: Lint, typecheck, commit.**

```
pnpm --filter @megasaver/policy lint:fix
pnpm --filter @megasaver/policy typecheck
git add packages/policy/test/redact-jwt.test.ts
git status --short
git commit -m "test(policy): freeze jwt output across the fix" -m "Fourteen cases — six token shapes up to a 16 KB payload and a 3 KB x5c header, plus every delimiter carrier the design keeps — asserted against byte literals captured by running the pre-fix quadratic pattern outside the repo. Pinning without compiling the old pattern into CI, where a 7.5-second regex under a 30-second testTimeout would ambush the first contributor to append a many-start case. Assertions are pattern-level because bearer_token consumes the Authorization case ahead of jwt in the real pipeline."
```

Expected: one file staged; subject is 46 characters.

---

### Task 7: Sibling plan edits and the recorded collisions

**Files:**
- Modify: `docs/superpowers/plans/2026-07-19-redaction-baseline-extension-plan.md`

Spec §8: that plan is written, hardcoded, and unexecuted, so drift is silent until someone runs it and reads a stale RED as a bug. Three edits are mandated there; a fourth follows from Task 1 of this plan and is marked as such.

---

- [ ] **Step 1: §8 edit 1 — the Task 1 snapshot literal (line 171).**

Replace:

```ts
      source: "eyJ[A-Za-z0-9_-]+\\.eyJ[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+",
```

with:

```ts
      source: "(?<![A-Za-z0-9_-])eyJ[A-Za-z0-9_-]+\\.eyJ[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+",
```

Without this, that plan's Task 1 asserts GREEN against unmodified source and fails, looking like a broken snapshot rather than a landed fix.

- [ ] **Step 2: §8 edit 2 — the "single intended exception" framing (line 20).**

Replace:

```
- Task 1 pins `private_key_block` in its **current** form so it is green against unmodified source; Task 3 flips that one snapshot entry as part of its own commit. That is the single intended exception to the lock.
```

with:

```
- Task 1 pins `private_key_block` in its **current** form so it is green against unmodified source; Task 3 flips that one snapshot entry as part of its own commit. That is this plan's only intended exception to the lock. There are **two** amended entries overall: `jwt` was already amended on `main` by `docs/superpowers/specs/2026-07-20-jwt-redos-fix-design.md`, so Task 1's snapshot pins the fixed `jwt` source from the start and Task 3 still flips exactly one entry.
```

Then re-check Task 3's calibration at line 632 and replace:

```
single deliberate exception to the §2 no-behaviour-change invariant.
```

with:

```
only deliberate exception to the §2 no-behaviour-change invariant introduced by
this plan; the `jwt` amendment landed separately on `main` before Task 1 ran.
```

Task 3's mutation check itself needs no change — it exercises `aws_access_key` (`{16}` → `{15}`), not `jwt`, so its calibration survives.

- [ ] **Step 3: §8 edit 3a — the Task 6 §9.5 exclusion comment (lines 2445–2450).**

Replace:

```ts
// §9.5 — timed against the NEW detector tier only. The LOCKED `jwt` detector is
// deliberately excluded: it is already strongly super-linear at these scales
// (31 / 114 / 437 / 1850 ms against 'eyJaA0'.repeat(n), one run peaking at
// 7268 ms), a pre-existing exposure this change neither introduces nor is
// scoped to fix. The design locks the detector and tracks the fix as its own
// chain; gating it here would fail CI on day one for an out-of-scope defect.
```

with:

```ts
// §9.5 — timed against the new detector tier AND the locked `jwt` detector. The
// jwt exclusion this gate originally carved out is gone: the quadratic it named
// was fixed on 2026-07-20 by a leading (?<![A-Za-z0-9_-]) lookbehind, taking
// 313 KiB of 'eyJaA0'.repeat(n) from 8,374 ms to 0.45 ms. jwt now clears this
// ceiling by three orders of magnitude, so there is no reason to exempt it.
```

Then bring `jwt` into that gate's scope. **Do not add a `jwt` key to
`ADVERSARIAL_SEEDS`** (line 2458): the per-detector loop iterates `NEW_TIER`,
not that record, so a key there would not be timed — and the reverse-coverage
test at line 2561 (`orphans`, seeds whose name is absent from `NEW_TIER`) would
fail, because `jwt` is a baseline detector and never enters `NEW_TIER`. Add a
dedicated block instead, modeled on the `openai_project_key` 313 KiB case, after
the block ending at line 2549:

```ts
// The locked jwt detector, timed here since 2026-07-20 removed its quadratic.
// Three seeds: narrowing the lookbehind to (?<![A-Za-z0-9]) leaves 'eyJaA0' at
// 0.46 ms while '-eyJaA' costs 7,494 ms and '_eyJaA' costs 7,561 ms.
describe("redos — locked jwt detector at the measured blow-up scale (§9.5)", () => {
  const detector = REDACTION_PATTERNS.find((entry) => entry.name === "jwt");
  if (detector === undefined) throw new Error("jwt not in REDACTION_PATTERNS");

  for (const seed of ["eyJaA0", "-eyJaA", "_eyJaA"]) {
    it(`stays under ${CEILING_MS}ms at ${OPENAI_SCALE_KIB} KiB of ${seed}`, () => {
      const ms = elapsedMs(
        detector.pattern.source,
        detector.pattern.flags,
        padding(seed, OPENAI_SCALE_KIB),
      );
      expect(ms).toBeLessThan(CEILING_MS);
    });
  }
});
```

That plan's Step 4 currently expects `31 tests pass (28 per-detector + 313 KiB +
2 coverage)` at line 2579. Update it to `34 tests pass (28 per-detector +
313 KiB + 3 jwt seeds + 2 coverage)`, or its own expected output goes stale.

- [ ] **Step 4: §8 edit 3b — the Task 6 commit-message body (line 2631).**

That body ships a falsehood into git history the moment it is executed. Replace the `-m` body with:

```
Every detector in the new tier is timed against its own repeated literal prefix at 20/39/78/156 KiB, with openai_project_key additionally at 313 KiB — the scale where the unbounded form of its runs measures 12.3 s against 12.4 ms bounded. The locked jwt detector is inside the ceiling too: its quadratic was fixed on 2026-07-20 and it now clears the gate by three orders of magnitude, so the exemption this test originally carried has been removed.
```

- [ ] **Step 5: Additional edit (beyond §8) — the typecheck-wiring fact.**

Task 1 of *this* plan already wired `tsc -p tsconfig.test.json --noEmit`, so that plan's line 18 fact is stale and its Task 1 wiring step will not find its old string. Replace line 18:

```
- `packages/policy` does **not** typecheck its tests: the script is `tsc -b --noEmit` and `tsconfig.json` excludes `test`. `tsconfig.test.json` exists but nothing invokes it. Task 1 wires it up, matching the `packages/core` and `apps/cli` precedent.
```

with:

```
- `packages/policy` typechecks its tests as of 2026-07-20: the script is `tsc -b --noEmit && tsc -p tsconfig.test.json --noEmit`, wired by the jwt ReDoS fix branch, matching the `packages/core` and `apps/cli` precedent. Task 1's wiring step is therefore already satisfied — verify with `pnpm --filter @megasaver/policy typecheck` and skip the edit.
```

- [ ] **Step 6: Record the collision that needs no edit.**

Append to that plan's load-bearing facts list (after the line edited in Step 5):

```
- **No edit needed, recorded so the merge is expected rather than investigated:** Task 5's structural ordering test derives leading literals from `pattern.source` with a helper that stops at any `(` which is not `(?:`. The jwt fix changes `leadingLiterals(jwt)` from `["eyJ"]` to `[]` — identical to how the eleven existing lookbehind-gated entries already behave, so the test needs no change.
```

- [ ] **Step 7: Verify no stale claim survives.**

```
grep -n "super-linear" docs/superpowers/plans/2026-07-19-redaction-baseline-extension-plan.md
```

Expected: only lines inside that plan's **Task 10 wiki bodies** (around lines 3340, 3385, 3453) still say `super-linear`. Those are wiki text the plan writes when *it* executes, and Task 8 of this plan writes the corrected record to the same wiki pages first. Leave them: rewriting another plan's wiki payload is out of §8's scope, and Task 8's superseding entry is what the reader lands on. Note the three line numbers in the PR body so the reviewer sees the choice was deliberate.

- [ ] **Step 8: Commit.**

```
git add docs/superpowers/plans/2026-07-19-redaction-baseline-extension-plan.md
git status --short
git commit -m "docs(plan): retarget extension plan at fixed jwt" -m "That plan is written and unexecuted, and Task 1 hardcodes jwt's pattern source in its frozen snapshot, so landing this fix first turns a correct plan into a silent RED. Updates the snapshot literal, extends the single-exception framing to name the jwt amendment, removes the ReDoS gate's jwt exclusion from both the test comment and its committed commit-message body, and marks the typecheck wiring as already done. The ordering-test collision is recorded as needing no edit."
```

Expected: one file staged; subject is 48 characters.

---

### Task 8: Changeset, wiki, and full verification

**Files:**
- Create: `.changeset/jwt-redos-fix.md`
- Modify: `wiki/entities/policy.md`
- Modify: `wiki/log.md`

---

- [ ] **Step 1: Write the changeset.**

Create `.changeset/jwt-redos-fix.md`:

```md
---
"@megasaver/policy": patch
---

Fix a quadratic ReDoS in the `jwt` redaction detector: a leading
`(?<![A-Za-z0-9_-])` lookbehind rejects start positions glued to a base64url
character, taking 313 KiB of adversarial input from 8,374 ms to 0.45 ms.

**Behavior change:** a JWT preceded directly by a base64url character —
including `-` and `_`, so `session-<jwt>` and `id_token_<jwt>` — no longer
redacts and stays in cleartext. This is intended and accepted per
`docs/superpowers/specs/2026-07-20-jwt-redos-fix-design.md` §5: the `-` and `_`
characters must stay in the lookbehind class, because narrowing it to
`(?<![A-Za-z0-9])` recovers those two shapes and reintroduces the full
quadratic (7,494 ms at the same scale). Every standard JWT carrier — `=`, `:`,
`"`, `;`, whitespace, start-of-string — is preserved, and 14 frozen cases
assert byte-identical output against the pre-fix pattern.

Patch rather than minor: no API surface changes. `redact`,
`redactWithFindings`, `redactForLedger`, `RedactResult`, and the `jwt` finding
name are all unchanged.
```

- [ ] **Step 2: Update `wiki/entities/policy.md`.**

Append a new section at the end of the file, matching the existing `## v1.1 / post-v1.0 (2026-06-03)` section's style:

```md
## jwt detector ReDoS fix (2026-07-20)

The LOCKED §9d `jwt` detector was quadratic. Root cause, established by
measurement rather than reading: every `eyJ` occurrence is a candidate start,
`[A-Za-z0-9_-]+` greedily consumes to the end of the class run, the mandatory
`\.` fails, and the engine backtracks one character at a time — so each start
costs O(remaining length) and there are O(n) starts. Isolating the variables
confirms it: 39 KiB with 6,800 starts costs 204 ms; the same 39 KiB with one
start costs 0.0 ms. The driver is start count, not run length.

An earlier note blamed "the separator is not excluded from the character
class". That is wrong — `[A-Za-z0-9_-]` does not match `.`, so excluding the
dot is a no-op.

Fix: one leading `(?<![A-Za-z0-9_-])`. Inside a dotless run every `eyJ` after
the first is preceded by a class character and is rejected before any scanning,
collapsing O(n) useless starts to O(1). 313 KiB: 8,374 ms → 0.45 ms.

**Corrected severity: adversarially reachable, not ordinarily reachable.** The
original follow-up claimed the blowup was reachable from ordinary base64-heavy
logs, citing 9.93 ms for a 24.6 KiB base64 run. Re-measured: 0.00 ms. Random
base64url contains `eyJ` with probability ≈ (1/64)³ ≈ 1/262,144 per position,
so a 24 KiB blob holds ~0.1 occurrences. Text full of *real* JWTs is also fast —
the dots satisfy `\.` immediately. The blowup needs many `eyJ` occurrences in
text containing no dots, which is a crafted payload. Still CRITICAL-tier: the
redactor processes untrusted agent output, tool results, and Hot Handoff
packets authored elsewhere, and a crafted payload stalls every sink.

Accepted trade-off: a JWT glued to `[A-Za-z0-9_-]` no longer redacts, so
`session-<jwt>` and `id_token_<jwt>` stay in cleartext. The `-` and `_` must
stay in the class — narrowing to `(?<![A-Za-z0-9])` recovers both and restores
the quadratic (7,494 ms / 7,561 ms at 313 KiB). Two rejected alternatives were
measured, not assumed: segment-length bounds are 40x slower *and* drop a 3 KB
x5c header and a 16 KB ID token entirely; atomic-group emulation is
byte-identical but does not fix the performance (5,870 ms), because the cost is
scanning at every start, not the backtracking.

The BB3 §5a lock table was amended in the same commit with a footnote naming
the spec, since that table is where the lock is declared and it records the
pattern verbatim. `test/redact-jwt.test.ts` carries a structural gate on
`pattern.source`, a 313 KiB timing gate across three seeds (`eyJaA0`, `-eyJaA`,
`_eyJaA` — the last two catch the narrowing edit), explicit non-match
assertions for the §5 shapes, and 14 frozen equivalence cases. policy@1.2.3.

Sources: [[docs/superpowers/specs/2026-07-20-jwt-redos-fix-design]],
[[docs/superpowers/specs/2026-05-10-bb3-policy-design]].
```

- [ ] **Step 3: Append to `wiki/log.md`.**

`wiki/log.md` is `type: append-only` — do **not** edit the existing
`## [2026-07-20] plan | Redaction baseline extension planned (CRITICAL)` entry
whose closing lines carry the original overstatement. Append at the bottom:

```md
## [2026-07-20] fix | jwt detector ReDoS fixed (CRITICAL)

One-line fix on `packages/policy/src/redaction-patterns.ts`: a leading
`(?<![A-Za-z0-9_-])` on the LOCKED `jwt` detector. 313 KiB of
`'eyJaA0'.repeat(n)` goes from 8,374 ms to 0.45 ms — quadratic to linear,
~17,400x. Root cause is start-position count, not run length: 39 KiB with 6,800
`eyJ` starts costs 204 ms, the same 39 KiB with one start costs 0.0 ms.

**Supersedes the severity claim in the entry above.** That entry filed this as
"reachable from ordinary base64-heavy logs". Re-measured, that is wrong: a
24.6 KiB unbroken base64 run costs 0.00 ms, because random base64url holds `eyJ`
about once per 262,144 positions. Text full of real JWTs is fast too — the dots
satisfy the mandatory separator immediately. The correct classification is
**adversarially reachable, not ordinarily reachable**: it needs a crafted
payload with many `eyJ` occurrences and no dots. It stays CRITICAL-tier because
the redactor sits on untrusted agent output, tool results, and Hot Handoff
packets, where a crafted payload stalls every sink.

The earlier note's stated root cause ("the separator is not excluded from the
character class") was also wrong — `[A-Za-z0-9_-]` does not match `.`.

Accepted trade-off (spec §5): a JWT glued to a base64url character, including
`-` and `_`, no longer redacts; `session-<jwt>` and `id_token_<jwt>` stay in
cleartext, asserted explicitly so nobody narrows the class back into the
quadratic. BB3 §5a lock table amended with a footnote in the same commit. The
unexecuted redaction-baseline extension plan was retargeted: snapshot literal,
single-exception framing, and the ReDoS gate's jwt exclusion (comment and
committed commit-message body) all updated, and `jwt` brought into that gate's
scope. Sources:
[[docs/superpowers/specs/2026-07-20-jwt-redos-fix-design]], [[entities/policy]].
```

- [ ] **Step 4: Run full verification.**

```
pnpm verify
```

Expected: `pnpm lint` (biome check .) clean, `pnpm typecheck` (turbo typecheck — now including `tsc -p tsconfig.test.json` for policy) clean, `pnpm test` (turbo test) all packages green, `pnpm conventions:check` clean (no `docs/conventions/` file was touched, so no mirror can have drifted).

- [ ] **Step 5: Capture the feature smoke evidence.**

Record for the verifier, alongside Task 2's capture output:

```
pnpm --filter @megasaver/policy test -- redact-jwt
```

Expected: `21 passed (21)` with a total duration under one second. The contrast against Task 3's ~25-second RED run is the smoke evidence that the vulnerability was present and is gone.

- [ ] **Step 6: Commit.**

```
git add .changeset/jwt-redos-fix.md wiki/entities/policy.md wiki/log.md
git status --short
git commit -m "docs(policy): record jwt redos fix in wiki" -m "Corrects the severity classification the original follow-up carried: adversarially reachable, not reachable from ordinary base64-heavy logs, which re-measures at 0.00 ms. log.md is append-only, so the superseding entry names the overstated one rather than editing it. The changeset states the behavior change in its body because a silent security-relevant behavior change under a patch bump is the part that would bite."
```

Expected: three files staged; subject is 42 characters.

---

## Definition of done

1. Spec exists — `docs/superpowers/specs/2026-07-20-jwt-redos-fix-design.md`. ✓
2. This plan exists. ✓
3. Tests written first — Tasks 3 and 4 are RED against shipped code before Task 5 touches `src/`. The equivalence corpus (Task 6) is the one exception, and it is deliberate: its RED evidence is Task 2's out-of-repo differential, because compiling the old pattern into CI is forbidden by spec §6.1.
4. `pnpm verify` green — Task 8 Step 4.
5. Feature smoke evidence — Task 2's old-vs-new capture (8,374 ms → 0.45 ms, `diffs=0`) plus Task 8 Step 5's runtime collapse.
6. External reviewer pass — **`code-reviewer` AND `critic`, separate passes**, author ≠ reviewer (CRITICAL tier, `CLAUDE.md` §12).
7. `omc:tracer` evidence loop and `omc:security-reviewer` — both mandatory at CRITICAL. Task 2's stdout is the tracer's input.
8. `omc:verify` verifier pass with reproduction evidence.
9. Zero pending TodoWrite items.
10. Changeset added — Task 8 Step 1.
11. `CLAUDE.md` / `AGENTS.md` / `.cursor/rules` — **no change needed**; no `docs/conventions/` file is touched.

`autopilot`, `ralph`, and any unsupervised loop are **forbidden** on this branch.

---

## Rollback

The functional change is one line. To revert behavior without unwinding the paperwork, restore `packages/policy/src/redaction-patterns.ts:51` to the pre-fix pattern and delete `packages/policy/test/redact-jwt.test.ts` — that reinstates an 8.4-second stall on 313 KiB of crafted input, so this is a last resort, not a mitigation.
