# Code-Truth Verify (i6) — Design

- **Date:** 2026-07-13
- **Status:** architect pass applied (verdict APPROVE-WITH-FIXES; B1 + M1–M5 +
  N1–N7 integrated, 2026-07-13)
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
| Indexer extractors are pure `(filePath, source) → ExtractedBlock[]`, publicly exported, blocks carry `contentHash`, `startLine`, `endLine`, `name` (optional, non-unique) | `packages/indexer/src/index.ts:2-7`, `code-block.ts:26` |
| Indexer's own `extractorFor` dispatches only TS/JS/MD/JSON (architect M2) — the POLYGLOT dispatch (ts/js/py/go/rs/md/json) lives in output-filter, private | `packages/indexer/src/build.ts:46-49`; `packages/output-filter/src/parsers/outline.ts:15-26` |
| `relatedSymbols` is read by 4 surfaces but written by NO writer (architect M1) | `create.ts:170`, `update.ts:157`, `save-memory.ts:51` |
| Agent-recall rankers exclude stale rows outright (STALE_WEIGHT can't fire there) | `memory-search.ts:65`, `get-relevant-memories.ts:71` |
| `updateMemoryEntry` = full-store read + rewrite under dir lock, per call | `json-directory-registry.ts:334-337`, `json-directory-store.ts:132-157` |
| Bridge dispatch is pure request→response; no post-response lifecycle | `mcp-bridge/src/server.ts:289-291` |
| `ProFeature = "savings-analytics" \| "brain-portability"`; `checkEntitlement` is feature-agnostic (key = documentation) | `packages/entitlement/src/entitlement.ts:6,37` |
| CLI gate-then-upsell pattern (`MEMORY_HISTORY_UPSELL`) | `apps/cli/src/commands/memory/history.ts` |
| Guard analytics ledger precedent: dedicated append-only event file, deliberately NOT TokenSaverEvent because avoided tokens are estimates | `packages/stats/src/guard-event.ts:8-13` |
| `Project.rootPath` exists (verify knows where to run git) | `packages/core/src/project.ts:12` |
| Core already depends on output-filter, which depends on indexer → extractors reachable with NO new dependency edge (architect M2) | `core/package.json:30` |
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
  // Close ownership (architect B1): true ONLY when the contradiction mutation
  // itself closed validTo (found the row open). Heal may reopen validTo only
  // when this is true — a close owned by the lineage channel (supersession,
  // manual close) is never stomped by a code-truth heal.
  closedByCodeTruth: z.boolean(),
}).strict();
```

Two optional fields on `memoryEntrySchema` AND explicitly on
`memoryEntryUpdatePatchSchema` AND the overlay entry schema (all three are
`.strict()` — `memory-entry.ts:325,350` — and `updateMemoryEntry` re-parses
the full entry, so omitting the patch/overlay additions makes every §7
mutation and every anchor repoint a runtime Zod rejection; architect N1):

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
- Per related symbol: extract blocks from the cited file's current content
  using the **output-filter polyglot dispatch** (the private `extractorFor`
  in `packages/output-filter/src/parsers/outline.ts:15-26`, exported from
  output-filter's public surface as part of this feature — small additive
  change). Core already depends on output-filter, so NO new `core → indexer`
  dependency is added (architect M2). **Supported languages: TS/JS
  (mts/cts/tsx/jsx/ts/js/mjs/cjs), Python, Go, Rust, Markdown, JSON.** Other
  extensions get file anchors only (no symbol anchors) — stated limitation,
  not an error.
- Match block by `name`; copy its `contentHash` + span. Symbol strings
  support two forms:
  - `path#name` — explicit file.
  - bare `name` — searched across the blocks of all `relatedFiles`.
  - No match ⇒ that symbol is skipped (not an error).
  - **Name-collision rule (architect N2):** `ExtractedBlock.name` is optional
    and not unique within a file. At capture, if multiple blocks in the file
    share the name, skip that symbol (cannot anchor unambiguously). At
    verify, if multiple candidate blocks share the name, the symbol
    contradicts only when NONE of them matches the anchored `contentHash`
    (any match ⇒ verified). Ambiguity never produces a contradiction.
