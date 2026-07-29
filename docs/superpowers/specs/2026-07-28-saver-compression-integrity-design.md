# Saver Compression & Save-Integrity — Design

- **Date:** 2026-07-28
- **Risk:** CRITICAL. Touches evidence-preserving compression, the context packer,
  chunk persistence (user-recoverable evidence), and public CLI/MCP behaviour.
  Per `risk-modes.md`: HIGH chain + `tracer` evidence loop + `security-reviewer`
  + verifier with reproduction evidence + manual user confirmation. No autopilot.
- **Status:** DRAFT — awaiting user approval. No implementation until approved.
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
