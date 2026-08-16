---
feature: memory-write-verify-followup
date: 2026-08-16
risk: HIGH
status: draft-design
pending: [user-spec-review, architect-pass]
reviewers: [architect, code-reviewer, critic]
sources:
  - docs/superpowers/specs/2026-08-06-memory-write-verify-design.md
  - docs/superpowers/specs/2026-07-14-brain-autopilot-design.md
  - docs/superpowers/specs/2026-06-12-phase5-forge-failed-run-learning-design.md
---

# Memory Write-Verify Follow-Up — Remaining Ungated Surfaces

## Problem

The memory-write-verify gate (shipped 2026-08-16, PR #359) covers the
MCP boundary: `save_memory`, `convert_failure_to_rule`,
`save_project_rule`, `memory_from_session`. Its spec explicitly left
three surfaces as follow-ups:

1. **CLI `mega memory from-session`** writes `source: "test_failure"`
   memories with no gate, no TTL, no sidecar — the MCP tool's exact
   logic, ungated (`apps/cli/src/commands/memory/from-session.ts`).
2. **Brain autopilot** (`runAutopilot`, core) writes APPROVED rows —
   a machine approving without any evidence resolution or conflict
   check. It can approve a row that contradicts already-approved
   memory (no `checkConflicts` corpus), and staged rows never expire.
   The autopilot spec itself marks this HIGH (§12 — memory write
   path, machine writes `approved` rows).
3. **Rule read-exclusion is MCP-only:** `get_applicable_rules`
   threads `asOf` and excludes expired rules, but `mega rules apply`
   and the GUI workspace-rules route call `rankApplicableRules`
   without `asOf` — a human sees rules an agent no longer sees.

## Goal

Apply the shipped write gate to the two remaining writers and thread
`asOf` on the two remaining rule readers — all within the locked
Decision 5/7 shapes of the parent spec: evidence pointers must resolve
and the claim must not contradict approved memory before persist;
failures land `suggested`; gated entries get a 90d default TTL
enforced losslessly by sweep; expired rules are read-excluded
everywhere a caller has a clock.

## Non-Goals (YAGNI)

- No change to `approve_memory` or any other shipped gate surface.
- No change to `isRecallable` (TTL stays sweep-side).
- No new package; the gate stays core-pure (Decision 1 of the parent
  spec): all IO at callers, verdict via `verifyMemoryWrite`.
- No change to the autopilot rule table (`scoreCandidate`) or policy
  schema — the write gate composes with them, never replaces them.
- No evidence pointer minting from failed attempts (no new
  evidence-ledger writes).
- CLI `memory from-session` and autopilot `session_summary`
  (DECISION:) candidates stay out of the locked `{agent,
  test_failure}` set — they remain ungated, unchanged.

## Locked Decisions

1. **CLI `memory from-session` mirrors the MCP amendment C exactly.**
   Per `test_failure` candidate the gate runs with an EMPTY resolution
   (candidates carry no evidence pointers; the CLI cannot import the
   mcp-bridge resolver, and zero pointers need no IO) and the
   `approvedActive` corpus as in `save_memory`. Verdict unverified
   (`zero_evidence_pointers`) ⇒ `suggested` + low cap + default
   `expiresAt` (90d) + `quarantined` system sidecar. `session_summary`
   candidates unchanged. `detect: false` stays.
2. **Autopilot gate composes structurally with the rule table.**
   - `classifyEvidencePointer` gains a closed-form kind:
     `autopilot_attestation`, matched by the `autopilot@` prefix
     (`AUTOPILOT_EVIDENCE_PREFIX`, the single shared definition in
     `autopilot.ts`). Anything else about the string is not parsed.
   - The mcp-bridge resolver resolves agent-cited `autopilot@`
     pointers as FAIL-CLOSED unresolved with reason
     `autopilot_attestation_unverifiable` (no IO): an agent cannot
     mint an attestation that verifies.
   - `runAutopilot` (core) constructs the `WriteResolution` inline —
     it already computes `priorHashes`:
     - qualified candidates (auto-approve attempt): one attestation
       pointer, `resolved: true` iff `priorSessionHit` (qualification
       already requires it; the pointer makes the verdict
       evidence-backed, not merely score-backed);
     - non-qualified candidates: empty resolution.
     - corpus: `approvedActive` = approved non-stale entries of the
       project excluding the candidate itself; `droppedCitedFiles`
       follows the save_memory rule (no anchor + cited files ⇒ all
       cited files dropped).
   - Composition: `entry.approval = verdict.approval`,
     `entry.confidence = verdict.confidence`,
     `auto-approve ⇔ qualified ∧ verdict.outcome === "verified" ∧
     conflict-free`. Conflict-free = `checkConflicts(candidate,
     approvedActive)` returns `unrelated` — duplicate, supersession,
     and contradiction ALL block auto-approve (the shipped rubric
     hard-flags only contradiction; autopilot IS a promotion path, so
     it adopts the approve gate's posture: a blocked row lands
     `suggested` + low + a `quarantined` sidecar carrying the
     conflict reasons and conflictIds, and the human approve gate
     remains the promotion path for those). A contradiction with
     approved memory (or an anchor miss) can no longer auto-approve —
     this closes the existing hole.
3. **Gated rows get TTL + sidecar, including autopilot-approved
   rows.** `expiresAt = createdAt + 90d` (explicit-null path does not
   exist here; both writers are engine-owned). Sidecar written via
   `setMemoryValidation` (`validatedBy: "system"`) for every gated
   row the write actually creates (best-effort, never fails the
   write). Autopilot's `validFrom`/`lastActiveAt`/marker evidence on
   approved rows are preserved.
4. **`asOf` threading on both rule readers.** `runRulesApply` and the
   GUI workspace-rules route pass `asOf: now` to
   `rankApplicableRules` — expired rules drop out exactly as in MCP
   `get_applicable_rules`. CLI `now` is injectable (`MEGA_TEST_NOW`
   pattern, default `new Date().toISOString()`); the GUI uses
   `RouteContext.now()` (already present). No new flags, no output
   format change.

## Architecture

```
CLI: mega memory from-session ──► verifyMemoryWrite (empty resolution,
                                   approvedActive corpus) ─► cap/TTL/sidecar
CLI: mega brain autopilot run ──► runAutopilot (core) ─► inline resolution
                                   (attestation ⇔ priorSessionHit) ─►
                                   verdict gates auto-approve
CLI: mega rules apply ──────────► rankApplicableRules(asOf: now)
GUI: GET /workspaces/:key/rules ► rankApplicableRules(asOf: ctx.now())
agent ─MCP─► save_memory cites "autopilot@…" ─► resolver fail-closed
                                                (autopilot_attestation_unverifiable)
```

## Components

1. `classifyEvidencePointer` + `PointerResolution` kind union — core
   `write-verify.ts`: add `autopilot_attestation` (prefix match).
   `AUTOPILOT_EVIDENCE_PREFIX` relocates INTO `write-verify.ts` (the
   classification table owns the closed-form prefixes), with
   `autopilot.ts` re-exporting it for existing importers (digest.ts
   etc.) — mirrors the `POSSIBLE_SUPERSEDES_PREFIX` relocation and
   breaks the cycle (autopilot → write-verify only).
2. `runAutopilot` gate wiring — core `autopilot.ts`: inline
   `WriteResolution`, `verifyMemoryWrite` per candidate, verdict →
   confidence/approval/TTL, `setMemoryValidation` sidecar on created
   rows (dry-run unchanged: no write, no sidecar).
3. Resolver fail-closed — mcp-bridge `write-verify-resolver.ts`: a
   `autopilot_attestation` pointer from agent input is unresolved,
   no IO.
4. CLI `memory from-session` wiring — mirror MCP amendment C with an
   empty resolution; no new imports from mcp-bridge.
5. `runRulesApply` — `asOf` via injectable `now`.
6. GUI workspace-rules route — `asOf: ctx.now()`.

## Error handling

Gate stays total: `verifyMemoryWrite` is pure; the inline resolutions
carry no IO. Sidecar writes are best-effort (try/catch) and never
fail the write. `runAutopilot` dry-run writes nothing and records
nothing. CLI exits 0/1 unchanged.

## Security & privacy

- Autopilot auto-approve now requires: policy ∧ rule-table high ∧
  cross-session recurrence AND zero contradiction with approved
  memory AND full anchor coverage of cited files. The
  "machine approves a contradicting row" hole closes; a human
  re-approval is still needed for anything the gate quarantines.
- Agents cannot forge autopilot attestations: the mcp-bridge resolver
  fails them closed; only the core engine (which computed the
  recurrence itself) can mark them resolved.
- No new network/IO surfaces. Expired-rule exclusion is read-side
  only, never deletes rows.

## Testing

TDD, red first, injected clocks (ISO strings), `.strict()` schemas.

| Area | Red test |
|---|---|
| core classifier | `autopilot@1 …` ⇒ `autopilot_attestation`; `cs-…`/ledger/notes unchanged |
| core autopilot gate | staged candidate ⇒ suggested+low+TTL+quarantined sidecar; qualified candidate with recurrence ⇒ auto-approved AND verified+high cap+TTL+valid sidecar; qualified candidate conflicting with an approved row (duplicate/supersession/contradiction) ⇒ NOT approved, quarantined with the conflict reasons+ids; anchor-miss ⇒ not approved; cap-exceeded ⇒ staged not approved; dry-run writes nothing; session_summary untouched |
| bridge resolver | agent-cited `autopilot@…` ⇒ unresolved `autopilot_attestation_unverifiable`, no IO |
| cli from-session | test_failure candidates ⇒ TTL+quarantined sidecar (mirrors MCP suite); session_summary unchanged; idempotence preserved |
| cli rules apply | expired rule excluded with injected `now`; absent-now default does not crash; `--json` parity |
| gui workspace-rules | expired overlay rule excluded via `ctx.now()` |
| regression | existing autopilot store/policy/digest suites green; `rankApplicableRules` absent-`asOf` byte-identical |

Smoke (DoD #5): captured CLI runs — `mega memory from-session` lands
quarantined+TTL rows; `mega brain autopilot run` auto-approves a
recurring failure and quarantines a contradicting one; `mega rules
apply` hides an expired rule.

## Risk & process

HIGH (§12: autopilot write path — a machine writes `approved` rows).
Full superpowers chain; worktree (no `main` edits); `architect` pass
on the spec; `code-reviewer` AND `critic` separate passes (author ≠
reviewer, fresh context); `verifier` with smoke evidence. Escalation:
any `isRecallable` change, any approved-row deletion, or weakening the
`auto-approve ⇔ verified` composition ⇒ stop and re-scope.

## Dependencies / build order

Depends on shipped: memory-write-verify (PR #359), brain-autopilot,
FORGE, evidence ledger, sweep M2. Changesets: `@megasaver/core`
(minor), `@megasaver/mcp-bridge` (minor), `@megasaver/cli` (minor),
`@megasaver/gui` (minor — workspace-rules `asOf`).
Wiki after merge: `concepts/brain-autopilot`-related page,
`structured-memory-engine` write-gate section extension, `log.md`.

## Open questions

- Should autopilot-approved rows be exempt from the 90d TTL (recurring
  knowledge may outlive 90 days)? Locked for v1: uniform 90d
  (Decision 3); revisit with field data — sweep archives losslessly
  either way.
- Should `mega memory from-session` / autopilot later cite the
  failed-attempt ledger as real evidence pointers? Deferred — needs a
  minting writer on failed-attempt records first.
