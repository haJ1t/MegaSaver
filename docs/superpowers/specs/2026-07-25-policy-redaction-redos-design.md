# Policy redaction ReDoS — instances 4 and 5

- **Date:** 2026-07-25
- **Risk:** HIGH (`CLAUDE.md` §12 — evidence-preserving compression / anything
  touching user files at scale; the change edits a LOCKED baseline detector and
  a security sink that every agent-visible output path routes through)
- **Class:** [[wiki/concepts/unbounded-run-redos]] instances 4 and 5
- **Scope:** `packages/policy/src/redaction-patterns.ts` only

## 0. What is broken

`redactWithFindings` (`packages/policy/src/redact.ts:17`) applies every entry of
`REDACTION_PATTERNS` and then every entry of `OBSERVED_PATTERNS` to the whole
input. Four of those patterns are quadratic in input length. Measured with
`String.prototype.replace` on a single pattern, 50 KB → 100 KB:

| pattern | shape | 50 KB | 100 KB | ratio |
|---|---|---|---|---|
| `aws_secret_key` | 100 KB of spaces | 2,206 ms | 9,412 ms | 4.27x |
| `basic_auth_header` | 100 KB of spaces | 1,894 ms | 8,350 ms | 4.41x |
| `api_key_header` | 100 KB of spaces | 1,280 ms | 7,606 ms | 5.94x |
| `api_key_header` | ` \t` alternation | 1,245 ms | 18,178 ms | 14.60x |
| `email` | `'a'.repeat(n)` | 6,049 ms | 23,098 ms | 3.82x |
| `email` | `'a.b_c1'.repeat(n)` | 3,065 ms | 5,934 ms | 1.94x |

A ratio above 2.0x per doubling is superlinear by definition. The `email` row
reproduces instance 4 (138 / 1,299 / 4,551 ms at 12.5 / 25 / 50 KB in the wiki);
the other three reproduce instance 5 (6,132 / 4,598 / 4,156 ms at 50 KB).

### Why each one is quadratic

**Instance 5 — three variable-length lookbehinds.** V8 evaluates a lookbehind
**right to left**. In `(?<=aws_secret_access_key\s*=\s*)` the *trailing* `\s*` is
therefore the first element tried: at every start position it consumes the whole
preceding whitespace run, requires `=`, fails, and gives back one character at a
time. That is O(run) work at O(n) start positions — O(n²). Same for the trailing
`\s*` of `api_key_header` and the trailing `\s+` of `basic_auth_header`.

**Instance 4 — `email`.** `[A-Za-z0-9._%+-]+@` is the plain class/literal form of
the class: an unbounded greedy run followed by a required literal that never
arrives, retried at every start position.

### Why it is reachable

Not adversarial. `apps/cli/src/commands/handoff/open.ts:98` runs
`redactWithFindings(git.diff.text)` over a whole git diff;
`packages/context-gate/src/record-output.ts:162` runs `redact(input.raw)` over
raw tool output. Column-padded tables, tab-indented logs and minified/identifier
blobs are all ordinary content, and there is no size cap ahead of the sink.

## 1. The LOCKED-table constraint

Two different locks apply, and they are not the same lock:

- `aws_secret_key` **is** row 5 of the §5a `REDACTION_PATTERNS` baseline table in
  `docs/superpowers/specs/2026-05-10-bb3-policy-design.md:299` (epic §9d, LOCKED
  for BB3). Its pattern bytes are transcribed there.
- `api_key_header` and `basic_auth_header` are **not** in that table. They are
  "Contextual secrets", appended after the ten baseline rows
  (`redaction-patterns.ts:88`). No §5a row to amend.
- `email` is not in the §5a table either; it is the one count-only observer of
  the §9d baseline (`2026-07-19-redaction-baseline-extension-design.md:25-26`).

The lock is **documentary, not mechanical** — there is no snapshot test pinning
pattern bytes (`grep -rn REDACTION_PATTERNS packages apps` finds only
`redact-jwt.test.ts`, which looks up the `jwt` entry by name). The lock's own
amendment procedure is established by precedent: the `jwt` row was amended twice
in 2026-07-20, both times for **this same defect class**, each time by adding a
dated footnote under the table and never by rewriting the row silently
(`2026-05-10-bb3-policy-design.md:325-345`). This spec follows that procedure for
the `aws_secret_key` row. `email` gets the same treatment in the same table's
footnote area even though it lives in `OBSERVED_PATTERNS`.

