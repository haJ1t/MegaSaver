# Saver Compression & Save-Integrity — Design

- **Date:** 2026-07-28
- **Risk:** CRITICAL. Touches evidence-preserving compression, the context packer,
  chunk persistence (user-recoverable evidence), and public CLI/MCP behaviour.
  Per `risk-modes.md`: HIGH chain + `tracer` evidence loop + `security-reviewer`
  + verifier with reproduction evidence + manual user confirmation. No autopilot.
- **Status:** APPROVED 2026-07-28. Stages 0-3 implemented on
  `docs/saver-integrity-spec` (41 commits, three tracks merged); see §7 Outcomes.
  Stage 4 (condensation) not started. Awaiting external review.
- **Origin:** find-only audit 2026-07-28 (`wiki/syntheses/saver-root-cause-2026-07-28`),
  reconciled against three independent external LLM audits supplied by the user.

## 0. Scope boundary — what this spec does NOT own

`2026-07-19-net-positive-megasaver-design.md` (user-approved, Stage A shipped)
owns the **cost axis**: prompt-cache churn, turn count, model cascade. Its own
finding is that baseline cost decomposes as cache-writes 62–75% / cache-reads
15–38% / output 5–10%, so a churn-free saver has a hard ceiling near 1.1–1.25x
and the 2x target lives in turn count, not compression ratio.

This spec owns the **quality axis**, which that spec explicitly does not address:

1. how much the compressor actually removes (the 60–90% ask), and
2. whether what it removes can be got back (the "safe save" ask).

The two are coupled in one direction only: a compressor that is honest about its
own numbers is a precondition for validating anything in the cost spec. That is
why Stage 0 here is shared instrumentation.

## 1. Problem — two distinct failure families

### 1a. The compressor is a fixed-size truncator, not a compressor

`minBytesFor` (`apps/cli/src/hooks/saver.ts:52-57`) sets the eligibility floor to
`modeToBudget(mode)`. `record-output.ts:145` sets the output budget to the same
`modeToBudget(mode)`. `fitBudget` (`packages/output-filter/src/fit.ts`) then packs
chunks greedily **up to** that budget — it maximises fill, it does not minimise
output. Therefore `ratio = 1 − budget / rawBytes`: the ratio is a function of
input size, not of content redundancy.

Measured 2026-07-28 by driving `recordAndFilterOverlayOutput` over built `dist/`
with TypeScript source input:

| mode | floor = budget | 6 KB | 12.5 KB | 25 KB | 50 KB | 100 KB | 250 KB |
|---|---:|---:|---:|---:|---:|---:|---:|
| aggressive | 4 KB | 28.0% | 65.4% | 82.5% | 91.2% | 95.6% | 98.2% |
| balanced | 12 KB | *floor* | 3.7% | 50.3% | 74.9% | 87.5% | 95.0% |
| safe | 32 KB | *floor* | *floor* | *floor* | 34.5% | 67.4% | 86.9% |

`returnedBytes` is pinned to the budget in every compressed row (4.3 / 12.5 /
32.6 KB). Scope note: the curve holds when the returned text reaches the budget —
the low-redundancy case. Highly redundant input can beat it via
`collapseRepeatedLines` (a 25 KB log measured 88.9% in balanced), but under the
shipped default those inputs never enter the pipeline at all:

- `DEFAULT_MODE = "safe"` (`packages/context-gate/src/resolve-saver-settings.ts:44`)
  ⇒ nothing under 32 KB is ever touched.
- Bash floor is `BASH_COMPRESS_FLOOR = 24_000` against Claude Code's ~30 000-char
  pre-hook truncation ⇒ a ~6 KB working window.
- Category compressors (vitest/tsc/json) are gated off for file sources
  (`packages/output-filter/src/types.ts:266-274`) ⇒ a `Read` has no mechanism
  other than drop-chunks-until-budget.

Net: on the large majority of real tool calls the saver returns 0%.

### 1b. "Safe save" fails in two different ways on different paths

These are **not** the same defect and do not share a fix.

**(i) Unrecoverable loss — 3 of 4 entry points.** Only the hook path persists the
full redacted output (`record-output.ts:178-191`). The other three persist
`filtered.excerpts` — the *kept* excerpts only:

- `packages/context-gate/src/read.ts:249-255`
- `packages/context-gate/src/run-command.ts:390-396`
- `packages/context-gate/src/run-command.ts:636-642`

Everything `fitBudget` drops on those paths is gone from disk. Meanwhile
`packages/connectors/shared/src/context-gate-block.ts:28` tells every connected
agent "Raw output is stored" — false on those paths. This is the most severe
finding in the audit: a losslessness promise that the storage layer does not keep.