- `repoHead` = `git rev-parse HEAD`.
- **Best-effort, total:** ANY failure (not a git repo, path outside repo, git
  missing, extractor throw) ⇒ returns `undefined`, save proceeds unanchored.
  Capture must never block or fail a save.
- Files with no blob at HEAD (untracked/new) are skipped from `files`;
  if nothing anchors, return `undefined`.
- Path safety: reject (skip) any related file that normalizes outside
  `rootPath` — anchors never reference paths outside the project root.
- Path normalization (architect N3): related-file inputs may be cwd-relative
  while git runs at `project.rootPath`; normalize every input to
  repo-relative POSIX form before any git call, and store only that form.
- Git argv/stdin hygiene (architect N4, hard requirements): git is spawned
  via `execFile` (no shell); every path-taking invocation uses the `HEAD:`
  prefix (`rev-parse HEAD:<path>`) or an explicit `--` separator (`log`,
  `diff`) so a leading-dash path can never be parsed as a flag; paths
  containing newlines or control characters are rejected before being written
  to `cat-file --batch-check` stdin (a newline would inject an extra object
  query).

### 5.1 Symbol input plumbing (prerequisite slice — architect M1)

`relatedSymbols` is READ by four surfaces today but WRITTEN BY NO writer:
CLI `create.ts` builds only `relatedFiles` from `--file`, `update.ts` patches
only `relatedFiles`, and MCP `save-memory.ts`'s input schema lacks the field
entirely. Since the symbol is the contradiction unit (§6.2), this plumbing is
a hard prerequisite, scoped as its own task:

- CLI `mega memory create`/`update`: new repeatable `--symbol <name|path#name>`
  flag → `relatedSymbols`.
- MCP `save_memory`: `relatedSymbols` added to the input schema (same
  validation shape as `relatedFiles`) and spread into the entry build.
- `update.ts` re-capture needs `rootPath`: resolve via
  `registry.getMemoryEntry(id).projectId → registry.getProject(...).rootPath`
  (both exist today — architect N3).

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

An entry whose `lastVerified.result === "contradicted"` that now passes all
checks ⇒ `healed`. Keyed STRICTLY on the structured `lastVerified` field —
never on evidence-string sniffing (architect B1: string-matching `evidence[]`
to decide a bi-temporal reopen is brittle and helped enable the resurrection
bug below). Entries passing checks with no prior contradiction ⇒ `verified`.

**Close ownership (architect B1 — the resurrection bug).** `validTo` is
shared state between the i1 lineage channel (supersession, manual close) and
the i6 code-truth channel. The failure without ownership tracking: A is
superseded by B (lineage closes A); A's symbol later changes → verify marks A
contradicted (validTo already closed, skipped); code reverts → heal blindly
sets `validTo: null` → A is current again ALONGSIDE its superseder B, and
`changedFromFor` suppresses B's lineage line (a reopened predecessor
suppresses enrichment — `supersession.ts:184`). Fix: contradiction records
`lastVerified.closedByCodeTruth = true` ONLY when it actually closed an open
row. Heal reopens `validTo` ONLY when that flag is true; otherwise heal
clears `stale`, updates `lastVerified`, appends heal evidence — and leaves
`validTo` untouched.

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

Two pinned edge semantics:

- **Granularity inconsistency (architect N6, accepted):** file existence is a
  HEAD question (`rev-parse HEAD:<path>`), symbol existence is a worktree
  question (disk read). An uncommitted whole-file delete therefore never
  trips rule 1 (blob still at HEAD) — only rule 2, for files with symbol
  anchors (disk read fails ⇒ symbols missing). Benign because the hook fires
  on commits; documented so tests pin it.
