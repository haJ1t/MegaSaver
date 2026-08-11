---
feature: workspace-preflight-diff
date: 2026-08-11
risk: MEDIUM
status: draft-design
pending: [user-spec-review, architect-pass]
reviewers: [code-reviewer]
build-order: "1 of 9 (wave-3 batch)"
---

# Workspace Preflight Diff (P0-1)

## Problem

A session starts and ends with no durable record of what the workspace looked like. The agent's narrative ("I only touched src/a.ts") cannot be checked against reality, and the next session re-discovers the same dirty-tree facts. Seed data exists but is scattered: `git status`, untracked files, the store's overlay chunk sets, and the per-session intent — none joined into one snapshot. Wave-2 backlog deferred `workspace-preflight` as "`pre-session world snapshot + mega preflight diff between sessions`" (`wiki/syntheses/next-wave-2-ideas-2026-08-06.md:70`), and both sweeper (P0-2) and forensics depend on it.

## Goal

1. `mega preflight snapshot [--label <text>]` captures a **workspace preflight snapshot**: git-grounded world state at a point in time — HEAD, branch, dirty diff manifest, untracked list (ignore-aware), staged/unstaged split, plus pointers to already-stored evidence (chunk sets, read-index freshness).
2. `mega preflight diff <snapA> <snapB> | --last` renders a bounded, deterministic diff between two snapshots — what changed on disk, what the agent wrote vs. narrated, and what evidence covers the delta.
3. Snapshots are the **input seam for sweeper (P0-2) and evidence-bundle (P1-1)**; this pair owns the snapshot file contract, everyone else consumes it.

Success criteria: `snapshot` succeeds on a clean and on a dirty worktree; `diff` shows staged/unstaged/untracked sections with ignore-filtered paths; snapshot is ignored by chunk-store listing and pruning; `pnpm verify` green.

## Non-Goals (YAGNI)

- No commit, no checkout, no push — read-only snapshot/diff. No auto-run on SessionStart (opt-in, explicit).
- No cross-workspace snapshot comparison (same `workspaceKey` only).
- No LLM summary of the diff (deterministic counters + path lists).
- No new retention policy — snapshots live beside content-store siblings under the existing content dir and inherit its 7-day prune sidecar; pruning behavior is documented but not changed in v1.
- No GUI surface in v1 (CLI JSON + human text only; GUI heatmap P2-1 consumes the derived counters).

## Locked Decisions

1. **Snapshot file is a reserved sibling, not a chunk-set.** Path `content/<workspaceKey>/<liveSessionId>/preflight-<ts>-<shortId>.json` (overlay) and `content/<projectId>/<sessionId>/preflight-<ts>-<shortId>.json` (registry). Single source: `PREFLIGHT_FILENAME_RE = /^preflight-\d+-[a-z0-9]{6}\.json$/`. Both `listChunkSets` / `listOverlayChunkSets` (`packages/content-store/src/store.ts`) and `pruneOlderThan` skip it — same pattern as `CAPSULE_FILENAME` / `READ_INDEX_FILENAME` (`docs/superpowers/specs/2026-08-06-compaction-guard-design.md` LD3).
2. **Snapshot keying = workspaceKey + session scope.** `workspaceKey = encodeWorkspaceKey(project.rootPath)` (`@megasaver/shared`), `sessionId` gated by `SAFE_SEGMENT` (`apps/cli/src/hooks/intent-run.ts:35`). `resolveSnapshotTarget` mirrors `locateChunkSet`/`readOverlaySummary` split: registry vs overlay, identical to `gatherResumeSources` (`docs/superpowers/specs/2026-08-06-session-resurrection-design.md` LD4). Snapshot without a registered project is refused (`error: no registered project for this workspace`).
3. **Git is the ground truth; store is the evidence overlay.** Snapshot captures: `headOid`, `branch` (or `detached:headOid`), `staged: {name,status,hash}[]`, `unstaged: {name,status,hash}[]`, `untracked: string[]` (ignore-filtered via `@megasaver/policy` ignore helpers and `git check-ignore` fallback), `added/modified/deleted` counters, `snapshotAt` ISO, `capturedBy`, `label`. Git interaction reuses `apps/cli/src/hooks/intent-run.ts` git discovery (`findGitRoot`, `getGitBranch`) and a bounded `git -C <root> status --porcelain=v1 -uall -z` + `git rev-parse HEAD` + `git rev-parse --abbrev-ref HEAD` executed via `execFile` with 2s timeout — never hung, never shell-interpolated.
4. **Dirty-diff is a manifest, not a patch body.** `staged`/`unstaged` entries record path + short status + blob hash (from `git ls-files -s` + `git diff-index`), not full hunks. Bodies stay losslessly in chunk-sets already captured by the saver hook (`packages/context-gate/src/record-output.ts`). `mega preflight diff` joins snapshot A→B manifests and shows sectioned path lists (≤ 200 paths per section, remainder "+N more") — deterministic, token-bounded like `renderCapsuleContext` (`apps/cli/src/hooks/capsule.ts:524`).
5. **Ignore-aware untracked.** Untracked list is filtered through the same ignore set the indexer uses (`packages/indexer/src/scan.ts` ignore loader) and `git check-ignore` stdout as tie-breaker, so `.megasaver/`, `node_modules/`, `dist/` never appear. Exact allow-list lives in `packages/content-store/src/store.ts` skip + a new `preflight-scan.ts` ignore helper that shares the indexer pattern set.
6. **Deterministic ordering.** Every array in the snapshot is lexicographically sorted by path; `snapshotId = preflight-<epochMs>-<6-char base36 rand>` ensures stable file name and total order. Diff output is sorted, diff of identical snapshots is empty with exit 0 (not an error).
7. **Storage ownership.** `@megasaver/content-store` owns the filename regex + skip lines and exports `listPreflightSnapshots` (overlay + registry mirrors) + `readPreflightSnapshot`. `apps/cli` owns the git capture and diff renderer. No other package imports content-store internals directly.

