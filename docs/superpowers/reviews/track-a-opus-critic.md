# Track A — adversarial review (critic)

- **Date:** 2026-07-29
- **Target:** `docs/saver-integrity-spec` @ `c1d37849`, checkout `/Users/ozger/Desktop/MegaSaver-review`
- **Mandate:** break the tests. Not "do they pass" — *do they pass for the right reason.*
- **Premise given:** the author confessed three false greens (self-consistent broken
  mapping; indiscriminate fixture; unit test green while the real path never changed).
  Assume more of the same class survived. It did — one instance of each.

## Method

`pnpm install --prefer-offline && pnpm build`, then `pnpm verify` — **green**, 60/60
turbo tasks, conventions ok. Baseline: all four target files pass (10 + 4 tests).

Every claim below is a **mutation receipt**: reintroduce the exact defect the spec
says it fixed, rerun, record the result. Mutations were applied to a disposable
`cp -a` copy under the session scratchpad, never to `MegaSaver-review`; that
checkout ends this review with `git status` showing zero source modifications.
`packages/context-gate` resolves `@megasaver/output-filter` through `dist/`, so
output-filter mutations were rebuilt before use — noted per finding.

---

## BLOCKER — `recovery-addressability.test.ts` passes with the A3 defect fully present

**Where:** `packages/context-gate/test/recovery-addressability.test.ts:92-115`,
`packages/context-gate/src/record-output.ts:122-132`

**Why it is wrong:** the test's stated contract is "delivered line numbers and stored
chunks must inhabit one coordinate system". It does not test that. It tests one
number: `result.rawLineCount`.

Two assertions, both non-discriminating for interior markers:

1. `Math.max(...namedLines) === rawLines.length` is satisfied by the **tail** marker
   alone, and the tail is emitted as `` `… [lines ${cursor}-${total} omitted]` `` where
   `total = result.rawLineCount` — a value read off the raw output *regardless* of
   which coordinate space `cursor` is in. The extent check can only catch a wrong
   `total`. It cannot see interior drift.
2. The per-marker loop resolves `start` to chunk `floor((start-1)/40)` and asserts that
   chunk contains `rawLines[start-1]`. Since `chunkByLines` cuts the raw output into
   fixed 40-line pieces, chunk `floor((start-1)/40)` contains raw line `start`
   **by construction, for every `start` in `[1, 1700]`**. The assertion is true for any
   marker value whatsoever. This is precisely the self-consistency trap the test's own
   comment at :85-91 says it is avoiding — and then walks into.

**Evidence:** mutation M6 — in `record-output.ts:125-126`, revert the interior markers
to post-collapse space (`e.startLine` / `e.endLine` instead of `e.rawStartLine` /
`e.rawEndLine`), leaving the tail's `total` alone. This *is* the §W3/A3 defect.

```
pnpm --filter @megasaver/context-gate exec vitest run test/recovery-addressability.test.ts
  ✓ recovery addressability (1 test)   Tests  1 passed (1)
```

Green. Dumping `result.returnedText` verbatim from the same `MUT6=1` run:

```
DELIVERED MUT6=1 first 6 lines:
DELIVERED| 162 kept, 741 dropped
DELIVERED| … [lines 1-1 omitted]
DELIVERED| … [800 similar: <ts> heartbeat]
DELIVERED| … [lines 3-3 omitted]
DELIVERED|   at moduleLoader.require (/repo/src/pkg-0/loader-0.ts:0:1) payload 0
DELIVERED|   at moduleLoader.require (/repo/src/pkg-1/loader-1.ts:1:1) payload 1
DELIVERED| ...
DELIVERED| … [lines 165-1700 omitted]
DELIVERED| [Mega Saver: compressed 93759→12494 B (~23440→3124 tokens, 86.7%). Full
            output recoverable — stored in 43 chunks of ~40 lines each; fetch any
            with: mega output chunk "cs-addr" "<i>" (i = 0..42) …]
```

