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

**A second hardening and verification round then ran** against the residuals the
first round declared open. It re-applied every round-1 mutation rather than
inheriting its receipts, added five more, and fixed the passthrough overshoot.
Its own `pnpm verify` legs were run before the first mutation and after the last
revert, with a fresh `pnpm build` between them, both exit 0.

**A third round then shipped §W1 lever (a), the admission-guard floors and the
two read-path ledger sites**, and re-measured everything from scratch. Its
mutation campaign is 18 cycles, not 12: every earlier mutation re-applied, plus
six new ones covering the code this round changed. Where rounds disagree, the
latest measurement governs and the disagreement is named at the point it occurs.

Verification evidence for the third round, with its provenance. `pnpm verify`
exit 0, run twice — once on arrival before the first mutation (uncached, full
run) and once after the last revert, with the tree byte-identical between them.
`conventions:check` ok (`CLAUDE.md`, `AGENTS.md`, 3 `.cursor` rules). The
`turbo run test` leg is 60/60 tasks. Per-package counts are quoted **from the
uncached baseline run**, because the final run was a FULL TURBO cache hit — that
is legitimate evidence only because the content hash is identical, so the numbers
cited are the uncached ones: `@megasaver/context-gate` 59 files / 417 tests;
`@megasaver/output-filter` 51 files / 497 tests; `@megasaver/cli` 145 files /
1464 passed + 7 skipped; `core` 913; `mcp-bridge` 343; `daemon` 113; `stats` 262;
`gui` 676. No failures anywhere in the workspace. `git status` at the start and at
the end of that session are identical (same 9 modified + 3 untracked files), so no
concurrent-agent churn is folded into these numbers.

Each mutation cycle was: snapshot file → apply the defect by exact-substring
replace → full `pnpm build` → run the `context-gate`, `output-filter` and
`apps/cli` suites → restore the file → `pnpm build` again → sha256 against the
baseline. All 18 builds were green, so no mutation was "caught" by a compile
error, and all 18 reverts were verified by hash.

**Cross-package resolution was calibrated, not assumed.** Packages resolve each
other through `package.json` `exports` → `dist/`, so a mutation in
`output-filter/src` is invisible to `context-gate` until `output-filter` is
rebuilt. M13 was applied, `context-gate` run *without* a rebuild (pass), then
rebuilt and run again (still pass) — which is what licenses reading
`context-gate`'s zeros on the `output-filter` mutations as genuine "not
applicable" rather than "never ran". Every campaign cycle rebuilds.

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
| W1/A4 lever (b) | `targetBudget`: mode budget is the ceiling, target is a share of the input |
| W1 lever (a) | `COMPRESS_FLOOR_BYTES = 2_048` in `record-output.ts`; `minBytesFor(tool)` in `apps/cli/src/hooks/saver.ts` no longer takes a mode. The eligibility floor is no longer the mode budget |
| W1 (admission guard) | `DEFAULT_SAVING_FLOORS = { absoluteBytes: 256, relative: 0.15 }`, passed explicitly from `record-output.ts`; the read/exec call sites stay on `NO_FLOORS` |
| W0/B1-B5 | Signed `deltaBytes`, model-facing bytes, recovery debt, real BPE count, fresh-store harness |
| W0/B1 (read paths) | `run.ts`'s two read entry points count the MCP envelope and persist a signed `deltaBytes` |
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
(`read.ts:264`, `read.ts:291`, `run-command.ts:395`, `run-command.ts:661`,
`record-output.ts:247`) now share one chunking entry point and cannot re-diverge
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

### Three non-discriminating tests, and what three rounds of mutation testing show

The critic's mandate was not "do the tests pass" but "do they pass for the right
reason". Three did not:

| test | passed with the defect fully present | now |
|---|---|---|
| `recovery-addressability.test.ts` | A3's interior-marker skew: its per-marker check ("chunk `floor((N-1)/40)` contains raw line N") is true for every N by construction, so its only discriminating assertion was the tail extent | adjacency assertion — the span a marker names must close where the next delivered raw line begins; round 2 added continuity and chunk-coordinate assertions to the same file, which catch M10 and M11. As of HEAD the adjacency assertion also catches M6 with a defect-naming message (see below) |
| `save-integrity.property.test.ts` | delivered text reduced to the summary line: `universe = delivered + recovered` is satisfied by `recovered` alone, so the delivered half contributed nothing | `assertDeliveredCarriesEvidence` — the delivered half must itself carry raw evidence |
| the A1 read-path block | the production read path was never executed; the test hand-assembled its own `persistChunkSet` call, so `run.ts:180` — `mega output file`, `mega output filter`, MCP `read-file`, the daemon registry — was uncovered repo-wide | `read-pipeline-recovery.test.ts` drives `runOutputPipeline` itself |

Each defect was then reintroduced as a mutation and the catcher recorded. The
table below is the **third round's** re-measurement and supersedes both earlier
tables wherever they differ. Every earlier mutation was re-applied rather than
inherited, and six were added for the code this round changed. Mechanics,
per-package test counts and the cross-package rebuild calibration are in the
provenance paragraphs at the head of this section.

| mutation | defect restored | caught by |
|---|---|---|
| M1a | `run.ts` `runOutputPipeline` persists `filteredResult.excerpts…join("\n")` instead of `read.raw` — §1b(i), the most severe finding in the audit | `read-pipeline-recovery`, `recovery-invariants` (2 files) |
| M1b | same defect at `runOverlayOutputPipeline` | `read-pipeline-recovery`, `recovery-invariants` (2 files) |
| M2 | `returnedTextOf` returns the summary and nothing else | 5 files / 13 tests: `coordinate-skew`, `record-output`, `recovery-addressability`, `recovery-invariants`, `save-integrity.property` |
| M6 | interior markers numbered in delivered (post-collapse) space | `recovery-addressability` **only** |
| M7 | `recoverableChunks` drops `normalize()` | `coordinate-skew`, `recovery-invariants` (2 files) |
| M8 | `returnedTextOf` appends a content-shaped line that appears nowhere in the raw | `recovery-invariants`, `save-integrity.property` — both hook-path only |
| M9 | `fitBudget` keeps roughly half as many chunks | `record-output`, `save-integrity.property`, `output-filter/filter-output` (3 files, both packages) |
| M10 | only the FIRST interior gap marker is emitted | `recovery-addressability` (defect-naming); `recovery-invariants` fires only on its own anti-vacuity precondition |
| M10b | ONE interior marker suppressed (the third), leaving ≥2 adjacency checks so a counter-based test is fully escaped | `recovery-addressability` **only**, via the continuity assertion |
| M11 | wrong `chunkCount` handed to `buildRecoveryFooter` | `coordinate-skew`, `recovery-addressability` (2 files) |
| M12 | every stored chunk's `startLine`/`endLine` shifted by one | 5 files, two packages: `coordinate-skew`, `read-pipeline-recovery`, `record-output`, `recovery-addressability`, `apps/cli` `saver-roundtrip` |
| M13 (new) | `filterOutput` reports `returnedBytes` without counting the summary (`output-filter/src/types.ts:403`; the same defect ships **unmutated** on the outline branch at `:248` — see "What is still open", item 2) | `output-filter/passthrough-honesty` **only** (6/6 of its tests) |
| M14 (new) | `FilterOutputResult.deltaBytes` clamped at zero (`types.ts:447`) | `output-filter/passthrough-honesty` **only** (2 tests) |
| M16a (new) | `runOutputPipeline`'s ledger reverts to clamped/unsigned filter values, envelope uncounted | `ledger-signed-delta` **only** |
| M16b (new) | same at `runOverlayOutputPipeline` | `ledger-signed-delta` **only** |
| M17 (new) | `record-output.ts` eligibility floor reverts to `input.compressFloorBytes ?? modeToBudget(input.mode)` | `floor-decoupling` **only** |
| M17b (new) | `apps/cli` hook floor re-couples to the safe-mode budget (`minBytesFor` returns 32_000) | `apps/cli` `saver.test.ts` **only** (7 tests) |
| M18 (new) | admission-guard `DEFAULT_SAVING_FLOORS` reverted to off (`{0, 0}`) | `floor-decoupling` **only**, and only via its direct `admitCompression` assertions |

