# Saver Compression & Integrity — Three-Track Work Split

- **Date:** 2026-07-28
- **Source spec:** `docs/superpowers/specs/2026-07-28-saver-compression-integrity-design.md`
  (DRAFT — **not approved**). This document allocates work; it is not a licence to
  implement. No track starts before the spec is approved (§4 hard gate).
- **Purpose:** the work is executed by three separate agents/LLMs in parallel.
  Tracks are split by difficulty **and** by disjoint file ownership, because three
  agents editing the same hot files is a bigger risk than the work itself.

## Allocation summary

| Track | Difficulty | Owns | Risk | Assigned model | Depends on |
|---|---|---|---|---|---|
| **A** | HARD | Architecture: one pipeline, one coordinate system, integrity gate, ratio lever | CRITICAL | **Opus 5** | B's accounting before A4 |
| **B** | MEDIUM | Observability, honest accounting, evidence-loss compressors | HIGH | **Kimi K3** | A's W4 contract before B6–B8 |
| **C** | EASY | Five isolated defect fixes | MEDIUM | **Gemini Flash 3.6** | none — starts immediately |

### Packaging per assigned model

The tracks were scoped by difficulty before the models were named; the assignment
fits, but two tracks need their hand-off shaped to the model that receives them.

**Track C / Flash — hand over tests, not descriptions.** Every C task ships as a
*pre-written failing test* plus the exact expected behaviour; the agent's job is
red→green, not design. This matters most for C1 (`filenames`), where the correct
output shape is a schema question, and for C2, whose stop-word list must be
**decided and written into the task**, never left to the model to invent. Flash
must not be asked to choose a list, a threshold, or a data structure.

**C2 carries a convention decision that must be resolved before hand-off.**
§11 says Turkish is never hardcoded and routes through the i18n layer. A stop-word
list is not a user-facing string, so it is arguably out of scope for that rule —
but it *is* hardcoded Turkish, and the project has no i18n layer yet. Decide
explicitly (inline list vs. a shared constants module) and put the answer in the
task. Do not let it be discovered mid-implementation.

**Track B / Kimi — the schema migration is the risky part, not the compressors.**
B6–B8 (`compressTsc`, `classify`, `parseGoTest`) are self-contained. B1's signed
`deltaBytes` crosses `stats/event.ts`, `summary.ts` and every reader of those
schemas, with a back-compat window for the clamped legacy field. Specify the
migration shape up front rather than leaving it to the implementer.

**Track A / Opus — the only track that gets an open design question.** A3's choice
(marker→chunkId map vs. unified coordinate spaces) is deliberately unresolved and
belongs to this track's brainstorming step.

## File ownership — no file appears in two tracks

**Track A**
```
packages/context-gate/src/record-output.ts
packages/context-gate/src/read.ts
packages/context-gate/src/run-command.ts
packages/context-gate/src/recovery-footer.ts
packages/output-filter/src/types.ts
packages/output-filter/src/fit.ts
packages/output-filter/src/normalize.ts     (A3b only)
packages/connectors/shared/src/context-gate-block.ts
```

**Track B**
```
packages/stats/src/event.ts
packages/stats/src/summary.ts
packages/stats/src/audit-store.ts
packages/context-gate/src/fetch-chunk.ts
packages/mcp-bridge/src/server.ts
packages/output-filter/src/tokens.ts
packages/output-filter/src/compress/tsc.ts
packages/output-filter/src/classify.ts
packages/output-filter/src/parsers/go-test.ts
packages/bench-replay/**            (harness hygiene)
+ NEW  packages/output-filter/src/model-facing-bytes.ts
```

**Track C**
```
packages/output-filter/src/tokenize.ts
packages/output-filter/src/rank.ts
packages/retrieval/src/bm25.ts
apps/cli/src/hooks/saver.ts
```

Each track runs in its own git worktree (§10). Branch names:
`feat/saver-a-architecture`, `feat/saver-b-accounting`, `feat/saver-c-defects`.

---

## Track A — HARD (architecture)

Owns spec workstreams W2, W3, W4, W1. Strictly sequential; A4 is gated.

**A1. Publish the integrity contract first (W4).**
Write the property test *before* any implementation: for every entry point and
mode, `delivered text ∪ all recoverable chunks` reconstructs the redacted raw.
Ship it red. **This is Track A's first deliverable because Track B's B6–B8 must
satisfy it** — publish the test interface, then hand it over.

