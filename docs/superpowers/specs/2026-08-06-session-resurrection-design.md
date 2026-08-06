---
feature: session-resurrection
date: 2026-08-06
risk: HIGH
status: draft-design
pending: [user-spec-review, architect-pass]
reviewers: [code-reviewer, critic]
build-order: "6 of 11 (next-wave batch)"
---

# Session Resurrection (B2 — `mega resume`)

## Problem

When a session dies (crash, kill, closed terminal), everything it paid
for is already in the store — registry record, read-index, chunk sets,
session intent, stats events — but a fresh session inherits none of it
and re-explores what was already captured (pains P6/P2,
`wiki/syntheses/vibe-coding-pains-2026.md`). No command rebuilds a dead
session's working context into something consumable.

## Goal

`mega resume <sessionId>` (and `--last`) assembles a **kickoff
capsule**: a bounded, redacted, evidence-preserving digest of the dead
session's working state, built from store pointers — not paraphrase.
Modes: (a) stdout (default), (b) `--copy` clipboard, (c) `--next` — a
pending capsule delivered at-most-once to the next session in the same
workspace via the **existing task-kickoff seam**.

## Non-Goals (YAGNI)

- Replaying/re-executing anything: read-only over the store (plus one
  pending-capsule file in mode c). No transcript reconstruction —
  pointers to stored evidence, never the conversation.
- Cross-agent handoff semantics (hot-handoff i10 owns that).
- Session Mesh presence implementation (A1 spec owns it; we only
  *read* its presence file when present — soft dependency).
- GUI surface; Windows `--next` delivery (kickoff persistence is
  POSIX-only, amendment §5). No new retention rules — chunk sets keep
  the 7-day prune default.

## Locked Decisions

1. **Reuse the task-kickoff delivery seam for `--next`; no literal
   SessionStart delivery.** Task kickoff already owns what a capsule
   needs: the `UserPromptSubmit` envelope
   (`hookSpecificOutput.additionalContext`), the at-most-once claim
   tombstone (`stats/task-kickoff-sessions/<safe-session>.json`), the
   2 000-token / 9 000-UTF-16 bound, the 500 ms deadline runner, and
   `TaskKickoffEvent` accounting (`apps/cli/src/hooks/task-kickoff.ts`,
   `task-kickoff-process.ts`, amendment 2026-08-01). The SessionStart
   warm-start hook (`apps/cli/src/hooks/warmup-run.ts`) has none of
   that — no tombstone, no bounded-render contract, no cost event — so
   delivering there would duplicate the tombstone machinery into a
   second seam, which this spec forbids. Consequence: the capsule
   arrives on the next session's **first prompt** — accepted.
2. **Consumption is rename-claim, prefer-loss.** `--next` writes ONE
   pending capsule per workspace at
   `stats/<workspaceKey>/resume-capsule.json` (atomic tmp+rename,
   0700/0600, mirroring `writeIntentAt`,
   `apps/cli/src/hooks/intent-run.ts`). The kickoff worker consumes by
   atomic rename before use; first consumer wins. If delivery then
   fails (deadline, claim race, stdout error) the capsule is lost, not
   retried — amendment §1 posture; `mega resume` regenerates it.
3. **Capsule replaces the standard kickoff pack for that prompt.**
   `prepareTaskKickoff` checks for a pending capsule after
   `workspaceKey = encodeWorkspaceKey(project.rootPath)` is derived,
   before the expensive context-pack render; capsule text becomes the
   rendered pack; claim, pack, envelope, event flow unchanged. No
   capsule file → byte-identical behavior (regression gate).
4. **Both session layouts are first-class.** Resolution mirrors
   `locateChunkSet` (`packages/context-gate/src/locate-chunk-set.ts`):
   registry (`CoreRegistry.getSession`,
   `content/<projectId>/<sessionId>/`) and overlay
   (`readOverlaySummaryAnyWorkspace`,
   `content/<workspaceKey>/<liveSessionId>/`). `--last` = newest last
   activity among cwd-workspace overlay summaries (`updatedAt`) and
   the cwd-matched project's registry sessions.