No mutation in that set survives. Three records to keep with the table.

- **M9 is a different variant from the second round's.** This round's M9 drops
  every other kept chunk; the second round's halved the byte budget. Both satisfy
  the same description, which is why the `output-filter` catcher here is
  `filter-output.test.ts` rather than `fit`/`rank`. Not a coverage regression.
- **M10b exists because a counter can be escaped.** M10 suppresses the first
  marker and is caught; M10b suppresses one interior marker in the middle, leaving
  enough adjacency checks that an anti-vacuity counter never fires. The continuity
  assertion still names the exact span (`raw 400 and raw 681 read as contiguous`).
- **M18 is unobservable through pipeline behaviour by construction.** The shipped
  admission floors reject nothing the eligibility floor admits (see "Deferred →
  shipped"), so reverting them to off changes no black-box outcome. A
  constant-asserting test plus a white-box spy is the only guard that can exist.

**M6's characterisation in the second round is stale as of HEAD.** That round
recorded M6 as firing solely through an anti-vacuity counter whose message
described the fixture rather than the defect. Measured now, M6 fails the adjacency
assertion with a defect-naming message: `… [lines 3-3 omitted] is followed by raw
line 801, so the gap it names must close at 800: expected 3 to be 800`. The cause
was discriminated rather than guessed — `git log -1` on
`recovery-addressability.test.ts` is `48c9b066`, which is HEAD and the same commit
that touched this spec, so the second round's text was already stale when written
rather than changed by this round. M6 is still single-guarded; only the message
quality is different.

**Single-point coverage got worse again, and the count is now nine.** Nine
distinct defects have exactly one guarding file, spread over five files:

| file | sole guard for |
|---|---|
| `context-gate/test/recovery-addressability.test.ts` | M6, M10b |
| `output-filter/test/passthrough-honesty.test.ts` | M13, M14 |
| `context-gate/test/ledger-signed-delta.test.ts` (**untracked**) | M16a, M16b |
| `context-gate/test/floor-decoupling.test.ts` (**untracked**) | M17, M18 |
| `apps/cli/test/hooks/saver.test.ts` | M17b |

M10 is effectively a tenth: its second file, `recovery-invariants`, failed only
its own anti-vacuity precondition ("a shallow hand-off cannot tell a skewed
coordinate space from a sound one"), which is not an assertion about a missing
marker. The second round's line — "five of eight defects have exactly one guard" —
is superseded. M1, M7 and M8 gained real second guards this round (all in
`recovery-invariants`), but five new defects landed with one guard each, so the
absolute count rose.

**Two of those five files are untracked**, and a third untracked file
(`context-gate/test/recovery-invariants.test.ts`) is the *second* guard for M1, M7
and M8. If the three do not land in the merge commit, M16a/M16b/M17/M18 have zero
coverage and M1/M7/M8 revert to single-guarded. See "What is still open", item 1.

**`output-filter`'s 497 tests caught exactly the mutations living in that
package's source** (M9, M13, M14); `context-gate` source is unreachable from
there. Its zeros in this table are "not applicable", not "not caught", and that
reading was verified by the rebuild calibration above rather than assumed.

Two corrections the second round's text needs and this round can close:
`output-filter/test/passthrough-honesty.test.ts` is **tracked** (`git ls-files`
lists it), so the staging-hazard item recorded against it is withdrawn; and the
M6 characterisation above.

### Measured ratio (diagnostic, not the gate)

The unit of this table is **`returnedBytes` at a stated input size**, not a
ratio. `savingRatio` is carried as a derived column, last, because a saving ratio
quoted without its input size is not a statement about the compressor — it is a
statement about the denominator.

Fixture, stated so the numbers can be reproduced: distinct non-repeating
TypeScript source, driven through `recordAndFilterOverlayOutput` — the hook path
— against built `dist/`, with `storeRawOutput: true` and a fresh store per cell,
and with no `compressFloorBytes` passed, so each cell uses the shipped default.
The corpus was checked non-degenerate: at 250 KB it is 3614 lines, 3099 of them
distinct, and no delivered text in any cell contains a collapse stand-in
(`... [repeated N times]` or `... [N similar:]`), so these rows measure the budget
rather than redundancy. This is the **same generator and same corpus** the second
round used — the only variable changed is the eligibility floor default (was
`modeToBudget(mode)` = 4000 / 12000 / 32000 B, now `COMPRESS_FLOOR_BYTES` = 2048
in every mode) — so the comparison below is genuinely row-by-row. A 3 KB row was
added because the new floor puts it in range.

`deltaBytes` is the pipeline's signed byte delta at this entry point
(`rawBytes − returnedBytes`). It is a measurement of delivered bytes. It is not a
savings figure and not a net-cost figure; see "The A4 gate is NOT met".

| input | mode | rawBytes | decision | returnedBytes | deltaBytes | chunkCount | savingRatio (derived) |
|---|---|---:|---|---:|---:|---:|---:|
| 3 KB | aggressive | 2993 | compressed | 594 | 2399 | 2 | 0.802 |
| 3 KB | balanced | 2993 | compressed | 699 | 2294 | 2 | 0.766 |
| 3 KB | safe | 2993 | compressed | 730 | 2263 | 2 | 0.756 |
| 6 KB | aggressive | 6133 | compressed | 1101 | 5032 | 3 | 0.820 |
| 6 KB | balanced | 6133 | compressed | 1205 | 4928 | 3 | 0.803 |
| 6 KB | safe | 6133 | compressed | 3152 | 2981 | 3 | 0.486 |
| 12.5 KB | aggressive | 12785 | compressed | 1911 | 10874 | 5 | 0.851 |
| 12.5 KB | balanced | 12785 | compressed | 3123 | 9662 | 5 | 0.756 |
| 12.5 KB | safe | 12785 | compressed | 5798 | 6987 | 5 | 0.547 |
| 25 KB | aggressive | 25501 | compressed | 3027 | 22474 | 10 | 0.881 |
| 25 KB | balanced | 25501 | compressed | 6655 | 18846 | 10 | 0.739 |
| 25 KB | safe | 25501 | compressed | 12133 | 13368 | 10 | 0.524 |
| 50 KB | aggressive | 51152 | compressed | 3030 | 48122 | 19 | 0.941 |
| 50 KB | balanced | 51152 | compressed | 11218 | 39934 | 19 | 0.781 |
| 50 KB | safe | 51152 | compressed | 25085 | 26067 | 19 | 0.510 |
| 100 KB | aggressive | 102391 | compressed | 3032 | 99359 | 37 | 0.970 |
| 100 KB | balanced | 102391 | compressed | 11220 | 91171 | 37 | 0.890 |
| 100 KB | safe | 102391 | compressed | 30627 | 71764 | 37 | 0.701 |
| 250 KB | aggressive | 255975 | compressed | 3990 | 251985 | 91 | 0.984 |
| 250 KB | balanced | 255975 | compressed | 12178 | 243797 | 91 | 0.952 |
| 250 KB | safe | 255975 | compressed | 31585 | 224390 | 91 | 0.877 |

**What the floor decoupling moved, and what it did not.** Of the 18 cells shared
with the previous table, **14 are byte-identical**: 6 / 12.5 / 25 KB in aggressive
and balanced, and every cell at 50, 100 and 250 KB. **Exactly four changed, and
every one of them was previously `passthrough`** — 6 KB balanced 6133 → 1205,
6 KB safe 6133 → 3152, 12.5 KB safe 12785 → 5798, 25 KB safe 25501 → 12133.
Nothing above the old floor moved by a single byte. The change is entirely the
band that the old floor excluded from the pipeline.

Four readings, all of which a ratio-only table hides:

1. **The rising ratio is denominator-driven, not compression getting better.**
   Aggressive returns 3027 / 3030 / 3032 B at 25 / 50 / 100 KB — a numerator flat
   to within 5 bytes while the input grows fourfold — and its ratio climbs 0.881
   → 0.970 on that alone. Balanced is the same shape: 11218 / 11220 B at 50 and
   100 KB, ratio 0.781 → 0.890.
2. **Safe does not plateau, and should not be described as if it did.** Safe
   returns 25085 → 30627 → 31585 B at 50 / 100 / 250 KB: the numerator grows
   1.26× while the input grows 5×. The ratio still climbs for the same reason —
   the denominator outruns it — but the ceiling is not pinned the way
   aggressive's and balanced's are within their measured range.
3. **The 250 KB cell steps, in every mode.** Aggressive rises 3032 → 3990 B,
   balanced 11220 → 12178 B and safe 30627 → 31585 B between 100 and 250 KB — the
   same +958 B in all three. The second round's prose reported the step in
   aggressive and balanced only; its own table already showed it in safe. The
   step coincides with `chunkCount` rising 37 → 91. Mode-independence is new
   information about the cause; no mechanism is established and none is claimed.
4. **The band with no recovery handle shrank; it did not disappear.** A
   `passthrough` cell carries `chunkSetId: null` and `chunkCount: null` **even
   with `storeRawOutput: true`**, because the early return precedes persistence —
   nothing is lost (the model keeps the full raw and no footer is emitted) but
   "raw output is stored" is not true of it. That band used to be everything below
   the mode budget, i.e. everything below 32 KB under the shipped default. It is
   now everything below 2048 B: no cell in this table is `passthrough`, and every
   one of the 21 rows carries a `chunkCount` between 2 and 91. The floor is still
   real — safe at 1.5 KB was measured `passthrough` — so the second round's
   reading 4 is narrowed, not closed.

The generator ran from the session scratchpad and is **still not committed**, so
§6's "reproduction evidence for every ratio claim … captured, not asserted"
remains unmet for this table. The fixture is named; the script is not in the repo.

Before/after figures are not reproduced here. The before → after ladder this
section previously published was reproduced independently by the critic to
within ~1 pt on a comparable fixture, with one exception: balanced @ 12.5 KB,
where this section claimed 4.5 %, §1a said 3.7 %, `fit.ts:57` implies 16 %, and
the critic measured 0.1–1.1 % end-to-end. Four numbers for one cell and no named
fixture. The direction of the argument is unharmed — the true "before" is worse
than was claimed — but the cell is unmeasured until the generator is committed.

**This table is fixture-sensitive and one cell has a 2× spread across corpora.**
At safe / 3 KB it reads `deltaBytes` 2263 (ratio 0.756); the floor-sizing work
that chose 2048 measured 619–1136 B (ratio 0.30–0.37) at the same cell on real
repo source plus adversarial `tsc` output. Both are valid measurements of
different content. That corpus is not in the repo, so the headroom argument built
on it (see "Deferred → shipped") can be contradicted but not re-checked.

### Passthrough overshoot — a reporting defect on one path, a payload on another

The previous table showed `passthrough` cells returning more bytes than they
received (6170 against 6166 raw) under `savingRatio: 0`. Two separate things were
wrong, and they were fixed differently because they are not the same kind of
defect.

**Where the overshoot came from.** `filterOutput`'s `returnedBytes` counts the
summary line plus the excerpt text, and in the non-compressed bands the summary
line is pure addition. Measured on real repo source before any change, calling
`filterOutput` **directly** — a different entry point from the ladder above,
whose bands are set by `compressFloorBytes`, not by `PASSTHROUGH_THRESHOLD_TOKENS`:
`model-facing-bytes.ts` 2888 → 2931 B (+43), `guard-match.ts` 6793 → 6882 B
(+89), `predefined-roles.ts` 6883 → 7024 B (+141) — each reported as
`savingRatio: 0`, indistinguishable from breaking even exactly.

**Does that text reach the model? Per path, not one verdict.**

| path | passthrough text reaches the model | therefore |
|---|---|---|
| PostToolUse hook | **No.** `apps/cli/src/hooks/saver.ts:351` returns `PASSTHROUGH` for any non-`compressed` decision; only the compressed branch reaches `updatedToolOutput` at `:361`. The model keeps the original tool output | the overshoot was a **reporting** defect: the rendering was built, returned and discarded |
| daemon `/excerpt` | **No.** `packages/daemon/src/handlers.ts:47-57` calls the same entry point and `saver-run.ts:125` hands the JSON to the same hook, which discards it identically | same defect, same fix, over HTTP |
| registry exec / overlay exec / MCP | **Yes.** `packages/mcp-bridge/src/server.ts:316` stringifies the whole struct, so scores, features, warnings and metrics are all model-facing | these paths already count the transport payload (`run-command.ts:432`) and record an unclamped delta |

**What was changed.** Two edits, neither of which shrinks a payload. (i) On the
hook/daemon path, `record-output.ts`'s `filtered.decision !== "compressed"`
branch now reports what the model actually keeps — `returnedText: input.raw`,
`returnedBytes: rawBytes`, zeros — matching the shape the admission-guard branch
70 lines below already used for the same situation. On a 13-byte payload that
branch had been reporting 62 returned bytes. (ii) A signed `deltaBytes` was added
to `FilterOutputResult` and `RecordOverlayOutputResult`, never clamped, alongside
the existing `bytesSaved` and `savingRatio`, which keep their floor at zero so no
existing reader changes meaning. `filterOutput`'s `returnedBytes` and
`savingRatio` are byte-for-byte unchanged in every band; the loss is now
*representable*, not smaller.

**What the fix costs this table.** Because the non-compressed branch now returns
the raw, every `passthrough` cell above reads `returnedBytes === rawBytes` and
`deltaBytes === 0`. The summary-line inflation is therefore **no longer
observable through this entry point at all** — it can only be measured by calling
`filterOutput` directly. This ladder cannot serve as a regression witness for it.
The only thing that pins the `filterOutput`-level relationship is
`packages/output-filter/test/passthrough-honesty.test.ts`, a single file. It is
**tracked** — the second round recorded it as untracked; `git ls-files` lists it,
and that item is withdrawn. M13 and M14 are its two sole-guarded defects.

**The read-path ledger sites are now closed.** `run.ts`'s two read entry points —
`runOutputPipeline` (project layout) and `runOverlayOutputPipeline` (overlay) —
previously appended `returnedBytes` / `bytesSaved` / `savingRatio` straight off
the filter result, with no signed field and no count of the MCP envelope the
result is actually delivered in. Both now compute `mcpEnvelopeBytes(result)`
*after* the chunk-set id and shown-dedup are applied, and persist
`returnedBytes` = envelope, `bytesSaved` = clamped envelope-aware value,
`deltaBytes` = the unclamped signed value, `savingRatio` = clamped envelope-aware
ratio (`run.ts:220`, `:243`, `:389`, `:412`). This mirrors what the exec paths
already shipped. Delivery was traced for `runOutputPipeline`:
`mcp-bridge/src/tools/read-file.ts` returns `outcome.result` unmodified and
`server.ts:316` stringifies it, so the model pays for scores, the `features`
object, warnings and metrics — not just excerpt text.

Measured on the two sites, off the persisted event and summary. Inflating case, a
32-byte file that the filter passes through: `returnedBytes` 81 → 748,
`deltaBytes` absent → −716, `summary.deltaBytesTotal` 0 → −716. A read that costs
the model 716 bytes more than the file it read used to aggregate as exactly zero.
Compressing case, an 88,787-byte error log in balanced mode:
`returnedBytes` 11,291 → 13,221, `bytesSaved` 77,496 → 75,566, `savingRatio`
0.873 → 0.851. Those are corrections — the old numbers over-reported — and they
shift persisted aggregates; see "What is still open", item 7.

**`run-command.ts:457-460` / `:693` was resolved as correct-as-is, not fixed.**
`deltaBytes` on those exec events was already signed and already expresses the
loss. `savingRatio` cannot be made signed: `packages/stats/src/event.ts` declares
`savingRatio: z.number().min(0).max(1)` inside a `.strict()` object that
`appendEvent` / `appendOverlayEvent` parse on write, so a negative value throws
`StatsError("schema_invalid")` and turns the tool call into `store_write_failed`.
The reasoning is now a WHY comment at both sites and the derivation
(`deltaBytes / rawBytes`) is pinned in `ledger-signed-delta.test.ts`. The
residual — no *persisted* signed ratio anywhere — stays open; see item 8.

### What A4 changed, and where it changed nothing

A4 sizes the output as `min(max(MIN_TARGET_BYTES, targetRatio × rawBytes),
modeCeiling)` (`output-filter/src/fit.ts:75-92`, `MIN_TARGET_BYTES = 1_024`,
`MODE_TARGET_RATIO` = 0.125 / 0.25 / 0.5). It alters the outcome only while
`rawBytes × targetRatio < modeBudget` — that is, between the eligibility floor and
`modeBudget / targetRatio`. Neither the ratios nor the budgets changed this round;
the floor did, and it is now the same 2048 B in every mode for the original tool
surfaces:

| mode | eligibility floor | `MIN_TARGET_BYTES` binds below | crossover (`budget / ratio`) | band where A4 changes anything |
|---|---:|---:|---:|---|
| aggressive | 2 KB | 8 KB | 32 KB | 2–32 KB |
| balanced | 2 KB | 4 KB | 48 KB | 2–48 KB |
| **safe (shipped default)** | **2 KB** | **2 KB** | **64 KB** | **2–64 KB** |

Two mechanical notes on that table. The `MIN_TARGET_BYTES` column is where the
1024 B clamp, not the ratio, sets the target: below 8 KB in aggressive and 4 KB in
balanced the target is a flat 1024 B, so A4's ratio does not apply there even
though the band does. And the floor column no longer describes every surface —
coarse/new surfaces (`Task`, `BashOutput`, `Monitor`, `WebSearch`, `ToolSearch`,
`mcp__*`) get a flat `NEW_SURFACE_MIN_BYTES = 16_384`
(`apps/cli/src/hooks/saver.ts:29,45-46`) instead of the old `max(modeBudget,
16384)`, which was 32000 under safe. That change shipped inside lever (a) without
a spec item of its own; it is recorded in "What is still open", item 9.

Outside those bands the behaviour is byte-identical to before A4: the ceiling
binds. The ladder above shows it — aggressive returns 3030 / 3032 / 3990 B and
balanced 11218 / 11220 / 12178 B at 50 / 100 / 250 KB, each sitting just under
its 4000 / 12000 B ceiling and flat to within 5 bytes across the 50–100 KB pair.
Safe returns 30627 / 31585 B at 100 / 250 KB against a 32000 B ceiling.

This section previously said "the ratio is now a floor set by policy rather than
a function of how far the input exceeded a constant". That holds **only inside
those bands**. Above the crossover §1a's original criticism survives intact. What
changed under the shipped default is the lower edge: the band was 32–64 KB, and
it is now 2 KB–64 KB. §1a's "nothing under 32 KB is ever touched" no longer holds.
That sentence is in §1a, which this section does not own; it is recorded here as a
contradiction for whoever revises §1a.

### A4 gate — REFORMULATED 2026-07-30 (user-approved)

The original wording below ("net cost reduction", one number) is superseded. It
was not reachable by any instrument this repo can build, for reasons that are now
evidenced rather than suspected:

- **Live A/B cannot resolve it.** Spread 0.68x-1.23x against a ~5% effect, driven
  by agent-path nondeterminism (turn counts differ run to run for the same
  prompt). That is a systematic confound, not noise, so replicates do not
  converge on it.
- **Replay cannot resolve it either.** It is deterministic, but a fixed
  trajectory can never produce the recovery turns that expansion causes.
- **The mechanism that motivated the gate was misattributed.** "Rewrite in place
  -> cache invalidation" cannot occur: PostToolUse returns `updatedToolOutput`
  before the result enters the transcript (`saver.ts:377`), and recurring
  tool_results are byte-stable across a session (26/26 measured, both corpora).
  See the retraction in `wiki/syntheses/saver-cache-churn`.

**The gate is therefore a bounded decision, not a single number:**

> **A4 passes iff `S > 0` and `R < R*`.**
>
> | term | meaning | how it is obtained |
> |---|---|---|
> | `S`  | input-side cost saving | replay, per-arm-run cache namespaces |
> | `R*` | break-even recovery rate | derived offline from a recording |
> | `R`  | observed recovery rate | production ledger, `recoveryRate()` |

`R*` and `R` are both measured **pessimistically**, so the comparison is
conservative on both sides:

- `R*` assumes the agent expands the COSTLIEST outputs first, expands each one in
  FULL, and does so immediately after first sight (maximising the requests the
  recovered bytes ride in). Expansion is charged the RAW bytes, not the bytes
  compression removed, because `mega output chunk` appends chunks as new
  tool_results while the compressed summary stays in history — an expanded
  session carries both.
- `R` counts an output expanded by a single chunk exactly as one expanded in
  full, so it overstates recovery.

Both sides are measured in BYTE-APPEARANCES: the Messages API resends the whole
history every turn, so a byte's cost is proportional to how many requests it
appears in. Counting plain bytes would price a last-turn expansion the same as a
first-turn one.

**Measured 2026-07-30** (`rec-big/task_1`, balanced, 18 requests): saving 442,187
byte-appearances across 3 compressed outputs; `R* = 2/3`. Megasaver stays net
cheaper unless all three of its compressed outputs are pulled back in full.

**Status 2026-07-30: A4 PASSES UNDER MODEL.** All three terms have values.

| term | value | basis |
|---|---|---|
| `S`  | **1.199x** (megasaver ~16.6% cheaper, input side) | modelled offline; cross-checked against one real-API pair |
| `R*` | **66.7%** | derived offline from the recording |
| `R`  | **2.4%**  | production ledger, 42 compressed outputs, 1 expanded |

`S` is MODELLED, not measured — the API budget ran out mid-run. What makes it
usable rather than a guess:

1. **The model was validated against real usage.** Simulated against
   `rec-big/task_1`'s own end-to-end figures: total input-side tokens within
   **0.1%** (1,024,470 vs 1,025,568), cache_read within 3.4%, cache_creation
   over by 38%.
2. **The ratio is invariant to the one parameter the model cannot derive.**
   Bytes-per-token from 2.5 to 2.7 gives S = 1.1989 throughout — it cancels.
3. **The ratio is invariant to the model's known errors.** Perturbing
   cache_creation by -38% (to match reality) or +50%, or cache_read by -20%,
   applied equally to both arms, moves S only between 1.1987 and 1.1990.
4. **It agrees with the one real-API measurement available.** The
   order-sensitive paid run's second pair — the both-arms-warm regime, the
   closest thing to a fair comparison that run produced — measured **1.197**
   against the model's **1.199**.

Two modelling bugs were found by calibration rather than by review, and both
would have inverted the answer: matching cached prefixes only at the CURRENT
request's breakpoints (real sessions match entries whose marker has since moved
to a later turn), and hashing `cache_control` as though it were content (it is a
marker, and it moves every turn). Before those fixes the model put read/creation
at 0.44 where the real session ran 11.8.

**What is still not established.** `S` is not a measurement, and one real replay
run would settle it — the harness is ready and rehearsed (`--dry-run`). The
rate-card bias stands: 17/18 requests are opus-5 priced at one flat card, so the
figure is directional, not calibrated. `R*` is corpus-specific. `R` is n=42 from
a single operator. And the counterfactual-trajectory limit is unchanged — a live
compressed agent may take different turns than the recorded one.

### The A4 gate is NOT met (original wording, superseded above)

Per §W1 the pass condition is **net cost reduction at constant integrity**, with
ratio as diagnostic only. Integrity holds (9/9, and the property test is now
load-bearing on the delivered side) and the ratio is measured, but **net cost is
unmeasured**, so the gate is not met.

What "unmeasured" rests on, verified rather than inherited:
`wiki/syntheses/saver-cache-churn` pools Stage A at 0.97× — indistinguishable —
and records that **no stage can be validated with that harness**. The churn tax it
measured is roughly 18k extra cache-creation tokens per tool_result rewrite.
Nothing in `packages/bench-replay` records a real-API run. B5 added fresh-store
hygiene; the harness has still never run against the real API.

**This round moved churn exposure in an unmeasured direction.** Under the shipped
default the saver previously fired only above 32 KB; it now fires above 2048 B, so
it rewrites many more small outputs. The smallest new cell in the ladder above
delivers `deltaBytes` 2263 at 3 KB in safe mode — a delivered-byte figure nowhere
near the ~18k-token churn tax measured for a single rewrite. No test in the repo
can currently detect a net-negative outcome.

Nothing in this section is a savings claim or a net-cost claim, and none may be
added until the benchmark runs. In particular **the ratio ladder measures
delivered bytes, not cache-creation tokens**, so no row of it — `returnedBytes`,
`deltaBytes` or the derived ratio — is a net-cost claim.

### What is still open

Stated flat, from the third round's own receipts, and grouped so a reader can act
without reading the code. The distinction that matters throughout: some of these
are "no test sees it", and some are "wrong in production right now".

**Merge-blocking hygiene — mechanical, and catastrophic if missed.**

1. **Three of this round's guard files are untracked** (`??` in `git status`):
   `packages/context-gate/test/recovery-invariants.test.ts`,
   `packages/context-gate/test/floor-decoupling.test.ts`,
   `packages/context-gate/test/ledger-signed-delta.test.ts`. They are the **only**
   guard for M16a, M16b, M17 and M18, and the **second** guard for M1, M7 and M8.
   If they do not land in the merge commit, those four defects have zero coverage
   and M1/M7/M8 revert to single-guarded. `git add -u` will not pick them up.
   Verify they are staged before merging.

**Live production defects, in nobody's task.**

2. **M13 is live and unmutated in production on `filterOutput`'s outline branch**
   (`packages/output-filter/src/types.ts:248`). It computes
   `returnedBytes = byteLength(outline.skeleton)` while the same result also
   carries `summary: "outline mode: expand bodies via mega_fetch_chunk"` (48 B);
   `returnedTokens = estimateTokens(outline.skeleton)` under-counts identically.
   Verified by reading the branch. No test pins it, and a test written against
   current behaviour would pin the defect as correct. Needs a production fix from
   a round that owns `types.ts`.
3. **An unchanged re-read is uncounted, not miscounted.** `unchangedResult`
   (`run.ts:41-56`) hardcodes `returnedBytes: 0`, `bytesSaved: rawBytes`,
   `savingRatio: 1` and carries no `deltaBytes`; the unchanged branch returns at
   `run.ts:130` and `:330`, **before** either event-append site. A re-read that
   still costs the model a full MCP envelope (summary text plus the
   `priorChunkSetId` marker) therefore never reaches the ledger at all. A third
   ledger site, a different defect class from M16, and not in anyone's task.

**Coverage gaps.**

4. **Nine defects have exactly one guarding file**, across five files: M6 and
   M10b (`recovery-addressability`), M13 and M14 (`passthrough-honesty`), M16a and
   M16b (`ledger-signed-delta`), M17 and M18 (`floor-decoupling`), M17b
   (`apps/cli` `saver.test.ts`). M10 is effectively a tenth — its second file
   failed only its own anti-vacuity precondition, which is not an assertion about
   a missing marker. Two of the five files are untracked (item 1). The second
   round's "five of eight" is superseded: M1, M7 and M8 gained real second guards
   this round, but five new defects landed with one guard each, so the absolute
   count went up.
5. **Fabrication is still demonstrated on the hook path only.**
   `recovery-invariants.test.ts:576-604` drives `recordAndFilterOverlayOutput`
   alone, and `save-integrity.property`'s fabrication catch is likewise its three
   hook-path cases. No fabrication mutation has ever been run against the read or
   exec renderers, which do not go through `returnedTextOf`.
6. **M18 is undetectable by any black-box pipeline test, by construction.** The
   shipped admission floors (256 B / 0.15) reject nothing the eligibility floor
   admits on any measured shape, so reverting them to off changes no observable
   pipeline behaviour. Only `floor-decoupling`'s direct `admitCompression`
   assertions and its white-box spy can see it. Read the floors as a backstop
   against a near-no-op rewrite, not as a minimum-saving gate — any value tuned to
   bite re-opens the #278 dead band.

**Behaviour that changed silently, with nothing warning a reader.**

7. **Audit and GUI aggregates will shift and there is no migration note.** The
   read paths' persisted `returnedBytes` / `bytesSaved` / `savingRatio` now
   describe the whole MCP envelope — `mcpEnvelopeBytes` is
   `bytesOf(JSON.stringify(payload))`, so it also counts the ranking `trace` when
   `recordTrace` is on. Measured on one compressing read: `bytesSaved`
   77496 → 75566, ratio 0.873 → 0.851. CLI text output is unaffected
   (`apps/cli/src/commands/output/file.ts` and `filter.ts` render off
   `FilterOutputResult` — verified), but any surface reading the persisted summary
   shows corrected numbers with no note explaining the discontinuity.
8. **`savingRatio` remains clamped to [0,1] on every ledger site**, enforced by
   `packages/stats/src/event.ts` (`.strict()`, parsed on write by `appendEvent` /
   `appendOverlayEvent`). Leaving it clamped is defensible — a negative value
   throws `StatsError("schema_invalid")` and turns the tool call into
   `store_write_failed`. The consequence stands open: **no persisted signed ratio
   exists anywhere**, and readers must derive `deltaBytes / rawBytes`. A stored
   `deltaRatio` is a `packages/stats` packet nobody owns.
9. **New/coarse surfaces silently changed semantics.** `Task`, `BashOutput`,
   `Monitor`, `WebSearch`, `ToolSearch` and `mcp__*` previously got
   `max(modeBudget, 16384)` — 32000 under safe — and now get a flat
   `NEW_SURFACE_MIN_BYTES = 16_384` in every mode. `BASH_COMPRESS_FLOOR` and
   `BACKGROUND_SHELL_TOOLS` were deleted. Shipped inside the §W1 lever (a) change
   without a spec item of its own.
10. **Daemon default drift, invisible to its own tests.**
    `packages/daemon/src/handlers.ts:53` forwards `compressFloorBytes` only when
    present, so an `/excerpt` caller that omits it now gets 2048 instead of
    `modeToBudget(mode)`. The only in-tree caller
    (`apps/cli/src/hooks/saver-run.ts` via `saver.ts:345`) always forwards, and
    `packages/daemon/test/handlers.test.ts:152` passes 4000 explicitly — so no
    test in the repo can see this change. An out-of-tree or older client would.

**Unmeasured, unowned, or undecided.**

11. **Net cost is still unmeasured and the §W1/A4 gate is still not met.** Detailed
    in "The A4 gate is NOT met" above. The floor decoupling raised churn exposure
    in an unmeasured direction; no test in the repo can detect a net-negative
    outcome.
12. **`DEFAULT_MODE` is still `"safe"`** (`resolve-saver-settings.ts:44`),
    deliberately unchanged. §W1's own sub-item requires the `DEFAULT_MODE` change
    to be evaluated on its own so its effect is attributable. That evaluation has
    not been run.
13. **The floor-sizing evidence rests on an uncommitted, fixture-sensitive
    corpus.** The 2048 choice was measured at 619–1136 B of delivered-byte delta
    (ratio 0.30–0.37)
    at safe / 3 KB on real repo source plus adversarial `tsc` output; this
    section's own generator measures 2263 B / 0.756 at the same cell. Both are
    valid; the spread is 2×. The worst-case corpus is not in the repo, so the
    "2.4× headroom" that sized `absoluteBytes: 256` can be contradicted but not
    re-checked.
14. **The ratio generator is still not committed** (§6, "captured, not asserted"),
    so the ladder is reproducible in principle from its named fixture and not in
    practice from a script in the repo.
15. **`runOverlayOutputPipeline` has no in-repo production caller.** Confirmed by
    grep across `packages/` and `apps/` excluding tests: the only non-test
    references are its own definition (`run.ts:287`) and the `index.ts` re-export.
    Its new envelope accounting is a consistency argument with its exec sibling,
    not an observed delivery site.
16. **Whether 2048 is the right eligibility floor is undecided on present
    evidence, and is recorded as such rather than endorsed.** It is a principled
    construction — `MIN_TARGET_BYTES` (1024) divided by safe's 0.5 share, the
    smallest input at which safe's ratio is its own rather than the clamp — and
    §W1's text says "order 2 KB". The churn economics argue the opposite direction
    and are unmeasured, and the same measurement that sized it shows a 2 KB
    *absolute* saving floor would have required a ~6 KB eligibility floor.
17. **Stale comments in `packages/bench-replay` reference a constant that no
    longer exists**: `src/saver-subprocess.ts:19-20` ("`BASH_COMPRESS_FLOOR` is
    24_000") and `src/transform.ts:11-12` ("Bash caps at 24000, Read/LS/Grep/Glob/
    WebFetch use the plain mode budget"). Comments only; no logic depends on them,
    and the `maxBuffer` reasoning still holds because floors got smaller.

Two further items are recorded here because a reader needs them, and are **not**
coverage gaps:

- **The 250 KB step (+958 B, in all three modes) is unexplained.** It coincides
  with `chunkCount` 37 → 91; mode-independence is new information about the cause,
  but no mechanism has been established and none is asserted. An open measurement
  question, not a missing test.
- **`packages/output-filter`'s 497 tests reach only the defects living in that
  package's source** (M9, M13, M14). Structural — that package cannot import
  `context-gate` source — so its zeros read as "not applicable", and that reading
  was verified by rebuild calibration rather than assumed. The consequence to
  carry is that every `context-gate` defect rests on that package's 417 tests plus
  `apps/cli`'s alone.

### Deferred → shipped: §W1 lever (a) and the admission-guard floors

Both were deferred for the same reason and are recorded together because they
were in conflict with each other, not merely unfinished.

**The conflict.** §W1 lever (a) wants the eligibility floor small — "order 2 KB" —
so the saver reaches output the mode budget used to exclude. The admission guard
below it wants a minimum saving, and any minimum-saving floor above ~1 KB
re-opens the aggressive dead band PR #278 closed. Set as the earlier brief
proposed — eligibility floor 2 KB, absolute saving floor 2 KB — the two cannot
both hold: at 2 KB of input in safe mode there is not 2 KB of saving to be had.

**Why they no longer conflict.** The floors were sized from measurement rather
than from the brief's arithmetic, which was wrong in two places. (i) 5 KB
aggressive does not target ~625 B — `MIN_TARGET_BYTES = 1024` clamps it, so the
ratio never applies at that size. (ii) Aggressive was never the binding case: safe
is the shipped default and keeps the largest share (0.5), so it bounds everything,
and every worst cell lands there. Across 10 content shapes × 3 modes × 2–50 KB,
driven end-to-end through `recordAndFilterOverlayOutput`, the worst cell at the
eligibility floor is `tsc`-shaped output in safe mode at 2048 B: 619 B, ratio
0.302. That sets both floors with headroom rather than by assertion.

Every byte figure in this subsection is the delivered-byte delta
`rawBytes − returnedBytes` — the quantity `admitCompression` compares its floors
against. None of them is a net-cost figure; see "The A4 gate is NOT met".

**What shipped.**

- `COMPRESS_FLOOR_BYTES = 2_048` (`packages/context-gate/src/record-output.ts:57`,
  re-exported from `index.ts`), replacing
  `input.compressFloorBytes ?? modeToBudget(input.mode)`. 2048 is
  `MIN_TARGET_BYTES` (1024) divided by safe's 0.5 share: the smallest input at
  which safe's ratio is still its own rather than the minimum-signal clamp.
- `minBytesFor(tool)` in `apps/cli/src/hooks/saver.ts` no longer takes a mode.
- `DEFAULT_SAVING_FLOORS = { absoluteBytes: 256, relative: 0.15 }`
  (`admission-guard.ts:50`), passed explicitly from `record-output.ts:291`; the
  read and exec call sites stay on `NO_FLOORS`. 256 B is 2.4× under the worst
  measured cell and 0.15 is 2.0× under its ratio, which is exactly why they cannot
  re-open the #278 band.

**The alternative pairing was flagged, not silently dropped.** A 2 KB *absolute*
saving floor is defensible only with a ~6 KB eligibility floor — measured 2541 B
delta at 6144 B in safe, 1.24× headroom — which contradicts §W1's own "order
2 KB". The internally consistent pair (2048 / 256 / 0.15) shipped; the other is
recorded here so the choice is visible.

**Honest characterisation of the floors.** They reject nothing the eligibility
floor admits, on any of the 10 measured shapes. They are a backstop against a
near-no-op rewrite, not an active minimum-saving gate. That is the reason M18 is
invisible to every black-box test and the wiring is pinned by a white-box spy —
see "What is still open", item 6. The B8 dead-band tests that motivated the
original deferral still pass unchanged.

**What the floor decoupling does not settle.** Moving the floor is a cost-axis
decision (§0, owned by the net-positive spec), and that axis is still unmeasured:
items 11, 13 and 16 above. `DEFAULT_MODE` is still `"safe"` and its own
attributable evaluation has not been run (item 12).

### Still deferred, with reasons

- **Exec-path enforcement.** Those paths count the transport payload honestly and
  report a signed delta, so inflation is visible. A guard that changes what an MCP
  client receives should follow that measurement.
- **W6 condensation.** Unstarted; still gated on a measured head-to-head.
- **A persisted signed ratio.** Blocked by the stats event schema, not by effort;
  see "What is still open", item 8. It is a `packages/stats` packet nobody owns.
- **Suppressed-marker and fabrication coverage are no longer deferred** — both
  closed by mutation receipt (M10, M10b, M8). Their residuals live in "What is
  still open": fabrication is demonstrated on the hook path only, and both
  closures are single-guarded.

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
  cosmetic: the ~4 bytes/token estimate is the hot-path admission gate
  (`record-output.ts:185-187`), and CLAUDE.md §11 names `tr` as the second locale.
  Commit a corpus and re-derive.
- The `context-gate` parallel-`turbo` flake is **not** context-gate-specific: an
  `mcp-bridge` recall test failed once under a parallel run and passed on rerun
  and in isolation.


## 8. Floor decoupling — implemented, deliberately not adopted (2026-07-29)

§W1 lever (a) was built, tested and then **left out of the default**, by an
explicit decision after the numbers came in. Recording it here because §7's
earlier text said it shipped, and it does not.

**What exists.** `COMPRESS_FLOOR_BYTES` (2048) in `record-output.ts` is the
decoupled eligibility floor, and the admission guard's minimum-saving floors
(`DEFAULT_SAVING_FLOORS`, 256 B / 0.15) are on. Passing `compressFloorBytes`
opts in per call. `test/floor-decoupling.test.ts` proves the capability works
in all three modes.

**What ships.** The default floor is still `modeToBudget(mode)`, and
`minBytesFor` in the hook still derives per-tool floors from it, including the
`BASH_COMPRESS_FLOOR` / `BACKGROUND_SHELL_TOOLS` caps that keep safe mode under
Claude Code's ~30 000-char truncation ceiling. Those were deleted when the floor
was decoupled and are restored — deleting them would have re-opened the B9 dead
zone that a separate fix had closed.

**Why not adopted.** Adoption moves the shipped trigger from 32 KB to 2 KB under
`safe`: far more rewrites, on far smaller outputs. A rewrite invalidates the
client's prompt cache, and `wiki/syntheses/saver-cache-churn` measured that at
~18k tokens of cache re-creation — against which the 2 263 B saving measured at
the 3 KB cell does not pay. The ratio case is measured; the cost case is not,
and **cost is what the §W1 gate turns on.** The final verifier put it plainly:
whether 2048 is the right number cannot be defended in either direction on the
evidence available.

`test/floor-decoupling.test.ts` carries an adoption guard: a test asserting the
default still passes a 3 KB input through. Wiring the constant in as the default
fails it, so the change cannot happen silently.

**To adopt:** run the real-API benchmark, and if net cost holds at constant
integrity, change one default and delete that guard.

## 9. Corrections and outcomes (2026-07-31 audit)

A 24-agent end-to-end audit (7 scanners, adversarial verification of every
P0/P1 finding) re-verified this spec's ledger against HEAD `e5a7a6f6` and
executed the residual defect inventory on `worktree-feat-saver-audit-fixes`
(`docs/superpowers/plans/2026-07-31-saver-audit-fixes-plan.md`). Corrections
to §7/§8, stated as deltas — the earlier text is preserved above, per the
correct-not-rewrite rule:

- **§8's Bash-cap claim was false for foreground Bash.** "The
  `BASH_COMPRESS_FLOOR` / `BACKGROUND_SHELL_TOOLS` caps … keep safe mode under
  Claude Code's ~30 000-char truncation ceiling" held only for the
  BashOutput/Monitor branch. Foreground Bash got
  `Math.max(budget + 1, Math.min(budget, BASH_COMPRESS_FLOOR))` — identically
  `budget + 1` (the `Math.min` term is dead), i.e. 32 001 under safe, above the
  ceiling: single-stream foreground Bash could never compress in safe mode.
  The `budget + 1` premise (pre-A4 fit-to-budget guard-revert cycle, C4) died
  with `targetBudget`; 3732a0cb restored the formula without its premise.
  Fixed: foreground Bash now gates at `min(budget, BASH_COMPRESS_FLOOR)`
  (24 000 / 12 000 / 4 000), and a 25 KB safe-mode Bash output compresses
  end-to-end (red→green evidence in `apps/cli/test/hooks/saver.test.ts`).
- **§7 item 9 and item 10 are resolved-by-revert** (3732a0cb restored
  `max(modeBudget, 16384)` for coarse surfaces and the `modeToBudget`
  fallback in `record-output.ts`); **item 17's staleness was misdescribed** —
  the constants exist again; the bench-replay comments' real staleness was
  modelling the Bash floor as 24 000 while production was `budget + 1`
  (true again after the fix above).
- **§7 item 7's parenthetical is stale**: trace/firewall are stripped before
  envelope measurement at all four ledger sites; `mcpEnvelopeBytes` no longer
  counts the ranking trace.
- **DEFAULT_MODE mislabel.** `DEFAULT_MODE = "safe"` appears only in
  `disabled()` results, which the hook passthroughs before floor math; both
  activation write paths default to **balanced**
  (`apps/cli/src/commands/session/saver/{workspace,default}.ts`). Statements
  in §1a/§7 reading "safe is the shipped default" describe the explicit
  `--mode safe` configuration, not the operative enabled default.
- **§8's adoption rationale cites a retracted mechanism.** The in-place-rewrite
  churn tax (~18k tokens/rewrite) was retracted (`888d45cb`); the A4 gate was
  reformulated (user-directed): **pass iff billed S > 0 and R < R\* = 66.7%**,
  R measured 2.4% from the real ledger, S modelled 1.199x — one completed
  two-arm real-API replay is the single open leg. Floor/mode adoption stays
  gated on it.
- **A3b's "evidence markers non-droppable" was overstated**: only normalize's
  two marker forms were reserved; every compressor-emitted counted marker was
  droppable under budget pressure (reproduced with zero-slack budgets). Fixed:
  shared `EVIDENCE_MARKER` grammar (`packages/output-filter/src/markers.ts`)
  reserved in `fitBudget` for all families.
- **Spec-B10 (dedupe on passthrough/light) is now fixed** (dedupe gated to the
  compressed band; folds counted in `droppedCount`). The §7 outcome table's
  "B10" row uses the plan's renumbering (= daemon double count, spec B11) —
  read that row as B11. Spec-B11 is also now fixed: overlay event ids are
  deterministic (`ove-<sha256>` + 10-minute bucket) and the store append is
  idempotent; residual double-count window is a bucket-edge race (~0.3% of
  the former exposure).
- **§7 item 2 (outline M13-live) fixed** — outline counts its summary into
  `returnedBytes`/`returnedTokens`. **Item 3 (unchanged re-read uncounted)
  fixed** — both unchanged branches append an envelope-true, signed event;
  the delivered marker struct's self-reported `returnedBytes: 0 /
  savingRatio: 1` remains a known residual on the mcp-bridge delivery side.
- **New closures beyond the §7 list**: Grep/Glob filenames rebuild now
  delivers a counted omission marker + recovery footer entries behind an
  `… ` sentinel with an honest `numFiles`; the dual-stream Bash boundary is
  structural (`ShapedStreams`), never an in-band droppable line, with
  per-stream events; daemon `/expand` charges expansion debt; dedupe keeps
  the highest-scored cluster member; `parseGoTest` reports parser-level
  omissions with a counted marker. Savings surfaces (headline, GUI overview,
  session strip) headline the signed net with gross and re-fetched as the
  breakdown.
- **One audit evidence clause refuted during execution**: the claim that
  pytest/cargo-test/eslint/stacktrace parsers share go-test's silent-omission
  pattern is false at HEAD — all four are complete partitions of their input
  (byte-for-byte reconstruction verified empirically). `parsers/index.ts` now
  carries explicit `dropped: 0` for them, so adoption is one local change if
  any ever starts skipping content.

Still open after this round: read/exec MCP delivery guard (spec §7's
exec-path enforcement; needs the A4 corpus), `runOverlayOutputPipeline`
wire-or-delete, persisted signed ratio (stats packet), fabrication coverage
beyond the hook path, floor-sizing corpus + ratio generator still
uncommitted (§7 items 13/14), and the A4 real-API leg itself.
