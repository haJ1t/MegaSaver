---
feature: long-memory-ga
date: 2026-08-06
risk: HIGH
status: draft-design
pending: [user-spec-review, architect-pass]
reviewers: [code-reviewer, critic]
build-order: "7 of 11 (next-wave batch; continues LM1)"
sources:
  - docs/superpowers/specs/2026-07-19-long-memory-runtime-design.md
  - docs/superpowers/specs/2026-07-20-long-memory-lm1-observations-design.md
  - docs/superpowers/specs/2026-07-26-lm2-product-memory-integration-design.md
  - wiki/concepts/structured-memory-engine.md (approval gate)
  - wiki/sources/longmemeval-v2.md
  - wiki/decisions/a4-closed-under-model.md
---

# Long Memory GA — Observation Promotion, Retrieval, Hygiene

## Problem

LM1 records evidence-bound state snapshots and transitions
(`packages/long-memory/src/lm1-runtime.ts`); LM2 ranks product
memories (`@megasaver/memory-recall`). But no LM1 observation ever
becomes a durable `MemoryEntry` fact, so observations never reach
the task kickoff pack or context-gate ranking; unpromoted ones
accumulate with no admission-side expiry; and a promotion could
silently contradict approved memory.

## Goal

GA the Long Memory line: (a) deterministic observation→durable-fact
promotion writing `suggested` `MemoryEntry` rows through the Phase 10
approval gate; (b) approved facts flowing into session kickoff and
context-gate ranking with fill-gap precedence (never overriding
explicit intent); (c) hygiene — candidate-side expiry, contradiction
flagging on promotion, §13 metadata completeness.

## Non-Goals (YAGNI)

- No LM3 knowledge candidates (runbooks/gotchas/premises) — deferred.
- No change to LM0 contracts, the JSONL host, the Python adapter, or
  LM1 capture/identity/persistence/recall — LM1 records stay
  append-only, never deleted or mutated.
- No change to LM2 `rankLm2Candidates` or `scoreChunk` weights; no
  new approval machinery (`applyApprovalFlip` + `isRecallable` are
  the only gates); no auto-approval of promoted facts, ever.
- No LLM/model calls; no paid API calls in CI (per
  `decisions/a4-closed-under-model`: closed under model, no replay).
- No GUI; no official LongMemEval-V2 score claim (that gate stays
  `syntheses/longmemeval-v2-status`).

## Locked Decisions

1. **Promotion writes the existing `MemoryEntry` registry, nothing
   new** (continues `2026-07-26-lm2-product-memory-integration`: one
   source of truth). Drafts carry `approval: "suggested"`,
   `source: "agent"`; the human exit is the shipped `mega memory
   approve` → `applyApprovalFlip` (`apps/cli/src/commands/memory/
   approve.ts`), whose approved flip runs `applySupersession`.
2. **Dependency direction preserved.** `@megasaver/long-memory`
   never imports `@megasaver/core` (LM1 plan hard rule). The listing
   surface is additive inside long-memory; the pure draft builder is
   in `@megasaver/memory-recall` (already imports both sides); only
   the CLI writes via `CoreRegistry.createMemoryEntry`.
3. **Deterministic promotion identity.** Promoted id = lowercase
   v5-style UUID from the first 16 SHA-256 bytes of
   `megasaver.memory.promotion.v1\0` + workspaceKey + snapshot id
   (mirrors `deriveLm1RecordId`; satisfies `memoryEntryIdSchema`).
   Re-promotion is idempotent: the duplicate-id create is caught and
   reported `already-promoted`.
4. **Fill-gap precedence, exactly like session intent.** Explicit
   tool intent always wins. Hints are appended only when
   `buildSaverDecision` (`apps/cli/src/hooks/saver.ts`) has no
   explicit intent, after `readSessionIntent`'s value; absent both,
   behavior is byte-identical to today. Kickoff: promoted facts fill
   only slots left after verified/healed memories, never displacing.
