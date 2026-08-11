---
feature: conversation-fork-time-travel
date: 2026-08-11
risk: HIGH
status: draft-design
pending: [user-spec-review, architect-pass]
reviewers: [code-reviewer, critic]
build-order: "8 of 9 (wave-3 batch)"
---

# Conversation Fork & Time-Travel (P2-3)

## Problem

A user tries a risky instruction, regrets it, and wants to compare "what if I had said X instead" without losing the current session's evidence. Today the session is linear: compaction already has a capsule (wave-1 `compaction-guard`), but there is no **branch** primitive. Agents cannot A/B two prompts from the same fork point, and the user cannot rewind to a clean pre-prompt snapshot to try an alternative. P2 pains compaction amnesia and re-discovery tax (`wiki/syntheses/vibe-coding-pains-2026.md:22-30`) need a fork, not just a recap.

## Goal

1. `mega fork snapshot [--label <text>]` writes a **fork point**: a preflight snapshot (P0-1) + the current work-state capsule (compaction-guard shape) + the last intent, atomically as `store/forks/<forkId>/snapshot.json`.
2. `mega fork list | show <id> | diff <a> <b>` manages fork points (deterministic, sorted, bounded).
3. `mega fork resume <id> [--next]` materializes the fork point as a resume capsule (P0 `session-resurrection` seam `stats/<wk>/resume-capsule.json`) so the **next session** starts from the forked context via the existing task-kickoff envelope — the same as `mega resume --next` but seeded from a fork, not a dead session.

Success criteria: snapshot at t0, make a file change, snapshot at t1, `fork diff` shows the file; `fork resume` + next prompt delivers the forked capsule deterministically; `pnpm verify` green.

## Non-Goals (YAGNI)

- No in-process session rewind (the current shell is never mutated); fork is a persisted point the *next* session opts into.
- No branch graph beyond a flat list (no parent pointer in v1; follow-up adds DAG).
- No transcript rewrite — evidence only (chunkSets + intent + snapshot), never raw conversation.
- No GUI in v1.

## Locked Decisions

1. **Fork point = joined derived view.** `ForkPoint = { version:1, forkId:string, createdAt:string, label?:string, workspaceKey:string, git:GitState, preflightSnapshotId:string, capsule:WorkStateCapsule|null, intent:{prompt,ts}|null, lineage:{storeRootHash, indexHash} }`. Built by calling `buildPreflightSnapshot` (P0-1) + `buildWorkStateCapsule` (compaction-guard) + `readLatestIntentRecord` — no new capture logic, just composition.
2. **Storage = `store/forks/<forkId>.json` (store-global) + `store/stats/<wk>/fork-index.json` (per-workspace pointer list).** `forkId = <epoch>-<6id>` same generation as preflight. Fork files are reserved siblings ignored by `listChunkSets`/`pruneOlderThan` (third reserved regex alongside `PREFLIGHT_FILENAME_RE` and `CAPSULE_FILENAME`).
3. **Resume = reuse resurrection capsule.** `fork resume` writes the existing pending capsule file `store/stats/<wk>/resume-capsule.json` via `writeResumeCapsule` (session-resurrection P0, `apps/cli/src/hooks/resume-capsule.ts:282`) after rendering the fork's capsule through `renderCapsuleContext` + `renderPreflightDiff` into one text. The task-kickoff worker consumes it unchanged (`docs/superpowers/plans/2026-08-06-session-resurrection.md` Task 7) — no second seam.
4. **Flat list, deterministic order.** `list` returns newest-first; `diff` is the same renderer as `renderPreflightDiff` (P0-1) plus capsule entry counts. No merge, no conflict.
5. **Safety: fork never overwrites a pending resume capsule.** If `resume-capsule.json` already exists, `fork resume` refuses `error: a resume capsule is already pending; clear it or wait` exit 1 (same at-most-once gate as `mega resume --next`).
6. **Ownership.** `apps/cli` owns all fork commands + the `forks/` helpers; `@megasaver/content-store` only adds the `FORK_FILENAME_RE` skip (one line each in listers/pruner). No new package.

## Architecture

```
mega fork snapshot --label "before risky edit"
  captureGitState + buildPreflightSnapshot -> atomicWrite preflight sibling
  buildWorkStateCapsule + readLatestIntentRecord
  buildForkPoint -> atomicWrite store/forks/<id>.json + append fork-index.json

mega fork resume <id> --next
  read fork point (Zod strict) -> renderForkCapsuleText -> writeResumeCapsule
  (next Session: task-kickoff consumes -> envelope.additionalContext)

mega fork list/diff/show -> read forks/*.json, sort, render
```

## Components

- **C1 `packages/content-store/src/store.ts`:** `FORK_FILENAME_RE` + skip lines (additive, one bool per lister/pruner).
- **C2 `apps/cli/src/fork/model.ts` (pure):** `forkPointSchema`, `buildForkPoint`, `renderForkCapsule`, `diffForkPoints`.
- **C3 `apps/cli/src/commands/fork/{snapshot,list,show,diff,resume,index}.ts`:** citty `mega fork` with five children; io-injected runners.

## Error handling

- No project match / no git → fork still writes with `git: {available:false}` and empty capsule (fail-open for git, but fork file still created — provenance degrades, not fails).
- Unknown forkId → `error: fork "<id>" not found` exit 1.
- Pending capsule exists on `resume` → exit 1, hint `mega resume --clear` if that command exists, else `rm store/stats/<wk>/resume-capsule.json`.
- Malformed fork file → read returns null, that fork omitted from `list` with stderr warning count.

## Security & privacy

- Fork point is redacted once at build time (paths + intent prompt via `redact()`); raw conversation never stored.
- Fork files 0600, fork dir 0700; `resume-capsule.json` owner-only (same as resurrection).
- No network.

## Testing

- **Unit (TDD):** `buildForkPoint` composition (preflight + capsule + intent → hash-stable), `renderForkCapsule` bounded (< 2000 tokens), `diffForkPoints` shows added file, `FORK_FILENAME_RE` skip, pending-capsule refusal on resume.
- **Integration:** tmp store+git → `runForkSnapshot` writes fork + preflight sibling (preflight sibling ignored by chunk listing); `runForkResume` writes resume capsule; kickoff consumes it and envelope carries fork label; `list` sorted newest-first.

## Risk & process

**HIGH** (§12: touches hook-adjacent capsule + pending-capsule seam that sits on the `UserPromptSubmit` critical path; content-store skip coupling). Worktree mandatory; `architect` + `critic` separate passes; `security-reviewer` not required (no path traversal beyond existing `SAFE_SEGMENT`). Full `pnpm verify` + captured hook round-trip (snapshot → resume → next prompt shows fork) required.

## Dependencies / build order

- Requires **P0-1 preflight** and **compaction-guard capsule** (wave-1, `docs/superpowers/specs/2026-08-06-compaction-guard-design.md`) for composition; consumes **session-resurrection resume capsule** seam (reuse, no fork).
- Independent of P0-2/P0-3/P1-1 but strongest when they exist (fork diff gains richness).
- Build order **8 of 9 (wave-3 batch)**.

## Open questions

1. Flat list vs DAG parent pointer — add `parentForkId` now or v2? (v1 flat.)
2. Should `fork snapshot` also write an undo handle for the post-fork file writes (join with P0-2 quarantine)? (v1: no join; P0-2 is manual.)
