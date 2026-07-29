# Saver Compression & Integrity — Step Plan

- **Date:** 2026-07-28
- **Spec:** `docs/superpowers/specs/2026-07-28-saver-compression-integrity-design.md`
  — **APPROVED by the user 2026-07-28.**
- **Allocation:** `docs/superpowers/plans/2026-07-28-saver-integrity-work-split.md`
  (Track A → Opus 5, Track B → Kimi K3, Track C → Gemini Flash 3.6).
- **Discipline:** TDD throughout — no production line without a failing test
  first. Every track in its own worktree. Author ≠ reviewer per the split's
  capability rotation.

## Worktrees

```
feat/saver-a-architecture   → Track A (Opus 5)
feat/saver-b-accounting     → Track B (Kimi K3)
feat/saver-c-defects        → Track C (Gemini Flash 3.6)
```

**Branch point: `docs/saver-integrity-spec`, not `main`.** That branch carries the
approved spec, both plans, the wiki record and the conventions fix (`main` + 3
commits: `bfd639f9`, `cd866fa5`, `482b8bc2`). `main` does **not** have them yet, so
a worktree cut from `main` would contain no source of truth and every track's
`wiki/log.md` append would conflict on merge. Either fast-forward `main` to this
branch first and then branch from `main`, or branch all three from
`docs/saver-integrity-spec` directly.

## Baseline: green, with two environment caveats

Measured 2026-07-28 on the branch point, per package, via
`../../node_modules/.bin/vitest run`:

| package | result |
|---|---|
| `context-gate` | 369 passed, 0 type errors |
| `output-filter` | 451 passed, 0 type errors |
| `stats` | 249 passed, 0 type errors |
| `mcp-bridge` | 343 passed, 1 skipped, 0 type errors |
| `retrieval` | 43 passed, 0 type errors |
| `bench-replay` | 149 passed |

Two caveats every agent must be told, so nobody chases a failure that is not
theirs and nobody invents a private workaround:

1. **`pnpm` is not on PATH, but corepack provides it — and a fresh worktree needs
   setup before ANY test can run.** A git worktree shares `.git`, not
   `node_modules` or `dist/`, so a newly created one cannot resolve a single
   workspace import. `turbo` additionally shells out to a `pnpm` binary and fails
   with "Unable to find package manager binary" unless one is on PATH.

   **Run this once in each worktree before anything else:**
   ```sh
   corepack enable pnpm --install-directory "$HOME/.local/bin"   # once per machine
   export PATH="$HOME/.local/bin:$PATH"                          # once per shell
   pnpm install --prefer-offline
   pnpm build            # REQUIRED — vitest resolves @megasaver/* from dist/
   ```
   Skipping `pnpm build` produces
   `Failed to resolve entry for package "@megasaver/policy"`, which looks like a
   broken import and is not. After this, `pnpm verify` works as written and the
   DoD gate is reachable.
2. **The previously reported `context-gate` concurrency flake did not reproduce**,
   but it was described as appearing under a parallel `turbo` run, and turbo could
   not be driven here. Green in isolation is not proof it is gone. If it appears,
   it is pre-existing — do not attribute it to your track.

Note also that `verify` chains with `&&`, so a test failure means
`conventions:check` never runs — DoD item 4 does not currently gate item 10. The
conventions drift that had been red since before this programme is now fixed
(`bfd639f9`), so the check passes when it is reached.

## Critical path

```
C  ──────────────────────────────▶ merges continuously, independent
B1 ─────────┐
A1 ─┐       │
    ├─▶ B6-B8 (needs A1 contract)
    └─▶ A2 ─▶ A3/A3b ─▶ [gate: A1 green] ─┐
                                          ├─▶ A4  (needs B1+B2 landed)
B1,B2 ────────────────────────────────────┘
```

A4 is the only step with two upstream tracks. Everything else is intra-track.

---

## Track A — Opus 5 (CRITICAL)

### A0. Resolve the open design question first (brainstorming step)

Spec §5 Q2 is unresolved and blocks A3. Three candidates, not two — a third
emerged while writing this plan and should be judged alongside:

1. **marker→chunkId map in the footer.** Cheap. Keeps pre-collapse raw on disk.
   Footer grows by one mapping line per gap.
2. **Unify the coordinate spaces.** Chunk the post-collapse text. Clean, but the
   collapsed content (the measured 800 repeated lines) then exists nowhere —
   it *breaks* losslessness, so it likely fails A1 by construction.
3. **Line provenance — delivered markers speak RAW coordinates.** Track each
   output line's source raw line range through `normalize` → `collapseRepeatedLines`
   → `collapseSimilar` → compressor, so gap markers read `lines 146-902 of the
   original omitted` and the chunk id follows from the existing 40-line rule.
   Most work; also the only option where the number the agent sees matches the
   file's real line numbers — which is what an agent reasons in.