5. **Expiry is admission-side only.** LM1 records are immutable;
   "decay" = a `maxAgeDays` (default 45) filter on promotion
   candidates from an injected clock. Old observations stay
   recallable via LM1 recall, unchanged.
6. **Metadata completeness is a schema-checked invariant.** Every
   draft carries §13's five: `source` ("agent"), timestamps
   (injected now), `confidence` (deterministic: `high` when ≥2
   evidence ids, else `medium`), `scope` ("project"), `expiresAt`
   explicit (`null` allowed, never omitted).

## Architecture

```
LM1 store (append-only, untouched)
 └► listCurrentStateForPromotion   NEW @megasaver/long-memory
 └► buildPromotionDrafts           NEW @megasaver/memory-recall
     │ drafts (approval:"suggested") + contradictions + unchanged
 └► mega memory promote            NEW apps/cli
     registry.createMemoryEntry → report → hints refresh
     │ human: mega memory approve (existing gate)
 └► approved facts ─► renderTaskKickoffPack fill-gap slots
                   ─► promoted-facts.json → buildSaverDecision
                      fill-gap ranking terms (intent absent only)
```

## Components

1. **`listCurrentStateForPromotion`** — new
   `packages/long-memory/src/lm1-promotion-read.ts`, exported from
   `src/index.ts`. Input `{ storeRoot, workspaceKey,
   evidenceEligibility, clock, maxAgeDays }` → bounded, deterministic
   `Lm1PromotionCandidate[]` (`{ snapshot: Lm1Snapshot, ageDays }`,
   stateKey-ascending). Reuses `createFileLm1Store`,
   `selectCurrentStateSnapshots`, and LM1 caps (10,000-record scan,
   512 evidence resolutions); ineligible/over-cap groups are omitted
   per LM1 recall omission semantics.
2. **`buildPromotionDrafts` + `derivePromotedMemoryId`** — new
   `packages/memory-recall/src/promotion.ts`. Pure mapping to
   `memoryEntrySchema`-valid drafts: `type: "architecture"` (see Open
   questions), title `state: <stateKey>`, content = already-redacted
   snapshot text, keyword `lm-fact:<stateKey>`, `evidence` =
   [snapshot id, ...evidenceIds]. An approved entry with the same
   `lm-fact:` keyword and different content ⇒ draft sets
   `supersedesId` + a `PromotionContradiction` is reported; equal
   content ⇒ `unchanged` (no draft).
3. **Evidence eligibility adapter** — new
   `apps/cli/src/lm/evidence-eligibility.ts`:
   `createLedgerEligibilityPort` maps `@megasaver/evidence-ledger`
   `loadEvidence`/`getEvidenceStatus` onto LM1's
   `EvidenceEligibilityPort`; fails closed (`revoked`).
4. **`mega memory promote`** — new
   `apps/cli/src/commands/memory/promote.ts` (registered in
   `commands/memory/index.ts`). Opens the store as `runMemoryApprove`
   does; workspace key via `projectWorkspaceKey`; creates drafts;
   reports created/already-promoted/unchanged/contradictions;
   `--json` parity; `--max-age-days` (default 45).
5. **Promoted-fact hints** — new
   `apps/cli/src/hooks/promoted-facts.ts`: `writePromotedFactHints`
   (atomic tmp+rename, best-effort) + `readPromotedFactHints` (Zod
   safeParse, catch ⇒ `undefined`), file
   `<storeRoot>/stats/<workspaceKey>/promoted-facts.json`
   `{ terms, ts }`, terms ≤12 × ≤64 chars, from approved `lm-fact:`
   entries. Writers: `mega memory promote`; `runMemoryApprove` after
   an `lm-fact:` flip.
6. **Saver fill-gap wiring** — `SaverDeps` gains
   `readPromotedFactHints`; `buildSaverDecision` appends hint terms
   to the fill-gap intent only when no explicit intent exists
   (session intent first). `scoreChunk` untouched.
7. **Kickoff fill-gap admission** —
   `apps/cli/src/hooks/task-kickoff-pack.ts`: after `eligibleMemory`
   (verified/healed) selection, slots left under
   `TASK_KICKOFF_MAX_MEMORIES` fill with approved, `isRecallable`,
   non-stale `lm-fact:` entries lacking `lastVerified`.