## 2. Approach, per pattern

One bound each. Nothing else changes — no new file, no size gate, no new export.

| pattern | change |
|---|---|
| `aws_secret_key` | trailing `\s*` → `\s{0,64}` |
| `api_key_header` | trailing `\s*` → `\s{0,64}` |
| `basic_auth_header` | `basic\s+` → `basic\s{1,64}` |
| `email` | local part `[A-Za-z0-9._%+-]+` → `[A-Za-z0-9._%+-]{1,64}` |

### Why only the trailing quantifier in each lookbehind

The *leading* `\s*` (the one directly after the key literal) is reachable only
after the `=` / `[:=]` has already matched, i.e. only from a start position
within 64 characters of such a delimiter. Making that set of start positions
Θ(n) requires one delimiter per ≤64 characters — which simultaneously caps the
leading run at ≤64, because the previous delimiter terminates it. The two
conditions are mutually exclusive, so the leading run is O(n) in total, not
O(n²). Measured: bounding it in addition changes nothing (both variants stay in
the 10–140 ms band at 200 KB across `ws=ws`, `ws:ws`, `(ws×500)basic(ws×500)`
and `(ws×64)=` shapes). It is therefore left alone — a bound that is not
load-bearing is a change that cannot be justified by a red test.

### Why a bound and not a size gate on the observer loop (instance 4)

The wiki records "a size gate on the observer loop may be a cheaper correct fix"
(`wiki/concepts/unbounded-run-redos.md:120-126`). It is not, for two reasons
found by reading the sink:

1. **`OBSERVED_PATTERNS` is not count-only everywhere.** `redactForLedger`
   (`redact.ts:53-59`) runs the *same* array and actually **replaces** — because
   an email must never persist into a ledger `sourcePath` label (F-FW-1). A gate
   in `redactWithFindings` leaves that second loop quadratic; a gate in both
   turns a DoS into an email leak above the cap. That is a strictly worse bug.
2. **A gate loses the count on exactly the inputs that matter.** Above the cap
   `observed` would report zero emails for a large git diff — the case the
   observer exists for.

The bound fixes both loops at once, at the root, and is a 3-character diff.

### Why 64 is the right bound

RFC 5321 §4.5.3.1.1 caps an email local part at 64 octets, so `{1,64}` cannot
truncate a deliverable address. For the three whitespace runs, 64 characters of
padding between a header/assignment key and its value is already wider than an
80-column terminal once the key name is counted; every real shape (`key=value`,
`key = value`, `Key: value`, column-aligned config) is far inside it.

## 3. What could regress

- **A secret stops being redacted.** The only inputs whose classification
  changes are: a key/value separated by **more than 64 whitespace characters**,
  and an email whose **local part exceeds 64 characters**. Mitigation: a positive
  test per touched pattern on a real header/assignment line, plus an equivalence
  sweep over the shapes that used to match (`§4`).
- **`email`'s count changes.** It does not: `{1,64}` is still greedy with
  backtracking, so a 100-character local part simply matches starting 36
  characters later — same single match at the same `@`, same count. Pinned by
  test.
- **A bound is added that does nothing.** Guarded by requiring each of the four
  bounds to go red *alone* when reverted (`§4`).
- **The guard test passes for the wrong reason.** The prior art
  (`wiki/concepts/unbounded-run-redos.md:142-172`) records a 5 s ceiling at 50 KB
  under which four of five reverted bounds stayed green. This spec uses a growth
  ratio through the real exported function, at 50 KB → 100 KB, with min-of-trials
  and a calibrated repeat count, per that page's "Prefer a growth ratio" section.

## 4. Verification

1. `packages/policy/test/redact-redos.test.ts` — growth ratio through
   `redactWithFindings` on the four triggering shapes. Red before the fix.
2. Same file: revert-one-bound proofs, one per bound, each confirmed red alone
   and restored.
3. Same file: positive redaction per touched pattern on a real line, plus an
   equivalence sweep asserting the bounded and unbounded forms agree on every
   shape that used to match.
4. `pnpm --filter @megasaver/policy test`, plus `context-gate`, `output-filter`
   and `core` — the packages that consume the redaction sinks.
5. `pnpm verify`.
