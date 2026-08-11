---
feature: context-yield-audit
date: 2026-08-11
risk: MEDIUM
status: draft-design
pending: [user-spec-review, architect-pass]
reviewers: [code-reviewer]
build-order: "1 of 3 (wave-4 batch)"
---

# Context Yield Audit — freeloader table for injected memories/rules (P2-1 wave-4)

## Problem

Every agent turn injects memories and rules into context via `MEGA SAVER:CONTEXT_GATE` blocks, handoff capsules, and warm-start packs, but we never measure whether that injected context was used. The solo-developer roadmap (`wiki/syntheses/solo-developer-roadmap.md:28`) sequences Brain Doctor (2.3) → Context Contracts (2.4) → Déjà Vu (2.5) on the premise that trust requires evidence; wave-2 backlog deferred `context-yield-audit` as "`freeloader table for injected memories/rules (evidence lower bound, no causality claims)`" (`wiki/syntheses/next-wave-2-ideas-2026-08-06.md:75`). Without a yield audit, freeloading memories bloat every turn's suffix (cache-write cost `wiki/syntheses/cache-write-cost-reduction-2026-08-01.md:1` — suffix size = per-turn write cost), and no honest-metrics surface can report measured injections vs. observed reuse.

## Goal

1. `mega context yield --project <id> [--window 7d] [--json]` computes a **freeloader table**: for each memory/rule that was injected into context in the window, report injection count, observed-reuse lower bound, and yield tier (HOT/COLD/FREELOADER) — deterministic, no LLM, no causality claim.
2. `yield = reused / injected` where `reused` is the evidence lower bound: at least one of (a) the memory's `relatedFiles` appears in a post-injection read-index, (b) its id appears in a decision-trace, (c) its lexical fingerprint appears in the delivered diff's added lines. No counterfactual ("would have failed without") — only observed reuse.
3. Output is bounded (top 50 freeloaders, remainder aggregated) and carries an `honestReceipt` explaining that yield is a lower bound and unread freeloaders may still have deterred a mistake.

Success criteria: audit on a project with 30+ injected memories shows table sorted by yield ascending; `--json` validates against strict Zod; `pnpm verify` green; no network, no LLM.

## Non-Goals (YAGNI)

- No automatic eviction or rewriting of memories — audit only, read-only (Doctor owns repairs, Contracts owns gates).
- No per-token dollar causality ("this memory saved $X") — rowspan is injections + reuse counts, never dollars.
- No cross-project yield (same `projectId` only; workspaceKey-scoped).
- No GUI in v1 (CLI table + JSON; GUI heatmap is a follow-up consumer).
- No new persistence — reads from existing `content-store` chunk-sets, `stats` read-index, and `memory-graph` registry only.

## Locked Decisions

1. **Read-only join, no new store.** Audit reads three existing seams: `listChunkSets` + `readChunkSet` for delivery evidence, `stats/read-index` for post-injection file-touch signal, `memory-graph/registry.listEntries({projectId})` for the injected set. No writes, no migration. Honest-metrics pattern mirrors `apps/cli/src/preflight/snapshot.ts` pure join (`docs/superpowers/specs/2026-08-11-workspace-preflight-diff-design.md` LD3).
2. **Yield is a lower bound.** `reusedAtLeast = max(signalA, signalB, signalC)` where each signal is 0/1 per injection event, never a probability. Report header carries `honestNote: "reused is a lower bound; absence does not prove uselessness"`. This satisfies the evidence-discipline gate (`wiki/syntheses/solo-developer-roadmap.md:33`) — no causal claim.
3. **Lexical fingerprint, not embedding.** Signal C uses a bounded, deterministic n-gram fingerprint of the memory's `content` (first 200 chars, lowercased, tokenized on `\W+`, 3-grams) matched against `git diff` added-line corpus for that session. No embeddings, no LLM, no vector sidecar — pure, testable, and `exactOptionalPropertyTypes` safe.
4. **Windowed, ignore-aware, bounded.** Default window 7d, max 30d. File-touch signal uses the same ignore set as `packages/indexer/src/scan.ts` — `.megasaver/`, `node_modules/`, `dist/` never count. Table capped at 50 rows + `+N more` aggregate, sorted by yield ascending then injection count descending — deterministic like `renderPreflightDiff` (`apps/cli/src/preflight/snapshot.ts:comparePreflightSnapshots`).
5. **Pure core, CLI thin wrapper.** `packages/context-pruner/src/yield-audit.ts` exports `computeYieldAudit(input): YieldAuditReport` (pure, ≤ 300 LOC, no I/O). `apps/cli/src/yield-audit/compute.ts` is the pure scorer; `apps/cli/src/commands/context/yield.ts` is the io-injected citty command that gathers the three seams and renders. No package besides `context-pruner` holds scoring logic — satisfies `AGENTS.md` one-responsibility boundary.
6. **Strict schemas.** `yieldAuditReportSchema` (Zod `strict()`) in `packages/context-pruner/src/yield-audit.ts` validates both `--json` output and the pure function's return — same pattern as `evidenceBundleSchema` (`apps/cli/src/bundle/schema.ts:canonicalJson`).

