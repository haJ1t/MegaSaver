# Code-Truth Verify (i6) — Design

- **Date:** 2026-07-13
- **Status:** draft (pending architect pass)
- **Risk:** HIGH (§12 — memory schema change, connector-adjacent recall path,
  user-repo hook install). Architect pass on this spec + full gauntlet
  (code-reviewer AND critic) required before merge. The hook-install slice is
  treated CRITICAL-adjacent (writes an executable into the user's `.git/hooks`)
  — see §8.2 for its confinement rules.
- **Portfolio:** i6 from `wiki/syntheses/memory-moat-portfolio.md` (score 29).
  Sketch: `wiki/syntheses/memory-moat-sketches.md` §i6.
- **Base branch:** stacked on `feat/living-brain` (both touch
  `memory-entry.ts`, recall surfaces, and the bi-temporal fields). Retarget to
  `main` after PR #286 merges.
- **Scope decision (user, 2026-07-13):** full sketch minus GUI badges (GUI
  branch lives separately); new `"code-truth"` ProFeature key.

## 1. Problem

Memories rot silently. A memory citing `src/auth/middleware.ts#verifyToken`
stays "approved, high confidence" forever even after a refactor deletes the
function. Every recall then feeds the agent a lie. No memory tool on the
market (claude-mem, mem0, Zep, Letta) can detect that its memory became false,
name the commit that falsified it, or heal when the code reverts.

Living Brain (i1) made memory *versioned* (supersession at the human/save
boundary). Code-Truth makes it *truthful*: the repo itself becomes a verifier.

## 2. Goal

Git-anchored memories:

1. **Capture** — at save time, record what the memory claims about the code:
   file blob SHAs and symbol content hashes.
2. **Verify** — deterministically detect when the current worktree contradicts
   an anchor; name the falsifying commit.
3. **Stale + heal** — contradiction flips `stale: true` and closes `validTo`;
   a revert that restores the hash reopens the row. Never delete.
4. **Surface** — CLI table, post-commit hook, sweep pre-pass, pre-recall
   spot-check with down-ranking, savings attribution.

No LLM anywhere. CI-safe. Non-git projects degrade to unanchored gracefully.

## 3. Grounding (verified on feat/living-brain)

| Fact | Location |
|---|---|
| `relatedFiles` / `relatedSymbols` optional string arrays on memory schema | `packages/core/src/memory-entry.ts:92-93` |
| `stale: z.boolean().default(false)` exists; sweep archives stale rows | `memory-entry.ts:94`, `:253` |
| `evidence: z.array(z.string()).optional()` exists | `memory-entry.ts:91` |
| `effectiveConfidence` = confidence × ageDecay(lastActiveAt ?? updatedAt ?? createdAt) × tier | `memory-entry.ts:214-224` |
| `sweepMemoryTiers` pure-planner pattern (pure plan / impure apply) | `memory-entry.ts:236` |
| Indexer extractors are pure `(filePath, source) → ExtractedBlock[]`, publicly exported, blocks carry `contentHash`, `startLine`, `endLine`, `name` | `packages/indexer/src/index.ts:2-7`, `code-block.ts` |
| Extractor dispatch `extractorFor(path)` exists but is private | `packages/indexer/src/build.ts:46-49` |
| `ProFeature = "savings-analytics" \| "brain-portability"`; `checkEntitlement` is feature-agnostic (key = documentation) | `packages/entitlement/src/entitlement.ts:6,37` |
| CLI gate-then-upsell pattern (`MEMORY_HISTORY_UPSELL`) | `apps/cli/src/commands/memory/history.ts` |
| Guard analytics ledger precedent: dedicated append-only event file, deliberately NOT TokenSaverEvent because avoided tokens are estimates | `packages/stats/src/guard-event.ts:8-13` |
| `Project.rootPath` exists (verify knows where to run git) | `packages/core/src/project.ts:12` |
| Dependency direction: core does NOT depend on indexer today; indexer does NOT depend on core → adding `@megasaver/indexer` to core creates no cycle | both `package.json` |
| Living Brain: `lastActiveAt` stamped at create; decay keys on it | i1 spec + `registry.ts` |

## 4. Data model

New file `packages/core/src/memory-anchor.ts`:

```ts
export const fileAnchorSchema = z.object({
  path: z.string().min(1),          // repo-relative, POSIX separators
  blobSha: z.string().min(1),       // git blob SHA at capture
}).strict();

export const symbolAnchorSchema = z.object({
  path: z.string().min(1),
  name: z.string().min(1),
  startLine: z.number().int().positive(),
  endLine: z.number().int().positive(),
  contentHash: z.string().min(1),   // indexer hashText over the block span
}).strict();

export const codeAnchorSchema = z.object({
  repoHead: z.string().min(1),      // HEAD sha at capture
  capturedAt: z.string().datetime({ offset: true }),
  files: z.array(fileAnchorSchema),
  symbols: z.array(symbolAnchorSchema),
}).strict();

export const verificationResultSchema = z.enum(["verified", "contradicted", "healed"]);

export const lastVerifiedSchema = z.object({
  headSha: z.string().min(1),
  at: z.string().datetime({ offset: true }),
  result: verificationResultSchema,
}).strict();
```

Two optional fields on `memoryEntrySchema` (and its overlay/patch shapes,
mirroring how i1 added `lastActiveAt`):

- `anchor?: CodeAnchor`
- `lastVerified?: LastVerified`

Additive: legacy rows parse untouched; brain export/import flows them
automatically (schema-additive, repo-relative paths + SHAs are portable — the
destination machine's clone verifies them natively).

**Dropped from sketch (YAGNI):** `deps?: [{name, claimedVersion}]` dependency
checker. Too few `dependency`-type memories to justify it in v1.

## 5. Capture path

`captureCodeAnchor(opts): CodeAnchor | undefined` in
`packages/core/src/memory-anchor.ts`:

```ts
captureCodeAnchor({
  rootPath: string,
  relatedFiles?: readonly string[],
  relatedSymbols?: readonly string[],
  execGit?: (args: string[], cwd: string) => string,  // injectable for tests
}): CodeAnchor | undefined
```

- Runs BEFORE the sync `registry.createMemoryEntry`; the anchor rides in on
  the entry. Registry signatures stay sync and untouched.
- Per related file: `git -C rootPath rev-parse HEAD:<path>` → `blobSha`.
- Per related symbol: run the indexer extractor for the cited file
  (`extractorFor` — exported from indexer as part of this feature, one-line
  additive change) on the file's current content; match block by `name`;
  copy its `contentHash` + span. Symbol strings support two forms:
  - `path#name` — explicit file.
  - bare `name` — searched across the blocks of all `relatedFiles`.
  - No match ⇒ that symbol is skipped (not an error).
- `repoHead` = `git rev-parse HEAD`.
- **Best-effort, total:** ANY failure (not a git repo, path outside repo, git
  missing, extractor throw) ⇒ returns `undefined`, save proceeds unanchored.
  Capture must never block or fail a save.
- Files with no blob at HEAD (untracked/new) are skipped from `files`;
  if nothing anchors, return `undefined`.
- Path safety: reject (skip) any related file that normalizes outside
  `rootPath` — anchors never reference paths outside the project root.

Writers wired (all pass-through; capture stays in core):

| Writer | Behavior |
|---|---|
| CLI `mega memory create` | auto-capture when `relatedFiles`/`relatedSymbols` present; `--no-anchor` opt-out |
| CLI `mega memory update` | re-capture when relatedFiles/relatedSymbols change; `--no-anchor` opt-out |
| MCP `save_memory` | auto-capture (same rule); no opt-out flag (agents shouldn't decide) |
| CLI `task status --save-summary` | auto-capture |
| `from-session` extraction | auto-capture (entries carry relatedFiles) |

## 6. Verify engine

`packages/core/src/code-truth.ts`, pure/impure split mirroring
`sweepMemoryTiers`.

### 6.1 Pure planner

```ts
export type RepoState = {
  headSha: string;
  // path → current blob sha, or "missing"
  blobs: ReadonlyMap<string, string | "missing">;
  // path → extracted blocks of the CURRENT worktree content (only for files
  // cited by symbol anchors)
  blocks: ReadonlyMap<string, readonly ExtractedBlockLite[]>;
  // path → rename target discovered via `git diff -M` (present only when the
  // anchored path is missing and a rename was detected)
  renames: ReadonlyMap<string, string>;
  // path → falsifying commit sha (last commit touching path since anchor head)
  attribution: ReadonlyMap<string, string>;
};

export function verifyAnchors(
  entries: readonly MemoryEntry[],
  repo: RepoState,
  now: string,
): VerifyPlan;

export type VerifyPlan = {
  contradicted: Array<{ id: MemoryEntryId; reason: string; commit?: string }>;
  healed: MemoryEntryId[];
  verified: MemoryEntryId[];
  repointed: Array<{ id: MemoryEntryId; from: string; to: string }>;
  unanchored: MemoryEntryId[];
};
```

Unit-testable with fixture `RepoState`; zero git in unit tests.

### 6.2 Contradiction policy (the false-stale defense)

A file-blob change ALONE is NEVER a contradiction. Contradiction requires one
of:

1. Anchored file deleted (blob "missing") AND no rename detected.
2. Cited symbol no longer present in the file's current blocks (matched by
   `name`).
3. Cited symbol present but its `contentHash` changed.

File anchors without symbol anchors: blob change ⇒ stays `verified` (the
memory cited a file, not its exact content; only deletion-without-rename
contradicts). This is deliberate: file-level anchors are weak claims, symbol
anchors are strong claims. The unit of contradiction is the symbol hash.

Missing file first consults `renames`; a rename **repoints** the anchor
(planner emits `repointed`, applier rewrites `anchor.files[].path` /
`anchor.symbols[].path` and re-checks under the new path in the same pass) —
never flags.

### 6.3 Heal

An entry whose `lastVerified.result === "contradicted"` (or `stale === true`
with a code-truth evidence line) that now passes all checks ⇒ `healed`.
Entries passing checks with no prior contradiction ⇒ `verified`.

### 6.4 Worktree-vs-HEAD semantics (pinned)

Verification runs against **worktree content** (what the agent actually reads
when coding), not HEAD blobs — except `files[].blobSha` comparison, which uses
`rev-parse HEAD:<path>` (blob identity is a HEAD concept). Symbol re-extraction
reads the file from disk. Attribution uses history:
`git log -n1 --format=%H <anchorHead>..HEAD -- <path>` names the falsifying
commit; when the change is uncommitted (dirty tree), `commit` is absent and
the reason says `uncommitted change`. Dirty-tree flips are expected to
oscillate; healing makes that harmless and the post-commit hook only fires on
commits.

### 6.5 Impure runner

```ts
export async function runVerify(opts: {
  registry; projectId; rootPath;
  scope?: { changedPaths: string[] };   // --changed / hook mode
  now: string;
}): Promise<VerifyPlan & { applied: true }>
```

- One `git rev-parse HEAD`; one batched `git cat-file --batch-check` for all
  anchored blobs; re-extract ONLY files cited by symbol anchors (worktree
  read); `git diff --name-status -M <head>..HEAD` for renames of missing
  paths; one `git log -n1` per contradicted path (attribution).
- `scope.changedPaths` filters candidate entries to those whose anchor cites
  at least one changed path (post-commit hook: `git diff-tree --no-commit-id
  --name-only -r HEAD`).
- Applies the plan via `registry.updateMemoryEntry` (§7).
- Git spawned via `execFile` (no shell), `cwd = rootPath`.

## 7. Mutation semantics

Via existing `registry.updateMemoryEntry`, per plan bucket:

| Bucket | Mutation |
|---|---|
| contradicted | `stale: true`; `validTo: now` (only if currently open); append evidence `"code-truth: contradicted by <sha7> — <path>#<symbol> <reason>"` (or `path` alone for file anchors); set `lastVerified {headSha, at, result: "contradicted"}` |
| healed | `stale: false`; `validTo: null`; append evidence `"code-truth: healed at <sha7> — hash matches again"`; `lastVerified.result = "healed"` |
| verified | update `lastVerified` only — **no-op write suppression**: skip the write entirely when `lastVerified.headSha` is unchanged (keeps repeat verifies free and updatedAt honest) |
| repointed | rewrite anchor paths; no status change |

Invariants:

- **No `supersedesId`** — code falsified the memory; nothing superseded it.
  Lineage (i1) stays human/agent-attributed; code-truth is a parallel,
  evidence-attributed channel. `mega memory history` still shows the close
  via validTo timeline.
- **Never bump `lastActiveAt`** — verify is observation, not use. Decay must
  not treat a contradiction flip as activity (i1 keys decay on
  `lastActiveAt ?? updatedAt`; rows created post-i1 always have
  `lastActiveAt`, so the `updatedAt` bump from the flip is inert for them.
  Legacy pre-i1 rows lack `lastActiveAt` — for them the flip WOULD reset
  decay via `updatedAt`; accepted: STALE_WEIGHT ×0.3 dominates the decay
  factor it inflates, and sweep archives stale rows anyway).
- **Deterministic from repo state** — no agent-supplied field can cause a
  close. This is the structural difference from the i1 gauntlet BLOCKER
  (agent-forged `approval` + `supersedesId`): the spot-check path (§8.4) runs
  inside `get_relevant_memories`, but every flip it persists derives solely
  from `git`/disk state, never from tool arguments. An agent cannot ask for a
  close; it can only trigger a look at reality.
- Evidence strings are machine-composed from `sha7`, repo-relative path, and
  symbol name. They render in CLI `show`/`explain` only. If a future surface
  renders them into agent-facing config, the i1 `containsSentinel` guard
  applies (paths and symbol names originate from user/agent input at save
  time — treat as tainted for sentinel purposes).

## 8. Surfaces

### 8.1 `mega memory verify` (FREE)

`mega memory verify <projectId> [--changed] [--quiet] [--json] [--store <dir>]`

- Full pass (or `--changed`: diff-tree-scoped to last commit).
- Table: `3 contradicted, 1 healed, 41 verified, 12 unanchored, 2 repointed`
  + per-row: id, title, reason, falsifying commit.
- `--quiet`: print only when contradicted/healed ≠ 0 (hook mode).
- `--json`: machine shape of the plan.
- Exit code 0 always (verification is reporting, not a gate).
- Free-tier upsell: when contradictions found AND not entitled, print one
  line: hook automation is Pro (`MEMORY_VERIFY_UPSELL` const, same pattern as
  `MEMORY_HISTORY_UPSELL`).

### 8.2 `mega memory verify --install-hook | --uninstall-hook` (PRO)

Installs a post-commit hook into `<rootPath>/.git/hooks/post-commit`.

Confinement rules (CRITICAL-adjacent, non-negotiable):

- Sentinel-block idempotent write, exactly the connector-sync pattern:
  `# MEGA_SAVER_BLOCK_START` / `# MEGA_SAVER_BLOCK_END`. Existing foreign
  hook content is preserved byte-for-byte outside the block; re-install
  replaces only the block; `--uninstall-hook` removes only the block (file
  deleted only if the remainder is empty/whitespace and we created it).
- Only ever writes this one file; creates it `0755` when absent (with
  `#!/bin/sh` shebang line as part of the managed block's bootstrap when the
  file is new).
- Hook body: `mega memory verify <projectId> --changed --quiet --store <dir>
  || true` — fail-open, sub-second (diff-tree scoping), never blocks a
  commit.
- Explicit user command only (the flag IS the confirmation). Never
  auto-installed by init/doctor/connector sync.
- Gate-first: entitlement checked before any filesystem write; free tier
  prints upsell and exits 0 without touching the repo.

### 8.3 Sweep fold (PRO)

`mega memory sweep` gains a verify pre-pass (runs `runVerify`, then the
existing sweep — which already archives `stale` rows, so contradicted rows
archive in the same run with zero new sweep logic). `--no-verify` opts out.
Free tier: sweep behaves exactly as today (no verify pre-pass, no error).

### 8.4 Pre-recall spot-check (PRO)

In MCP `get_relevant_memories` (and in-process `recall`):

- Take top-5 anchored hits from the ranked result.
- mtime pre-filter: skip files whose `mtime <= anchor.capturedAt` (unchanged
  since capture); re-hash only the rest. Hard budget ~50ms — on budget
  exhaustion, remaining hits pass through unchecked (fail-open).
- Contradicted hits: down-ranked in THIS response (STALE_WEIGHT re-ordering)
  + tagged `verification: "contradicted-by-code"` in the payload; the
  stale/validTo flip is persisted asynchronously (post-response) via the same
  §7 mutations, so the NEXT recall drops the row entirely (§9 mechanism 1).
- Free tier: no spot-check; payload omits the field.

### 8.5 `mega memory show` / `explain` (FREE)

Anchor summary (n files, n symbols, captured at sha7), verification badge from
`lastVerified`, and the code-truth evidence trail.

### 8.6 MCP

- `save_memory`: captures anchors (§5).
- `get_relevant_memories`: `verification` badge per hit (`"verified" |
  "contradicted-by-code" | "unanchored"`) — badge itself is FREE (from stored
  `lastVerified`); live spot-check is PRO.
- New tool `verify_memories` (thin alias over `runVerify`, same shape as the
  CLI `--json` output). PRO (agent-triggered automation).

## 9. Ranking and recall visibility

Two distinct mechanisms — do not conflate them:

1. **Contradicted rows drop from agent recall.** The §7 `validTo: now` close
   makes `isRecallable` (i1) false, so `get_relevant_memories`, warm-start,
   and the connector block stop serving the row. This IS the Pro promise
   ("wrong memories never reach your agent") and reuses i1's validity gate
   with zero new recall logic. CLI `list`/`search`/`show` still surface the
   row with its badge (and `--as-of`/`history` show the closed period), so
   nothing vanishes from the human.
2. **`STALE_WEIGHT = 0.3`** multiplier in `effectiveConfidence` when
   `memory.stale === true` (add `stale` to the function's `Pick`). It covers
   the rows that are stale but still open/recallable: pre-existing
   user/sweep-marked stale rows, and the §8.4 in-flight demotion (the row was
   ranked before the flip persisted — this response down-ranks it; the next
   recall drops it via mechanism 1). Non-stale rows rank bit-identically to
   today.

## 10. Savings attribution (PRO)

Guard-ledger precedent (`guard-event.ts`): a dedicated append-only ledger,
deliberately NOT TokenSaverEvent (estimates must not poison measured
savings).

`packages/stats/src/code-truth-event.ts`:

```ts
codeTruthEventSchema = z.object({
  type: z.literal("stale-recall-avoided"),
  id: uuid, projectId, sessionId,
  memoryId: z.string().min(1),
  avoidedTokens: z.number().int().nonnegative(),  // token size of demoted memory
  estimated: z.literal(true),
  createdAt: datetime,
}).strict();
```

Each spot-check demotion (§8.4) appends one event. Savings insights gains a
"stale recall waste avoided: $X" line (folds in like the guard firewall
report, under the Pro savings surface).

## 11. Gating

`ProFeature` union += `"code-truth"` (`entitlement.ts:6`). No license-format
change — `checkEntitlement` is feature-agnostic; the key documents intent.

| Surface | Tier |
|---|---|
| Anchor capture (all writers) | FREE, always-on (data must accumulate for everyone or later conversion has nothing to verify) |
| `mega memory verify` one-shot + badges + show/explain | FREE |
| Post-commit hook automation | PRO |
| Sweep verify pre-pass | PRO |
| Pre-recall spot-check + async flip | PRO |
| `verify_memories` MCP tool | PRO |
| Savings "stale recall avoided" line | PRO |

Free diagnoses the disease ("3 memories contradicted by current code"); Pro is
the immune system (wrong memories never reach the agent). Organic upsell:
every free verify that finds contradictions prints the hook upsell line.

## 12. Testing

- **Pure planner:** fixture `RepoState` unit tests — contradiction ladder
  (file deleted / symbol missing / hash changed / blob-only change stays
  verified), rename repoint, heal, unanchored passthrough, dirty-tree
  attribution absence. Zero git.
- **Capture:** temp-git-repo integration test (git init, commit fixture TS
  file, capture, assert blob/symbol hashes; non-git dir ⇒ undefined; path
  escape ⇒ skipped).
- **Runner:** temp-git-repo integration — the WOW loop: save → delete symbol
  → commit → verify contradicts naming the commit → revert → verify heals.
- **Hook install:** tmp repo — install idempotence (double-install = one
  block), foreign-content preservation byte-for-byte, uninstall removes only
  block, free tier writes nothing.
- **Ranking:** stale row ranks below identical non-stale row; non-stale
  bit-identical snapshot.
- **Spot-check:** injected clock/fs — budget exhaustion passes through;
  demotion tags + async flip persisted; free tier untouched payload.
- **E2E smoke (DoD):** captured terminal session of the WOW loop through the
  real binary.

TDD per task; `pnpm verify` green; gauntlet (fresh code-reviewer + fresh
adversarial critic, opus) over full branch diff; verifier re-pass on fixes.

## 13. Out of scope (v1)

- GUI badges (GUI branch separate; fields flow through existing bridge
  automatically when it lands).
- Dependency checker (`deps` anchors).
- Cross-file symbol move detection (rename detection is file-level only).
- Anchor backfill for existing rows (accumulates organically; a `--backfill`
  could come later).
- LLM-assisted contradiction judgment. Never planned.

## 14. Risks

1. **False-stale noise** — mitigations baked in: symbol hash (not file hash)
   is the contradiction unit; blob change alone never contradicts; `git diff
   -M` repoints renames; healing makes every false flip recoverable and
   auditable.
2. **Dirty-tree flapping** — worktree semantics pinned (§6.4); hook fires on
   commits only; healing absorbs oscillation.
3. **Legacy-row decay inflation on flip** — accepted with rationale (§7).
4. **Perf** — batched cat-file; `--changed` scoping; 50ms spot-check budget
   with mtime pre-filter; per-project JSON ceiling unchanged.
5. **Hook trust** — §8.2 confinement; fail-open body; sentinel block;
   explicit command only.
6. **Competitor clone** — moat is cross-agent local store + bi-temporal audit
   trail + $-savings proof, not the git trick alone.
