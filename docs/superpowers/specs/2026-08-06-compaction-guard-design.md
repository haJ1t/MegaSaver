---
feature: compaction-guard
date: 2026-08-06
risk: HIGH
status: draft-design
pending: [user-spec-review, architect-pass]
reviewers: [code-reviewer, critic]
build-order: "2 of 11 (next-wave batch)"
---

# Compaction Guard (B1) — Design Spec

## Problem

Claude Code auto-compaction destroys intra-session working memory: the
agent forgets which files it touched, which commands it ran, and what
the task was, then re-explores from scratch and does not consult memory
(upstream anthropics/claude-code#75759, #57486; pain P2 in
`wiki/syntheses/vibe-coding-pains-2026.md`). Mega Saver already holds
the receipts locally — every hook-captured read/command persists an
overlay chunk-set whose `source` carries the redacted file path /
command line (`packages/content-store/src/chunk-set.ts`
`overlayChunkSetSchema`; `packages/context-gate/src/record-output.ts`
`chunkSetSource`). Nothing reconnects the post-compact agent to that
evidence.

## Goal

1. **Snapshot (PreCompact):** on Claude Code's `PreCompact` hook event
   (verified real: fires on `trigger: "auto" | "manual"`; stdout ignored;
   can only observe or block — we never block), write a structured,
   secret-redacted WORK-STATE CAPSULE (≤2 000 tokens) to the store:
   session intent, files touched, commands run, chunk-set pointers.
2. **Re-inject (SessionStart, `source === "compact"`):** emit a
   one-screen "what you already did" recap via
   `hookSpecificOutput.additionalContext`, each line carrying its
   `chunkSetId` so details expand losslessly through the existing
   chunk fetch surface (`mega output chunk` / `proxy_expand_chunk`).
3. Fail-open everywhere: any failure ⇒ write nothing / inject nothing,
   exit 0 (§13.4 discipline of `saver-run.ts` / `warmup-run.ts`).

Success criteria: capsule written on simulated PreCompact; recap only
for `source === "compact"`; render ≤ 2 000 tokens (`estimateTokens`) at
any store size; no capsule ⇒ empty stdout; `pnpm verify` green.

## Non-Goals (YAGNI)

- **No transcript parsing.** `transcript_path` from the PreCompact
  payload is never read: it holds the unredacted conversation, and its
  format is not a contract. The store is the only capsule source.