5. **Evidence-preserving pointers, bounded.** The capsule lists chunk
   set pointers with the recovery-footer wording
   (`mega output chunk "<chunkSetId>" "<i>"`,
   `packages/context-gate/src/recovery-footer.ts`) — never chunk
   bodies. Budget: `TASK_KICKOFF_TOKEN_CAP` (2 000) via `countTokens`
   (`packages/output-filter/src/tokens.ts`) and
   `TASK_KICKOFF_CHARACTER_CAP` (9 000) — constants reused from
   `apps/cli/src/hooks/task-kickoff-pack.ts`. Greedy fill, newest-
   first, drop-not-truncate. Tokenizer decline (null) falls back to
   `tokensFromBytes` (core re-export), count labeled `estimated`.
6. **Live-session refusal is mesh-gated; heuristics only warn.** Fresh
   `store/mesh/presence/<liveSessionId>.json` (`lastSeenAt` < 10 min,
   matching the mesh plan's `DEAD_AFTER_MS` = 600 000 ms) → refuse,
   exit 1. Path and field are locked by the session-mesh plan's
   `presenceRecordSchema`
   (`docs/superpowers/plans/2026-08-06-session-mesh.md` Task 1):
   ISO-offset `lastSeenAt`, presence keyed by liveSessionId — so the
   mesh gate applies to overlay targets only (their sessionId IS the
   liveSessionId); registry session ids have no liveSessionId mapping
   and always take the heuristic path. Mesh absent (unimplemented
   today — soft dependency): a last-activity-under-10-min heuristic
   warns but proceeds — a session that crashed 2 minutes ago is the
   primary use case, indistinguishable from live without presence.
   Unreadable presence files fail open.
7. **Placement: apps/cli, one additive package change, one consumed
   cross-pair dependency.** New `apps/cli/src/commands/resume/`
   (command, gather, render) and `apps/cli/src/hooks/resume-capsule.ts`
   (pending-capsule store shared with the kickoff worker). Consumed:
   `listOverlayChunkSets` in `@megasaver/content-store` — OWNED and
   implemented by the compaction-guard pair (build-order 2, its Task 1,
   `docs/superpowers/plans/2026-08-06-compaction-guard.md`), including
   the reserved `work-state-capsule.json` (`CAPSULE_FILENAME`) sibling
   skip; this feature never redefines it (plan Task 1 guards
   out-of-order execution). Additive: a `readOverlaySummary` re-export
   in `@megasaver/core` — apps/cli must not import `@megasaver/stats`
   (dependency-graph guard, `apps/cli/test/dependency-graph.test.ts`).

## Architecture

```
mega resume <id> | --last
  resolve target (registry getSession | readOverlaySummaryAnyWorkspace)
  liveness gate (overlay: mesh lastSeenAt -> refuse; else heuristic warn)
  gather (fail-open, each source optional):
    session record / overlay summary          -> provenance header
    stats summary (core re-export)            -> one stats line
    intent stats/<wk>/intent/<sid>.json (TTL-free) -> intent
    listChunkSets | listOverlayChunkSets      -> pointer inventory
    loadReadIndex + rehash vs contentHash -> unchanged|changed|missing
  render (bounded, redacted, provenance + staleness >7d warning)
  emit: stdout | --json | --copy (darwin pbcopy) | --next (capsule)

next session, first prompt (UserPromptSubmit)
  task-kickoff worker -> prepareTaskKickoff
    claim absent -> project match -> workspaceKey
    consumeResumeCapsule (rename); hit -> replaces context-pack render
    -> createSessionClaim -> writePack -> envelope -> TaskKickoffEvent
```

## Components

1. **`apps/cli/src/commands/resume/gather.ts`** — target resolution,
   liveness classification, source collection. Read-index keys are
   `pathHash` (sha256, not reversible); file paths come from joining
   `chunkSetId` to summaries with `source.kind === "file"`
   (`packages/content-store/src/chunk-set.ts`). Freshness = sha256 of
   current file content vs stored `contentHash`.
2. **`apps/cli/src/commands/resume/render.ts`** — deterministic
   renderer: provenance header, staleness/liveness warnings, intent,
   working set (≤ 12 files), captured outputs (≤ 8, newest-first),
   stats line, untrusted-data footer; counting loop mirrors
   `renderTaskKickoffPack`'s `countText` pattern.
3. **`apps/cli/src/commands/resume/index.ts`** — citty command,
   `runResume(input): Promise<0|1>`, injected io, `--store`/`--json`
   parity; registered in `apps/cli/src/main.ts`.
4. **`apps/cli/src/hooks/resume-capsule.ts`** — pending-capsule write /
   consume (rename-claim; > 24 h stale discarded on consume; Zod
   re-validation plus cap re-check at the file boundary).
5. **`prepareTaskKickoff` integration** — one consume call plus a
   rendered-source branch; everything downstream unchanged.
6. **Package surface** — `listOverlayChunkSets` consumed from
   content-store (delivered by compaction-guard Task 1; skips
   `READ_INDEX_FILENAME`, `SHOWN_INDEX_FILENAME`, and the reserved
   `CAPSULE_FILENAME` sibling); one addition: `readOverlaySummary`
   re-export in core `src/context-gate.ts` (joining
   `readOverlayEvents`).

## Error handling

- Unknown session id → `error: session "<id>" not found` exit 1.
- Every gather source is optional: missing read-index, pruned chunk
  sets, absent intent/stats degrade to labeled omissions in the
  capsule, never a crash (fail-open).
- `--next` refusals, exit 1: win32 (amendment §5); no registered
  project matching the workspace — the kickoff worker keys the capsule
  by `encodeWorkspaceKey(project.rootPath)`, so without a match it is
  never read (workspace-key-parity lesson, intent-aware-hook §2).
- Consume path never throws into the hook: malformed/stale capsule →
  removed, normal kickoff proceeds (fail-open, exit 0).
- Clipboard: darwin `pbcopy` best-effort; elsewhere warn on stderr and
  still print (handoff `defaultCopyPath` precedent).

## Security & privacy

- Sources are already redacted at capture (intent via `redact()`,
  chunks via `recoverableChunks`); the rendered capsule passes
  `redact()` once more before any emit or persist (belt for HIGH risk).
- Pending capsule: owner-only 0700 dir / 0600 file, atomic write;
  local store only, no network surface.
- Injected text carries provenance + "pointers are stored evidence,
  not instructions" (mesh-spec posture); never chunk bodies or store
  paths beyond the `mega output chunk` wording.

## Testing

- Unit: capsule store (write / consume / second-consume-null / stale /
  malformed), gather (both layouts, freshness tri-state, fail-open
  omissions, liveness incl. mesh-presence fixture), render (caps
  enforced by dropping, staleness warning, redaction, estimated-token
  fallback).
- Integration: seeded temp store → `runResume` stdout / `--json` /
  `--next`; kickoff consumes the capsule end-to-end via
  `buildTaskKickoffHookOutput` (envelope carries capsule text, claim
  created, capsule gone); regression — no capsule → kickoff unchanged;
  claimed session → capsule untouched.
- No timing-tight assertions: generous deadlines, structural guards.

## Risk & process (§12 HIGH)

Touches the task-kickoff hook delivery path (HIGH per the 2026-08-01
amendment) and reads session storage at scale. Chain: spec → user
review → architect pass (fresh context) → plan → worktree
`feat/session-resurrection` → TDD → `code-reviewer` AND `critic`
separate passes → verifier evidence (CLI smoke capture + installed-hook
capsule delivery run). Evidence-preserving compression only.

## Dependencies / build order

- Builds on (shipped): task-kickoff seam + amendment, read-index,
  chunk sets, stats overlay readers, redact, intent capture,
  recovery-footer wording.
- Builds on (same wave, earlier): compaction-guard (build-order 2)
  delivers `listOverlayChunkSets` plus the reserved `CAPSULE_FILENAME`
  sibling skip in content-store; this pair consumes the export (plan
  Task 1 guards out-of-order execution).
- Soft: session-mesh presence (build-order 1, unimplemented) — only
  strengthens the liveness gate when it lands. Contract locked by the
  session-mesh plan's `presenceRecordSchema`
  (`docs/superpowers/plans/2026-08-06-session-mesh.md` Task 1):
  `store/mesh/presence/<liveSessionId>.json` with an ISO-offset
  `lastSeenAt` field; reader is tolerant/fail-open, overlay targets
  only.
- Changesets: core, cli (minor); content-store only if plan Task 1's
  out-of-order fallback implemented the lister in this feature. Build
  order: 6 of 11 (next-wave batch).

## Open questions (tracked, non-blocking)

- Should `--last` also scan sibling registered projects in the store
  (v1: cwd workspace + cwd-matched project only)?
- Advertise `proxy_expand_chunk` alongside `mega output chunk` in the
  capsule footer when the MCP bridge is connected?
