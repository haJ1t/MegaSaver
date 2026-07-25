# `compileGlob` Exponential-Backtracking + Metachar-Injection Fix — Design

- **Date:** 2026-07-25
- **Status:** user-approved design. Approach chosen after both originally
  proposed candidate fixes were **refuted by measurement** (§3); the user
  confirmed the linear-matcher approach and the inclusion of the
  `@megasaver/core` call site.
- **Risk:** CRITICAL (§12 — security gate). `compileGlob` is the single
  matcher behind the LOCKED §9a `DENYLIST_GLOBS` (`SECRET_PATH_PATTERNS`),
  the `.megasaver/permissions.yaml` `deny.read` / `deny.write` rules, and
  `ProjectRule.appliesTo` ranking. Mandatory chain: HIGH chain +
  `security-reviewer` + verifier with reproduction evidence + this manual
  user-confirmation record. Worktree required; `autopilot` / `ralph` /
  any unsupervised loop forbidden.
- **Origin:** reported as an exponential blowup in `**/`-chained globs.
  Measurement confirmed the report and found two further defects of the
  same root cause (§2).

---

## §1 Summary

`packages/policy/src/secret-paths.ts:26` compiles an untrusted glob string
into a `RegExp`. That is the root cause of three distinct defects. The fix
removes the regex entirely and matches the glob directly with a
non-backtracking NFA simulation.

## §2 The three defects, one root cause

`compileGlob` translates `**/` → `(?:.*/)?`, `**` → `.*`, `*` → `[^/]*`,
`?` → `[^/]`, `.` → `\.`, and emits **every other character raw** into the
regex body.

**D1 — chained wildcards backtrack exponentially.** The translations are
ambiguous: adjacent unbounded quantifiers admit many splits of the same
subject, and a non-matching subject forces the engine through all of them.
This is *not* specific to `**/` — all three wildcard forms blow up
identically. Measured against a 255-character subject (`k` = wildcard
count):

| k | `*a`×k, `/`-free subject | `**a`×k | `**/a`×k, segmented subject |
|---|---|---|---|
| 3 | 17.16 ms | 14.16 ms | 3.62 ms |
| 4 | 1,041.06 ms | 1,027.45 ms | 126.20 ms |
| 5 | 58,529.58 ms | 47,486.46 ms | 3,233.72 ms |
| 6 | — | — | 158,483.06 ms |

Compilation stays at 0.007–0.038 ms throughout; the cost is entirely in
`.test()`.