**The answer is almost certainly a hybrid, and the brainstorming question is
"which path gets which", not "which candidate wins".** Provenance requires every
delivered line to have a source raw line. That holds through `normalize` →
`collapseRepeatedLines` → `collapseSimilar`, which only drop and fold. It does
**not** hold through a compressor: `compressTsc` synthesises
`Top files by error count: …`, and `compressVitest` / `compressProse` likewise
emit lines that exist nowhere in the raw — there is no source line to point at.

Read the gating at `types.ts:266-274`: `compressorEligible` requires
`decision === "compressed"` **and** (`!isFileSource || category === "structured"`)
**and** a confident classification. Therefore:

| path | compressor runs? | provenance viable? |
|---|---|---|
| file reads (except `.json`) | no — gated off for file sources | **yes** |
| the measured 1700-line log (`command`, generic shell, low confidence) | no | **yes** |
| vitest / tsc / diff / structured | yes, rewrites lines | **no** for synthesised lines |

So: provenance on the collapse-only path — which covers the common `Read` case
*and* the measured failure — and the footer map wherever a compressor ran; or
require each compressor to emit its own provenance, which is real per-compressor
work and should be priced before it is chosen. Verify this split against
`compressorEligible` before handing A0 to `architect`.

### A1. Integrity contract — RED FIRST, ship before anything else

Property test: for every entry point × every mode, `delivered text ∪ all
recoverable chunks` reconstructs the redacted raw. Ships failing.
Fixtures: (a) the 1700-line log where marker `lines 146-902 omitted` resolves to
chunk 3 which holds lines 121-160; (b) a `read.ts` case proving dropped excerpts
are unrecoverable today.
**Hand the test interface to Track B the moment it is red** — B6–B8 are written
against it.

### A2. One pipeline, one guard (W2)

1. Extract `compressAndPersist`: persists **full redacted raw** (never
   `filtered.excerpts`), one shared admission guard, one signed event.
2. Migrate `read.ts:249`, `run-command.ts:390`, `run-command.ts:636` onto it.
   Their private persistence is deleted.
3. **Strengthen the guard, do not copy it.** `record-output.ts:232` rejects only
   `returnedBytes >= rawBytes`; require a minimum absolute *and* relative saving,
   threshold from B4's measured numbers. Until B4 lands use a conservative
   placeholder and mark it `TODO(threshold)` — do not guess a final value.
