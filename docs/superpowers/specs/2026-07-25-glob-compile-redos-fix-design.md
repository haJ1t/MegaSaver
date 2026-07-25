# `compileGlob` Catastrophic Backtracking Fix — Design

- **Date:** 2026-07-25
- **Status:** user-approved design (2026-07-25). Approach chosen after the
  originally-proposed fix — "collapse runs of adjacent unbounded
  quantifiers" — was **disproven by measurement** (§3). Not yet reviewed;
  `code-reviewer`, `critic`, and `security-reviewer` passes are required
  before merge.
- **Risk:** HIGH (§12 — policy denylist core path). `compileGlob` backs
  `SECRET_PATH_PATTERNS`, the read-gate denylist. A change that altered
  what an accepted pattern matches would be a denylist **bypass**, not a
  slowdown. The chosen approach is selected specifically because it
  changes zero matching semantics (§5). Worktree required; no `main`
  edits. Mandatory: full chain + `architect` + `critic` +
  `security-reviewer`.
- **Origin:** found while evaluating whether `ProjectRule.appliesTo`
  should carry a length bound (`packages/core/src/project-rule.ts:24`).
  The bound was rejected; the investigation surfaced this instead.
  Pre-existing in shipped code since the BB3 policy package (`61efb28b`);
  no in-flight branch introduced it.

---

## 1. Problem

`compileGlob` (`packages/policy/src/secret-paths.ts:26`) compiles a glob
to an anchored, case-insensitive `RegExp`. Consecutive wildcard tokens
compile to **multiple unbounded quantifiers in one pattern**. On a
subject that does **not** match, the engine explores every way to
partition the subject among those quantifiers — exponential time.

Three consumers:

| consumer | file | exposure |
|---|---|---|
| `SECRET_PATH_PATTERNS` | `secret-paths.ts:57` | fixed compile-time list, max 2 quantifiers — **not** exploitable |
| `parseProjectPermissions` | `parse-project-permissions.ts:56` | user-supplied `.megasaver/permissions.yaml` `deny.read` / `deny.write` globs |
| `rankApplicableRules` | `packages/core/src/project-rule-ranking.ts:18` | agent-supplied `ProjectRule.appliesTo`, per (rule, glob, file) triple, no cache |

Non-matching input is the **common** case in ranking — most rules do not
apply to most files — so the pathological path is the hot path.

### 1a. Measurements

All on Node (macOS), subject
`packages/core/src/project-rule-ranking.ts` (41 chars, non-matching):

| glob | length | time |
|---|---:|---:|
| `'*'*12 + 'x'` | 13 | 58 ms |
| `'*'*14 + 'x'` | 15 | 426 ms |
| `'*'*16 + 'x'` | 17 | **3,135 ms** |
| `'*'*18 + 'x'` | 19 | >15,000 ms (killed) |
| `'**/'*85` | 256 | 228 ms |
| `'**/'*200` | 601 | 20,181 ms |

A **17-character** glob costs over three seconds. Length is not the
governing variable (§3), so a length cap does not fix this.

### 1b. Why the shipped denylist is not itself exploitable

Every entry in `DENYLIST_GLOBS` compiles to at most **2** crossing
quantifiers (counted in §4). The list is a compile-time constant. The
reachable attack surface is the two *user-supplied* paths in the table
above.

---

## 2. Root cause

The scanner emits three unbounded forms:

| glob token | emitted | crosses `/`? |
|---|---|---|
| `**/` | `(?:.*/)?` | yes |
| `**` (not followed by `/`) | `.*` | yes |
| `*` (lone) | `[^/]*` | **no** |
| `?` | `[^/]` | bounded, single char |

`**` pairs greedily left-to-right, so `"*".repeat(2n)` emits `n`
adjacent `.*`. Against a subject of length `m`, a failing match explores
~`C(m+n-1, n-1)` partitions.

---

## 3. Why the originally-proposed fix was rejected

The proposal was to collapse runs of adjacent unbounded quantifiers
(`.*.*` → `.*`, `(?:.*/)?(?:.*/)?` → `(?:.*/)?`). Two measured shapes
defeat it:

| shape | glob | emits | length | time |
|---|---|---|---:|---:|
| alternating | `'**/**'*8 + 'x'` | `(?:.*/)?.*(?:.*/)?.*…` | 41 | >12,000 ms |
| separated | `'**?'*12 + 'x'` | `.*[^/].*[^/]…` | 37 | >12,000 ms |

