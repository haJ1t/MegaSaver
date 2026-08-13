---
feature: filter-matrix-expansion
date: 2026-08-13
risk: MEDIUM
status: approved
pending: []
reviewers: [code-reviewer]
build-order: "v2.7 #2 (was wave-2 batch #5)"
updated: 2026-08-13
---

# Filter Matrix Expansion (v2.7 #2)

## Problem

RTK's breadth moat is ~100+ hand-tuned command filters (git, docker, kubectl,
aws, gh, npm, cargo, terraform…) vs our ~dozen parsers/compressors
([[syntheses/rtk-competitive-analysis-2026-08-01]] §3.2). Their filters are
lossy; ours sit behind the W4 reconstruct-or-declare integrity gate
(`packages/context-gate/test/save-integrity.property.test.ts`): delivered ∪
stored chunks must reconstruct the redacted raw, and delivered text must not
fabricate lines. Idea 3 of §5: port the top filters into
`@megasaver/output-filter` without copying their lossiness.

Today the gap is concrete: `git status`/`git log` classify as `diff` via
`DIFF_CMD` (`src/classify.ts`) and route to `compressDiff`'s no-hunk path,
which only folds pure graph-spine lines — a near no-op on status/log output.
docker/kubectl/gh/npm/pip/cargo-build/terraform output gets only the generic
chunk/rank pipeline. Since v2.7 #1 (exec-rewrite) merged, every such command
running under `mega output exec-live` flows through this same compressed
band — these filters compound directly onto the net-positive saver path.

## Freshness reconciliation (2026-08-13, per v2.7 decision page)

All four spec-freshness flags from [[decisions/v27-net-positive-saver]] are
checked against `main` @ `a5c107cc`:

1. **Stage A first-sight ledger (v2.3.0)** — irrelevant here: this spec makes
   no claim about first-sight accounting; it only adds compressors inside the
   already-ledgered compressed band.
2. **Session Mesh hook infra (v2.6.0)** — irrelevant here: no hook path; the
   Non-Goals section explicitly excludes PreToolUse modes. The only
   interaction is the compounding note in Problem above.
