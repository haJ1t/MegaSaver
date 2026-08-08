---
feature: undisclosed-change-audit
date: 2026-08-06
risk: MEDIUM
status: draft-design
pending: [user-spec-review]
reviewers: [code-reviewer]
build-order: "17 of 20 (wave-2 batch)"
---

# Undisclosed-Change Audit

## Problem

An agent's end-of-turn narrative and the tree it actually touched
routinely diverge: lockfiles regenerate, configs get drive-by edits,
and files "fixed" in prose were never written. Nothing reconciles
the two. The existing hook telemetry cannot — verified: the
PreToolUse logger (`apps/cli/src/hooks/logger.ts`) **skips
Write/Edit by design** ("Anything else (Write, Edit, …) is
skipped", §13.3 category table) and its Bash lines carry no target
(only `file_path`/`path` are read from `tool_input`). `ingestHookLog`
(`packages/stats/src/metrics.ts:85`, re-exported via
`packages/core/src/context-gate.ts:43`) only counts eligible native
calls. The authoritative record is git — and the CLI already has an
injectable reader: `gatherDirtyState(cwd, execGit)` in
`apps/cli/src/git-delta.ts` (`git status --porcelain -z`,
rename-aware, `ExecGit` injection).

## Goal

Reconcile a turn's FILE-CHANGE narrative against the observed tree
delta with pure set arithmetic — no LLM judging: (1) CLAIM side —
deterministic, linear-time extraction of file paths from
caller-provided narrative text; (2) RECORD side — observed delta =
dirty worktree paths ∪ paths from commits inside the session
window; (3) both diffs — `undisclosed` (touched-but-never-
mentioned) and `phantom` (mentioned-but-untouched); (4) persisted
per-session receipt; `mega session disclosure <id>` report, `--json`.

## Non-Goals (YAGNI)

- NO transcript scraping and NO Stop-hook auto-capture in v1.
  Claude Code hook payloads carry `transcript_path`, not message
  text (repo evidence: the UserPromptSubmit fixture at
  `apps/cli/test/hooks/task-kickoff-hardening.test.ts:141` —
  no Stop fixture exists in-repo; the Stop event shares this
  envelope per the Claude Code hooks contract), and transcript
  parsing is the posture claim-verification-gate already
  rejected (its Non-Goal 1). v1 is CLI-only with explicit
  `--text-file <path>` input. Stated honestly, not hidden.
- NO hook-log write capture. Extending the logger's
  `TOOL_CATEGORY` to Write/Edit would perturb the §13.3 eligibility
  lock and the `ELIGIBLE_NATIVE_TOOLS` coupling in `ingestHookLog`.
  Out of scope; separate spec if ever wanted.
- NO fuzzy prose references ("the config", "the session module") —
  stated v1 limitation. Exact-path matching only; a claimed
  directory does not cover its children.
- NO LLM/semantic judging, no blocking, no exit-code gate
  (`--strict` deferred), no allowlist for lockfiles/generated files
  (surfacing those is the point), NO new package — all new code
  lives in `apps/cli` (claim-verification-gate's placement).

## Locked Decisions

1. **Delineation vs claim-verification-gate.** That feature audits
   SUCCESS claims ("tests pass") against exec receipts
   (`childExitCode` on `TokenSaverEvent`). This feature audits
   FILE-CHANGE narrative against the observed tree delta. Different
   claim class, different record, zero shared claim patterns — this
   spec owns its path extractor outright.
2. **Record = git, two sources.** `observed = paths from
   gatherDirtyState(cwd, execGit).statusPaths ∪
   gatherCommittedPaths(cwd, session.startedAt, session.endedAt,
   execGit)` — the latter a new export in
   `apps/cli/src/git-delta.ts` (`git log --name-only
   --since=<startedAt> [--until=<endedAt>] --format=`, parsed via
   the existing `parseNameOnly` logic, `tryGit` fail-soft). Session
   window fields verified: `startedAt: string`, `endedAt: string |
   null` (`apps/cli/src/commands/session/shared.ts`).
3. **Extractor patterns locked, linear-time.** Three match kinds:
   `backtick` (`` `…` `` spans, len 1..256; path-shaped only —
   contains `/` or a dot-extension filename), `diff-header`
   (line-anchored `diff --git a/… b/…`, `+++ b/…`, `--- a/…`),
   `bare` (`(?:[\w.@-]{1,64}/){1,8}[\w.@-]{1,64}`, ≥ 1 slash;
   diff-header lines excluded). Every quantifier bounded
   ([[concepts/unbounded-run-redos]]); input capped at
   `MAX_DISCLOSURE_INPUT_BYTES = 8_388_608` — the cap the ReDoS
   guard sizes against ([[concepts/redos-guard-testing]]).
4. **Normalization is repo-relative or dropped.** Trim quotes and
   trailing `:line[:col]`, `\` → `/`, strip `./`; absolute paths
   under `cwd` relativized; other absolutes and `..`-escapes
   dropped and counted in `droppedCandidates`. Candidates that
   `redact()` (`@megasaver/policy`) would alter (`count > 0`) are
   dropped, never persisted — a secret is not a repo path.
5. **Receipt persisted per session, atomic.**
   `<storeRoot>/disclosure/<sessionId>.json`, Zod `.strict()`
   schema, tmp+rename write (per-package atomic-writer discipline;
   cli precedent `apps/cli/src/hooks/intent-run.ts:111`).
   `sessionId` is the branded lowercase-UUID
   (`packages/shared/src/ids.ts:17`) — filename-safe by schema.
6. **One command, two modes.** With `--text-file <f>`: compute,
   persist, print. Without: re-print the last persisted receipt
   (error if none). Default exit 0 (report-only); errors follow the
   CLI policy: text → stderr, empty stdout, exit 1.

## Architecture

```
mega session disclosure <id> --text-file <f> [--json] [--store …]
  -> resolveStorePath / ensureStoreReady -> registry.getSession(id)
  -> readFile(f) <= cap -> extractClaimedPaths(text)   (Decision 3)
  -> normalizeClaimedPath(raw, cwd)       (Decision 4, drops counted)
  -> observeTreeDelta: gatherDirtyState ∪ gatherCommittedPaths
  -> reconcileDisclosure -> { undisclosed, phantom }
  -> writeDisclosureReceipt (atomic) -> table | --json

mega session disclosure <id>              (no input)
  -> readDisclosureReceipt -> print | receipt-not-found error
```

## Components

All under `apps/cli/src/commands/session/disclosure/` unless noted.

1. **`path-claims.ts`** — `MAX_DISCLOSURE_INPUT_BYTES`,
   `ClaimedPath = { path, matchKind }`, `extractClaimedPaths(text)`
   (dedup by path, first-kind-wins, ≤ 512 entries).
2. **`normalize.ts` / `reconcile.ts`** — pure
   `normalizeClaimedPath(raw, cwd): string | null` (Decision 4) and
   `reconcileDisclosure({ claimed, observed })` → sorted + deduped
   `{ claimed, observed, undisclosed, phantom }`.
3. **`git-delta.ts` (existing, cli root) + `observe.ts`** — new
   export `gatherCommittedPaths(cwd, sinceIso, untilIso, execGit):
   string[] | null` (Decision 2); `observeTreeDelta({ cwd,
   startedAt, endedAt, execGit })` unions the two git sources,
   `null` propagates "not a git repo".
4. **`receipt-store.ts`** — `disclosureReceiptSchema` (`.strict()`:
   sessionId, generatedAt, claimed, observed, undisclosed, phantom,
   droppedCandidates, inputBytes), `writeDisclosureReceipt`,
   `readDisclosureReceipt` (missing/malformed → `null`).
5. **`disclosure.ts`** — `runSessionDisclosure(input): Promise<0|1>`
   + `sessionDisclosureCommand` (citty,
   [[workflows/cli-test-pattern]] shape: env-slice + stdout/stderr
   callbacks, injectable `execGit`/`now`); registered in
   `apps/cli/src/commands/session/index.ts` `subCommands`.

## Error handling

- New helpers in `apps/cli/src/errors.ts` returning `CliMessage`:
  `disclosureInputTooLargeMessage`,
  `disclosureInputUnreadableMessage(path)`,
  `disclosureReceiptNotFoundMessage(id)`, `notAGitRepoMessage`.
  Session/store errors reuse `mapErrorToCliMessage` /
  `sessionNotFoundMessage` (kinds `sessionId` / `session`).
- Empty claimed set is NOT an error: every observed path is then
  `undisclosed` — a legitimate, reportable outcome. Malformed
  persisted receipts read as absent (report mode →
  receipt-not-found; compute mode overwrites).

## Security & privacy

- Nothing from the narrative text is persisted or echoed except
  normalized repo-relative paths that survived Decision 4;
  secret-shaped candidates are dropped via `redact()` count, never
  stored. Receipts carry path names and counts only — no content,
  no diffs, no command lines.
- Git runs via the existing hardened `ExecGit` default (3 s
  timeout, 10 MB maxBuffer, `-z` NUL parsing to defeat C-quoting,
  `apps/cli/src/git-delta.ts:7`).

## Testing (TDD — red first; detail in plan)

| Layer | Test |
|-------|------|
| extractor | per-kind positives; dedup/first-kind-wins; cap 512; non-paths rejected |
| ReDoS guard | non-vacuity (min match count) + n-vs-4n growth ratio (min-per-size, calibrated repeats, explicit timeout) + each bound proven red alone ([[concepts/redos-growth-ratio-measurement]]) |
| normalize | quotes/`:line:col`/backslash/`./`; cwd-relativize; `..` + foreign-absolute dropped; redact-drop |
| git-delta | `gatherCommittedPaths` with fake `ExecGit`: since/until args, dedup, `null` on git failure |
| observe/reconcile | union of dirty+committed; both diffs; sorted; fixture clocks only — no timing-tight assertions |
| receipt-store | atomic write (no partial file), read-back round-trip, malformed → `null` |
| CLI | compute + report modes, `--json` shape, all error paths, mkdtemp store, fake `ExecGit` |

## Risk & process

MEDIUM (§12): additive CLI reporter, no core-path change, no hooks
touched. Reviewer: `code-reviewer`. Worktree default (§4).
Escalate to HIGH if: the extractor ever runs inside a hook hot
path; receipts ever gate/block anything; or the logger's
`TOOL_CATEGORY` / `ingestHookLog` must change.

## Dependencies / build order

Build order 17 of 20 (wave-2 batch). Depends only on shipped
surfaces: core session registry (`registry.getSession`), cli
`git-delta.ts`, `@megasaver/policy` `redact` (already a cli
dependency). No new packages or deps (were one ever needed: mirror
`packages/content-store/package.json` — no pnpm catalog). Changeset
required (DoD #9: cli public surface).

## Open questions

- `--strict` (exit 1 when `undisclosed` non-empty) as a CI gate —
  deferred until a consumer exists.
- Directory-claim matching (`src/foo/` covering children) — v1
  exact-match limitation; revisit with real receipts.
- Stop-hook auto-capture: only viable if a future payload carries
  the final message text; if pursued, reuse
  claim-verification-gate's connector precedent — extend
  `buildHookCommand`'s subcommand union
  (`packages/connectors/claude-code/src/hook-settings.ts:34`) and
  add Stop-event helpers mirroring the SessionStart pair.