- **Alternating**: no two *identical* tokens are ever adjacent, so an
  identical-token collapse is a no-op.
- **Separated**: the quantifiers are not adjacent at all — a mandatory
  `[^/]` sits between them. **No collapse rule can merge them by
  construction.**

A collapse across *different* token types was also considered and
rejected as unsafe: the equivalences are order-dependent and subtle.
`(?:.*/)?[^/]*` ≡ `.*`, but `[^/]*(?:.*/)?` ≢ `.*` (it cannot match
`a/b`). Getting that algebra wrong in the denylist matcher is exactly the
bypass this spec must avoid.

**Conclusion:** the governing variable is the *count* of crossing
quantifiers in a pattern, not their adjacency and not the glob's length.

---

## 4. Chosen approach — reject pathological globs at compile time

Count crossing quantifiers as they are emitted. If the count exceeds a
cap, throw before constructing the `RegExp`.

### 4a. What counts

Only quantifiers that can cross `/`:

- `(?:.*/)?` (from `**/`) — **counted**
- `.*` (from `**`) — **counted**
- `[^/]*` (from a lone `*`) — **not counted**
- `[^/]` (from `?`) — **not counted**, bounded

`[^/]*` is excluded on evidence, not intuition. It cannot cross a
separator, so each instance is bounded by one path segment, and the
scanner never emits two of them adjacently (two consecutive `*` pair
into `**`). Measured: a glob with 32 `[^/]*` runs in **0.10 ms**.
Counting them would reject legitimate patterns like `src/*/*/*/*.ts`
for no benefit.

### 4b. Cap = 3

Worst observed single-match time by crossing-quantifier count, across
adversarial shapes and subjects of 41 / 128 / 256 chars:

| count | 1 | 2 | 3 | 4 | 5 |
|---|---:|---:|---:|---:|---:|
| worst ms | 0.37 | 1.34 | **57** | **252** | **>10,000** |

The cliff is between 3 and 5. Cap of 3 was verified against adversarial
shapes that hold the crossing count at 3 while maximising uncounted
tokens — worst case 57 ms, and `manysegstar` (32 uncounted quantifiers)
at 0.10 ms.

Every shipped `DENYLIST_GLOBS` entry is ≤2:

```
1  **/.env                      2  **/.gcp/**            1  **/id_ed25519
2  **/.env.*                    2  **/.azure/**          2  **/*.pem
2  **/.ssh/**                   2  **/private_keys/**    2  **/*.key
1  **/.aws/credentials          2  **/secrets/**         1  **/credentials.json
1  **/.aws/config               1  **/id_rsa             2  **/service-account*.json
```

Cap 3 therefore leaves one slot of headroom over every shipped pattern
and keeps legitimate user globs such as `**/a/**/b/**` working. Cap 2
would leave zero headroom and reject that pattern; cap 4 admits a 252 ms
single match.

### 4c. Why this approach and not a linear matcher

A DP/NFA matcher would eliminate the bug class outright and reject
nothing. It was considered and set aside for this change because it
rewrites the matcher backing the secret denylist, which makes "did
matching semantics shift?" the central review question.

The chosen approach makes that question trivially answerable: the
counter does not touch the `body` string. An accepted glob compiles to a
**byte-identical** `RegExp` to today's. A pattern either behaves exactly
as it does now, or refuses to compile. **A denylist bypass is impossible
by construction** — the property that matters most at this risk level.

The cost is honest and stated: pathological-but-harmless globs (e.g.
`'**/'*4`, semantically equivalent to `**/`) are refused rather than
normalised. No such glob exists in the repo or in any realistic use.

---

## 5. Changes

### 5a. `packages/policy/src/secret-paths.ts`

- Add `MAX_CROSSING_QUANTIFIERS = 3` with the §4b measurements as the
  WHY comment.
- Add `GlobCompileError extends Error`, carrying the offending glob and
  the observed count. Exported from `packages/policy/src/index.ts`.
- `compileGlob` increments a local counter at the `(?:.*/)?` and `.*`
  emit sites only, and throws `GlobCompileError` before `new RegExp` if
  the count exceeds the cap.
- The `body` construction is otherwise untouched.