**(ii) Mis-addressed recovery — the hook path.** Delivered excerpts and their
`… [lines X-Y omitted]` markers are numbered in **post-collapse / post-compressor**
space (`types.ts:192, 261-274, 370`; `record-output.ts:91-107`). Stored chunks
index `redactedText` — **pre-collapse** (`record-output.ts:181-183`). The footer
publishes only "~40 lines each, i = 0..N-1" (`recovery-footer.ts:43-46`); no
line→chunk formula exists, and the code comment concedes one cannot be given.

Measured (1700-line build log, 800 repeated + 900 distinct lines, balanced):
delivered marker `… [lines 146-902 omitted]` → the only published rule yields
chunk 3 → chunk 3 actually holds raw lines 121-160, content `[info] heartbeat ok`.
The correct chunk is ~23. Every recovery on collapsed output mis-addresses, the
agent probes further, and compressed-view + N blind expansions exceed the raw read.

`wiki/syntheses/saver-savings-gaps` C13 measured exactly this shape (10.4 KB file
→ 991 tok + ~2600 tok of sliced re-reads) and is marked FIXED. The fix stopped
re-compression of the escape hatch; **addressability was never fixed.**

### 1c. The system cannot see itself failing

- `bytesSaved = Math.max(0, …)` (`types.ts:351`) and the stats schema forces
  `nonnegative()` (`packages/stats/src/event.ts:20,43`; `summary.ts:10,27`).
  An event that *inflated* the payload records as "0 saved". Inflation is
  structurally invisible in every aggregate, so every average is biased positive.
- `filterOutput`'s own `returnedBytes` / `savingRatio` (`types.ts:346-352`) count
  summary + excerpt text only — they exclude the gap markers and the recovery
  footer that the model actually receives. `record-output.ts:226` recomputes
  honestly, so hook stats and the GUI (which reads the overlay-event store via
  `apps/gui/src/lib/claude-sessions-client.ts`) are correct; `read.ts:188`,
  `run-command.ts:256`, `run-command.ts:527` and `apps/cli/src/commands/bench.ts:184`
  publish the inflated number.
- `packages/context-gate/src/fetch-chunk.ts` (46 LOC) writes no event at all.
  Recovery is never charged back, so the ledger reports gross savings while the
  agent pays net.
- `estimateTokens = ceil(bytes/4)` everywhere (`tokens.ts:17-19`). Every threshold,
  every reported saving and every dollar figure rests on it. Direction of error is
  content-dependent and currently unmeasured.

### 1d. Confirmed defects (each independently shippable)

| # | defect | location | effect |
|---|---|---|---|
| B1 | `tokenizeForMatch` applies no stop-word filter; `keywordScore` counts raw hits and is weighted `×(1+INTENT_MATCH_BUMP)=×21` | `output-filter/src/tokenize.ts`, `rank.ts:84-92,132-133` | "the/in/is/bu/ve" match nearly every chunk ⇒ intent ranking degenerates to noise |
| B2 | `compressTsc` drops every line not matching `file(line,col): error TSxxxx` except `Found N errors` | `output-filter/src/compress/tsc.ts:16-34` | position-less diagnostics (`error TS5023: Unknown compiler option`), multi-line explanations and code frames deleted with no marker |
| B3 | classifier assigns `typescript` at 0.7 confidence on output-sniff alone | `output-filter/src/classify.ts:52,127-129` | any text containing `error TS1234:` — including a fetched issue page — is routed into B2 |
| B4 | `parseGoTest` keeps only blocks containing `--- FAIL:` | `output-filter/src/parsers/go-test.ts:15-30` | a panicking test emits no FAIL line ⇒ panic message and stack silently dropped |
| B5 | BM25 `tokenize` splits on `/\W+/` — no identifier splitting, ASCII-only | `packages/retrieval/src/bm25.ts:33-38` | `parseConfig` never matches query `parse`; Turkish query terms mis-split |
| B6 | Grep/Glob rebuild splits the whole compressed text back into `filenames: string[]` | `apps/cli/src/hooks/saver.ts:179-186` | summary line, gap markers and footer enter the array as fake paths while `numFiles` keeps the old count — corruption, not loss |
| B7 | `… [repeated N times]` is emitted as its own line ⇒ its own chunk ⇒ droppable by `fitBudget` | `output-filter/src/normalize.ts:22-35` + `fit.ts` | measured: dropped, model saw one heartbeat line with no evidence 800 existed |
| B8 | only the larger of stdout/stderr is compressed | `apps/cli/src/hooks/saver.ts:124-133` (comment concedes it) | two comparable streams both below floor pass through raw; a small-stream error can be the one left uncompressed |
| B9 | safe-mode Bash: floor 24 KB vs budget 32 KB | `saver.ts:33,54` + `modeToBudget` | pre-truncated Bash output fits the budget ⇒ nothing dropped ⇒ net-negative guard fires ⇒ full pipeline runs and discards its work |
| B10 | `dedupe()` runs on the passthrough and light bands too | `output-filter/src/types.ts:296-302` | the code comment at `:250-252` promises those bands "keep all chunks … so no real signal is dropped" — SimHash folding contradicts it |
| B11 | daemon-timeout double count | `saver-run.ts:108-138` + `daemon/src/handlers.ts:47` | `excerptHandler` calls `recordAndFilterOverlayOutput`, which appends the overlay event. A client-side timeout **after** the daemon has written makes the hook fall back and write the event a second time — savings double-counted |
| B12 | `compressProse` keeps the first paragraph per section + first 3 list items; `compressJson` keeps first 3 + last of any array ≥20 | `compress/prose.ts:6-10,19-20`, `compress/json.ts:10,68-81` | lossy on docs and on data; intent-matched JSON keys are annotated but their values are not preserved. **Note:** the prose behaviour is `saver-savings-gaps` D20, recorded as a conscious accept — this spec re-opens it only because W4 now demands an explicit marker or recoverability, not because the trade-off was wrong |