4. Correct `connectors/shared/src/context-gate-block.ts:28` ("Raw output is
   stored") to state the real per-path guarantee. Do this in step 1, not last —
   it is a false statement shipping to users today.

### A3. One coordinate system (W3) — implements A0's decision

### A3b. Evidence markers become non-droppable

`… [repeated N times]` is emitted as its own line (`normalize.ts:22-35`), becomes
its own chunk candidate, and `fitBudget` drops it (measured). Fix in `fit.ts`:
a chunk carrying an evidence marker is not eligible for dropping. **Not** a
`normalize.ts` merge — that changes `collapseSimilar`'s fold decisions and
`test/normalize.test.ts:34,42` pin the exact current output.

### A4. Ratio lever (W1) — GATED

Blocked on: A1 green **and** B1+B2 merged. Not before.

1. **`DEFAULT_MODE` alone, measured by itself.** One line
   (`resolve-saver-settings.ts:44`). Capture the size-ladder table before and
   after. This is the single highest-ratio change in the programme and its effect
   must be attributable.
2. Separate `floorBytes` ("worth touching?") from `targetRatio` ("how small?");
   `fitBudget` fills to `min(targetRatio × rawBytes, modeCeiling)`.
3. Re-run the ladder.

**Gate is net cost at constant integrity, not ratio.** Aggressive already
measures 82.5% at 25 KB unchanged and is the worst cost arm — a ratio gate is
passed by shipping the mode this spec argues against.

### A5. Export hygiene

`filterOutput`'s `returnedBytes`/`savingRatio` stay **exported and deprecated**
through A1–A3; removed only in A4, after B2 has landed and C has rebased.

---

## Track B — Kimi K3 (HIGH)

### B1. Signed savings — do this first, it unblocks A4

Add signed `deltaBytes` to the event schema. Today `bytesSaved = Math.max(0,…)`
(`types.ts:351`) plus `nonnegative()` (`stats/event.ts:20,43`, `summary.ts:10,27`)
make inflation **unrepresentable**. Keep `bytesSaved` as a clamped legacy field
for one minor version; aggregates read the signed field.
**Specify the migration shape before writing code** — this crosses every reader
of those schemas.
**Gate: a deliberately inflating input yields a negative aggregate in
`mega audit`.** If inflation still reports 0, B1 is not done and A4 cannot start.

### B2. Model-facing byte module

New `packages/output-filter/src/model-facing-bytes.ts`, exported: summary +
excerpts + gap markers + footer. Must include the MCP envelope —
`mcp-bridge/src/server.ts:316` `JSON.stringify`s the whole payload, so per-excerpt
`score` and the 9-field `features` object reach the model counted nowhere.
Track B **creates and exports** it; Track A wires it in. This keeps `types.ts`
single-owner.

### B3. Recovery debt

`fetch-chunk.ts` (46 LOC, emits nothing today) appends an expansion event with
fetched bytes + `chunkSetId`. Net per chunk-set = compression saving − Σ
expansions. Reports show net.

### B4. Real tokenizer at the reporting boundary

`estimateTokens = ceil(bytes/4)` (`tokens.ts:17-19`) underpins every threshold and
every dollar figure. Real BPE count for *reported* numbers; keep the cheap
estimate for hot-path gating. **Measure and publish the divergence** — A2's guard
threshold is derived from it.

### B5. Field telemetry + harness hygiene

Install the hook, capture one real session. Today `~/.claude/settings.json` has no
MegaSaver hook and `~/.local/share/megasaver` has no `stats/`, `content/` or
`evidence/` — every number in the wiki comes from a harness the wiki says cannot
validate a stage. Fresh store per benchmark run, justified by workspace-scoped
net-effect/stats records (**not** by the seen-ledger story — session-scoped,
unverified).

### B6. `compressTsc` silent drop — needs A1's contract

`compress/tsc.ts:16-34` deletes every line not matching
`file(line,col): error TSxxxx` except `Found N errors`: position-less diagnostics
(`error TS5023: Unknown compiler option`), multi-line explanations, code frames.
Satisfy A1 or emit an explicit marker naming what was removed.

### B7. Classifier over-reach

`classify.ts:127-129` — `typescript` at 0.7 confidence on output-sniff alone
routes any text containing `error TS1234:` (a fetched issue page included) into B6.

### B8. `parseGoTest` panic drop — needs A1's contract

`parsers/go-test.ts:15-30` keeps only blocks containing `--- FAIL:`; a panicking
test prints none, so its message and stack are dropped silently.

### B9. `compressProse` / `compressJson` — declare or recover

`prose.ts:6-10` keeps the first paragraph per section + first 3 list items;
`json.ts:10,68-81` keeps first 3 + last of any array ≥20 and does not preserve
intent-matched values. Prose is `saver-savings-gaps` D20, a conscious accept —
re-opened only because A1 now demands an explicit marker or recoverability.

### B10. Daemon-timeout double count

`saver-run.ts:108-138` + `daemon/handlers.ts:47`: `excerptHandler` appends the
overlay event; a client timeout **after** the daemon wrote makes the hook fall
back and write it again. Savings double-counted.

---

## Track C — Gemini Flash 3.6 (MEDIUM)

**Hand-off rule: each task ships as a pre-written failing test plus the exact
expected behaviour. Flash implements red→green. Flash chooses no list, no
threshold, no data structure.**

| # | task | file | note for the packet |
|---|---|---|---|
| C1 | `filenames` rebuild corruption — summary line, gap markers and footer enter the array as fake paths while `numFiles` keeps the old count | `hooks/saver.ts:179-186` | expected output shape must be given; it is a schema question |
| C2 | stop-word filter for intent matching | `tokenize.ts`, `rank.ts:84-92,132-133` | **list supplied in the packet.** ×21 weight ⇒ ranking baseline moves; merge early |
| C3 | BM25 identifier split + Unicode | `retrieval/bm25.ts:33-38` | `split(/\W+/)` never splits `parseConfig`; ASCII-only |
| C4 | safe-mode Bash dead zone (floor 24 KB < budget 32 KB) | `hooks/saver.ts:33,54` | state the intended relationship, not just the numbers |
| C5 | single-slot stdout/stderr | `hooks/saver.ts:124-133` | the existing comment concedes the gap |

**Open before C2 ships:** §11 forbids hardcoded Turkish and routes strings through
an i18n layer that does not exist yet. A stop-word list is not user-facing, so the
rule arguably does not bind — but decide explicitly (inline list vs. shared
constants module) and put the answer in the packet.

---

## Definition of done (per track)

`definition-of-done.md` items 1–10, plus:

- Every ratio or savings claim backed by a captured re-run of the size ladder —
  asserted numbers are not evidence.
- Track A: `code-reviewer` (fresh Opus context) **and** `critic`, separate
  contexts, plus `security-reviewer` (A2 changes what is written to disk).
- Track B: `code-reviewer` by Opus; `security-reviewer` on B1 (changes what is
  reported to the user).
- Track C: Kimi for C1/C4/C5; **Opus for C2/C3** — they move the ranking baseline
  the other tracks pin fixtures on.
- `wiki/syntheses/saver-root-cause-2026-07-28` updated with outcomes.
