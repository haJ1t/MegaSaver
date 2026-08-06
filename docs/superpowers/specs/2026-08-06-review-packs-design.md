---
feature: review-packs
date: 2026-08-06
risk: HIGH
status: draft-design
pending: [user-spec-review, architect-pass]
reviewers: [code-reviewer, critic]
build-order: "8 of 11 (next-wave batch)"
---

# Review Packs (C2) — Design Spec

## Problem

2026 research shows review — not generation — dominates agent token
spend (`wiki/syntheses/vibe-coding-pains-2026.md` P3/P4): reviewer
agents re-read whole files, re-run diffs, and re-derive "did the tests
actually pass?" while authors claim "tests pass" without evidence.
Mega Saver already owns every ingredient — the AST chunker
(`chunkBySemantic`, PR #182), the `@megasaver/indexer` extractors, the
lossless expandable chunk store (`content-store` + `fetchChunk`), and
captured command runs — but nothing composes them into a
reviewer-facing artifact. Exit codes are today NOT persisted anywhere:
`runChild` returns `childExitCode` to the caller
(`packages/context-gate/src/run-command.ts:85`) and only failures leave
durable traces (SessionFailure / guard corpus / overlay failures).
claim-verification-gate (C3, build-order 3) closes that hole at the
source: it adds an additive-optional `childExitCode` to
`tokenSaverEventSchema`/`overlayTokenSaverEventSchema` written at the
run-command event seams. What is still missing is the reviewer-facing
composition — nothing joins diff, context, receipts, and claims.

## Goal

`mega review pack [<base>..<head>]` produces an evidence-preserving
REVIEW PACK: (a) the diff chunked semantically via the existing
`chunkBySemantic`; (b) per-touched-file minimal surrounding context —
enclosing declaration extents from the indexer's extractors, never
whole files; (c) test receipts — the latest `childExitCode`-carrying
command event rows for affected packages when present in the store;
(d) a claims manifest —
commit subjects vs receipts present. Everything persists as expandable
chunk sets via the existing content-store (lossless drill-down:
pointers, never paraphrase-away). Output: stdout digest, `--json`,
chunk-set ids; MCP tool `review_pack` for reviewer agents.

## Non-Goals

- Running tests. The pack reads existing receipts only; absence of a
  receipt is reported, never repaired.
- GitHub/PR integration; remote refs beyond what local git resolves.
- Scoring/judging the code. The manifest states facts (claims,
  receipts, gaps) with zero verdicts.
- Receipt persistence, at any seam. claim-verification-gate (C3,
  build-order 3) OWNS exit-code persistence: an additive-optional
  `childExitCode` on `tokenSaverEventSchema` /
  `overlayTokenSaverEventSchema` (`packages/stats/src/event.ts`),
  written at the `runOutputExecCommand`/`runOverlayOutputExecCommand`
  event constructions (run-command.ts:433/679). This pair only READS
  those rows; per C3's own cross-pair ownership note, review-packs
  "consumes childExitCode receipt rows; it adds no ledger of its own".
- Receipt-based merge gating (that is C3, a separate feature).

## Locked Decisions

1. **New leaf package `@megasaver/review-pack`.** One bounded context
   (§8). Deps: `shared`, `policy`, `output-filter`, `content-store`,
   `stats`, plus `indexer` via LAZY cached dynamic `import()` only
   (decision `wiki/decisions/lazy-load-heavy-deps`). NO
   `@megasaver/core` edge — dependency-direction guard test mirrors
   `packages/content-store` (`decisions/content-store-no-core-edge`).
2. **Receipts are read, never written.** A receipt is an existing
   `TokenSaverEvent`/`OverlayTokenSaverEvent` row with
   `sourceKind: "command"` carrying C3's `childExitCode`, read via the
   existing `readEvents`/`readOverlayEvents` surface
   (`packages/stats/src/store.ts:156/694`; re-exported through
   `@megasaver/core` for the CLI per the CLI-never-imports-stats
   invariant, `packages/core/src/index.ts:254-255`,
   `packages/core/src/context-gate.ts:48/91`). A thin receipts-view
   module in `@megasaver/review-pack` filters and windows those rows;
   rows without `childExitCode` (pre-C3) degrade to
   "receipt without exit code". Overlay rows are keyed by
   `encodeWorkspaceKey(repoTopLevel)`; durable rows are keyed by
   registry `projectId`, supplied by the caller (MCP tool input; CLI
   via an injected registry lookup). NO new event family, NO ledger,
   NO context-gate or stats-schema edits in this pair.
3. **Persistence = three overlay chunk sets** via the existing
   `saveOverlayChunkSet` (`packages/content-store/src/store.ts:169`):
   `<packId>-diff` (raw unified diff), `<packId>-context` (enclosing
   declaration extents), `<packId>-manifest` (claims manifest JSON).
   `workspaceKey = encodeWorkspaceKey(repoTopLevel)`,
   `liveSessionId = review-<packId>`. `source = { kind: "command",
   command: "mega", args: ["review", "pack", <rangeLabel>] }` — valid
   under the existing discriminated union; NO schema change.
   Expansion reuses `locateChunkSet`/`fetchChunk`
   (`packages/context-gate/src/fetch-chunk.ts:131`), the CLI
   `mega output chunk`, and MCP `mega_fetch_chunk` unchanged.
4. **Semantic diff = `chunkBySemantic(headText, path)` on the
   head-revision content**, keeping only chunks overlapping the hunks'
   new-file line ranges (`git diff --unified=0`). Pure deletions have
   no head chunks — they are preserved by the raw-diff chunk set
   (losslessness lives there). `chunkBySemantic` + `type Chunk` become
   public exports of `@megasaver/output-filter` (currently internal,
   `src/parsers/semantic.ts:124`).
5. **Context extents come from the raw extractor blocks**
   (`extractTs`/`extractMd`/`extractJson`, extension dispatch mirroring
   `semantic.ts`), NOT from `chunkBySemantic` — the chunker sub-splits
   blocks >80 lines and would truncate an enclosing declaration.
   Unsupported extensions fall back to a ±20-line window per hunk.
6. **Redact-first, always.** The diff text, every context extent, and
   the manifest are passed through `policy.redact()` BEFORE chunk-set
   construction; all three chunk sets set `redacted: true` (F-MAJ-3).
   The rendered digest is built only from already-redacted material AND
   passes through `redact()` once more before stdout.
7. **Fail-closed git gate.** Not a repo / `git` missing →
   `git_unavailable`. `git status --porcelain -z` non-empty →
   `dirty_worktree` (message: commit or stash first). Unresolvable
   base/head/merge-base → `bad_range`. Empty diff → `empty_diff`. Any
   error → exit 1, NOTHING persisted; a mid-persist failure deletes
   already-written sets of this pack (`deleteOverlayChunkSet`) before
   erroring (`store_write_failed`). No partial pack, ever.
8. **Default range** = `merge-base(defaultBranch, HEAD)..HEAD`,
   reusing the `defaultBranch` resolution chain already proven in
   `apps/cli/src/git-delta.ts`; no default branch resolvable → require
   an explicit range (`bad_range`).

## Architecture

```
mega review pack [range] ─┐        ┌─ MCP review_pack (mcp-bridge,
 (apps/cli/commands/review)▼       ▼   projectId → registry rootPath)
             @megasaver/review-pack  buildReviewPack()
    git.ts ── clean-tree gate, range, commits, diff, show, hunks
    semantic-diff.ts ── chunkBySemantic(headText) ∩ changed ranges
    context-extents.ts ── lazy indexer extractors → enclosing extents
    receipts.ts ── readEvents/readOverlayEvents rows → windowed
                   candidates (sourceKind "command", childExitCode)
    claims.ts ── commit subjects × receipt candidates (scope match)
    persist.ts ── 3 × saveOverlayChunkSet (all-or-nothing)
    digest.ts ── redacted stdout digest + expand pointers
                          │
       content-store (expand: fetchChunk / mega output chunk /
                      MCP mega_fetch_chunk — all pre-existing)
receipts (read side): TokenSaverEvent rows carrying childExitCode —
  written by claim-verification-gate (C3) at the run-command event
  constructions (run-command.ts:433/679); this pair reads, never writes
```

## Components

1. `packages/review-pack/src/receipts.ts` — thin receipts view over
   C3-owned event rows: `readReceiptEvents` (overlay by
   `workspaceKey`, durable by optional `projectId`),
   `receiptCandidatesFromEvents` (filter `sourceKind: "command"`,
   join window `RECEIPT_WINDOW_MINUTES = 1440`, rows without
   `childExitCode` kept but flagged), `ReceiptCandidate`
   (`command` [the event's redacted `label`], `exitCode?: int|null`,
   `chunkSetId?`, `createdAt`).
2. `packages/review-pack/` — builder (see Architecture). Public
   surface: `buildReviewPack`, `ReviewPack`, `ReviewPackError` +
   `reviewPackErrorCodeSchema` (5 members, alphabetic per AA3).
3. `apps/cli/src/commands/review/{index,pack}.ts` — Citty command per
   `wiki/workflows/cli-test-pattern.md` (inner `runReviewPack` +
   thin adapter); flags: positional `range?`, `--json`, `--store`.
4. `packages/mcp-bridge` — `review_pack` in `mcpToolNameSchema`
   (alphabetic), `TOOL_INPUT_SCHEMAS` + `TOOL_DEFS` entries, dispatch
   case recording ALL THREE chunk-set ids into `returnedChunkSetIds`
   so the expansion guard admits them (`server.ts:287-290`).

## Error handling

- `ReviewPackError` codes (alphabetic): `bad_range`, `dirty_worktree`,
  `empty_diff`, `git_unavailable`, `store_write_failed`. CLI maps each
  to one stderr line + exit 1; `--json` emits `{ ok: false, reason }`;
  MCP wraps in `McpBridgeError`.
- Git subprocess: `execFileSync`, `timeout: 3000`, `maxBuffer: 10MB`
  (the `git-delta.ts` defaults); throw → `git_unavailable` at the
  gate, `bad_range` during range resolution.
- Extractor throw / zero blocks → per-file fallback (line chunks /
  window extents); NEVER fails the pack (the `chunkBySemantic` null
  contract). Receipt read errors → empty receipts + a manifest
  warning, not a failure (receipts are optional evidence).

## Security & privacy

- Secret redaction is the HIGH-risk failure mode: `redact()` before
  persist AND before stdout (decision 6); receipt `command` labels are
  the event `label`, already redacted at the run-command seams
  (run-command.ts:292/580).
- Path segments (`workspaceKey`, `liveSessionId`) pass
  `assertSafeSegment` (content-store) — no traversal; the receipts
  read path inherits stats' own `assertSafeSegment` checks
  (readEvents/readOverlayEvents).
- No network, no LLM calls, read-only git (`status`, `rev-parse`,
  `merge-base`, `log`, `diff`, `show` only).
- Packs inherit overlay retention (7-day prune). ASSUMPTION: no
  retention hold for packs in v1; a reviewer needing an old pack
  regenerates it.

## Testing

TDD, red first. Unit: receipts view — `sourceKind` filter, window
edges, `childExitCode` present / null / absent (absent → "receipt
without exit code", never a crash); range/
clean-tree/commit/hunk parsing against a REAL temp fixture repo built
in-test (git init + commits, hermetic env); semantic-diff overlap
selection incl. null-fallback; extents incl. unsupported-ext window;
claims matching (`--filter` label rule, gap listing); persist
all-or-nothing (fault-injected save); digest redaction (secret in diff
never reaches stdout). Integration: CLI end-to-end on fixture repo →
digest + `--json` + `mega output chunk` round-trip; MCP `review_pack` →
ids expandable via `mega_fetch_chunk` in-session. Guards: no-core-edge
dependency test; no-eager-typescript test for the lazy indexer import.

## Risk & process

Risk **HIGH** (§12): cross-pair receipt consumption (C3-owned rows),
evidence-preserving compression, public CLI flags. Chain: architect
pass on this spec → worktree (`feat/review-packs`, no `main` edits) →
TDD → `pnpm verify` → `code-reviewer` AND `critic` (separate passes,
author ≠ reviewer) → verifier evidence (fixture-repo smoke + chunk
round-trip capture). Evidence-preserving mode only.

## Dependencies / build order

"8 of 11 (next-wave batch)". Upstream (all shipped): content-store
overlay surface, `chunkBySemantic` (#182), indexer extractors, policy
redact, `fetchChunk` + expansion guard. BLOCKED BY:
claim-verification-gate (C3, build-order 3) for exit-code receipts —
C3 owns the additive-optional `childExitCode` on
`tokenSaverEventSchema`/`overlayTokenSaverEventSchema` and its
run-command seam writes (event constructions run-command.ts:433/679;
`result.chunkSetId`, set at 402/668, rides into the rows'
`chunkSetId`); per C3's cross-pair note, review-packs "consumes
childExitCode receipt rows; it adds no ledger of its own". Graceful
degradation: command rows without `childExitCode` render "receipt
without exit code", so the pack builds either way — full receipts
require C3 landed. Internal order: output-filter export → review-pack
package (git → semantic-diff/extents → receipts view → claims →
persist/digest) → CLI → MCP.

## Open questions

1. Should repo-root receipts (`pnpm verify` at top level) attach to
   every touched package in the manifest, or stay a separate "repo"
   scope row? Draft locks "repo" scope row (no fan-out) — reviewer
   judgment stays honest.
2. Receipt key reach. Overlay rows are keyed by the live workspace's
   `workspaceKey`; ASSUMPTION: agent workspaces sit at the repo
   top-level so `encodeWorkspaceKey(repoTopLevel)` matches. Durable
   rows are keyed by registry `projectId` — the CLI matches
   `registry.listProjects()` on `rootPath === repoTopLevel`
   (`packages/core/src/registry.ts:71`); subdir-rooted projects and
   unregistered repos read as "no receipt" — acceptable v1 or needs a
   key-family probe?
3. RESOLVED: `review_pack` keeps its name in both MCP naming modes —
   `exposedToolName` returns identity for any tool not in the
   three-entry `NAME_PAIRS` map
   (`packages/mcp-bridge/src/tool-naming.ts:37-40`); no identity row
   is needed.
4. Session enumeration for the receipts read couples review-pack to
   the `stats/<key>/<id>.events.jsonl` layout (the readdir idiom
   stats itself uses internally, `store.ts:584`). Should stats export
   a session-id enumerator instead? Deferred — flag at review if the
   coupling bites.