## Architecture

```
mega preflight snapshot [--label "before fix"]
  resolveStorePath + ensureStoreReady
  findProjectByCwd -> workspaceKey + projectId + gitRoot
  gitCapture(root, 2000ms): rev-parse HEAD/branch + status -z + ls-files -s
  buildPreflightSnapshot({git, counters, workspaceKey, sessionId, now})
  atomicWriteFile(content/<wk>/<sid>/preflight-<ts>-<id>.json)

mega preflight diff <a> <b> | --last
  listPreflightSnapshots({storeRoot, workspaceKey|projectId, sessionId?})
  pick two snapshots (explicit ids or two newest in workspace)
  readPreflightSnapshot both (Zod strict)
  renderPreflightDiff(a,b): sectioned path lists + chunk-set delta join
  stdout: human text (default) | --json single object
```

## Components

- **C1 `@megasaver/content-store`:** `PREFLIGHT_FILENAME_RE`, `PREFLIGHT_DIR` helpers, `listPreflightSnapshots` (registry + overlay), `readPreflightSnapshot`, skip in `listChunkSets`/`listOverlayChunkSets`/`pruneOlderThan`. Schema `preflightSnapshotSchema` (Zod strict) lives here.
- **C2 `apps/cli/src/preflight/snapshot.ts` (pure):** `buildPreflightSnapshot`, `comparePreflightSnapshots`, `renderPreflightDiff`, `parsePreflightId`. No I/O, no git.
- **C3 `apps/cli/src/preflight/git-capture.ts`:** `captureGitState(gitRoot, opts): Promise<GitState>` — execFile wrappers, timeout, parse `-z` status into staged/unstaged/untracked.
- **C4 `apps/cli/src/commands/preflight/*`:** citty commands `snapshot` + `diff`, io-injected `runPreflightSnapshot` / `runPreflightDiff` (pattern: `runResume`, `apps/cli/src/commands/resume/index.ts:19`).
- **C5 `apps/cli/src/main.ts`:** register `preflight` subcommand with two children.

## Error handling

- Git absent / outside a repo → snapshot still writes with `git: {available:false, reason}` + empty staged/unstaged/untracked; diff still works (counters zero). Exit 0 with stderr warning — fail-open like `runCapsuleHook` (`apps/cli/src/hooks/capsule-run.ts:722`).
- Unknown snapshot id → `error: snapshot "<id>" not found` exit 1 (mirrors `runResume`).
- `--last` with <2 snapshots → `error: need two snapshots to diff` exit 1.
- Malformed snapshot file → `readPreflightSnapshot` returns `null` and that side becomes `(unreadable)` in diff, never throws into the command.
- Store path unsafe / no project match → `error: no registered project for this workspace; run mega project create` exit 1 (workspace-key-parity, `docs/superpowers/specs/2026-08-06-session-resurrection-design.md` LD6).

## Security & privacy

- Snapshot paths are hash-derived (`encodeWorkspaceKey`) + `SAFE_SEGMENT` gated; no raw cwd in file name.
- Untracked paths are redacted once via `redact()` (`@megasaver/policy`) at build time — secrets in file names (e.g., `keys/aws-secret.txt`) become `[REDACTED]`. No file contents are read.
- Git command args are argv arrays, never shell strings; `git -C` confines to the repo root (no path traversal).
- Snapshots are local-store only, owner-only mode 0700/0600 via `atomicWriteFile` (same as `writeIntentAt`, `apps/cli/src/hooks/intent-run.ts:102`).

## Testing

- **Unit (TDD, red first):** snapshot schema strictness (extra key rejects), deterministic sorting (shuffle in → sorted out), compare (identical → empty diff; only-untracked→ staged-empty), renderer caps (200-path trim → "+N more"), git parser (crafted `status -z` bytes → staged/unstaged/untracked split), ignore filter (node_modules/.megasaver skipped).
- **Integration:** seeded tmp store + tmp git repo (`git init` + commits) → `runPreflightSnapshot` writes a valid file skipped by `listOverlayChunkSets`; `runPreflightDiff` shows staged file after `echo >> file`; `--json` parses; `listPreflightSnapshots` returns sorted newest-first.
- **Regression:** pre-existing `listOverlayChunkSets` / `pruneOlderThan` still pass with snapshot files present.

## Risk & process

**MEDIUM** (§12: touches git at `execFile` boundary + content-store listing, but no delete/move, no hook mutation). Work in worktree; `architect` pass required per HIGH? — MEDIUM branch: `code-reviewer` only, but architect review recommended due to content-store skip coupling. `pnpm verify` + CLI smoke (snapshot → diff on a temp repo) required before merge.

## Dependencies / build order

- Builds on shipped: content-store BB4 (`CREATED` skips), `encodeWorkspaceKey`, `SAFE_SEGMENT`, `atomicWriteFile`, `findProjectByCwd`.
- Owned by this pair: `PREFLIGHT_FILENAME_RE` + `listPreflightSnapshots` family.
- Consumed by: **P0-2 sweeper** (quarantine manifest = diff of current vs last snapshot) and **P1-1 evidence-bundle** (snapshot ids become bundle lineage). Build order **1 of 9 (wave-3 batch)** — no earlier wave-3 dependency.

## Open questions

1. Should `snapshot --auto` run on SessionStart (PostToolUse aside) via an opt-in hook, or stay manual? (v1 manual; hook is follow-up.)
2. Snapshot prune age = chunk-set prune (7 days) or longer (14 days) to keep diff horizon? (v1 inherits content-store default.)