The 900 distinct stack-trace lines are addressed as beginning at raw line 165.
`floor(164/40) = 4`; chunk 4 holds raw lines 161-200 — heartbeat noise. That is the
exact failure the test's own header describes ("the marker resolved to chunk 3,
holding raw lines 121-160; the right chunk was ~23"), reproduced with the test green.

**Boundary, pinned:** mutation M6b additionally sets `total = result.chunkedLineCount`.
*Then* it fails — `expected 903 to be 1700` (note: 903, matching §1b's measured
`… [lines 146-902 omitted]`). So the test's entire discriminating power is
`result.rawLineCount === raw.split("\n").length`. Everything else is decoration.

Note the footer in that capture: it advertises "43 chunks … i = 0..42", i.e. a
43 × 40 = 1720-line space, and the markers name lines up to 1700. The two numbers agree.
That internal consistency is exactly what makes the mis-addressing invisible — to an
agent following the published rule, and to this test.

**Fix direction:** assert that a marker's named span is *disjoint from* the raw lines
actually delivered, and that a marker's own start/end bracket content the delivered
excerpts do not contain. Extent alone is not addressability.

---

## BLOCKER — the production read path has no recovery-content coverage at all

**Where:** `packages/context-gate/test/save-integrity.property.test.ts:109-142`;
production call site `packages/context-gate/src/run.ts:173-182` (and `:352-361`)

**Why it is wrong:** the read-path block calls `readAndFilter`, then **assembles the
`persistChunkSet` call itself**, passing `raw` by hand. The production wiring — the
line that decides *what gets handed to the sink* — is `run.ts:180`. That line is never
executed by the test. This is the author's confessed class #3 verbatim: the unit test
is green while the real path is untested.

`runOutputPipeline` is not incidental. It is `mega output file`, `mega output filter`,
MCP `read-file`, and `daemon/src/handlers-registry.ts:201`.

**Evidence:** mutation M1 — at `run.ts:180` and `run.ts:359`, replace
`raw: read.raw` with `raw: filteredResult.excerpts.map((e) => e.text).join("\n")`.
This is §1b(i), the finding the spec calls "the most severe in the audit", restored
byte for byte on the registry read path.

```
pnpm --filter @megasaver/context-gate exec vitest run
      Tests  385 passed (385)
pnpm test
 Tasks:    60 successful, 60 total
```

The **entire monorepo** is green with the flagship defect reinstated.

**Nothing else covers it either.** Cross-referencing every test that calls
`runOutputPipeline` against every test that reads recovered chunk text:

```
tests calling runOutputPipeline AND asserting on chunk content:
  packages/mcp-bridge/test/tools/read-file.test.ts   ← outline branch only
```

That single hit is the **outline** path (`decision === "outline"`, fetching a
declaration body), which `persistChunkSet:255-264` serves from `result.chunks`, not
from `raw` — so M1 cannot touch it. Every other chunk-content assertion in the repo
(`save-integrity.property`, `recovery-addressability`, `fetch-chunk*`,
`persist-outline`, `saver-roundtrip`) either constructs its own `persistChunkSet` call
or runs the hook path. **No test anywhere asserts what is recoverable after a normal,
non-outline `runOutputPipeline` read.** The A1 test is not merely bypassing the call
site; it is the reason nobody noticed the call site is uncovered.

**Fix direction:** the A1 contract belongs on `runOutputPipeline`, not on a
hand-assembled `readAndFilter` + `persistChunkSet` pair. A contract test that
constructs the wiring it is meant to police cannot police it.

---

## BLOCKER — `assertNothingLost` is structurally unable to fail on the delivered side

**Where:** `packages/context-gate/test/save-integrity.property.test.ts:62-73`

**Why it is wrong:** the test's docstring states the promise as "whatever the model is
handed, **plus** whatever the recovery surface can hand back, together still contain
everything". The assertion builds `universe = delivered + "\n" + recovered` and checks
`redact(raw)` lines against it. But `recovered` is `recoverableChunks(raw)` re-joined —
i.e. `redact(raw)` split into 40-line pieces and reassembled. The second term alone
satisfies the assertion for every input. `delivered` contributes nothing.

The `+` in the contract is doing no work. 9/9 attests to persistence only; it is
silent about what the model receives, which is the half the product is *for*.