## Error handling

- Promotion listing throws only typed `Lm1Error` codes; draft
  building is total — contradiction/unchanged are results, not
  errors.
- CLI exits 0/1 per `workflows/cli-test-pattern`; duplicate-id
  create reports `already-promoted` (idempotent re-run).
- Hints read/write are best-effort (failure ⇒ `undefined` / no
  write; the hook never blocks a tool call); the eligibility adapter
  fails closed (`revoked`), never open.

## Security & privacy

- Promoted content is LM1 text already redacted once by
  `prepareCapture`; promotion never re-redacts or un-redacts.
  Evidence ids are preserved for provenance; no chunk bodies copied.
- No network anywhere; hints hold only stateKey-derived terms from
  redacted records, under the resolved store root, keyed by the same
  `encodeWorkspaceKey` value the saver already trusts.
- LM1 trusted-root boundary and append-only guarantees unchanged.

## Testing

Model-free GA acceptance against the LongMemEval-V2 contract
(`wiki/sources/longmemeval-v2.md`), closed under model:

| Ability | GA evidence (all local fixtures, no model) |
|---|---|
| Static state | promoted fact reaches kickoff pack fixture end-to-end |
| Dynamic state | correction chain ⇒ only newest eligible leaf promotes; approval closes predecessor |
| Workflow | deferred to LM3 (explicit, not hidden in aggregate) |
| Gotcha | deferred to LM3 (explicit) |
| Premise | partial: contradiction flag + supersession receipt |

Accuracy = fixture pass/fail per ability row. Latency = structural
bounds only (scan/candidate/evidence-lookup counts and caps), never
wall-clock. Plus: idempotent re-promotion, metadata-completeness
schema assertions, fill-gap precedence (explicit intent wins;
absent-file behavior byte-identical), kickoff non-displacement,
eligibility fail-closed, and long-memory's no-core-import boundary.

## Risk & process

HIGH (§12: memory schema-adjacent, new agent injection surface).
Worktree `feat/long-memory-ga`, no `main` edits; full superpowers
chain; `architect` pass; `code-reviewer` AND `critic` separate
passes; verifier evidence incl. CLI smoke. Escalation: touching
`scoreChunk`/rank weights, the LM1 store write path, or any
auto-approval shortcut ⇒ stop, re-scope.

## Dependencies / build order

Build 7 of 11 (next-wave batch). Depends on shipped LM1 runtime, LM2
product memory integration, the Phase 10 approval gate, the
task-kickoff hook, and the intent-aware fill-gap seam. Changeset
required (`@megasaver/long-memory`, `@megasaver/memory-recall`,
CLI). Wiki after merge: `concepts/long-memory-runtime` +
`concepts/structured-memory-engine#approval-gate`.

## Open questions

- Memory `type` locked to `"architecture"` for v1. ASSUMPTION: a
  single mapping (no per-representation split) is acceptable for GA.
- Verified: `titleSchema` (`packages/shared/src/title.ts`) has NO
  upper length bound — only trim + `min(1)` + a control-character
  regex + NFC normalize — so `state: <stateKey>` always parses
  (stateKey itself caps at `MAX_LM1_STATE_KEY_CODE_UNITS` = 512).
  The 80-code-unit truncation is a deliberate product/display
  choice, not a schema constraint.
- ASSUMPTION: `mega brain digest` (shares `applyApprovalFlip`) skips
  hints refresh; the next `promote`/`approve` run reconciles.
- Verified: `unresolvedHighRisk` =
  `record.redactionReport.unresolvedHighRisk`. Every evidence record
  carries a required `redactionReport`
  (`packages/evidence-ledger/src/schema.ts:33`) whose
  `unresolvedHighRisk` is a required boolean
  (`packages/evidence-ledger/src/sub-schemas.ts:44-45`). No absent
  case exists; unreadable records take the throw ⇒ `revoked` branch.