### 1e. Claims received but NOT confirmed — do not plan against these

- **"20× billing penalty."** Cache *write* is ~1.25× base input, not 20×. Measured
  net effect is 0.93–0.97×, i.e. 3–7% worse than baseline. The direction is real;
  the magnitude is not.
- **"`appendAuditEvent` is dead code."** It is called by
  `apps/cli/src/commands/context/build.ts:38`. It is absent from the *saver* path,
  which is a coverage gap, not dead code.
- **"Seen-ledger decay is a bug / silent self-disable."** It is intentional P1
  cache-protection design (`saver.ts:321-325`, `saver-seen.ts`). It is a
  deliberate trade-off owned by the net-positive spec — repeats are never
  compressed by design. Re-opening it belongs to that spec, not this one.
- **"Multi-text-block collapse loses blocks."** `saver.ts:154-167` joins every
  text block into `raw` and the rebuild emits the compressed result in the first
  text block's position while preserving non-text blocks in order. All text is
  represented in the replacement; only inter-block boundaries are lost. Cosmetic,
  not evidence loss.
- **"Outline mode's 0.9 ratio is a top defect."** The threshold is real
  (`types.ts:124`) but outline is opt-in and off by default. Low priority.
- **"Benchmark carry-over is caused by the seen ledger."** `saver-seen.ts:20` is
  session-scoped (`saver-seen/<sessionId>.json`) and `bench-replay`'s session id
  is caller-supplied (`saver-subprocess.ts:106,114`) with no in-repo caller found.
  Fresh-store benchmark hygiene is justified on its own merits (workspace-scoped
  net-effect and stats records), **not** by this unverified mechanism.

## 2. Design

Six workstreams. W0 is a precondition for every claim with a number attached;
W4 gates everything that touches user-visible losslessness.

### W0 — Make the system observable (precondition)

- **Signed savings.** Introduce a signed `deltaBytes` on the event schema so
  inflation is representable. Keep `bytesSaved` as the clamped legacy field for
  one minor version; aggregates switch to the signed field. Without this, every
  later measurement is biased.
- **Model-facing accounting everywhere.** One helper computes "bytes the model
  receives" = summary + excerpts + gap markers + footer, used by all four entry
  points. `filterOutput`'s own totals become internal-only. This must include the
  MCP envelope: `packages/mcp-bridge/src/server.ts:316` `JSON.stringify`s the
  whole payload, so per-excerpt `score` and the 9-field `features` object reach
  the model and are counted nowhere today.
- **Recovery debt.** `fetch-chunk` appends an expansion event carrying the fetched
  bytes and its `chunkSetId`. Net saving for a chunk-set = compression saving −
  Σ expansions. Reports show net.
- **Real tokenizer at the reporting boundary.** Replace `bytes/4` for *reported*
  numbers with a real BPE count; keep the cheap estimate for hot-path gating only,
  and measure the divergence before choosing thresholds.
- **Field telemetry.** Install the hook on the developer machine and capture one
  real session. Today `~/.claude/settings.json` carries no MegaSaver hook and
  `~/.local/share/megasaver` has no `stats/`, `content/` or `evidence/` — every
  number in the wiki comes from a harness the wiki itself says cannot validate a
  stage. Fresh store per benchmark run.

**Gate:** a deliberately inflating input produces a negative aggregate in
`mega audit`. If inflation still reports as 0, W0 is not done.

### W1 — Decouple floor from budget (the ratio lever)

- `floorBytes` answers "is this worth touching at all" — small (order 2 KB).
- `targetRatio` answers "how small should the result be" — per mode
  (e.g. safe 0.5, balanced 0.25, aggressive 0.12 of raw), with an absolute
  minimum-signal floor so a 3 MB log still yields a usable excerpt set.