- **Unreachable anchorHead (architect N7):** after rebase/amend/force-push,
  `<anchorHead>..HEAD` may error or return nothing. Contradiction detection
  is unaffected (it reads current state); only attribution degrades — treat
  as "attribution unavailable" (`commit` absent), never let it throw the
  runner.

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
| contradicted | `stale: true`; `validTo: now` ONLY if currently open, and record `lastVerified.closedByCodeTruth = true` in exactly that case (else `false`); append evidence `"code-truth: contradicted by <sha7> — <path>#<symbol> <reason>"` (or `path` alone for file anchors); set `lastVerified {headSha, at, result: "contradicted", closedByCodeTruth}` |
| healed | `stale: false`; `validTo: null` ONLY when `lastVerified.closedByCodeTruth === true` (B1 ownership guard — never reopen a close owned by the lineage channel); append evidence `"code-truth: healed at <sha7> — hash matches again"`; `lastVerified = {…, result: "healed", closedByCodeTruth: false}` |
| verified | update `lastVerified` only — **no-op write suppression**: skip the write entirely when `lastVerified.headSha` is unchanged (keeps repeat verifies free and updatedAt honest) |
| repointed | rewrite anchor paths; no status change |

**Batch apply (architect M5).** `updateMemoryEntry` re-reads the whole
project store and rewrites the full `.jsonl` under a cross-process dir lock
per call — applying a big plan row-by-row is N serialized full-store
rewrites. The applier uses a new registry batch operation
(`applyMemoryEntryPatches(projectId, patches[])`: one dir-locked
read-modify-write applying every plan mutation at once, same validation per
entry as `updateMemoryEntry`). Single-row surfaces keep using
`updateMemoryEntry`.

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
- mtime pre-filter: skip files whose `mtime <= anchor.capturedAt`; re-hash
  only the rest. **Non-authoritative optimization** (architect N5): mtime can
  be back-dated by checkout/revert/touch, so a skipped hit may hide a real
  contradiction — accepted as fail-open; the full `mega memory verify` pass
  never uses mtime. Hard budget ~50ms — on exhaustion, remaining hits pass
  through unchecked (fail-open).
- Contradicted hits are **excluded from the returned results** and disclosed
  in a response-level `contradictedByCode: [{id, title}]` field (i1
  changedFrom-style disclosure; titles pass the sentinel guard). The
  stale/validTo flip is persisted **inline, inside the existing handler
  try/catch, fail-open** — write errors are swallowed, the response still
  returns (architect M3: the bridge has no post-response lifecycle; a
  floating promise's rejection would kill the stdio server via
  unhandledRejection, and `updateMemoryEntry` is sync anyway, so deferring
  bought nothing).
- Coverage honesty (architect M4): the spot-check inspects only the top-5
  anchored hits post-ranking. A contradicted row ranked below that leaks into
  at most ONE recall response; the next verify/sweep/hook pass or its own
  future top-5 appearance flips it, after which §9 mechanism 1 drops it. The
  Pro claim is worded "checked memories never reach your agent; everything
  anchored is checked within one recall of surfacing."