- **No compaction blocking.** Never emit `{"decision":"block"}`.
- **No paraphrase/summarization of receipts.** The capsule lists
  redacted labels + pointers; content stays in chunk-sets (lossless-
  pointer philosophy, same posture as diff-on-reread's unchanged-marker).
- **No cross-session resurrection** (`mega resume` is B2, separate spec).
- **No exit-code capture.** ASSUMPTION: the PostToolUse Bash
  `tool_response` exposes no reliable exit code today — nothing in
  `apps/cli/src/hooks/` reads one. v1 lists commands without exit codes;
  wiring exit codes is a follow-up once the payload field is confirmed.
- **No decision extraction.** `openDecisions` ships as a reserved,
  always-empty field: no session-scoped decision store exists today
  (guard corpus holds failures; registry memory is project-scoped).
  A Stop-hook extractor is v2.

## Locked Decisions

1. **Trigger: `PreCompact` + `SessionStart(source === "compact")`.**
   Both verified against Claude Code hooks docs
   (code.claude.com/docs/en/hooks). The connector's supported hook set
   (`packages/connectors/claude-code/src/hook-settings.ts`
   `SettingsObject`) gains a `PreCompact` key; no matcher is written
   (omitted matcher ⇒ both `auto` and `manual` triggers).
2. **Capsule = derived view over the overlay store, not a new ledger.**
   Built by enumerating `<storeRoot>/content/<workspaceKey>/
   <liveSessionId>/*.json` chunk-sets (new `listOverlayChunkSets`,
   mirror of `listChunkSets`, `packages/content-store/src/store.ts`).
   Labels are already redacted at persist time (`record-output.ts`
   `redactedLabel`); the read-index is NOT the file-list source — it
   keys by `sha256(absPath)` and stores no raw paths.
3. **Capsule location: reserved sibling file**
   `work-state-capsule.json` next to `read-index.json` /
   `shown-index.json` in the overlay session dir. `CAPSULE_FILENAME`
   exported from content-store; skipped by `listChunkSets`,
   `listOverlayChunkSets`, and `pruneOlderThan` (same mechanism as
   `READ_INDEX_FILENAME`, store.ts L20-21/L120-121/L290-291).
4. **Keying: `(encodeWorkspaceKey(cwd), session_id)`** — identical
   derivation to the intent hook (`apps/cli/src/hooks/intent-run.ts`),
   so writer and reader can never disagree. `session_id` gated by the
   same `SAFE_SEGMENT` regex (exported from intent-run.ts).
5. **Intent source: the intent files, TTL-waived.** `readSessionIntent`
   applies a 30-min TTL (D17, ranking-specific); the capsule reads the
   raw `{prompt, ts}` record via a new `readLatestIntentRecord` and
   reports its age instead — a compaction typically lands deep into a
   long turn.
6. **Budget: `CAPSULE_TOKEN_BUDGET = 2000`** enforced in the renderer
   with `estimateTokens` (`@megasaver/output-filter`, same helper as
   `core/src/warm-start.ts`); trimming drops oldest entries first and
   appends a "+N more in store" line — pointers, never receipts, are
   dropped last.
7. **Injection envelope:** `{hookSpecificOutput: {hookEventName:
   "SessionStart", additionalContext}}` (precedent: `guard-run.ts`
   L223, `cache-advice-run.ts` L259-262; explicit > plain stdout).
8. **Two new hook subcommands**, one responsibility each (§8):
   `mega hooks capsule` (PreCompact writer) and `mega hooks recap`
   (SessionStart injector). Recap is a SECOND SessionStart entry beside
   warmup — the guard hook already proves two same-event entries keyed
   by subcommand coexist (`repairEntry`/`entryMatchesSubcommand`).

## Architecture

```
PreCompact {session_id, cwd, trigger} -> mega hooks capsule
  wk = encodeWorkspaceKey(cwd)
  listOverlayChunkSets(content/<wk>/<sid>) -> sources (redacted labels)
  readLatestIntentRecord(storeRoot, wk, sid) -> {prompt, ts}
  buildWorkStateCapsule -> redactCapsule -> atomicWriteFile
  content/<wk>/<sid>/work-state-capsule.json      (stdout: nothing)
-- compaction --
SessionStart {session_id, cwd, source:"compact"} -> mega hooks recap
  loadCapsule (exact sid; else newest capsule in <wk> ≤ 15 min old)
  renderCapsuleContext (≤2000 tok) -> additionalContext envelope
  lines carry chunkSetIds -> mega output chunk / proxy_expand_chunk
```

## Components

- **C1 `@megasaver/content-store`:** `CAPSULE_FILENAME` const +
  reserved-name skips; `listOverlayChunkSets({storeRoot, workspaceKey,
  liveSessionId}): Promise<readonly ChunkSetSummary[]>` (overlay mirror
  of `listChunkSets`; `store_corrupt` posture preserved). Public-API
  addition ⇒ changeset.
- **C2 capsule model (`apps/cli/src/hooks/capsule.ts`, pure):**
  `workStateCapsuleSchema` (Zod; version literal, capturedAt, trigger,
  intent?, filesTouched[], commandsRun[], searchCount, fetchCount,
  openDecisions[]), `capsulePath`, `buildWorkStateCapsule`,
  `redactCapsule`, `renderCapsuleContext` (budget-bounded).
- **C3 PreCompact handler (`apps/cli/src/hooks/capsule-run.ts` +
  `commands/hooks/capsule.ts`):** stdin → Zod safeParse → build →
  atomic write. Never writes stdout. Always exit 0.
- **C4 recap handler (`apps/cli/src/hooks/recap-run.ts` +
  `commands/hooks/recap.ts`):** gate `source === "compact"`, load
  capsule, render, emit envelope; `""` on every other path.
- **C5 connector install:** `addPreCompactHook` / `hasPreCompactHook` /
  `removePreCompactHook` (mirror of the SessionStart trio);
  `buildHookCommand` union + `"capsule" | "recap"`;
  `installClaudeCodeHook` gains `compactionGuard?: boolean`
  (default true, `--no-compaction-guard`); uninstall + status wired.
- **C6 intent-run.ts:** export `SAFE_SEGMENT`; add
  `readLatestIntentRecord(storeRoot, workspaceKey, sessionId?):
  {prompt, ts} | undefined` (TTL-free sibling of `readSessionIntent`).

## Error handling

- Every entry point mirrors `runSaverHookFromProcess`: outer try/catch,
  `process.exitCode = 0`, empty output on failure. A crashing PreCompact
  hook would stall every compaction — fail-open is not optional.
- Zod `safeParse` at both stdin boundaries; unsafe `session_id` ⇒ skip.
- `listOverlayChunkSets` ENOENT ⇒ `[]` ⇒ minimal capsule (intent only).
- A `store_corrupt` chunk-set throw is caught by the outer catch ⇒ no
  capsule this round (never a crash, never a partial file — atomic write
  via content-store's `atomicWriteFile`).
- Missing/stale/malformed capsule at recap ⇒ empty stdout (no injection).
- ASSUMPTION: the post-compact SessionStart keeps the pre-compact
  `session_id`. Mitigation: exact-id lookup first, then
  newest-capsule-in-workspace fallback bounded to 15 min
  (`RECAP_FALLBACK_WINDOW_MS`); wrong-session injection risk is bounded
  by the window and by the capsule being pointers-only.

## Security & privacy

- Capsule content is metadata + already-redacted labels only: chunk-set
  labels pass `policy.redact` before persist (record-output.ts L278);
  intent prompts are redacted at capture (intent-run.ts `captureIntent`).
  `redactCapsule` re-runs `redact` per string field as defense in depth.
- Never read `transcript_path`; never store raw file content or command
  output in the capsule.
- Path segments validated (`assertSafeSegment` inside content-store
  paths; `SAFE_SEGMENT` on `session_id` before it becomes a dir name).
- Injection is additive context, no instructions executed; capsule text
  is rendered from schema-validated fields only.

## Testing

TDD, red first, in `apps/cli/test/hooks/` (mimic `intent-run.test.ts`
mkdtemp/store pattern) and `packages/content-store/test/`: capsule
build (source partitioning, newest-first, path dedupe); render budget
(large synthetic capsule ⇒ ≤2000 estimated tokens, "+N more" line;
giant pasted intent prompt clamped, still within budget);
redaction of every string field; PreCompact handler (writes capsule,
malformed stdin ⇒ no file, throwing store ⇒ null); recap gating
(`startup`/`resume`/`clear` ⇒ "", `compact` ⇒ envelope with chunk ids);
fallback window with injected clock (no real timers); connector
add/remove/idempotence + install/uninstall/status round-trip.

## Risk & process

**HIGH** (§12: connector core path, public CLI surface, context
injection at session scale). Worktree mandatory; `architect` pass on
this spec; reviewers `code-reviewer` AND `critic` in separate fresh
contexts; verifier evidence: captured hook round-trip (simulated
PreCompact stdin → capsule file → simulated SessionStart stdin →
envelope) + `pnpm verify`. Escalation trigger: any change to
`filterOutput`/ranking or to compaction blocking ⇒ stop, re-spec.

## Dependencies / build order

"2 of 11 (next-wave batch)". Depends only on shipped surfaces:
content-store (BB4), overlay pipeline (#140/#181), intent hook (#180),
hook installer (PR #141). This pair OWNS `listOverlayChunkSets` (plan
Task 1, `CAPSULE_FILENAME` skip included); session-resurrection
(build-order 6) consumes it rather than re-implementing it. No daemon
change (capsule is built in-process from disk). Changesets: `@megasaver/content-store`,
`@megasaver/connector-claude-code`, `@megasaver/cli` (all minor).

## Open questions

1. Does post-compact `SessionStart` preserve `session_id`? (Locked
   fallback covers both answers; confirm empirically, then simplify.)
2. Recap on `source === "resume"` too (fresh capsule)? Deferred to B2.
3. Exit codes: claim-verification-gate (same batch) adds
   `childExitCode` to the exec-orchestrator receipt events
   (`TokenSaverEvent`, its plan Task 1); v1.1 feeds
   `commandsRun[].exitCode` by joining those receipts on `chunkSetId` —
   no second saver-side payload capture.
4. Count suppressed unchanged-reads (read-index hits) as "files
   touched"? v1: no — only persisted chunk-sets are listed.