**D2 — regex metacharacters are injected verbatim.** `(`, `)`, `+`, `{`,
`}`, `|`, `[`, `]`, `^`, `$`, `\` all reach the regex body unescaped, so a
"glob" is a partially-interpreted regex. A **zero-wildcard** glob is
therefore a classic ReDoS:

| glob | `*` count | subject | time |
|---|---|---|---|
| `(a+)+b` | 0 | 28 × `a` | 1,130.3 ms |
| `(a\|a)+b` | 0 | 24 × `a` | 1,210.6 ms |

This is what makes any wildcard-counting cap unsound: the cap counts a
token that the exploit does not need.

**D3 — the same passthrough silently breaks matching.** A deny rule for an
ordinary filename containing a regex metacharacter does not deny:

| glob | path | today | correct |
|---|---|---|---|
| `**/a+b.txt` | `x/a+b.txt` | `false` | `true` |
| `**/file(1).txt` | `x/file(1).txt` | `false` | `true` |
| `**/[draft].md` | `x/[draft].md` | `false` | `true` |

D3 needs no crafted input — it is reachable with a legitimate filename,
and it is the same end state as D1: the gate does not deny, with no
operator signal.

## §2b Reachability

Three call sites compile untrusted globs through this one function:

1. `parseProjectPermissions` (`packages/policy/src/parse-project-permissions.ts:56-57`)
   — `deny.read` / `deny.write` from a checked-in `.megasaver/permissions.yaml`.
   Consumed by `packages/context-gate/src/read.ts` and
   `packages/daemon/src/handlers.ts:117` and `:258`.
2. `rankApplicableRules` (`packages/core/src/project-rule-ranking.ts:18`)
   — `ProjectRule.appliesTo`, user/agent-authored, compiled **per call
   inside a ranking loop** with no cache. Not covered by the original
   report.
3. `SECRET_PATH_PATTERNS` (`packages/policy/src/secret-paths.ts:57`) — the
   LOCKED §9a constants. Trusted; each shipped glob has at most one `**/`,
   so the shipped set is not itself vulnerable.

End-to-end, a `permissions.yaml` carrying `deny: read: ['**/a'×9 + '/x']`
drives `evaluatePathRead` to burn multiple seconds and then return
`{ allowed: true }`.

## §3 Rejected alternatives (refuted by measurement, not by argument)

- **Collapse consecutive `(?:.*/)?` groups.** Does not apply: the vector
  carries a literal between the groups, so no two are adjacent.
- **Rewrite `**/` as the unambiguous-looking `(?:[^/]*/)*`.** Measured
  **worse**, not better — 344.46 ms vs 126.20 ms at k=4, 9,060.93 ms vs
  3,233.72 ms at k=5. Verified language-equivalent over 18 cases first, so
  the rejection is on cost alone.
- **Cap the wildcard count at the zod boundary.** Unsound twice over. To
  hold, the cap must be ≤2 — k=3 already costs 17 ms, and 256 globs × 17 ms
  is 4.4 s per path evaluation — which rejects the shipped `**/*.pem` and
  `**/.ssh/**` shapes. And D2 bypasses it completely with zero wildcards.
- **`.max(256)` on the glob array.** Not adopted. It bounds the wrong
  axis: per-glob cost, not glob count, is what is unbounded today, and
  after this fix per-glob cost is linear. Adding it would only create a new
  way for a valid config to be rejected. Revisit if a real large-config
  case appears.

## §4 The fix

`compileGlob(glob: string): PathMatcher`, where
`PathMatcher = { test(path: string): boolean }`.

**Tokenize** the glob once, at compile time, into:

| token | meaning | replaces |
|---|---|---|
| `GlobStarSlash` | zero or more complete leading segments | `(?:.*/)?` |
| `GlobStar` | any run, `/` included | `.*` |
| `Star` | any run within one segment | `[^/]*` |
| `Any` | one character, not `/` | `[^/]` |
| `Literal(ch)` | exactly `ch` | everything else |

`Literal` is the default arm, so **every** non-glob character — including
every regex metacharacter — is matched literally. That closes D2 and D3.

**Match** by NFA simulation. Carry a boolean frontier `cur[i]` = "the first
_t_ tokens can consume `path[0..i)`", seeded `cur[0] = true`, and advance it
once per token with a single left-to-right sweep:

- `Literal(c)` / `Any` — `next[i+1] |= cur[i]` where the character agrees.
- `Star` — sweep with an `active` flag that sets on any `cur[i]` and clears
  at each `/`.
- `GlobStar` — same sweep, without the clear.
- `GlobStarSlash` — `next[i] |= cur[i]`, plus `next[i] |= active && path[i-1] === '/'`.

`test` returns `cur[path.length]` after the last token. Each token is one
O(pathLen) sweep, so the whole match is O(tokens × pathLen) with no
backtracking **by construction** — there is no bound to tune and no cap to
bypass. At 50 tokens × a 4096-character path that is ~200k boolean
operations.

Case-insensitivity (today the `i` flag) becomes `toLowerCase()` on the glob
at compile time and on the path at match time.

## §5 Equivalence obligation

The LOCKED §9a denylist must keep its exact verdicts. Three gates:

1. A frozen table over all 15 `DENYLIST_GLOBS` × a fixture path corpus,
   asserting matcher verdict == today's regex verdict.
2. A `fast-check` property (`fast-check` is already a `devDependency`)
   over random glob/path pairs drawn from a **metachar-free ASCII**
   alphabet, asserting identical verdicts.
3. Explicit divergence tests pinning the *intended* behaviour change: the
   D2 and D3 cases above.

The property is restricted to metachar-free ASCII deliberately. Outside
that alphabet the two implementations are *supposed* to disagree (that is
D2/D3), and case folding changes carrier — see §5b.

## §5b Case-folding divergence, measured

The regex `i` flag used Canonicalize, which explicitly refuses any
non-ASCII → ASCII mapping; the matcher uses `toLowerCase()`. On ASCII the
two are identical, so **all 15 LOCKED §9a globs are unaffected** — every
one is pure ASCII, asserted by a test. Off ASCII they differ, and for a
denylist only the *direction* matters:

| glob | path | regex `i` | `toLowerCase` | direction |
|---|---|---|---|---|
| `k` | `K` (U+212A KELVIN SIGN) | no match | match | tightens |
| `ß` | `ẞ` (U+1E9E) | no match | match | tightens |
| `å` | `Å` (U+212B ANGSTROM) | no match | match | tightens |
| `ς` (U+03C2) | `σ` (U+03C3) | **match** | **no match** | **weakens** |

Every divergence found tightens the gate except one: Greek final sigma
and medial sigma both uppercase to `Σ`, so Canonicalize unified them and
`toLowerCase` does not. Reaching it requires an operator to write `ς` in a
deny glob against a path carrying `σ`. The old unification was an artifact
of regex canonicalization rather than an intended rule, so this is
accepted, not fixed — emulating Canonicalize would mean carrying Unicode
tables for a case with no consumer. All four rows are pinned by tests so
the boundary is asserted rather than discovered later.

## §6 Test plan (TDD — RED first)

The first test drives **`evaluatePathRead`**, not `compileGlob`, through a
crafted `permissions.yaml` parsed by `parseProjectPermissions`, and asserts
both halves:

- a path the crafted glob **matches** returns `{ allowed: false, reason: 'secret_path_read' }`;
- a path it does not match returns `{ allowed: true }`;
- both inside a wall-clock ceiling.

Ceiling 250 ms with `{ retry: 3 }`, matching the convention established by
the `redact-jwt` timing gates. The separator is large: the pre-fix cost of
the crafted case is measured in tens of seconds, so the gate is not
sensitive to CI load — a quadratic is slow on every attempt.

Further RED tests: the D2 zero-wildcard `(a+)+b` case, the D3 literal-filename
cases, and a `rankApplicableRules` regression driving a hostile `appliesTo`
glob (call site 2).

## §7 Definition of done

`pnpm verify` EXIT 0; every new test verified red before green; `code-reviewer`
**and** `critic` **and** `security-reviewer` passes (CRITICAL tier, §12);
verifier pass with reproduction evidence; changeset; wiki updated
(`concepts/unbounded-run-redos` gains this as a distinct defect shape —
ambiguous-quantifier chaining and metachar injection, not the unbounded-run
shape that page currently describes — and `entities/policy`).
