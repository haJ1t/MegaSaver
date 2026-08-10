---
feature: agent-blame
date: 2026-08-06
risk: MEDIUM
status: draft-design
pending: [user-spec-review]
reviewers: [code-reviewer]
build-order: "16 of 20 (wave-2 batch)"
---

# Agent Blame (wave-2 #16)

## Problem

`git blame` answers "who wrote this line" but in the agent era the
committer is a human squashing an agent's edits. The questions that
matter — *which session wrote this, what was it trying to do, and
what did the model have in view when it wrote it* — are unanswerable
today, even though the pieces exist: the store already holds redacted
session intent (`apps/cli/src/hooks/intent-run.ts`) and lossless
overlay chunk sets per `(workspaceKey, session)`. Nothing links an
Edit/Write to them, because the PostToolUse saver matcher
(`HOOK_MATCHER`, `packages/connectors/claude-code/src/hook-settings.ts:11`)
deliberately excludes Edit/Write; only the PreToolUse guard
(`GUARD_HOOK_MATCHER`, same file L23) sees edit payloads today.

## Goal

An append-only provenance ledger: on every Edit/Write a fail-open
PostToolUse hook appends `(file, line-span, liveSessionId, agent,
intentDigest, chunkSetIds-in-view)` to a JSONL sidecar in the store —
off the rewrite path, never mutating user files. `mega blame <file>
[--line N]` re-anchors recorded spans through `git blame --porcelain`
at query time and overlays each hunk with the session, the redacted
intent that drove it, and the chunk-set evidence handles that session
had in view.

## Non-Goals (YAGNI)

- Capturing Bash-driven file mutations (no span data; guard territory).
- Following renames/moves (`git blame -M/-C`) — v1 blames the path as-is.
- Span recovery for MultiEdit/NotebookEdit — recorded file-level only
  (sequential edits shift each other; a wrong span is worse than none).
- A GUI surface, cross-repo queries, or connector coverage beyond
  claude-code.
- Rewriting or annotating user files. The ledger is a sidecar, always.

## Locked Decisions

1. **Capture on a NEW PostToolUse entry, not the saver or the guard.**
   The saver matcher excludes Edit/Write by design; the guard fires
   *before* the edit exists. A dedicated `mega hooks blame` PostToolUse
   entry with matcher `^(?:Edit|Write|MultiEdit|NotebookEdit)$` fires
   after the edit succeeded. PostToolUse payloads carry
   `session_id/cwd/tool_name/tool_input` (the saver already parses
   exactly these — `apps/cli/src/hooks/saver.ts` L322–385).
   **ASSUMPTION:** PostToolUse `tool_input` for Edit/Write carries the
   same fields the PreToolUse guard verifies today (`file_path`,
   `old_string`, `new_string`, `content`, `edits[]`, `notebook_path` —
   `guard-run.ts` L48–66, L116–120); the repo never observes Edit on
   PostToolUse, so this is schema-gated: absent fields degrade to
   file-level or no record, never a crash. `tool_response` shape is
   unverifiable and is NOT relied on.
2. **Span granularity is honest, never guessed.** `Write`: span =
   whole `content` (1..lineCount). `Edit` (not `replace_all`): read the
   post-edit file (read-only, capped at 1 MiB) and locate `new_string`;
   a unique match yields `granularity: "span"`, anything else (zero,
   multiple, empty, oversized file) records `granularity: "file"` with
   `span: null`. MultiEdit/NotebookEdit: always file-level.
3. **Intent from `readSessionIntent`** (`intent-run.ts:87`), which is
   already redacted at capture (`captureIntent` redacts via
   `@megasaver/policy` before persisting, `intent-run.ts:129`). Stored
   as `intentDigest = { digest: sha256-hex[0:12], excerpt: first 120
   chars }`. The 30-min TTL means long turns record `intent: null` —
   accepted; never store un-redacted content.
4. **chunkSetIds-in-view** = newest ≤8 `chunkSetId`s from
   `listOverlayChunkSets({storeRoot, workspaceKey, liveSessionId})` —
   owned by compaction-guard's plan Task 1
   (`docs/superpowers/plans/2026-08-06-compaction-guard.md`); consumed
   as a delivered dependency with a skip-if-present guard. Handles
   only; content stays in the lossless store.