**Evidence:** mutation M2 — `returnedTextOf()` returns `result.summary` and nothing
else. The model is handed one line (`"7 kept, 20 dropped; top error: …"`), zero
excerpts, zero evidence.

```
pnpm --filter @megasaver/context-gate exec vitest run test/save-integrity.property.test.ts
      Tests  9 passed (9)
```

**Fairness note:** the wider suite *does* catch M2 — `record-output.test.ts` (D16,
A3b, F30) and `recovery-addressability.test.ts` fail. So this is not a hole in the
suite; it is a hole in *this test*, which is the one the spec nominates as the
integrity gate and whose 9/9 is the W4 evidence in §7.

---

## MAJOR — 3 of the A1 test's 9 cases assert nothing, hidden by an `as unknown as` cast

**Where:** `packages/context-gate/test/save-integrity.property.test.ts:186-189`

**Why it is wrong:**

```ts
const r = result as unknown as { chunkSetId?: string; excerpts?: { text: string }[] };
const chunkSetId = r.chunkSetId ?? `cs-exec-${mode}`;
const delivered = (r.excerpts ?? []).map((e) => e.text).join("\n");
```

`runOverlayOutputExecCommand` returns `{ ok, result }`. There is no top-level
`excerpts` and no top-level `chunkSetId`. Both `??` fallbacks fire silently, every
run. The double cast is what stops `tsc` from saying so.

**Evidence:** probe against the exact call the test makes —

```
PROBE top-level keys: [ 'ok', 'result' ]
PROBE r.chunkSetId = undefined
PROBE r.excerpts   = undefined
PROBE delivered length as the A1 test computes it = 0
```

Combined with the finding above, the exec-path third of the property test reduces to
"`recoverableChunks(raw)` contains `redact(raw)`". Note the same file's hook-path
block asserts `result.decision === "compressed"`; the read-path and exec-path blocks
assert no decision at all, so a silent degradation to passthrough would also pass.

---

## MAJOR — the A1 test cannot detect corrupted recovery *order*

**Where:** `packages/context-gate/src/recoverable-chunks.ts:29`,
`packages/context-gate/src/record-output.ts:217`

**Why it is wrong:** `recoverAll` joins chunk texts and the assertion is per-line
substring containment. Containment is not reconstruction. Any permutation, duplication
or interleaving of the stored chunks satisfies it, while an agent following the
footer's advertised `i = 0..N-1` reassembles the output in the wrong order.

**Evidence:** mutation M8 — `[...pieces].reverse()` at both sinks, so chunk `0` holds
the last 40 raw lines.

```
test/save-integrity.property.test.ts   Tests  9 passed (9)
```

**Checked and it holds:** `recovery-addressability.test.ts` *does* catch M8
(`marker … [lines 1-1 omitted] resolved to chunk 0, which does not contain the line it
names`). So chunk ordering is covered — by the other test, not by the one whose job it
is. Downgraded from BLOCKER for that reason.

---

## MAJOR — two of the three `target-ratio` tests pass with A4 fully reverted

**Where:** `packages/output-filter/test/target-ratio.test.ts:52-69`