3. **`mega discover` ledger shapes** — belongs to the discover spec (#3), not
   this one.
4. **No network I/O in any hook path** — vacuous here: filters are pure
   functions with no IO of any kind.

Code drift check (assumptions in this spec vs current source): `DIFF_CMD`
misroute still present (`src/classify.ts:41`); `CompressorName` still six
members (`src/compress/index.ts:8`); `EVIDENCE_MARKER` (`src/markers.ts:14`),
`collapseSimilar` (`src/normalize.ts:100`), and the
`DIAGNOSTIC_CATEGORIES`/`skipDedupe` mechanism (`src/types.ts:199,354`) all
present as assumed; `src/filters/` does not exist yet;
`packages/context-gate/test/save-integrity.property.test.ts` present. No
assumption in this spec has drifted.

## Goal

Ten new structured command filters — git-status, git-log, docker-ps,
docker-build, kubectl-get, gh-pr-list, npm-install, pip-install, cargo-build,
terraform-plan — each a pure compressor behind the existing integrity gate,
plus a registry + conformance harness that makes the NEXT 20 filters a
mechanical contribution (the moat is volume; make volume cheap).

## Non-Goals (YAGNI)

- No PreToolUse command-rewrite mode (leapfrog idea 2 — separate feature).
- No changes to `classifyOutput` ordering, anti-guards, or `OutputCategory`.
- No intent-aware filtering inside the new filters (v1 filters ignore intent;
  ranking downstream still uses it).
- No mode-aware (aggressive/balanced) row caps — fixed constants v1.
- No `aws`/`kubectl describe`/`gh run list`/`cargo test` build-section filters
  in this wave (next-20 checklist targets). `cargo test` stays with the
  existing `src/parsers/cargo-test.ts` path — the new cargo-build filter
  matches `cargo build|check` only, so it cannot preempt that parser.
- No new dependencies, no CLI surface change (`apps/cli` untouched).

## Locked Decisions

1. **Registry, but additive-only (§13 justification — scope (a)).** The
   existing 5-category dispatch (`classify.ts` if-chain +
   `compressByCategory`) does NOT scale to 30+: each addition in that shape
   costs three hand-ordered edits (classifier chain, `OutputCategory` enum,
   compressor chain), each risking the ReDoS-audited anti-guard ordering.
   A new `src/filters/` registry (ordered array, first-match-wins) costs one
   module + one entry per filter. This is not premature abstraction: 10
   concrete instances land in this PR and 20 more are planned — rule of
   three, three times over. Conversely we do NOT migrate
   vitest/typescript/diff/structured/prose into the registry: churn on
   HIGH-risk, redaction-adjacent, cross-guarded code with zero capacity gain.
2. **Precedence: registry before category compressors.** In `filterOutput`,
   a registry hit (command-sourced, compressed band) preempts
   `compressorEligible`. This fixes the git-status/git-log misroute without
   touching `classify.ts`; `classification` still reports the sniffer's
   category, `compressor` is the authority on what ran.
3. **A matched filter owns the output.** If its shape guard rejects the text
   it returns the input verbatim (safe no-op; `compressor` stays `generic`)
   — it never falls back to a category compressor.
4. **`CompressorName` grows append-only** (published contract): the ten
   filter names are appended after `"generic"` in fixed order.
   `OutputCategory` is untouched.
5. **Reconstruct-or-declare per filter.** Every filter declares
   `integrity: "line-subset" | "rewrite"` and its exact `markers`.
   `line-subset` (all ten v1 filters): every delivered non-marker line
   appears verbatim (trim-compared) in the input; enforced mechanically by
   the shared conformance harness. `rewrite` (future, e.g. a synthesized
   header like `compressTsc`'s): excluded from the line-subset claim, must
   ship a bespoke integrity test (precedent:
   `test/compress-tsc-integrity.test.ts`) and declare every synthesized form.
   Recovery of the full redacted raw is unconditional either way —
   context-gate persists it independent of the compressor
   (`record-output.ts`: "store the FULL output (secrets redacted)").
6. **One marker grammar.** Every collapse marker is a counted
   `… [<n> <label>]` line — the `EVIDENCE_MARKER` prefix contract
   (`src/markers.ts`) that `fitBudget` recognizes. Declared marker regexes
   are anchored (`^… \[` … `\]$`), flagless, and exported aggregated as
   `COMMAND_FILTER_MARKERS` so the W4 no-fabrication allowlist composes from
   the same source the filters emit from (no drift-by-restatement).
7. **Registry hit ⇒ skip simhash dedupe.** Filtered table rows
   (docker-ps, kubectl-get) are near-identical shapes that simhash would
   fold, yet each is distinct evidence — same reasoning as
   `DIAGNOSTIC_CATEGORIES` in `src/types.ts`.

## Architecture

```
filterOutput (src/types.ts, compressed band only)
  source.kind === "command"
    └─ matchCommandFilter(command, normalized)   [NEW src/filters/]
         hit + changed text → textForChunks = filter.compress(normalized)
                              compressor = filter.name; provenance = null
                              skipDedupe = true
         hit + unchanged    → safe no-op (generic path, provenance kept)
         miss               → existing compressorEligible path (unchanged)
```

Filters run on `normalized` — which derives from `redact(raw)` — so no filter
ever sees an unredacted secret (pipeline order §11b is untouched).

## Components

1. `src/filters/index.ts` — `CommandFilter` type (`name`, `command: RegExp`,
   `integrity`, `markers`, `compress(text): string`), `COMMAND_FILTERS`
   ordered registry, `COMMAND_FILTER_MARKERS`, `matchCommandFilter`.
   Registry order is itself append-only (first-match-wins is observable).
2. Ten filter modules under `src/filters/` (one per file, pure, no IO, no
   deps). Behaviors, all line-subset + counted markers:
   - **git-status** — drop `(use "git …")` hint lines; cap porcelain
     same-status runs at 20 (`… [N hint lines]`, `… [N more <XY>]`).
   - **git-log** — oneline shape only: keep first 15 + last 5 commits
     (`… [N commits omitted]`); full-format logs pass through.
   - **docker-ps** — collapse consecutive same-IMAGE rows beyond 3
     (`… [N similar: <image>]` — the existing collapseSimilar form).
   - **docker-build** — drop BuildKit sha/extract/transfer noise lines
     (`… [N layer lines]`); step headers, DONE/CACHED, run output, errors kept.
   - **kubectl-get** — keep header + every non-healthy or restarted row;
     cap healthy zero-restart rows at 5 per status (`… [N more <Status>]`).
   - **gh-pr-list** — cap header-less TSV listing at 30 rows
     (`… [N more PRs]`).
   - **npm-install** — drop npm/pnpm progress noise, keep the last
     `Progress:` totals line + warnings/summary (`… [N progress lines]`).
   - **pip-install** — collapse `Requirement already satisfied` runs and
     download lines (`… [N already satisfied]`, `… [N download lines]`).
   - **cargo-build** — cap `Compiling/Checking/Fresh` runs at 3, fold
     exact-duplicate warning blocks (`… [N crates compiled]`,
     `… [N duplicate warnings]`); `error[` blocks always kept.
   - **terraform-plan** — collapse created-resource attribute bodies
     (`… [N attributes]`); update/destroy blocks and `Plan:` summary kept.
3. Wiring in `src/types.ts` (locked decisions 2/3/7) + `CompressorName`
   append + package `index.ts` exports.
4. Conformance harness `test/filters/conformance.ts` — the mechanism that
   makes filters cheap: determinism, empty-input no-op, line-subset,
   declared-markers-only, anchored flagless marker regexes, output smaller
   than fixture.
5. W4 inclusion — `packages/context-gate/test/save-integrity-command-filters.test.ts`
   drives each filter's fixture through `recordAndFilterOverlayOutput` and
   asserts reconstruct (chunk-walk) + no-fabrication against base structural
   forms ∪ `COMMAND_FILTER_MARKERS`. The existing property test file is not
   edited (its corpus carries no command source; its STRUCTURAL_LINE warning
   comment stays authoritative for its own corpus).
6. Conformance checklist `packages/output-filter/COMMAND-FILTERS.md` — the
   mechanical recipe for the next 20 filters (scope (d)).

## Error handling

- Filters are pure and never throw; unrecognized shape → input returned
  verbatim (decision 3). The existing no-blind floor in `filterOutput`
  already guards a compressor that empties its input.
- No regex uses `/g` (stateless `.test`); every quantifier bounded per
  [[concepts/unbounded-run-redos]] — no `^\s*` under `m`, classes capped.
- Zod boundaries unchanged — filters sit strictly inside the already
  validated `filterOutput` pipeline.

## Security & privacy

- Filters see only redacted text (redact runs first, §11b locked order).
- All fixtures are synthetic: fabricated shas/ids/image names/pod names, no
  real tokens, no secrets. No fixture is captured from a live system.
- No new IO, no new deps, nothing eagerly imported on the hot path
  (`no-eager-typescript.test.ts` guard must stay green; filter modules may
  not import `@megasaver/indexer` or `js-tiktoken`).

## Testing

- Per-filter fixture test (`test/filters/<name>.test.ts`): realistic
  before/after fixture + conformance harness call + behavior assertions.
- Wiring tests: registry preempts diff-compressor for `git status`;
  passthrough band never invokes a filter; no-op keeps `compressor: generic`
  and provenance; registry hit skips dedupe.
- W4 inclusion per component 5 — reconstruct + no-fabrication per filter.
- No timing-tight tests: ReDoS discipline is structural (bounded patterns,
  reviewed against the ReDoS registry), never throughput assertions.
- `pnpm verify` green; per-package runs via
  `pnpm --filter @megasaver/output-filter exec vitest run`.

## Risk & process

MEDIUM (§12): additive dispatch, no schema/storage change, no classifier or
redaction edits. Required reviewer: `code-reviewer` (fresh context, §9.6).
**Escalation trigger:** if implementation needs to touch `classify.ts`
ordering, redaction, fit/summarize, or stored formats → stop, re-classify
HIGH (architect + critic + worktree). Changeset: `@megasaver/output-filter`
minor (public `CompressorName` + new exports).

## Dependencies / build order

Wave-2 batch position 5 of 20. No dependency on other wave-2 items; touches
`packages/output-filter` + one new test file in `packages/context-gate`.
Feature branch + worktree per §10.

## Open questions

1. Which of the next-20 (aws, kubectl describe, gh run list, terraform
   apply, docker logs, pnpm test…) leads wave-2b — pick by observed
   hook-log frequency once `mega discover` (idea 4) exists?
2. Should row caps become mode-aware (aggressive folds harder)? Deferred;
   constants are trivially liftable later.
3. `gh pr list` piped output is assumed header-less TSV (gh v2 behavior);
   confirm against the pinned gh version during implementation — a wrong
   assumption only degrades to the safe no-op.
