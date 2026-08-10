---
feature: context-contracts
date: 2026-08-06
risk: HIGH
status: draft-design
pending: [user-spec-review, architect-pass]
reviewers: [code-reviewer, critic]
build-order: "11 of 20 (wave-2 batch)"
---

# Context Contracts (roadmap 2.4)

## Problem

Memory quality regresses silently. A memory edit, a supersession, a stale
flag, an approval change, or a ranking tweak can stop a critical memory from
being retrieved for the task it was learned on — and nothing fails. The
roadmap commits 2.4 to fixing this: "Opt-in completed-task fixtures test
whether a memory/instruction change still retrieves required evidence within
budget; deterministic retrieval assertions first", with the acceptance gate
"A failed contract names the missing/stale memory and passes after an
auditable repair; traces stay local"
(`wiki/syntheses/solo-developer-roadmap.md` §Sequence, row 2.4).

## Goal

Regression tests for retrieval. A CONTRACT is a completed-task fixture:
"given this task intent, recall must surface memory entries covering
evidence X within budget Y tokens." `mega contracts run` replays each
contract's intent through the EXISTING recall pipeline
(`rankProjectMemories` in `@megasaver/memory-recall`, gated by core's
`isRecallable`) in a forced-deterministic lexical mode, cuts the ranked list
at the token budget, and asserts every required evidence item is inside the
cut. A failure names the exact missing/stale entry and why. `mega contracts
add` captures a contract from a finished session. Runs are local-CI-shaped:
`--json`, exit code, no network, no model calls.

## Non-Goals

- **No outcome-causality claims.** This asserts RETRIEVAL, not that a memory
  caused a successful outcome. The roadmap's evidence-discipline paragraph is
  binding: "Context Contracts is the prerequisite for a defensible claim;
  counterfactual replay remains research, not launch copy"
  (`wiki/syntheses/solo-developer-roadmap.md` §Evidence discipline). v1 makes
  no replay, no counterfactuals.
- **No LLM/model calls, no network.** Deterministic-first per the roadmap.
  The adaptive (semantic) profile is excluded from v1 assertions.
- **No auto-repair.** Failures point at existing repair commands
  (`mega memory update/approve/reopen`); the repair itself stays manual and
  therefore auditable.
- **No contract of the warm-start brief or connector blocks** (v2 candidate).
- **No watch mode, no cross-project contracts, no remote/team sharing.**

## Locked Decisions

1. **Retrieval-only assertion.** The evidence-discipline paragraph of the
   roadmap is a Locked Decision for this feature: contracts prove surfacing,
   never per-memory outcome causality.
2. **Deterministic = forced lexical safe profile.** Verified: today
   `rankProjectMemories` picks the profile at
   `packages/memory-recall/src/rank-project-memories.ts:287`
   (`vectors.values.size === 0 ? "safe" : "adaptive"`), and `vectorReader`
   admits a sidecar vector only when its stored hash equals
   `memoryEmbeddingContentHash(entry)` (lines 186–191) — i.e. adaptivity is
   machine-state-dependent. Contracts pass a new opt-in
   `profile: "safe"` input that routes through the already-defined-but-
   currently-unreached `rankSafe` closure (line 250), skipping `vectorReader`
   entirely. No embedding is computed; tests prove it by injecting an
   `embed` that throws.
3. **`isRecallable` stays the single gate.** The evaluator never re-implements
   approval/validity/tier logic; it calls core `isRecallable`
   (`packages/core/src/memory-entry.ts:176`) plus the entry's `stale` flag
   only to NAME a failure's reason after the pipeline already excluded it.