- `fitBudget` fills to `min(targetRatio × rawBytes, modeCeiling)` instead of the
  mode ceiling.
- **Immediate sub-item, one line:** `DEFAULT_MODE` is `safe` ⇒ a 32 KB floor
  suppresses most traffic. Changing the shipped default moves more measured ratio
  than any redesign in this spec and must be evaluated first, on its own, so its
  effect is attributable.
- Re-run the W0 instrument over the same size ladder; the ratio must stop tracking
  input size.

**Gate — deliberately NOT a ratio target.** The §1a table already shows
aggressive at 82.5% on 25 KB with zero code changes, so any "ratio ≥ 60%" gate is
passed by flipping `DEFAULT_MODE` to `aggressive` — the arm the net-positive spec
measured as the *worst* on cost (0.93x vs balanced 0.96x), because a 4 KB budget
maximises churn along with ratio. Ratio is the number that made the product look
like it was working while it was not; it is a diagnostic here, never a pass
condition.

The pass condition is **net cost reduction at constant integrity**: signed net
saving (W0, after recovery debt) improves against the pre-stage baseline, W4's
integrity property test stays green, and the reported ratio is captured alongside
as evidence. A stage that raises ratio without moving net cost has failed.

### W2 — One pipeline, one guard

All four entry points route through a single `compressAndPersist` core that
always: (a) persists the **full redacted raw**, never excerpts; (b) applies one
shared admission guard; (c) emits one signed event. `read.ts` / `run-command.ts`
(×2) lose their private persistence.

**The guard must be strengthened, not merely propagated.** Today
`record-output.ts:232` rejects only when `returnedBytes >= rawBytes`, so a
one-byte saving justifies a rewrite — and under the cache churn the net-positive
spec measured, a one-byte saving is strictly negative. Copying that predicate to
three more paths would ship net-negative rewrites on three new surfaces. The
unified guard requires a **minimum absolute and relative saving**, with the
threshold derived from W0's measured churn cost rather than guessed.

This closes 1b(i) and the unguarded-inflation surface on the MCP/exec paths in
one change. Until it lands, `context-gate-block.ts:28`'s "Raw output is stored"
must be corrected to state the real guarantee per path.

### W3 — One coordinate system

Chunk the **same text the excerpts index**, or emit an explicit
`marker → chunkId` map in the footer. Either resolves 1b(ii); the map is the
smaller change and keeps pre-collapse raw on disk. The footer must never publish
a formula the storage layer cannot honour.

**Gate:** a property test — for any input, resolving every delivered gap marker
returns chunks whose content is exactly the omitted span. The 1700-line log case
ships as a fixture.

### W4 — Integrity gate (blocks W1)

A single test asserting: for every entry point and every mode, the union of
delivered text and all recoverable chunks reconstructs the redacted raw. Any
compressor or parser that cannot satisfy this either (a) becomes lossless, or
(b) emits an explicit marker naming what it removed and how to get it.

B2, B4 and B7 are the current violators.

### W5 — Ranking and parser correctness

B1–B9 from §1d, each red-first behind its own failing test. Independently
shippable; runs in parallel with W1–W3 design work. Suggested order by measured
blast radius: B6 (corruption) → B2/B4 (silent evidence loss) → B1/B5 (ranking) →
B9/B8/B3/B7.

### W6 — Condensation, GATED EXPERIMENT (not a deliverable)

The "RTK / caveman parity" ask: rewrite content densely instead of dropping spans.
Scoped as an experiment because the evidence to design it does not exist — we have
no measurement of what the compared tool does, and the user's naming
("caveman ponytail") does not resolve against this codebase (`caveman-commit` is a
commit-message skill per §10; `ponytail:` is an inline comment marker, e.g.
`saver.ts:128`, `handlers.ts:49`). Neither is a compression feature.

Explicit hazard: stripping comments to gain ratio deletes exactly the WHY that
`code-conventions.md` §Comments mandates be kept, and that a coding agent needs.
Any condensation candidate must pass W4 or declare itself lossy in the footer.

**Gate before any implementation:** a measured head-to-head on a fixed corpus
showing condensation beats W1's tuned extraction at equal integrity.

## 3. Staging

| stage | contents | gate |
|---|---|---|
| 0 | W0 | inflation visible as negative; one real session captured |
| 1 | W5 (B1–B9) + W2 correction to the connector block text | each bug red→green; `pnpm verify` |
| 2 | W2 + W3 + W4 | integrity property test green on all four paths |
| 3 | W1 (default-mode change measured first, alone) | ratio ≥60% @25 KB **and** stage-2 gate still green |
| 4 | W6 | experiment result only; implementation needs a fresh approval |