5. **Ledger lives in `@megasaver/stats`** as `blame-event.ts`
   (`<storeRoot>/stats/<workspaceKey>/blame-ledger.jsonl`), appended
   via the package-internal `appendPrivateLine`
   (`packages/stats/src/append-line.ts:94`, owner-only 0600). The CLI
   consumes it ONLY through the existing core re-export block
   (`packages/core/src/index.ts:254–262` — "apps/cli never depends on
   @megasaver/stats directly"); `appendBlameEvent` / `readBlameEvents`
   / `blameLedgerPath` / `BlameEvent` join that block.
6. **Rotation mirrors mesh events** (session-mesh plan Task 4): rename
   `blame-ledger.jsonl` → `blame-ledger-<epochMs>.jsonl` when it
   exceeds 5 MiB (rename, never copy-truncate), keep the newest 4
   rotated files, delete older. Rotation runs under
   `withFileLock(<ledger>.lock, {deadlineMs: 50, staleMs: 5000})` from
   `@megasaver/shared/node`; a missed lock skips rotation but still
   appends (the cap is soft, the record is not). Readers skip torn or
   foreign lines per-line, never fail the read.
7. **Query-time anchoring, drift-tolerant.** `mega blame` runs
   `git blame --porcelain` through an injected
   `execGit(args, cwd) => string` (precedent:
   `apps/cli/src/commands/memory/verify.ts:33`). A ledger entry anchors
   to a hunk iff same file AND its span overlaps the hunk's final-line
   span AND the hunk's commit does not predate the record
   (`authorTimeMs + DRIFT_SLACK_MS >= entry.at`, slack 5 min;
   uncommitted `0000…` hunks always pass). Span entries that anchor
   nowhere are reported under "recorded pre-rebase (anchors drifted)";
   file-level entries render in their own section — never attached to
   specific lines. No silent misattribution, no silent drops.

## Architecture

```
PostToolUse (Edit|Write|MultiEdit|NotebookEdit)
  -> mega hooks blame  (fail-open, exit 0, no stdout)
     parse payload -> compute span (read-only file peek, capped)
     -> readSessionIntent -> digest      (already redacted)
     -> listOverlayChunkSets -> newest 8 ids
     -> appendBlameEvent (core re-export -> @megasaver/stats)
        withFileLock: rotate-if-over-cap; appendPrivateLine JSONL

mega blame <file> [--line N] [--json]
  -> execGit blame --porcelain [-L N,N]   (injected for tests)
  -> parseGitBlamePorcelain -> hunks
  -> readBlameEvents(file) across live + rotated ledgers
  -> anchorEntries -> { overlays, fileLevel, unanchored } -> render
```

## Components

1. `packages/content-store` — `listOverlayChunkSets` (skip-if-present;
   identical to compaction-guard Task 1).
2. `packages/stats/src/blame-event.ts` — `blameEventSchema` (strict),
   `blameLedgerPath`, `appendBlameEvent` (+rotation), `readBlameEvents`;
   re-exported by `@megasaver/core`.
3. `apps/cli/src/hooks/blame-run.ts` — `buildBlameEvent` (pure core,
   injected `now`/`newId`/`list`), `runBlameHookFromProcess`.
4. `packages/connectors/claude-code/src/hook-settings.ts` —
   `BLAME_HOOK_COMMAND/MATCHER`, `add/has/removeBlameHook` (PostToolUse
   sibling entry; `repairEntry` keys on subcommand so it never collides
   with the saver entry), install/uninstall/status wiring,
   `buildHookCommand` union + `blame?: boolean` install flag.
5. `apps/cli/src/commands/hooks/blame.ts` + `hooks/index.ts` +
   `install.ts` `--no-blame` flag (guard-flag precedent).
6. `apps/cli/src/blame/porcelain.ts` + `apps/cli/src/blame/anchor.ts` —
   pure parser + anchor matcher, fixture-tested.
7. `apps/cli/src/commands/blame.ts` — `runBlame` per the
   cli-test-pattern (env-slice + stdout/stderr callbacks + injected
   `execGit`), registered in `main.ts`.

## Error handling

- Capture is §13.4 fail-open: always exit 0, no stdout, any failure
  (malformed payload, unreadable file, store error, lock miss) records
  less or nothing — never blocks the tool call, never throws.
- `session_id` is gated by intent-run's `SAFE_SEGMENT` before use as a
  store path segment (`listOverlayChunkSets` input); an unsafe id still
  records the event (JSON content only) with `chunkSetIds: []`.
- Query is a user command, NOT fail-open: git errors (not a repo, bad
  path, bad `-L`) print to stderr and exit 1. Missing provenance is not
  an error — hunks render with "no recorded provenance".
- Zod at every boundary: hook stdin payload, ledger lines (per-line
  `safeParse`, skip failures), event on append.

## Security & privacy

- The ledger stores NO file content: no `old_string`/`new_string`/
  `content` — only paths, spans, ids, and the intent digest/excerpt.
- Intent excerpt derives from the already-redacted intent file; the
  digest is of the redacted prompt (never the raw one).
- Ledger + rotated files are owner-only (0600 file / 0700 dir via
  `appendPrivateLine`), matching every JSONL in the store.
- Read-only peek at the edited file stays inside the hook process and
  is size-capped; nothing is written outside `<storeRoot>`.

## Testing

- TDD per task (red first). No timing-tight tests; injected clocks,
  injected `execGit` (fixture porcelain output), injected `list`.
- Unit: span location (unique/multiple/empty/trailing-newline/cap),
  schema round-trip, rotation at cap + rotated-file pruning, torn-line
  skip, anchor overlap + drift rule + pre-rebase bucketing, porcelain
  parser (committed, uncommitted, `-L` output).
- Handler: cli-test-pattern for `mega blame` (exit codes, --json).
- Integration smoke (DoD #5): real temp git repo — edit via synthetic
  hook payload, commit, `mega blame` shows the session overlay;
  captured terminal session.

## Risk & process

MEDIUM (§12): additive capture path, fail-open, no rewrite-path or
compression changes; public CLI surface grows (`mega blame`,
`--no-blame`) but touches no user files at scale. Full superpowers
chain, worktree default, reviewer: `code-reviewer`. **Escalation:** if
implementation ends up touching the saver rewrite path, chunk-set GC,
or writing outside the store, stop and re-classify HIGH.

## Dependencies / build order

- 16 of 20 (wave-2 batch). Consumes compaction-guard plan Task 1
  (`listOverlayChunkSets`) and its Task 2 `SAFE_SEGMENT` export — both
  guarded skip-if-present, so either branch may land first.
- No pnpm catalog; workspace-protocol deps only. New edges: none
  (stats→shared, cli→core already exist).

## Open questions

1. Rename-following (`-M/-C`) — worth it once real usage shows moved
   files losing provenance?
2. Should rotated ledgers archive (compress) instead of delete at the
   rotation cap? Current answer: mirror mesh, delete oldest, stay
   honest that pre-rotation provenance is gone.
3. Other connectors (Codex/Cursor) capture — needs their hook-payload
   equivalents; out of scope until a second connector ships hooks.