**Why it is wrong:** the file exists to pin W1/A4 ("the budget must be a TARGET
relative to the input"). Only the first test does that.

- Test 2, "still honours the mode ceiling on a large input", asserts the ceiling. The
  ceiling *is* the pre-A4 behaviour. It is a regression guard for the defect.
- Test 3, "scales with the mode: aggressive returns less than safe", is satisfied by
  the mode ceilings alone (`modeToBudget`: aggressive 4 000 < safe 32 000). It was
  already true before A4 and says nothing about target ratios.

**Evidence:** mutation M4 — `fit.ts:84`, `const ratio = MODE_TARGET_RATIO[input.mode] ?? 1`
→ `const ratio = 1`. `targetBudget` collapses to `modeBudget`: the fixed-size
truncator, exactly.

```
× reduces an input that only just clears the floor
    expected 0.15848 to be greater than 0.5
✓ still honours the mode ceiling on a large input
✓ scales with the mode: aggressive returns less than safe
  Tests  1 failed | 2 passed (3)
```

**Side finding — three different numbers for one cell.** The measured pre-A4 saving on
that fixture is **15.8 %**. `fit.ts:57` says "12.5 KB of distinct source in balanced
mode returned 10.5 KB, a 16 % saving" (agrees). `target-ratio.test.ts:12` and §7's
table both say **4.5 %**; §1a says **3.7 %**. Driving the hook path end-to-end I
measure **0.1 %–1.1 %** for that cell (below). Four numbers, one claim.

---

## MAJOR — `target-ratio` asserts on a number the model never receives

**Where:** `packages/output-filter/src/types.ts:393-399`;
`packages/output-filter/test/target-ratio.test.ts:45-49, 59`

**Why it is wrong:** `FilterOutputResult.returnedBytes` = `summary` + excerpt text.
It excludes the D16 `… [lines X-Y omitted]` markers and the recovery footer — both of
which `returnedTextOf` adds and both of which the model pays for.
`record-output.ts:226-228` knows this and corrects it on the hook path ("F30 honest
accounting"); the library-level number was left uncorrected, and the A4 gate is pinned
against the uncorrected one.

**Evidence:** same fixture, `filterOutput` vs the delivered `returnedText`:

```
size=12500  filterOutput.returnedBytes=2259  savingRatio=81.9%
            delivered=3357 B  honest ratio=73.1%   overhead=1098 B (+49%)
size=250000 filterOutput.returnedBytes=10333 savingRatio=95.9%
            delivered=12279 B honest ratio=95.1%   overhead=1946 B
```

Test 1 asserts `savingRatio > 0.5` against 81.9 %; the delivered saving is 73.1 %.
Worse, test 2 asserts `returnedBytes <= 12_000` and gets 10 333 — while the model is
handed **12 279 B**. The "mode ceiling" the test claims to enforce is not enforced on
delivered bytes. Given §W1's pass condition is *net cost*, gating on a number that
undercounts delivered bytes by up to 49 % is the wrong coordinate system for the gate.

---

## MAJOR — half of the A3b evidence-marker fix is unprotected

**Where:** `packages/output-filter/src/fit.ts:11`,
`packages/output-filter/test/fit-evidence-marker.test.ts:22-39`

**Why it is wrong:** `EVIDENCE_MARKER` guards two marker families —
`… [repeated N times]` and `… [N similar: <template>]`. The fixture only produces the
first. The second is never exercised anywhere, and it is the family a realistic log
actually yields: the `recovery-addressability` fixture's 800 timestamped heartbeats
collapse to `… [800 similar: <ts> heartbeat]`, not to `[repeated …]`.

**Evidence:** mutation M9 — narrow the regex to
`/^… \[(?:repeated \d+ times)/m`, dropping the `similar` alternation; rebuild
output-filter dist.

```
@megasaver/output-filter   Tests  491 passed (491)
@megasaver/context-gate    Tests  385 passed (385)
```

876 tests, all green, with half the fix deleted.

---

## MINOR — a marker chunk larger than the remaining budget is still dropped silently

**Where:** `packages/output-filter/src/fit.ts:23-29, 36-38`

**Why it is wrong:** `reserve()` returns early when `used + cost > budget`, and the
comment concedes "Each still yields to the budget". So the A3b guarantee is
"markers are preferred", not "markers survive". When a marker-bearing chunk does not
fit, the model is again handed a folded run with no count and no indication — the
failure mode the workstream exists to prevent. No test covers it. It is a design
accept, but it is not the promise `fit-evidence-marker.test.ts`'s name makes.

---

# §7 — reproduction of every numerical claim

Reproduced independently; fixtures named, because §7's are not.

| §7 claim | verdict |
|---|---|
| `pnpm verify` green | **reproduces** |
| "60/60 turbo tasks: lint, typecheck, every package's tests, conventions" | **mislabelled** |
| W4/A1 "was 3/9, now 9/9" | **reproduces exactly** |
| Ratio table, "after" | **reproduces to ~1 pt** (fixture unnamed) |
| Ratio table, "before" | **reproduces**, except balanced @ 12.5 KB |
| B4: code 0.975, prose 1.013, JSON 1.193 | **reproduces** |
| B4: Turkish 0.961 → "within 4 %, only JSON diverges" | **DOES NOT REPRODUCE** |

## §7 finding — MAJOR: the B4 Turkish figure is wrong, and its conclusion with it

**Where:** spec §7 "Corrections to the audits", `packages/bench-replay/src/token-divergence.ts`

**Why it is wrong:** §7 states `realTokens/estimateTokens` for Turkish is **0.961** and
concludes "within 4 % — **only JSON diverges**". Using the repo's own
`measureTokenDivergence` with its own `countTokens` (cl100k_base):

```
B4 code:types.ts       bytes=17959  est=4490  real=4276  real/est=0.952
B4 code:record-output  bytes=16760  est=4190  real=4024  real/est=0.960
B4 prose:spec.md       bytes=24573  est=6144  real=6446  real/est=1.049
B4 prose:README.md     bytes=36026  est=9007  real=8905  real/est=0.989
B4 turkish:natural     bytes= 9870  est=2468  real=3361  real/est=1.362
B4 turkish:ascii-ized  bytes= 9030  est=2258  real=3061  real/est=1.356
B4 json:package.json   bytes= 1660  est= 415  real= 572  real/est=1.378
B4 json:turbo.json     bytes=  703  est= 176  real= 207  real/est=1.176
```

Code and prose bracket §7's figures. Turkish does not: measured **1.362**, and the
*ASCII-ized* variant — stripped of `ı ş ğ ç ö ü`, the most favourable Turkish case
available — is still **1.356**. Scope of the claim, stated precisely: neither natural
nor ASCII-ized Turkish **prose** comes within 0.39 of 0.961, and the **sign is wrong**
for both. `bytes/4` *understates* Turkish tokens by ~36 %; §7 reports it *overstating*
them by 4 %. I cannot rule out that §7's fixture was something other than Turkish prose
(mostly-ASCII text with scattered Turkish words could land near 1.0) — which is itself
the problem: the fixture is not named and not committed, so the number cannot be
checked, only contradicted.

The conclusion "only JSON diverges" is therefore false: Turkish diverges as much as
JSON (1.36 vs 1.18-1.38). This matters concretely — `estimateTokens` is the hot-path
admission gate (`record-output.ts:166`), so on Turkish content every eligibility
decision and every reported saving is computed against a count that is 36 % low, and
CLAUDE.md §11 names `tr` as the second locale.

**Root cause of the un-reproducibility:** `token-divergence.test.ts` injects fake
counters for the ratio arithmetic and smoke-tests the real tokenizer on
`"hello world"` only. **No corpus is committed.** §6's DoD requires "reproduction
evidence for every ratio claim … captured, not asserted"; for B4 nothing was captured.

**Checked and it holds:** `tokens.ts:23-25` is honest that cl100k_base is an
approximation because the provider's tokenizer is not public. No finding there.

## §7 finding — MAJOR: W1's floor decoupling never shipped, and is not listed as deferred

**Where:** spec §W1 bullet 1 vs `record-output.ts:164`, `resolve-saver-settings.ts:44`

**Why it is wrong:** §W1 is two levers: (a) `floorBytes` becomes small, order 2 KB;
(b) `targetRatio` sizes the output. §7's "What shipped" lists only (b). Lever (a) is
absent from "What shipped" **and** absent from "Deferred, with reasons".
`record-output.ts:164` still reads `input.compressFloorBytes ?? modeToBudget(input.mode)`
and `DEFAULT_MODE` is still `"safe"` — the floor is still the ceiling, and §1a's "nothing
under 32 KB is ever touched" is still true. §7's own table shows it: safe reads `floor`
at 6 / 12.5 / 25 KB, before *and* after.

The consequence bounds A4's reach arithmetically. A4 changes the outcome only while
`rawBytes × ratio < modeBudget`, i.e. below `modeBudget / ratio`:

| mode | floor (unchanged) | crossover | band where A4 changes anything |
|---|---:|---:|---|
| aggressive | 4 KB | 32 KB | 4-32 KB |
| balanced | 12 KB | 48 KB | 12-48 KB |
| **safe (default)** | **32 KB** | **64 KB** | **32-64 KB only** |

Above the crossover the pre-A4 behaviour is byte-identical — my before/after ladder
shows the 50 KB and 250 KB cells unchanged in aggressive and balanced. §7 says
"the ratio is now a floor set by policy rather than a function of how far the input
exceeded a constant"; that sentence is true only inside those bands. §1a's original
criticism survives intact everywhere else, and under the shipped default it survives
everywhere except a 32-64 KB window.

## §7 finding — MINOR: the ratio table has no fixture, and one cell disagrees 4 ways

**Where:** spec §7 "Measured ratio"

**Why it is wrong:** the table is captioned "Distinct source, hook path" — not a
fixture. §1a said "built `dist/` with TypeScript source input". I reproduced with both
readings, driving `recordAndFilterOverlayOutput` (`sourceKind: "file"`,
`storeRawOutput: true`, `includeFooter: true`):

**After (as shipped):**

| fixture | mode | 6 KB | 12.5 KB | 25 KB | 50 KB | 250 KB |
|---|---|---|---|---|---|---|
| synthetic distinct | aggressive | 78.5 | 85.7 | 86.8 | 91.6 | 98.3 |
| synthetic distinct | balanced | floor | 73.0 | 74.1 | 75.4 | 95.1 |
| synthetic distinct | safe | floor | floor | floor | 49.2 | 87.0 |
| real repo `.ts` | aggressive | 77.3 | 84.7 | 85.6 | 91.2 | 97.4 |
| real repo `.ts` | balanced | floor | 70.8 | 72.3 | 74.6 | 92.6 |
| real repo `.ts` | safe | floor | floor | floor | 47.5 | 80.9 |
| **§7 claims** | aggressive | **77.3** | **85.0** | **86.4** | **91.2** | **98.3** |
| **§7 claims** | balanced | floor | **72.7** | **73.3** | **75.1** | **95.0** |
| **§7 claims** | safe | floor | floor | floor | **48.9** | **86.9** |

**Before (A4 reverted, `ratio = 1`):**

| fixture | mode | 6 KB | 12.5 KB | 25 KB | 50 KB | 250 KB |
|---|---|---|---|---|---|---|
| synthetic distinct | aggressive | 29.5 | 65.9 | 83.7 | 91.6 | 98.3 |
| synthetic distinct | balanced | floor | **1.1** | 51.3 | 75.4 | 95.1 |
| synthetic distinct | safe | floor | floor | floor | 34.9 | 87.0 |
| real repo `.ts` | balanced | floor | **0.1** | 49.0 | 74.6 | 92.6 |
| **§7 claims** | aggressive | 27.4 | 65.1 | 82.6 | 91.2 | 98.3 |
| **§7 claims** | balanced | floor | **4.5** | 50.3 | 75.1 | 95.0 |
| **§7 claims** | safe | floor | floor | floor | 34.8 | 86.9 |

Verdict: **the table is substantially honest** — every cell lands within ~1 pt of the
synthetic fixture, and the "before" column reproduces the shape faithfully. The
exception is balanced @ 12.5 KB, where §7 says 4.5 %, §1a says 3.7 %, `fit.ts:57` says
16 %, and I measure 0.1-1.1 % end-to-end. The true figure is *worse* than claimed, so
the direction of the argument is unharmed; but four numbers for one cell, and no named
fixture, is a §6 DoD miss ("captured, not asserted"). Commit the generator.

## §7 finding — NIT: "60/60 turbo tasks" is the wrong command's number

**Where:** spec §7 line 337-338

`pnpm verify` = `lint && typecheck && test && conventions:check`. `turbo run test`
alone is 60 tasks (30 build + 30 test) — that is where 60/60 comes from.
`turbo run lint typecheck test` is 120. `conventions:check` is a plain node script, not
a turbo task at all. Verified: `turbo run lint typecheck test --dry=json` →
`{ build: 30, lint: 30, test: 30, typecheck: 30 }`, and the `pnpm verify` transcript
prints `Tasks: 60 successful` at the `test` stage. Verify *is* green; the count
describes one third of it.

---

# Checked, and it holds

Stated explicitly per the review README — these are results, not absences.

- **`fit-evidence-marker.test.ts` is a genuine test.** Deleting the evidence-marker
  reservation loop (`fit.ts:36-38`) fails it: `expected '2 kept, 12 dropped\n[debug]
  cache ent…' to contain '[repeated 600 times]'`. The fixture's varied-error design is
  load-bearing exactly as its comment claims. The only gap is the `similar` family
  above.
- **Outline-mode chunks really are a whole-file partition.** `persistChunkSet:255-264`
  trusts `result.chunks` over `recoverableChunks(raw)` on the strength of a comment,
  and the A1 property test never runs outline mode — so I ran the A1 contract against
  it directly: 1 204-line TS file with imports, interstitial comments and top-level
  statements → 401 chunks, **0 lines unrecoverable**. The comment is true.
- **"was 3/9" reproduces exactly.** At `38bb2993` (the commit that introduced the test,
  before `225a0279` "recover from raw, not from excerpts"): `6 failed | 3 passed (9)`.
- **`recovery-addressability` catches chunk-store reordering** (M8), which the A1 test
  cannot. Its per-marker loop is inert against the defect it was written for, but live
  against this one.
- **`pnpm verify` is green** on a clean checkout, no flakes observed across ~6 full
  context-gate runs and 2 full monorepo runs.
- **cl100k_base is honestly labelled** an approximation in `tokens.ts:23-25`, not
  passed off as Anthropic's tokenizer.

---

# Summary

The three confessed false-green patterns did not stop at three.

| confessed pattern | recurrence found | receipt |
|---|---|---|
| broken mapping verified against itself | `recovery-addressability` per-marker loop; `target-ratio` test 2 | M6, M4 |
| fixture indiscriminate | `assertNothingLost` containment; `EVIDENCE_MARKER` `similar` half | M2, M8, M9 |
| unit green, real path unchanged | A1 read path bypasses `run.ts:180`; nothing else covers it | M1 |

The single most serious result: **the §1b(i) defect — "the most severe finding in the
audit" — can be reinstated on the production registry read path with the entire
60/60 monorepo suite green.** The test written to prevent that never touches the line
that causes it, and no other test does either.

§7's numbers are, with one exception, honest and reproducible; the exception (B4
Turkish) inverts the sign of the claim it supports. The larger §7 problem is not a
wrong number but an omission: **W1's floor lever never shipped and is not declared
deferred**, which silently confines A4's entire effect to a 32-64 KB window under the
shipped default.

None of this is a reason to unship. It is a reason not to treat 9/9 and "green" as
evidence. Per §W1's own rule — a stage that raises ratio without moving net cost has
failed — and net cost remains unmeasured, as §7 correctly concedes.

## Recommended before merge

1. Move the A1 contract onto `runOutputPipeline` / `runOverlayOutputPipeline`. Delete
   the hand-assembled `persistChunkSet` call from the test.
2. Make `assertNothingLost` two assertions: recovery is complete, **and** delivered is
   non-trivial (e.g. ≥ N excerpts, covering ≥ M distinct raw spans). Assert an ordered
   reconstruction, not per-line containment.
3. Delete the `as unknown as` cast at `save-integrity.property.test.ts:186` and read
   `result.result`. Assert `decision === "compressed"` in all three blocks.
4. Give `recovery-addressability` an assertion on interior markers: a marker's named
   span must be disjoint from the delivered excerpts' raw spans.
5. Add a `[N similar: …]` case to `fit-evidence-marker.test.ts`.
6. Re-gate A4 on delivered bytes (`returnedText`), not `FilterOutputResult.returnedBytes`.
7. Commit the B4 corpus and re-derive the Turkish figure. `0.961` is not obtainable.
8. Either ship W1's floor lever or move it to "Deferred, with reasons" — and state the
   32-64 KB band as the measured scope of A4 under the default mode.