Stages 1 and 2 may proceed in parallel worktrees; stage 3 must not start before
stage 2's gate is green, or ratio gains will again be paid for in lost evidence.

## 4. Non-goals

- The cost/cache axis (owned by `2026-07-19-net-positive-megasaver-design.md`).
  This spec must not re-derive first-sight-only or turn-cutting.
- Changing the LLM proxy's byte-verbatim forwarding.
- Any claim of a specific competitor's ratio without a reproduced measurement.

## 5. Open questions (for brainstorming, before approval)

1. Is `targetRatio` per mode, or adaptive to measured content redundancy?
2. Does W3 ship the marker→chunk map (cheap, keeps two spaces) or unify the spaces
   (clean, re-chunks post-collapse text and loses pre-collapse fidelity)?
3. Do stages 1–3 have any measurable effect at all under the cost spec's
   ceiling — i.e. is quality work justified on evidence integrity alone even if
   net cost is unchanged? (Position: yes, the losslessness promise is a
   correctness obligation independent of cost.)
4. Should `aggressive` survive as a mode if more compression is strictly worse on
   cost? Inherited open question from the net-positive spec.

## 6. Definition of done

Per `definition-of-done.md`, plus:

- Plan file in `docs/superpowers/plans/` derived from this spec **after approval**.
- TDD throughout; W4's property test exists before W1 is touched.
- `code-reviewer` AND `critic` in separate contexts (CRITICAL risk), plus
  `security-reviewer` — W2 changes what is written to disk and W0 changes what is
  reported to the user.
- Reproduction evidence for every ratio claim: the size-ladder table re-run and
  captured, not asserted.
- `wiki/syntheses/saver-root-cause-2026-07-28` updated with outcomes;
  `wiki/syntheses/saver-cache-churn` corrected (its `saverPausedByNetEffect`
  wiring claim is false — no such symbol exists; net-effect is read only by
  `doctor-saver.ts` and `session/saver/resolve.ts`, diagnostic-only).


## 7. Outcomes (2026-07-29)

Implemented across three parallel tracks, consolidated on
`docs/saver-integrity-spec`, then corrected after external review — code review
(`docs/superpowers/reviews/track-a-opus-codereview.md`) and adversarial critic
(`track-a-opus-critic.md`), both fresh contexts, neither the author.
`pnpm verify` green: exit 0, run twice (before the review's mutation work and
after every revert), `conventions:check` ok. The "60/60 turbo tasks" figure this
section previously reported is `turbo run test` alone (30 build + 30 test);
`turbo run lint typecheck test` is 120 tasks and `conventions:check` is a plain
node script, not a turbo task at all. Verify is green; the count described a
third of it.

### §5 Q2 answered — the coordinate question is a split, not a winner

Neither candidate alone. The gate is `types.ts` `compressorEligible`:

| path | compressor | delivered line numbers |
|---|---|---|
| file reads (except `.json`) | off for file sources | RAW line numbers |
| generic / low-confidence command output | off | RAW line numbers |
| vitest / tsc / diff / structured | rewrites lines | none — countless marker |