- Free tier: no spot-check; results unchanged.

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
   `memory.stale === true` (add `stale` to the function's `Pick`). Honesty
   note (architect M4): both agent-recall rankers already EXCLUDE stale rows
   outright (`memory-search.ts:65` `includeStale` default false;
   `get-relevant-memories.ts:71` `isRecallable && !e.stale`), so this weight
   never fires on the agent path. Its scope is the human `includeStale`
   surfaces (CLI list/search with stale shown): stale rows sort to the bottom
   instead of ranking as if healthy. The §8.4 in-flight demotion is NOT this
   mechanism — it is the explicit exclusion + disclosure described there.
   Non-stale rows rank bit-identically to today.

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
  attribution absence, name-collision ambiguity (any-match ⇒ verified;
  capture-side skip). Zero git.
- **B1 regression (mandatory):** supersede A with B (lineage close) →
  contradict A's symbol → verify → revert → heal pass MUST NOT reopen A's
  `validTo` (closedByCodeTruth=false); and the mirror case where code-truth
  itself closed the row MUST reopen. Assert `changedFromFor` enrichment for B
  survives.
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
  contradicted hit excluded + `contradictedByCode` disclosure present; flip
  persisted inline and a write error is swallowed (response still returns);
  free tier untouched payload.
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
4. **Perf** — batched cat-file on the git read side; `--changed` scoping;
   50ms spot-check budget with mtime pre-filter; and batch-apply on the write
   side (§7 — one dir-locked rewrite per plan, not per row; architect M5).
   Per-project JSON ceiling unchanged.
5. **Hook trust** — §8.2 confinement; fail-open body; sentinel block;
   explicit command only.
6. **Competitor clone** — moat is cross-agent local store + bi-temporal audit
   trail + $-savings proof, not the git trick alone.

## 15. Implementation deviations (build phase, 2026-07-14)

Recorded from the 18-task subagent-driven build (branch `feat/code-truth`,
stacked on `feat/living-brain`). Each traces to a task commit.

- Registry interface is `CoreRegistry`; the spec's "MemoryRegistry" survives
  only as a `Pick`-alias in `code-truth.ts` for the runner's narrow
  dependency.
- `captureCodeAnchor` / `extractBlocksForFile` are async — the indexer
  extractor set loads via a memoized dynamic import (keeps the multi-MB
  TypeScript compiler off the plain output-filter import path; the
  `no-eager-typescript` guard stays green).
- Symbol extraction reuses the existing polyglot dispatch in
  `@megasaver/output-filter` (ts/js/py/go/rs/md/json) rather than adding a
  `core → indexer` edge.
- `ExecGit` carries an optional third `input?` parameter so the batched
  `git cat-file --batch-check` can feed paths via stdin. A contradiction/heal
  gauntlet finding (proven) hardened `runVerify` and the CLI verify command:
  a cat-file FATAL/timeout (`out === null`) degrades the whole run to
  `unanchored` with zero writes — it never fabricates deletions (the earlier
  code mapped every path to "missing", which would have mass-closed every
  file-anchored memory on a large-repo timeout).
- Anchor `path` fields reject C0 controls + DEL (`/^[^\x00-\x1f\x7f]+$/`),
  matching `captureCodeAnchor`'s `normalizeRepoPath` (allows space, rejects
  DEL) — closes a cat-file stdin injection vector and keeps capture↔schema
  parity.
- `runVerify` treats an `extractBlocksForFile` throw as `undetermined`
  (never contradicts) rather than skipping the path (which the pure planner
  would read as "symbol missing" → false contradiction).
- MCP `save_memory` input schema stays `.strict()` and accepts only
  `relatedSymbols` (data) — never an agent-supplied `anchor`/`lastVerified`;
  the anchor is computed server-side. Negative regression tests pin the
  forge rejection.
- Pre-recall spot-check persists the stale/validTo flip INLINE (sync
  `updateMemoryEntry` inside the handler try/catch, write errors swallowed) —
  no post-response async, because the stdio server has no post-response
  lifecycle and a floating rejection would crash it.
- `"code-truth"` ProFeature key landed as a standalone prerequisite commit
  (Section C tasks gate on it) ahead of the `save_memory` slice.
- `verify_memories` requires `projectId` (a stateless call has no default);
  free tier returns an upsell payload, not an error or a real verify.
- `SpotCheckEnv.ledger` is a data object `{ storeRoot; sessionId?; newId? }`;
  the bridge appends via the `@megasaver/core` re-export of
  `appendCodeTruthEvent` (no bridge→stats dependency edge). The append is in
  its own swallow so a ledger write error never breaks a recall response.