**A2. One pipeline, one guard (W2).**
Route all four entry points through a single `compressAndPersist` core:
persists **full redacted raw** (never `filtered.excerpts`), applies one shared
admission guard, emits one signed event. `read.ts` and both `run-command.ts`
sites lose their private persistence.
The guard must be **strengthened, not copied**: today `record-output.ts:232`
only rejects `returnedBytes >= rawBytes`, so a one-byte saving justifies a
rewrite — strictly negative under cache churn. Require a minimum absolute *and*
relative saving, threshold taken from Track B's measured churn cost.
Immediately correct `context-gate-block.ts:28` ("Raw output is stored") to state
the real per-path guarantee.

**A3. One coordinate system (W3).**
Delivered gap markers and stored chunks must share an addressing scheme. Two
candidate designs — pick one at brainstorming, do not implement both:
marker→chunkId map in the footer (cheap, keeps pre-collapse raw on disk) vs.
unifying the spaces (clean, loses pre-collapse fidelity).
Fixture: the measured 1700-line log where marker `lines 146-902 omitted`
resolves to chunk 3 (holds lines 121-160, wrong content; correct is ~23).

**A3b. Droppable repeat marker — reassigned here from Track C.**
`… [repeated N times]` (`normalize.ts:22-35`) is emitted as its own line, becomes
its own chunk candidate, and `fitBudget` can drop it — measured: it did, and the
model saw a single heartbeat line with no evidence 800 existed. This looks like a
`normalize.ts` fix (Track C) but is not: merging the marker into its preceding
line changes the text `collapseSimilar` templates and folds on, and
`test/normalize.test.ts:34,42` pin the exact current output. The real defect is
that a marker carrying evidence is treated as a droppable chunk, which is a
`fit.ts` decision — Track A's file, and the same "delivered text must not silently
lose evidence" obligation A1 encodes. Evidence markers become non-droppable.

**A4. Ratio lever (W1) — GATED, do not start early.**
Separate `floorBytes` ("worth touching?") from `targetRatio` ("how small?").
Sub-step, measured **alone and first**: `DEFAULT_MODE` is `safe` ⇒ a 32 KB floor
suppresses most traffic; that one-line change moves more ratio than the redesign,
so its effect must be attributable.
**The gate is not a ratio number.** Aggressive already measures 82.5% at 25 KB
with zero changes, and is the worst cost arm — a ratio gate is passed by shipping
the mode this spec argues against. Pass condition: signed net saving improves at
constant integrity (A1 green), ratio reported as diagnostic only.

**Blocking:** A4 cannot start until A1–A3 are green **and** Track B's signed
accounting has landed — otherwise A4 measures a number that structurally cannot
go negative.

---

## Track B — MEDIUM (observability & honest accounting)

Owns W0 plus the three evidence-loss compressors. B1–B5 are independent of A and
start immediately; B6–B8 need A1's contract.

**B1. Signed savings.** Add signed `deltaBytes` to the event schema. Today
`bytesSaved = Math.max(0, …)` (`types.ts:351`) plus `nonnegative()` schemas
(`stats/event.ts:20,43`, `summary.ts:10,27`) make inflation *unrepresentable*.
Keep `bytesSaved` as a clamped legacy field for one minor version; aggregates
switch to the signed field.
**Gate: a deliberately inflating input produces a negative aggregate in
`mega audit`. If inflation still reports 0, Track B is not done — and nothing in
Track A's A4 may be measured.**

**B2. Model-facing bytes module.** New `model-facing-bytes.ts`: summary +
excerpts + gap markers + footer. Must include the MCP envelope —
`mcp-bridge/src/server.ts:316` `JSON.stringify`s the whole payload, so per-excerpt
`score` and the 9-field `features` object reach the model counted nowhere.
Track B *creates and exports* it; Track A wires it into `types.ts` /
`record-output.ts`. This split is deliberate — it keeps `types.ts` single-owner.

**B3. Recovery debt.** `fetch-chunk.ts` (46 LOC, currently emits no event) appends
an expansion event with fetched bytes + `chunkSetId`. Net saving per chunk-set =
compression saving − Σ expansions. Reports show net.

**B4. Real tokenizer at the reporting boundary.** `estimateTokens = ceil(bytes/4)`
(`tokens.ts:17-19`) underpins every threshold and every dollar figure. Use a real
BPE count for *reported* numbers; keep the cheap estimate for hot-path gating.
Measure the divergence before anyone picks a threshold from it.

**B5. Field telemetry + harness hygiene.** Install the hook and capture one real
session — `~/.claude/settings.json` has no MegaSaver hook and
`~/.local/share/megasaver` has no `stats/`, `content/` or `evidence/`, so every
number in the wiki comes from a harness the wiki says cannot validate a stage.
Fresh store per benchmark run, justified by workspace-scoped net-effect/stats
records (**not** by the seen-ledger carry-over story — that is session-scoped and
unverified).