Provenance is threaded through `normalize` → `collapseRepeatedLines` →
`collapseSimilar`, all fold-only, so every surviving line maps to a contiguous
raw span. A compressor synthesises lines that exist nowhere in the raw output
(`compressTsc`'s "Top files by error count: …"), so no raw line can be named and
the renderer emits a countless marker rather than a false number. **Line numbers
where they can be true, none where they cannot.**

### What shipped

| workstream | outcome |
|---|---|
| W4/A1 | Save-integrity property test: 9 cases, was 3/9, now 9/9 |
| W2/A2 | One `recoverableChunks` helper; read + both exec paths persist full redacted raw. Shared `admission-guard.ts` |
| W3/A3 | Gap markers in raw line space; provenance in `normalize.ts` |
| W3/A3 (post-review) | `recoverableChunks` indexes the same normalized text the markers are numbered in; `record-output.ts`'s duplicate inline chunker deleted |
| A3b | Evidence markers reserved in `fitBudget` ahead of score |
| W1/A4 | `targetBudget`: mode budget is the ceiling, target is a share of the input — lever (b) of §W1 only; lever (a) did not ship, see Deferred |
| W0/B1-B5 | Signed `deltaBytes`, model-facing bytes, recovery debt, real BPE count, fresh-store harness |
| W5/B6-B10, C1-C5 | The twelve defects |

### Coordinate skew — A3 shipped incomplete, review caught it, now closed

A3's contract is that delivered line numbers and stored chunks inhabit one
coordinate system. As shipped they did not. Markers were numbered in
`normalize(redact(raw))` space; chunks indexed `redact(raw)`. `normalize` is not
line-count preserving: `\r → \n` (`normalize.ts:16`) adds a line for every bare
CR — how npm, pip, curl, wget, docker, cargo and pytest draw progress bars, on
the hook path that carries the most volume — and the OSC branch of the ANSI
regex has a negated class that also matches `\n`, removing lines. Under the
footer's published "~40 lines each" rule a skewed marker then resolves either to
a chunk index that does not exist, or, in the shrink direction, silently to a
real chunk holding unrelated content. LF and CRLF are unaffected.

The A3 test could not catch it: its load-bearing assertion was the extent
invariant that breaks, and its corpus contained no CR. The A1 property test
could not either — containment holds whether or not the addressing is sound.

Closed by chunking the normalized text in `recoverableChunks` and deleting the
duplicate inline chunker in `record-output.ts`, so all five persistence sites
(`read.ts:264`, `read.ts:291`, `run-command.ts:395`, `run-command.ts:656`,
`record-output.ts:216`) now share one chunking entry point and cannot re-diverge
without a deliberate re-duplication. `packages/output-filter` exports `normalize`
for that purpose; re-implementing its regex inside `context-gate` would recreate
the divergence being closed. Outline mode is untouched and did not need it — it
renders via `excerptOf(…, null)`, emitting a countless marker and publishing no
line number.

Covered by `packages/context-gate/test/coordinate-skew.test.ts`, which fails
without the fix. Input: 400 npm-style progress redraws interleaved with 400
distinct log lines, balanced mode, hook path. RED: `marker space 1600 vs chunk
space 800 (skew 800)`. GREEN: highest marker line 1600, highest stored chunk
`endLine` 1600, skew 0; the footer advertises 40 chunks (`i = 0..39`), so every
line a marker names is reachable.

Disclosure: stored chunks now hold normalized text, so ANSI escapes and trailing
whitespace are no longer byte-recoverable from the chunk store. Neither is
evidence, the delivered excerpts were already normalized, and line-addressability
is what the footer promises — that now holds.

### Three non-discriminating tests, and what mutation testing now shows

The critic's mandate was not "do the tests pass" but "do they pass for the right
reason". Three did not:

| test | passed with the defect fully present | now |
|---|---|---|
| `recovery-addressability.test.ts` | A3's interior-marker skew: its per-marker check ("chunk `floor((N-1)/40)` contains raw line N") is true for every N by construction, so its only discriminating assertion was the tail extent | adjacency assertion — the span a marker names must close where the next delivered raw line begins |
| `save-integrity.property.test.ts` | delivered text reduced to the summary line: `universe = delivered + recovered` is satisfied by `recovered` alone, so the delivered half contributed nothing | `assertDeliveredCarriesEvidence` — the delivered half must itself carry raw evidence |
| the A1 read-path block | the production read path was never executed; the test hand-assembled its own `persistChunkSet` call, so `run.ts:180` — `mega output file`, `mega output filter`, MCP `read-file`, the daemon registry — was uncovered repo-wide | `read-pipeline-recovery.test.ts` drives `runOutputPipeline` itself |

Each defect was then reintroduced and run against the full `packages/context-gate`
suite (56 files / 388 tests), and the catcher recorded:

| mutation | defect restored | caught by |
|---|---|---|
| M1 | `run.ts:180,359` persist the kept excerpts instead of `read.raw` — §1b(i), the most severe finding in the audit | `read-pipeline-recovery.test.ts` **only** (2 tests) |
| M2 | `returnedTextOf` returns the summary and nothing else | 4 files / 10 tests: `record-output`, `save-integrity.property`, `recovery-addressability`, `coordinate-skew` |
| M6 | interior markers back in post-collapse space | `recovery-addressability.test.ts` **only** |
| M7 | `recoverableChunks` chunks un-normalized text | `coordinate-skew.test.ts` **only** |
| M-footer | footer under-reports `chunkCount`, so the published `i = 0..N-1` cannot reach the lines the markers name | `coordinate-skew.test.ts` |

No mutation in that set survives. That is the whole of the claim: **four named
defects now fail a mutation. Two classes still cannot be caught at all.**

- **Suppressed markers.** A mutation that omits a gap marker for a genuinely
  omitted region, while leaving every surviving marker correctly addressed, is
  caught by nothing except `recovery-addressability`'s anti-vacuity counter, and
  then only as a change of shape, never as a wrong address. A
  complement-coverage assertion cannot close it: it would fail on correct code,
  because the collapse stand-in legitimately represents lines no marker names.
  Closing it needs a production-surface change — excerpt raw spans exposed on
  `returnedText` — not a test.
- **Fabrication — inferred from the assertions' shape, not from a mutation.**
  Every assertion in the suite is containment-shaped: raw lines present in the
  delivered text, raw lines absent from the omitted ranges. Nothing asserts that
  delivered content is not invented, so a mutation appending plausible
  synthesized lines alongside the genuine ones should pass. Unlike M1–M7 above,
  that is a reading of the assertions, not a receipt: no such mutation has been
  run, and what would close the gap has not been established.
- **Single-point coverage** (not a hole, a fragility). M1, M6 and M7 are each
  caught by exactly one file; only M2 has redundancy. Deleting or weakening any
  one of those three files silently reopens a flagship defect. Compounding it,
  `recovery-addressability`'s anti-vacuity guard lands at exactly 2 adjacency
  checks, with no margin.

### Measured ratio (diagnostic, not the gate)

Fixture, stated because the table this replaces had none: distinct non-repeating
TypeScript source (~126 B/line, unique identifiers and counters per line so
nothing collapses), driven through `recordAndFilterOverlayOutput` against the
built `packages/context-gate/dist/index.js` — the hook path — with
`storeRawOutput: true`, `includeFooter: true`, and a fresh `mkdtemp` store per
cell. Sizes are reported alongside every ratio, because a saving ratio without
its input size is not a statement about the compressor.

| input | rawBytes | lines | mode | decision | returnedBytes | savingRatio | chunkCount |
|---|---:|---:|---|---|---:|---:|---:|
| 6 KB | 6166 | 49 | aggressive | compressed | 1256 | 0.796 | 2 |
| 6 KB | 6166 | 49 | balanced | passthrough | 6170 | 0 | — |
| 6 KB | 6166 | 49 | safe | passthrough | 6170 | 0 | — |
| 12.5 KB | 12895 | 102 | aggressive | compressed | 1888 | 0.854 | 3 |
| 12.5 KB | 12895 | 102 | balanced | compressed | 3535 | 0.726 | 3 |
| 12.5 KB | 12895 | 102 | safe | passthrough | 12846 | 0.004 | — |
| 25 KB | 25669 | 199 | aggressive | compressed | 3414 | 0.867 | 5 |
| 25 KB | 25669 | 199 | balanced | compressed | 6710 | 0.739 | 5 |
| 25 KB | 25669 | 199 | safe | passthrough | 25523 | 0.006 | — |
| 50 KB | 51261 | 393 | aggressive | compressed | 4304 | 0.916 | 10 |
| 50 KB | 51261 | 393 | balanced | compressed | 12302 | 0.760 | 10 |
| 50 KB | 51261 | 393 | safe | compressed | 26125 | 0.490 | 10 |
| 100 KB | 102434 | 781 | aggressive | compressed | 4307 | 0.958 | 20 |
| 100 KB | 102434 | 781 | balanced | compressed | 12305 | 0.880 | 20 |
| 100 KB | 102434 | 781 | safe | compressed | 32461 | 0.683 | 20 |
| 250 KB | 256054 | 1913 | aggressive | compressed | 4309 | 0.983 | 48 |
| 250 KB | 256054 | 1913 | balanced | compressed | 12307 | 0.952 | 48 |
| 250 KB | 256054 | 1913 | safe | compressed | 32463 | 0.873 | 48 |

Three readings, all of which the ratio-only table hid:

1. **`returnedBytes` plateaus per mode; the rising ratio is arithmetic on a fixed
   ceiling, not compression getting better.** Aggressive returns 4304 / 4307 /
   4309 B at 50 / 100 / 250 KB; balanced 12302 / 12305 / 12307 B. The ratio
   climbs from 0.916 to 0.983 purely because `rawBytes` grows against a constant
   numerator.
2. **Passthrough can grow the payload, and the metric cannot say so.** At 6 KB,
   balanced and safe both return 6170 B against 6166 raw — four bytes added,
   reported as `savingRatio: 0`. Passthrough is not byte-identical in the other
   direction either (12.5 KB safe: 12846 vs 12895). `savingRatio` is floored at
   zero and cannot express a net loss; either allow it to go negative or state
   the floor.
3. **Below the compress floor there is no recovery handle at all.** Passthrough
   rows carry no chunk set (`chunkCount: null`), because the pipeline returns
   early. Recoverability is a property of compressed outputs only.

The generator ran from the session scratchpad and is **not committed**, so §6's
"reproduction evidence for every ratio claim … captured, not asserted" is still
unmet for this table. The fixture is named; the script is not in the repo.

Before/after figures are not reproduced here. The before → after ladder this
section previously published was reproduced independently by the critic to
within ~1 pt on a comparable fixture, with one exception: balanced @ 12.5 KB,
where this section claimed 4.5 %, §1a said 3.7 %, `fit.ts:57` implies 16 %, and
the critic measured 0.1–1.1 % end-to-end. Four numbers for one cell and no named
fixture. The direction of the argument is unharmed — the true "before" is worse
than was claimed — but the cell is unmeasured until the generator is committed.

### What A4 changed, and where it changed nothing

A4 sizes the output as `min(targetRatio × rawBytes, modeCeiling)`. Because §W1
lever (a) did not ship, the eligibility floor is still `modeToBudget(mode)`, so
A4 alters the outcome only while `rawBytes × targetRatio < modeBudget` — that is,
between the floor and `modeBudget / targetRatio`:

| mode | floor (unchanged) | crossover | band where A4 changes anything |
|---|---:|---:|---|
| aggressive | 4 KB | 32 KB | 4–32 KB |
| balanced | 12 KB | 48 KB | 12–48 KB |
| **safe (shipped default)** | **32 KB** | **64 KB** | **32–64 KB only** |

Outside those bands the behaviour is byte-identical to before A4: the ceiling
binds. The ladder above shows the pin directly — aggressive 4304 / 4307 / 4309 B
and balanced 12302 / 12305 / 12307 B at 50 / 100 / 250 KB; safe 32461 / 32463 B
at 100 / 250 KB, with its 50 KB cell (26125 B) the one safe row inside the band
and therefore the one A4 moved.

This section previously said "the ratio is now a floor set by policy rather than
a function of how far the input exceeded a constant". That holds **only inside
those bands**. Above the crossover §1a's original criticism survives intact, and
under the shipped default it survives everywhere except a 32–64 KB window.

### The A4 gate is NOT met

Per §W1 the pass condition is **net cost reduction at constant integrity**, with
ratio as diagnostic only. Integrity holds (9/9, and the property test is now
load-bearing on the delivered side) and the ratio is measured, but **net cost is
unmeasured**: it needs a real-API benchmark, and `wiki/syntheses/saver-cache-churn`
records that the existing harness could not resolve an effect of this size. B5
added fresh-store hygiene; the harness has still never run against the real API.
Until it does, no net-cost claim may be made.

### Deferred, with reasons

- **§W1 lever (a) — decoupling the floor from the budget — did not ship.** §W1
  is two levers: (a) `floorBytes` becomes small, order 2 KB, and (b) `targetRatio`
  sizes the output. Only (b) shipped. `record-output.ts` still reads
  `input.compressFloorBytes ?? modeToBudget(input.mode)` and `DEFAULT_MODE` is
  still `"safe"`, so §1a's "nothing under 32 KB is ever touched" remains true and
  A4's reach is the band above. Reason: the floor is the same knob as the
  admission guard below it — moving it is a cost-axis decision (§0, owned by the
  net-positive spec) — and §W1's own sub-item requires the `DEFAULT_MODE` change
  to be evaluated on its own so its effect is attributable. That evaluation has
  not been run. Consequence to carry: below the floor the pipeline returns early
  and persists no chunk set, so under the shipped default output under 32 KB is
  not merely uncompressed — it has no recovery handle at all. Measured compress
  floors on the corpus above: aggressive engages by 6 KB, balanced between 6 and
  12.5 KB, safe between 25 and 50 KB.
- **Admission-guard floors ship OFF.** Requiring a minimum saving is the cost
  axis (§0, owned by the net-positive spec), and any floor above ~1 KB re-opens
  the aggressive dead band PR #278 closed. B4's divergence numbers are in;
  enabling the floors is one edit at one call site once that spec decides.
- **Exec-path enforcement.** Those paths now count the transport payload
  honestly and report a signed delta, so inflation is visible. A guard that
  changes what an MCP client receives should follow that measurement.
- **W6 condensation.** Unstarted; still gated on a measured head-to-head.
- **Suppressed-marker coverage.** Needs a production-surface change — excerpt
  raw spans on `returnedText` — not a test. **Fabrication coverage** is open
  with no established close; see the mutation subsection above.

### Corrections to the audits that produced this spec

- `bytes/4` was said to be ~35% off for code. Measured (B4, cl100k_base): code
  0.975, prose 1.013 — within 4%. JSON diverges (1.193).
- **The Turkish figure previously published here (0.961, and with it the
  conclusion "only JSON diverges") is withdrawn.** It does not reproduce: run
  against the repo's own `measureTokenDivergence`, Turkish prose lands well above
  1.0 — the sign of the claimed error is inverted, so `bytes/4` *understates*
  Turkish tokens rather than overstating them. No corpus was ever committed, so
  the original number can only be contradicted, not checked, and no replacement
  figure is published here because none has been captured under §6. This is not
  cosmetic: `estimateTokens` is the hot-path admission gate
  (`record-output.ts:166`), and CLAUDE.md §11 names `tr` as the second locale.
  Commit a corpus and re-derive.
- The `context-gate` parallel-`turbo` flake is **not** context-gate-specific: an
  `mcp-bridge` recall test failed once under a parallel run and passed on rerun
  and in isolation.