## Architecture

```
mega context yield --project <id> [--window 7d] [--json]
  resolveProject({cwd, projectIdFlag}) -> projectId + storeRoot
  gatherInjected = registry.listEntries({projectId})               # memory-graph
  gatherEvidence = listChunkSets({storeRoot, projectId}) + readChunkSet bodies
  gatherReads    = read-index entries for sessions in window
  gatherDiffs    = git diff --name-only HEAD (per-session, bounded)
  computeYieldAudit({injected, evidence, reads, diffs, window}) -> YieldAuditReport (pure)
  render: human table (default) | --json single object
```

## Components

- **C1 `packages/context-pruner/src/yield-audit.ts` (pure):** `yieldAuditReportSchema`, `computeYieldAudit`, `fingerprintMemory`, `tierFor(yield)`. No I/O.
- **C2 `apps/cli/src/yield-audit/compute.ts` (pure):** thin scorer re-export for CLI boundary; unit-tested with crafted injected/evidence fixtures.
- **C3 `apps/cli/src/commands/context/yield.ts` (io-injected):** `runContextYield(input: {cwd, projectId?, window?, json?, stdout, stderr}) => 0|1` — gathers seams via `findProjectByCwd`, `listChunkSets`, `readChunkSet`, `registry`, `execFile git`.
- **C4 `apps/cli/src/main.ts`:** register `context yield` subcommand.

## Error handling

- No registered project → `error: no registered project for this workspace; run mega project create` exit 1 (mirrors `apps/cli/src/commands/preflight/snapshot.ts:75`).
- Empty injected set → table prints `no memories/rules injected in window` exit 0 (not an error).
- Malformed chunk-set or read-index entry → that evidence is skipped, audit continues with `honestReceipt.warnings: ["skipped N unreadable chunk-sets"]`.
- Window > 30d → exit 1 `error: window exceeds 30d maximum`.
- Store unavailable → exit 1 with `reason` from `content-store` error code, never throws.

## Security & privacy

- No file contents logged; only aggregated counts and memory ids (first 8 chars) appear in table. Redaction via `redact()` on any path that leaks into `--json` `relatedFiles`.
- Git args are argv arrays, `git -C <root>` confined; timeout 2000ms as in `apps/cli/src/preflight/git-capture.ts:3`.
- Owner-only read via existing store permissions (0700/0600 atomic files) — same as `writeIntentAt` (`apps/cli/src/hooks/intent-run.ts:102`).

## Testing

- **Unit (TDD, red first, pure):** `computeYieldAudit` cases: all-freeloaders (reused 0 → yield 0, tier FREELOADER), half-reused (yield 0.5 → COLD), all-reused (yield 1 → HOT); fingerprint matches added-line corpus vs. misses; bounded table (55 injected → 50 rows + "+5 more" aggregate); strict schema rejects extra key; empty injected → empty report.
- **Integration:** seeded tmp store (`registry.createEntries` 5 memories, 3 chunk-sets with decision-trace ids, 2 read-index entries touching `relatedFiles`) → `runContextYield` JSON parses, yield counts equal expected lower bound, warnings for one malformed chunk-set, file-touch signal respects ignore filter.
- **Regression:** existing `listChunkSets`/`listOverlayChunkSets` unchanged; `context why`/`hotspots` tests still green.

## Risk & process

**MEDIUM** — read-only join over three existing stores, no hook mutation, no delete/move, no network. Work in worktree; `code-reviewer` only (no `architect`/`critic` required per `docs/conventions/risk-modes.md:MEDIUM`). `pnpm verify` + CLI smoke (`seed → yield --json` parses) required before merge.

## Dependencies / build order

- Builds on shipped: `content-store` chunk-set listing, `memory-graph` registry, `stats` read-index, `encodeWorkspaceKey`, `SAFE_SEGMENT`, `findProjectByCwd`.
- Owned by this pair: `yieldAuditReportSchema` + `computeYieldAudit` family.
- Consumers: GUI audit dashboard (follow-up), Brain Doctor remediation hints (reads yield tier). Build order **1 of 3 (wave-4 batch)** — no wave-4 dependency.

## Open questions

1. Should HOT threshold be 0.7 or 0.8? (v1: HOT ≥ 0.5, COLD 0.1–0.5, FREELOADER < 0.1 — tunable via `tierFor` pure function, no schema change.)
2. Window default 7d vs 14d for low-activity projects? (v1: 7d, flag `--window 14d` covers the tail.)