**B6. `compressTsc` silent drop** (`compress/tsc.ts:16-34`) — every line not
matching `file(line,col): error TSxxxx` is deleted except `Found N errors`.
Position-less diagnostics (`error TS5023: Unknown compiler option`), multi-line
explanations and code frames vanish. Must satisfy A1 or emit an explicit marker.

**B7. Classifier over-reach** (`classify.ts:127-129`) — `typescript` at 0.7
confidence on output-sniff alone routes any text containing `error TS1234:`
(including a fetched issue page) into B6's compressor.

**B8. `parseGoTest` panic drop** (`parsers/go-test.ts:15-30`) — blocks without
`--- FAIL:` are skipped, so a panicking test's message and stack are dropped
silently.

---

## Track C — EASY (isolated defects, fully parallel)

Five fixes, each red-first behind its own failing test. No dependency on A or B;
merge as they finish. Ordered by measured blast radius. (The repeat-marker defect
was reassigned to Track A as A3b — see the note there for why it is not a
`normalize.ts` fix.)

**C1. `filenames` corruption** (`hooks/saver.ts:179-186`) — the compressed text is
split back into `filenames: string[]`, so the summary line, gap markers and footer
enter the array as fake paths while `numFiles` keeps the old count. Corruption,
not loss — the model may try to open files that do not exist. Highest priority.

**C2. Stop-word leakage** (`tokenize.ts`, `rank.ts:84-92,132-133`) —
`tokenizeForMatch` applies no stop-word filter and `keywordScore` is weighted
`×(1+INTENT_MATCH_BUMP)=×21`, so "the/in/is/bu/ve" match nearly every chunk and
intent ranking degenerates to noise. Filter must cover EN **and** TR (§11: Turkish
is the planned second locale).

**C3. BM25 identifier split** (`retrieval/bm25.ts:33-38`) — `split(/\W+/)` never
splits `parseConfig` into `parse`/`config` and is ASCII-only, so identifier
queries and Turkish terms miss.

**C4. Safe-mode Bash dead zone** (`hooks/saver.ts:33,54`) — floor 24 KB vs budget
32 KB means pre-truncated Bash output fits the budget, nothing is dropped, the
net-negative guard fires, and the whole pipeline runs to discard its work.

**C5. Single-slot stdout/stderr** (`hooks/saver.ts:124-133`, the code comment
concedes it) — only the larger stream is compressed; two comparable streams both
below floor pass raw, and a small-stream error can be the uncompressed one.

---

## Sync points and integration hazards

1. **A1 → B6/B8.** Track A publishes the integrity contract before Track B fixes
   the lossy compressors, or B will fix them to the wrong shape.
2. **B1/B2 → A4.** No ratio measurement is meaningful before signed savings and
   model-facing accounting land. This is the hardest sequencing rule in the split.
3. **C2/C3 will shift ranking output.** Any fixture in Track A or B that pins
   selected excerpts may change. Track C merges first and often, so A and B rebase
   onto a moving ranking baseline rather than discovering it at the end.
4. **`packages/output-filter/src/index.ts`** is the shared export surface, and the
   hazard there is asymmetric. *Additions* (B's `model-facing-bytes.ts`) are
   ordinary line conflicts. A's internalization of `filterOutput`'s
   `returnedBytes` / `savingRatio` is a **removal** against two tracks' in-flight
   imports — a break, not a conflict. **Decision: A keeps both fields exported and
   marks them deprecated through stages 1–2, and removes them only in stage 3,
   after B2 has landed and both other tracks have rebased.** No track may plan
   around their absence before then.
5. **Author ≠ reviewer (§4, hard gate) — rotate by capability, not round-robin.**
   The rule is about *context*, not model identity: a fresh Opus context reviewing
   another Opus context satisfies it. That resolves the obvious tension — do
   **not** send Track A (CRITICAL) to Flash for review just to complete a cycle.
   §6 routes complex and security review to Opus.

   | authored by | reviewed by |
   |---|---|
   | A — Opus 5 | fresh Opus 5 context (`code-reviewer`) **and** `critic`, separate contexts; plus `security-reviewer` |
   | B — Kimi K3 | Opus 5 (`code-reviewer`); `security-reviewer` on B1 — it changes what is reported to the user |
   | C — Flash 3.6 | Kimi K3 for C1/C4/C5 (mechanical); Opus 5 for C2/C3, which move the ranking baseline every other track depends on |

## What this split does not solve

Parallelism does not shorten the critical path: Track A's A4 still waits on Track
B, and A2/A3 are sequential within A. Realistic shape is C finishing early, B
mid, A last. If the goal is the ratio number specifically, the shortest honest
path is B1 → A4's `DEFAULT_MODE` sub-step, measured alone — and that is one
person's afternoon, not three tracks.
