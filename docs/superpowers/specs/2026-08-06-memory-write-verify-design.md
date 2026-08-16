---
feature: memory-write-verify
date: 2026-08-06
risk: HIGH
status: approved-design
pending: [architect-pass]
reviewers: [code-reviewer, critic]
build-order: "9 of 20 (wave-2 batch)"
freshness:
  verified-against: b660b9c9 (main, 2026-08-16)
  note: >
    All premises re-verified on main: sweepMemoryTiers still at
    memory-entry.ts:252 with fail-loud now TypeError at :261; save-memory
    has no evidence input yet (SaveMemoryEnv.storeRoot exists); no
    expiresAt/verification on projectRuleSchema; POSSIBLE_SUPERSEDES_PREFIX
    still supersession.ts:42; locateChunkSet still re-exported by core;
    server.ts tool env cases drifted 444→486 (immaterial). User approved
    spec as-is 2026-08-16 including the plan's evidence-input assumption.
sources:
  - wiki/syntheses/llm-code-problems-research-2026-07.md (proposal 3 + validated bets)
  - wiki/concepts/failed-run-learning.md
  - docs/superpowers/specs/2026-08-06-long-memory-ga-design.md (delineation)
---

# Memory Write-Verify — Write Gate, Trust Tiers, Rule TTL

## Problem

Agent-side memory writes persist unverified. `handleSaveMemory`
(`packages/mcp-bridge/src/tools/save-memory.ts`) schema-parses,
captures an anchor, runs supersession detection — but resolves no
evidence pointer and runs no conflict check; verification happens only
at APPROVAL time (`approve-memory.ts`: `resolveEvidenceForMemory` →
`validateSave` → `checkConflicts`). `convert_failure_to_rule` persists
FORGE rules with no verification, and `projectRuleSchema`
(`packages/core/src/project-rule.ts`) has no TTL — FORGE's known limit
is unbounded rule growth. `MemoryEntry.expiresAt` exists
(`packages/core/src/memory-entry.ts:98`) but nothing enforces it:
`sweepMemoryTiers` never reads it; `isRecallable` ignores it.
Research basis (synthesis proposal 3): third-party verification before
persisting failure rules cuts false memory writes 78% and lifts task
success 31% (EDV); TTL enforcement adds 56% consistency.

## Goal

(a) Deterministic WRITE GATE at the `save_memory` MCP boundary (all
entries written there are agent-sourced — `source` is boundary-forced
to `"agent"`, Decision 5) and for FORGE-derived rules: before
persist, evidence pointers must resolve and the claim must not
contradict approved memory (reuse `checkConflicts`,
`packages/core/src/conflict-checker.ts:26`). Entries failing
verification land as `approval: "suggested"` — never dropped, never
auto-approved. (b) TRUST TIERS: verification outcome maps onto the
existing `confidence` enum (low/medium/high) by a deterministic
write-time rubric. (c) TTL: auto-written rules and gated entries get a
default `expiresAt`; `mega memory sweep` enforces it.

## Non-Goals (YAGNI)

- No change to `approve-memory`: it stays the ONLY promotion path;
  `suggested` stays deliberately not an accepted input there.
- No read-time confidence mutation — `effectiveConfidence`
  (`memory-entry.ts:224`) stays read-time-only; the rubric stamps
  stored confidence once, at write. No `isRecallable` change: TTL
  enforcement is sweep-side only.
- No `MemoryEntry` schema change — `expiresAt` and the validation
  sidecar (`memoryValidationSchema`, `setMemoryValidation`) exist.