### 5b. `packages/policy/src/parse-project-permissions.ts`

Wrap the two `.map(compileGlob)` calls; catch `GlobCompileError` and
rethrow as `PolicyLoadError`, mirroring how the zod failure is already
wrapped. The orchestrator continues to map that to `policy_load_failed`.
**The gate stays fail-closed** — a permissions file containing a
pathological glob is a load failure, never a silently-opened gate.

### 5c. `packages/core/src/project-rule-ranking.ts`

`appliesToMatches` catches `GlobCompileError` and returns `false`
(no match).

**This is the one deliberate asymmetry in the design and reviewers
should scrutinise it.** The two consumers take opposite failure
semantics on purpose:

- **policy** is a security gate → fail **closed** (throw).
- **ranking** is a scoring heuristic → **degrade** (skip the glob).

Justification for degrading in ranking: store reads are already
fail-closed at a coarser grain — `parseEntity`
(`packages/core/src/json-directory-store.ts:496`) throws
`CorePersistenceError` for the whole file, with no per-line recovery, so
letting a `GlobCompileError` propagate would take down `mega context`,
`rules list`, and brain export for the entire project because one stored
rule has a silly glob. Ranking has no security duty; skipping the glob
costs at most one missed suggestion.

---

## 6. Testing

TDD: every test below is written and observed failing before the fix.

1. **Red proof** — `'**/**'*8 + 'x'`, `'**?'*12 + 'x'`, `'*'*18 + 'x'`.
   Each currently exceeds 12 s. After the fix each must throw
   `GlobCompileError` within a small wall-clock budget. The assertion is
   on both the throw **and** the elapsed time; a throw alone would not
   prove the blowup is gone.
2. **Shipped denylist compiles** — every `DENYLIST_GLOBS` entry compiles
   without throwing. `SECRET_PATH_PATTERNS` is built at module load, so
   without this test a future 4-quantifier denylist addition would fail
   at **import** time in production rather than in CI.
3. **Boundary** — a 3-crossing-quantifier glob compiles; a
   4-crossing-quantifier glob throws. Uncounted tokens do not trip the
   cap: `src/*/*/*/*.ts` and a 32×`[^/]*` glob both compile.
4. **`parseProjectPermissions`** surfaces `PolicyLoadError` (not a raw
   `GlobCompileError`) for a pathological `deny.read` glob.
5. **`rankApplicableRules`** returns normally, and still ranks the
   remaining rules, when one rule carries a pathological glob.
6. **Differential property (fast-check, already a `packages/policy`
   devDependency; `redact.property.test.ts` sets the precedent).** For
   randomly generated globs that fall under the cap, assert the new
   `compileGlob(g).source` and `.flags` equal the **pre-fix**
   implementation's output. This mechanically proves the "zero semantic
   drift on accepted input" claim in §4c rather than resting it on
   argument. The reference implementation is inlined in the test file as
   a frozen copy of the current function.
7. Existing `evaluate-path-read.test.ts` and
   `parse-project-permissions.test.ts` stay green, unmodified.

---

## 7. Out of scope (stated, not silently narrowed)

- **Ranking fan-out.** `rankApplicableRules` remains
  O(rules × globs × files) with no cache. With the cap, a worst-case
  crafted rule set is bounded-but-slow (57 ms × fan-out) instead of
  unbounded. A `compileGlob` memo cache would **not** help — the cost is
  in `.test()`, not compilation. A per-call budget is the follow-up if
  this ever bites; there is no evidence it does today.
- **`ProjectRule.appliesTo` length bound.** Evaluated and rejected: a
  17-char glob already costs 3 s, so a length cap fixes nothing, and
  adding `.max()` to `projectRuleSchema` — a **read-back** schema —
  would make a previously-stored rule fail `parseEntity` and take down
  the whole rules file.
- **Replacing the regex matcher with a linear DP matcher** (§4c).
  Remains the option if rejection ever proves too blunt.

---

## 8. Definition of done

Per §9: spec (this file), plan, TDD red→green, `pnpm verify` green,
changeset (`@megasaver/policy` and `@megasaver/core` — `GlobCompileError`
is new public API and `compileGlob` gains a throw condition),
`code-reviewer` **and** `critic` **and** `security-reviewer` passes,
verifier pass with reproduction evidence.