4. **Budget cut semantics.** Rank all eligible entries (query
   `limit: entries.length` so `memoryFor`'s slice never truncates), then take
   the longest ranked prefix whose rendered text
   (`title + "\n" + content` per entry, joined) satisfies
   `estimateTokens(text) <= tokenBudget`, using
   `estimateTokens` from `@megasaver/output-filter`
   (`packages/output-filter/src/tokens.ts:17`, ~4 bytes/token) — the same
   estimator warm-start budgets with. Stop at first overflow (strict prefix).
5. **Contract files live in the user's repo**: `<cwd>/contracts/
   <name>.contract.json` (override `--dir`), Zod-schema'd, committed like any
   other test fixture. Schema: `{ name, intent, requiredEvidence:
   [{ kind: memory-entry-ref | file-ref | keyword, value }], tokenBudget,
   createdFrom }`. `intent` is capped at the imported
   `MAX_LM2_CANDIDATE_TEXT_CODE_UNITS` because an oversize task silently
   drops to task-free fallback (rank-project-memories.ts:233) — a contract
   must never silently lose its intent.
6. **Placement.** Schema + evaluator go in `@megasaver/memory-recall` (the
   retrieval-adapter bounded context; core cannot host them — it would
   create a core→memory-recall cycle). CLI hosts thin citty handlers only
   (§3c allow-list already admits `@megasaver/memory-recall` and
   `@megasaver/output-filter`; `@megasaver/stats` stays untouched —
   `apps/cli/test/dependency-graph.test.ts`).
7. **Capture source for `add`.** Intent = the session's `title`
   (`packages/core/src/session.ts`) or explicit `--intent`. Surfaced
   memories = the injections the session actually observed:
   `readSessionDecisionTrace(...).outputs[].memory.rankedByMemoryIds`
   (`packages/output-filter/src/decision-trace.ts:100` — memory ids are
   stamped INLINE on the registry replay trace per
   `wiki/decisions/decision-trace-inline-not-join`). When no trace exists,
   explicit `--evidence-*` flags are required. Preview by default; persist
   only with `--write`.
8. **Traces stay local.** Run reports append to
   `<storeRoot>/contract-runs/<projectId>.jsonl` under `withFileLock`
   (`@megasaver/shared`, `packages/shared/src/file-lock.ts`) — the mandated
   guard for state writes. Nothing leaves the machine.

## Architecture

```
contracts/*.contract.json ──Zod parse──► Contract
      │                                        │
mega contracts run <project>                   ▼
  registry.listMemoryEntries(projectId) ─► evaluateContract
      rankProjectMemories({ profile:"safe", task: intent,
                            query:{ includeStale:false, limit:n } })
        └─ rankSafe → lexical LM2 ranking (no vectors, no embed)
      ranked order ─► token-budget prefix cut (estimateTokens)
      requiredEvidence × cut ─► findings (pass | fail + named reason)
  report (text | --json) ─► exit 0/1 ─► contract-runs/<projectId>.jsonl
```

`mega contracts add <project> --session <id>`: `registry.getSession` →
intent; `readSessionDecisionTrace` → deduped `rankedByMemoryIds` →
`memory-entry-ref` evidence; preview → `--write` persists the fixture.

## Components

1. **`contractSchema` + types** — `packages/memory-recall/src/contract.ts`.
   Strict Zod object; `requiredEvidence` 1–32 items; `tokenBudget` positive
   int ≤ 100 000; `createdFrom: sessionId | null`.
2. **`evaluateContract`** — `packages/memory-recall/src/evaluate-contract.ts`.
   Pure over injected `{ contract, projectId, entries, storeRoot, asOf }`.
   Failure reasons (each names the entry when one is identifiable):
   `entry-missing` (id not in store), `entry-not-recallable` (fails
   `isRecallable` — which sub-gate: approval / validity window / archival),
   `entry-stale` (`stale: true`), `ranked-below-budget` (recallable, ranked,
   but outside the cut — reports rank position and cut size),
   `no-entry-in-cut` (no cut entry matches a file-ref/keyword). `file-ref`
   matches `relatedFiles` exactly after `/`-normalization; `keyword` matches
   case-insensitive substring over `title`, `content`, `keywords`.
3. **Deterministic profile input** — additive `profile?: "safe"` on
   `RankProjectMemoriesInput`; safe-profile early return through `rankSafe`.
4. **`mega contracts run`** — `apps/cli/src/commands/contracts/run.ts`,
   cli-test-pattern (`wiki/workflows/cli-test-pattern.md`): inner
   `runContractsRun(input): Promise<0 | 1>`, injected io/env/`now`.
   Loads `--dir` (default `contracts/`) sorted lexicographically; schema
   failure in any file = named failure, exit 1; `--contract <name>` filter;
   `--json` machine report; per-failure `repair` hint string.
5. **`mega contracts add`** — `apps/cli/src/commands/contracts/add.ts` as in
   Locked Decision 7. Refuses overwrite without `--force`.
6. **Run recorder** — append-only JSONL, `withFileLock`
   (`deadlineMs: 2000, staleMs: 30_000`); lock miss ⇒ skip record with a
   stderr note (recording is observability, never a gate).

## Error handling

- All external input crosses a Zod boundary: contract files, flags
  (`projectNameSchema`, session id), trace reads (already schema'd in
  output-filter). Internal results from `rankProjectMemories` are trusted
  (parse-on-handoff policy, read side).
- Store/project resolution errors reuse `mapErrorToCliMessage` /
  `projectNotFoundMessage` exactly as `memory search` does.
- An unreadable contracts dir: `run` reports "no contracts found" and exits 0
  (opt-in feature; absence is not failure). An unparsable `*.contract.json`
  IS a failure (a broken fixture must not pass CI silently).
- Recorder failures never change the exit code.

## Security & privacy

- No network, no model calls, no environment fingerprints in reports.
- Contract files are user-authored repo content; `add` writes only what the
  preview showed (intent text, entry ids, budget) — no memory `content` is
  copied into the fixture, so committing contracts leaks no memory bodies.
- Run records stay under the local store root; ids only, no content.
- Path handling via `node:path` `join`; contract `name` is a strict
  `[a-z0-9-]` slug so the fixture filename cannot escape `--dir`.

## Testing

TDD, red-first, per cli-test-pattern; no timing-tight assertions; `asOf`/
`now` always injected. Key cases: safe-profile determinism (throwing `embed`
never invoked; byte-identical `--json` across two runs); every failure
reason named with entry id + title; budget-cut boundary (evidence exactly at
the cut edge); file-ref normalization; keyword casing; malformed fixture ⇒
exit 1 naming the file; `add` with trace vs `--evidence-*` fallback vs no
source (error); `--write`/`--force`; lock-contended record skip.

## Risk & process

HIGH (§12: public CLI flags + memory/retrieval core path). Full superpowers
chain in a worktree (no `main` edits); `architect` pass pending on this
design; `code-reviewer` AND `critic` as separate passes; `verifier` with CLI
smoke evidence (a real captured `contracts add` → `run` → repaired re-run).
Escalation trigger: if implementation must touch LM2 ranker weights or
`isRecallable`, stop — that is a different, wider-blast-radius change.

## Dependencies / build order

11 of 20 in the wave-2 batch. No cross-pair symbol ownership: touches only
`@megasaver/memory-recall`, `apps/cli/src/commands/contracts/*`, and one
`subCommands` line in `apps/cli/src/main.ts` (trivial-conflict-prone across
the batch; rebase, don't fork). No pnpm catalog in this repo — new
workspace deps are declared per-package with `workspace:*`.

## Open questions

1. Should `contracts/` be configurable per-project (registry field) instead
   of per-invocation `--dir`? Deferred to first real usage feedback.
2. Should a v2 assert the warm-start brief surface (`assembleWarmStartBrief`)
   in addition to recall ranking? Deferred; separate spec.
3. Should run records graduate into the `@megasaver/stats` `AuditEvent`
   family (via a core re-export per §3c)? Deferred to keep v1 stats-free.