- No gate on human surfaces: CLI `memory create` (§9.1 trust ladder)
  and `mega memory promote` (long-memory-ga's path) are not wired.
- No LLM calls; no deletion of expired rules (deleting user data
  escalates to CRITICAL, §12) — eviction = read-exclusion + lossless
  sweep; no approval lifecycle added to `ProjectRule`.

## Delineation vs long-memory-ga (batch-1)

`2026-08-06-long-memory-ga-design.md` owns observation→fact PROMOTION
(LM1 snapshots → `buildPromotionDrafts` → `mega memory promote`, with
its own `lm-fact:` contradiction reporting). THIS feature owns the
write gate for DIRECT agent writes at the MCP boundary; promotion
drafts are already evidence-bound there, so `promote` is not
double-gated. Both paths land `approval: "suggested"` and exit only
through the shipped approve gate. Nothing here contradicts that spec.

## Locked Decisions

1. **Verdict is pure, in core.** New `verifyMemoryWrite`
   (`packages/core/src/write-verify.ts`): candidate + approved-active
   corpus + plain-data resolution results → `{ outcome, reasons,
   confidence, approval }`. All IO (ledger, chunk store, git) stays at
   callers — no new package edges; core stays agent-agnostic (§1).
2. **Reuse, don't fork.** Conflicts = existing `checkConflicts`; its
   signature narrows (type-level only) to the fields it already reads
   (`id/type/title/content/keywords/relatedFiles`) so a `ProjectRule`
   adapter can call it. Ledger resolution = existing
   `resolveEvidenceForMemory` (mcp-bridge); chunk-set existence =
   `locateChunkSet` (re-exported by core, `src/context-gate.ts:12`);
   file-at-commit = the already-captured anchor (`captureCodeAnchor`
   batches `cat-file` at HEAD; a cited file it dropped is an
   unresolved claim). Verdict lands in the EXISTING validation sidecar
   (`validatedBy: "system"`); approve-memory recomputes and overwrites
   at approval — the gate never pre-empts the human gate.
3. **Pointer classification is closed-form.** Evidence strings:
   `possible-supersedes:` prefix ⇒ lineage note (skipped);
   `/^cs-[0-9a-f]{32}$/` ⇒ chunk-set pointer (saver-minted,
   `apps/cli/src/hooks/saver.ts:425`; bare-id READ sanctioned per
   `wiki/concepts/chunk-set-identity`); else ⇒ evidence-ledger id
   candidate — but only UUID-shaped candidates reach the ledger
   resolver; any other string is `invalid_pointer` (no IO). Only
   recognized pointers count. **Chunk-set pointers are
   project/session-bound** (architect B1-repair, 2026-08-16) with a
   layout branch: a `registry`-layout hit must match the entry's
   `projectId` (and `sessionId` when the entry has one); an
   `overlay`-layout hit (the saver's actual persist path,
   `saveOverlayChunkSet` → `content/<workspaceKey>/<liveSessionId>/`)
   must match `encodeWorkspaceKey(projectRootPath)` (and
   `liveSessionId` when the entry has a sessionId). Mismatch ⇒ hard
   flag `cross_workspace` + unresolved with reason `cross_workspace`.
   A chunk set from another project/workspace in the same store can
   never verify.
4. **Rubric (deterministic; caps, never raises).** Hard flags
   (`unresolvedSecret`, revoked, cross-workspace, conflict
   `contradiction`) ⇒ `unverified`. Else ≥1 recognized pointer, all
   resolve, no cited file dropped by anchor ⇒ `verified`. Else ≥1
   resolves ⇒ `partial`. Else ⇒ `unverified`. Confidence :=
   min(caller, cap): verified→high, partial→medium, unverified→low.
   Approval: outcome ≠ `verified` ⇒ forced `"suggested"`; otherwise
   caller value passes through (today's behavior). Failing entries
   persist, never dropped. Sidecar: verified→`valid`,
   partial→`needs_approval`, unverified→`quarantined`.
5. **Gate keys on the BOUNDARY at `save_memory`.** `save_memory` is an
   agent-only MCP tool — the caller-supplied `source` field is
   overridden to `"agent"` at the boundary (the input key stays
   accepted for back-compat; the stored value is always `agent`), so
   the gate runs unconditionally there (architect B1 fix, 2026-08-16).
   An agent cannot dodge the gate by claiming `source: "manual"`.
   `source: "test_failure"` is RESERVED as an engine-owned value — no
   production writer exists today; when one lands, the
   `source ∈ {agent, test_failure}` engine condition applies to that
   surface. The human path (CLI `memory create`) writes through the
   registry directly and is untouched. Missing env `storeRoot` ⇒
   pointers unresolvable ⇒ never `verified` (fail-closed for trust)
   but the write still lands as suggested (fail-open for persistence,
   reason `resolver_unavailable`).
6. **TTL default 90 days, explicit wins.** Absent `expiresAt` on
   gated entries and FORGE rules ⇒ `createdAt + 90d`
   (`WRITE_VERIFY_DEFAULT_TTL_DAYS = 90`, aligned with the 90d
   `DEFAULT_SWEEP_MAX_IDLE_MS`). Caller datetime or explicit `null`
   (no expiry) respected — `saveMemoryInputSchema.expiresAt` and
   `failureToRuleInputSchema` gain `.nullable()` (additive).
7. **TTL enforcement is lossless.** `sweepMemoryTiers` gains one
   condition: past-`expiresAt` archives (tier demotion, never delete;
   `working`-tier exemption preserved). Rules: additive optional
   `expiresAt` + `verification` on `projectRuleSchema` (legacy rows
   parse untouched); `rankApplicableRules` gains optional `asOf`
   excluding expired rules (absent ⇒ unfiltered, back-compat); `mega
   memory sweep` reports `expired=` / `rulesExpired=`. No
   `updateProjectRule`/delete API is added.

## Architecture

```
agent ─MCP─► save_memory ─► resolveWritePointers (mcp-bridge, IO)
               │              ledger / cs-chunks / anchor coverage
               ▼
       verifyMemoryWrite (core, pure) ◄─ checkConflicts + rubric
               │  outcome, confidence cap, approval, TTL default
               ▼
       saveMemoryWithLineage ─► setMemoryValidation (system)
               ▼ human (unchanged): approve_memory — only promotion
agent ─MCP─► convert_failure_to_rule ─► same resolver (evidence only)
               └► rule + confidence cap + verification + expiresAt
                    reads: rankApplicableRules(asOf) excludes expired
                    sweep: reports expired entries + rules
```

## Components

1. `verifyMemoryWrite` + types — new `packages/core/src/
   write-verify.ts` (pure; exported from index).
2. `checkConflicts` Pick-narrowing — type-level, `conflict-checker.ts`;
   behavior and call sites unchanged.
3. `resolveWritePointers` — new `packages/mcp-bridge/src/
   write-verify-resolver.ts`: classify per Decision 3, resolve,
   return plain data for (1).
4. `save_memory` wiring — gate between schema-parse and
   `saveMemoryWithLineage`; sidecar for created (non-deduped) rows only.
5. `convert_failure_to_rule` wiring — env gains optional `storeRoot`;
   project root via `getFailedAttempt` → `getProject().rootPath`;
   stamps confidence cap, `verification`, default `expiresAt`.
6. Rule TTL surfaces — `projectRuleSchema` additive fields;
   `registry.convertFailureToRule` default-stamps TTL (engine-owned);
   `rankApplicableRules` `asOf`; `get_applicable_rules` env gains
   `now` (threaded in `server.ts`).
7. Sweep extension — `sweepMemoryTiers` expiry condition;
   `runMemorySweep` (`apps/cli/src/commands/memory/sweep.ts`) reports
   expired entries + rules; extends `apps/cli/test/
   memory-sweep.test.ts`, no duplicate suite.

## Error handling

- Gate is total: per-pointer resolver throws ⇒ that pointer is
  unresolved (reason recorded); the write itself NEVER fails because
  of the gate (schema/registry errors unchanged). Non-UUID ledger
  candidates are rejected at classification with `invalid_pointer`
  and never touch the ledger. Sidecar write is
  best-effort after persist (anchor-capture §5 discipline).
  `sweepMemoryTiers` keeps its fail-loud invalid-`now` TypeError.
  CLI exits 0/1 per `workflows/cli-test-pattern`; `--json` parity.

## Security & privacy

- CLOSES the forged-`approval:"approved"` hole at the `save_memory`
  boundary (architect B1 fix): `source` is boundary-forced to
  `"agent"`, so an unverifiable agent write can no longer land
  approved by claiming a human source; the gate caps confidence and
  forces `suggested` for every non-verified write.
- **Honesty of `verified` (architect M2):** the verdict attests
  pointer existence + same-project binding at write time, not
  claim↔content correspondence. An agent can mint evidence by running
  commands (the saver pipeline is agent-visible), so `verified` is an
  attestation tier, not proof. The stored confidence cap reflects
  this: it caps, never raises, and the human approve gate remains the
  only promotion path.
- Evidence resolution is workspace-keyed (`encodeWorkspaceKey`);
  cross-workspace pointers stay a hard flag; chunk-set pointers are
  additionally project/session-bound (Decision 3). The gate reads
  existence/status only, never copies ledger content. Ledger
  lookups are UUID-shaped only (`invalid_pointer` for anything else,
  no IO); the `evidence` input is capped at 32 pointers. Counters
  memory poisoning (research cluster 5): unresolved or contradicting
  claims cannot enter approved recall without a human flip. No
  network. Registry owns persistence; `withFileLock`
  (`@megasaver/shared/node`) available if a shared file needs it.

## Testing

TDD, red first. No wall-clock timing assertions — clocks injected
(pinned ISO strings, `memory-sweep.test.ts` pattern). Fixtures honor
`.strict()` + the scope↔sessionId `superRefine`.

| Area | Red test |
|---|---|
| core rubric | table-driven: flags/resolution → outcome; caps never raise; approval forced iff ≠ verified; zero pointers ⇒ unverified+low+suggested |
| core sweep+rules | past-expiresAt archives, null/absent never, working exempt, idempotent; legacy rule row parses; TTL stamped iff absent; `asOf` excludes expired, absent `asOf` byte-identical |
| bridge resolver | cs-id found/missing; **cs-id present but other-project ⇒ hard flag cross_workspace**; ledger missing/revoked; note skipped; non-UUID ledger candidate ⇒ `invalid_pointer` (no IO); no storeRoot ⇒ `resolver_unavailable` |
| bridge save/rule | failing entry persists suggested + sidecar quarantined; verified passthrough; deduped ⇒ no sidecar; unverified rule lands confidence low + verification recorded, never dropped; **caller `source:"manual"` is boundary-forced to agent ⇒ gated, cannot land approved**; **33-pointer evidence input rejected by schema**; **`source:"test_failure"` gated**; **approve composition: gate-written entry with resolvable evidence approves; zero-evidence ⇒ `missing_evidence` quarantine (documented)** |
| cli sweep | extend existing suite: `expired=`/`rulesExpired=` text + `--json` keys (update the `toEqual` summary) |
| regression | direct-registry (CLI `memory create`) path byte-identical (gate inert); json-directory registry round-trips the new rule `verification`/`expiresAt` fields |

Smoke (DoD #5): captured MCP run — save_memory with a dead evidence id
lands suggested/low; sweep archives an expired fixture and reports an
expired rule.

## Risk & process

HIGH (§12: memory schema-adjacent, write-path gate, public CLI output
change). Full superpowers chain; worktree `feat/memory-write-verify`,
no `main` edits; `architect` pass; `code-reviewer` AND `critic`
separate passes (author ≠ reviewer, fresh context); `verifier` with
smoke evidence. Escalation: any expired-row DELETION, `isRecallable`
change, or auto-approval shortcut ⇒ stop and re-scope.

## Dependencies / build order

Build 9 of 20 (wave-2 batch). Depends on shipped: conflict-checker,
validation sidecar, approve gate (Phase 10), FORGE (Phase 5), sweep
M2, evidence ledger, chunk-set identity fix. Composes with (never
blocks) batch-1 `long-memory-ga`. Changesets: `@megasaver/core`,
`@megasaver/mcp-bridge`, CLI. Wiki after merge:
`concepts/failed-run-learning` + approval-gate page + `log.md`.

## Open questions

- Uniform 90d rule TTL vs severity-scaled (critical rules longer)?
  v1 locks uniform; revisit with field data.
- ~~`source` is agent-claimable — force `source: "agent"` at the MCP
  boundary?~~ RESOLVED 2026-08-16 (architect B1): boundary-forced to
  `"agent"` at `save_memory` (Decision 5). Deferred stays: the same
  forcing on other future agent surfaces.
- **Recall-degradation consequence (architect M4, documented not
  accidental):** existing connectors that save without the new
  `evidence` input now land `suggested` and are quarantined
  (`missing_evidence`) at approve time — there is no MCP surface to
  add evidence after the fact. This is the intended trust tightening;
  connector guidance must tell agents to cite evidence. Integration
  tests pin both approve compositions.
- **Summary semantics (architect m9):** `expired=` counts rows
  expired AND archived by this run (newly expired); `rulesExpired=`
  counts currently-expired rules (state). Pinned in the CLI summary.
- Verified: `ProjectRule` is NOT a `MemoryEntry` — the research
  brief's "existing MemoryEntry field" holds only for entries; rules
  need Decision 7's additive `expiresAt`.
- Verified: `server.ts` env construction accepts the added
  `now`/`storeRoot` fields without route restructuring — every tool
  env is an inline object literal per case
  (packages/mcp-bridge/src/server.ts:384-452; `save_memory` already
  passes `storeRoot`). `GetApplicableRulesEnv.now` ALREADY exists
  (get-applicable-rules.ts:13) — only `asOf` threading is new.

