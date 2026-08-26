# @megasaver/content-store

## 1.2.3

### Patch Changes

- Updated dependencies [297f9ac]
  - @megasaver/shared@1.3.2
  - @megasaver/output-filter@1.8.1

## 1.2.2

### Patch Changes

- 929c8b4: `compaction-guard`: reconnect post-compact agents to intra-session overlay
  receipts without repeating prior tool runs. Snapshot on PreCompact
  (`mega hooks capsule`), bounded recap context injection on SessionStart
  (`mega hooks recap`, ≤2,000 tokens), and reconnected `chunkSets` and `capsule`
  legs in `loadFailureSnapshot`. Installed by default with `--no-compaction-guard`
  opt-out.
- Updated dependencies [9f87069]
- Updated dependencies [8c1454c]
  - @megasaver/output-filter@1.8.0

## 1.2.1

### Patch Changes

- @megasaver/output-filter@1.7.1

## 1.2.0

### Minor Changes

- 608eeba: Wave-3 P0-1/P0-2 + 7 pure cores: preflight snapshot/diff (reserved sibling, git capture, realpath-normalized), sweep scan/quarantine/restore (rank buckets, rename/copy never delete), inspectPack, hotspots scorer, prompt diet heuristics, fork model, bundle schema, deja-vu BM25, audition honest counters. CLI wired for all 9, pure TDD for 7 cores, smoke verified.

### Patch Changes

- d270c93: Scope chunk-set deletion and retention holds by `(workspaceKey, session, chunkSetId)`.

  The saver derives chunk-set ids from the output's sha256 with no session or
  workspace salt, so two sessions that produce byte-identical output write the
  same filename in different directories. The evidence sweep still resolved "which
  file to delete" with `locateChunkSet`, a store-wide first-match scan — so the
  daily, unattended GC could delete a live session's (or another repo's) raw
  output while the expired record's own copy survived, leaving the ledger claiming
  `available` over a file that was gone. The retention pin walker had the mirror
  defect: holds keyed by the bare id let one workspace's pin retain another
  workspace's expired chunk forever.

  `ChunkDeletePort` now takes a `ChunkRef { workspaceKey, sessionRef, chunkSetId }`
  (the evidence record already carried all three), and `sweepEvidenceStore` deletes
  only at that path — an unscopable ref is skipped rather than searched for.
  `pruneOlderThan` takes `keepChunkSetKeys` built from the new exported
  `chunkSetKey`, matched against the same triple; an unscopable hold falls back to
  the bare id and over-retains. `locateChunkSet` keeps serving reads only —
  colliding sets are byte-identical, so any match answers a read.

  The triple addresses the FILE, not its owner: several records in one session can
  point at one chunk file, so `gcEvidence` also skips the unlink when any record
  that survives the pass (pinned, manual_hold, or unexpired) still points at that
  address. It already lists every record in the workspace, so the check is a set
  lookup. The expiring record is still degraded to `retained_metadata_only`.

  Breaking (pre-1.0, no shim): `ChunkDeletePort` takes a ref, not a string;
  `pruneOlderThan`'s `keepChunkSetIds` is now `keepChunkSetKeys`.

- 07a4e3d: Stop the retention prune from deleting raw chunks that pinned or `manual_hold`
  evidence still points at.

  `pruneOlderThan` deleted every chunk set older than the window purely by
  `createdAt`, while the evidence ledger exempts pinned/`manual_hold` records from
  GC. On day 31 the hook GC (and `mega output gc`) deleted the chunk and left the
  record `available` with `rawExpandable: true` — the one evidence class a user
  explicitly protected became a dead pointer, and any expand on it failed.

  `pruneOlderThan` now accepts `keepChunkSetIds`, and the new
  `pruneChunkSetsHonoringPins` (context-gate, the package that already composes
  content-store + evidence-ledger) joins the two stores and supplies the exempt
  ids. Both CLI prune call sites use it. A corrupt ledger aborts the prune instead
  of pruning blind.

- 07a4e3d: Read a chunk set's age from its mtime before parsing its body in `pruneOlderThan`.

  The daily content-store sweep runs inside the Claude Code PostToolUse hook
  (`maybeRunOverlayGc` -> `pruneOlderThan`, awaited by `runSaverHookFromProcess`),
  so its cost is charged to a real user tool call. To read one `createdAt` string
  it did `readFileSync` + `JSON.parse` + up to two whole-object zod `safeParse`s
  per stored file — and each file holds an entire captured tool output. With
  30-day retention and no byte cap, every sweep read essentially the whole store
  to delete about a thirtieth of it.

  Measured on a synthetic store of young sets (min of 5, nothing deleted):
  37 MB across 300 sets 95.4 ms -> 0.8 ms, 73 MB across 600 sets 181.0 ms ->
  1.6 ms. Cost now tracks file count, not stored bytes.

  Chunk sets are write-once via `atomicWriteFile`, so mtime tracks `createdAt`;
  this is the same stat gate `pruneIntentFiles` and `pruneSeenFiles` already use
  on the sibling stores. Files whose mtime is past the cutoff still get the full
  parse, so the "valid chunk set or leave it alone" guard is unchanged and
  unknown or corrupt JSON is still never deleted.

  One deliberate behaviour change: age comes from mtime, so a set written or
  rewritten after the cutoff is retained even if its body claims an older
  `createdAt`. That direction can only delay a delete by one sweep, never delete
  early.

- 07a4e3d: Write the store owner-only (dirs 0700, files 0600). Everything MegaSaver
  persists was created with process-default permissions — 0644 files inside 0755
  directories — so on a shared box every other local account could read it with
  `cat` (CWE-732).

  The exposed data is the sensitive half of the product: an `OverlayChunkSet`
  holds the verbatim body of every file the agent read and the full transcript of
  every command it ran (redacted only for known secret shapes), and
  `stats/<wk>/session-intent.json` holds the user's verbatim prompt. Both are
  written on the default install path — the `mega hooks install` UserPromptSubmit
  and PostToolUse hooks — with no exploit step beyond `ls -l`.

  Measured on a fresh `HOME` through the real hook entry point
  (`… | mega hooks intent`), before → after:

  ```
  drwxr-xr-x  <HOME>/.local/share/megasaver           drwx------
  drwxr-xr-x  …/megasaver/stats/<wk>                  drwx------
  -rw-r--r--  …/<wk>/session-intent.json              -rw-------
  -rw-r--r--  …/<wk>/intent/sess1.json                -rw-------
  ```

  and through `mega output file <session> big.txt --intent …`, every one of
  `content/<proj>/<sess>/{<chunkSetId>,read-index,shown-index}.json`,
  `stats/<proj>/<sess>{.json,.events.jsonl}` and
  `stats/<proj>/<sess>-traces/replay-traces.jsonl` moved from `-rw-r--r--` to
  `-rw-------`, with every containing directory from `drwxr-xr-x` to `drwx------`.

  Fixed at the writers rather than at one directory, matching the convention the
  already-hardened siblings use (`daemon/discovery.ts`, `llm-proxy/store.ts`,
  `context-gate/saver-store.ts`): the three `atomicWriteFile` helpers
  (content-store, stats, evidence-ledger), the seven stats JSONL appenders (now
  routed through one `appendPrivateLine`), `writeReplayTrace`, the CLI intent
  hook's `writeIntentAt`, and `initStore` for the store root itself.

  Each site pairs the create-time `mode` with an explicit `chmod`, which is what
  actually repairs an existing install: `mkdir`'s mode is a no-op on a directory
  that already exists and `appendFileSync`'s is ignored once the file exists. That
  gap is why the hardened writers were being defeated in practice — an unhardened
  writer usually created `stats/` first, leaving `saver-hook-heartbeats.json`
  (0600) sitting in a 0755 directory. On the next write, an old store now heals
  itself.

  Windows is unaffected (NTFS ignores POSIX mode bits); the permission assertions
  skip there.

- Updated dependencies [07a4e3d]
- Updated dependencies [07a4e3d]
- Updated dependencies [b808902]
- Updated dependencies [07a4e3d]
- Updated dependencies [07a4e3d]
- Updated dependencies [07a4e3d]
- Updated dependencies [d26c4ec]
- Updated dependencies [07a4e3d]
- Updated dependencies [4ddac04]
- Updated dependencies [83202e0]
- Updated dependencies [ad32371]
- Updated dependencies [07a4e3d]
- Updated dependencies [07a4e3d]
- Updated dependencies [9d46944]
  - @megasaver/output-filter@1.7.0
  - @megasaver/shared@1.3.1

## 1.1.4

### Patch Changes

- Updated dependencies [eb74c35]
  - @megasaver/output-filter@1.6.0

## 1.1.3

### Patch Changes

- 3905c30: Saver recovery wave 2: hook-compressed output is now stored as uniform
  40-line chunks — the recovery footer advertises `N chunks` with fetch-by-id
  (`i = 0..N-1`) so an agent expands only the slice it needs instead of
  re-paying for the whole raw. The content
  store self-cleans: `pruneOlderThan` now recognizes overlay chunk sets (they
  previously leaked forever), removes emptied directories, runs best-effort
  from the saver hook at most once a day (30-day retention), and is available
  manually as `mega output gc [--days N]`.
- Updated dependencies [815445a]
- Updated dependencies [5695012]
- Updated dependencies [3905c30]
  - @megasaver/output-filter@1.5.0
  - @megasaver/shared@1.3.0

## 1.1.2

### Patch Changes

- Updated dependencies [20977aa]
  - @megasaver/output-filter@1.4.0

## 1.1.1

### Patch Changes

- Updated dependencies [26106bc]
- Updated dependencies [794be8b]
- Updated dependencies [4269f42]
  - @megasaver/shared@1.2.0
  - @megasaver/output-filter@1.3.0

## 1.1.0

### Minor Changes

- c12a575: Add per-session already-in-context dedup to the registry read pipeline.
  When `runOutputPipeline` is about to return an excerpt whose exact text
  was already shown earlier this session (recorded in a new sibling
  `shown-index.json`), the excerpt is dropped from the inline result and
  referenced via its prior chunk-set id instead — so identical text is not
  billed twice. Dedup runs after the chunk-set is persisted, so every
  suppressed excerpt remains recoverable via the referenced chunk-set
  (evidence-preserving). Adds an optional `deduped` field to
  `FilterOutputResult` and a `SHOWN_INDEX_FILENAME` constant to
  content-store (skipped when listing chunk-sets).
- c12a575: feat: per-session already-in-context dedup

  Suppress an excerpt whose exact text was already returned to the model
  earlier in the same session (any read, command, or grep) and reference the
  prior chunk-set instead, so identical text is not billed twice. New
  per-session shown-index.json sibling index; evidence stays recoverable via
  the referenced chunk-set (lossless expand).

- 46dce69: diff-on-reread (suppression-only): re-reading an unchanged file in the same
  session returns an `unchanged: { priorChunkSetId }` marker with empty
  excerpts and skips re-filtering + re-persisting. Lossless — the prior
  chunk-set is recoverable via expand. Adds FilterOutputResult.unchanged +
  unchanged-marker decision (output-filter); readRaw / filterRaw / read-index
  exports (context-gate); exports atomicWriteFile + read-index-tolerant
  listChunkSets / READ_INDEX_FILENAME (content-store).

  No @megasaver/daemon or @megasaver/mcp-bridge bump — passthrough only,
  confirmed by T11.

- fde8e86: Live-first Phase 4: session-scoped overlay surface keyed by
  `(workspaceKey, liveSessionId)` instead of `(projectId, sessionId)`.

  Adds, alongside the existing project-keyed APIs (kept for Phase 5):

  - `@megasaver/core`: `overlay-key` types (`workspaceKeySchema`,
    `liveSessionIdSchema`, `isSafeKeySegment`), `overlayMemoryEntrySchema`
    (scope-split: `project` = workspace/cwd-scoped, `session` = conversation),
    `overlayTaskPlanSchema`, and the overlay store fns
    (`read/writeOverlayMemory`, `read/writeOverlayTaskPlans`).
  - `@megasaver/stats`: `overlayTokenSaverEventSchema`,
    `overlaySessionTokenSaverStatsSchema`, and the overlay store fns
    (`appendOverlayEvent`, `readOverlaySummary`, `readOverlayEvents`,
    `resetOverlayOnDisable`).
  - `@megasaver/content-store`: `overlayChunkSetSchema` plus
    `saveOverlayChunkSet`/`loadOverlayChunkSet` for the
    `content/<workspaceKey>/<liveSessionId>/<chunkSetId>.json` layout.
  - `@megasaver/context-gate`: `runOverlayOutputPipeline`,
    `runOverlayOutputExecCommand`, and `resolveOverlayEffectiveSettings`
    — the proxy pipeline re-keyed off the live session (no registry
    lookup), emitting events/chunks under the overlay keys.

### Patch Changes

- 7fcd881: atomicWriteFile no longer reports a failure when the post-rename
  parent-directory fsync throws. Once the rename commits, the file is
  written; the directory fsync is a durability hint, not a correctness
  gate. Prevents spurious write_failed errors that could trigger
  double-writes in caller retry logic.
- Updated dependencies [7fcd881]
- Updated dependencies [c12a575]
- Updated dependencies [c12a575]
- Updated dependencies [66ac31e]
- Updated dependencies [66ae179]
- Updated dependencies [8580701]
- Updated dependencies [46dce69]
- Updated dependencies [42207dd]
- Updated dependencies [ede092b]
- Updated dependencies [fde8e86]
- Updated dependencies [4be82f8]
- Updated dependencies [b1978fa]
- Updated dependencies [3b1cf6e]
- Updated dependencies [f7cbc28]
- Updated dependencies [12c8e9e]
- Updated dependencies [f7bb136]
- Updated dependencies [ed46198]
- Updated dependencies [00bd97e]
- Updated dependencies [8b735fb]
- Updated dependencies [39e5eb6]
- Updated dependencies [39e5eb6]
- Updated dependencies [39e5eb6]
- Updated dependencies [39e5eb6]
- Updated dependencies [5431672]
- Updated dependencies [ede092b]
- Updated dependencies [3a6ed28]
- Updated dependencies [41751db]
- Updated dependencies [489d4ac]
- Updated dependencies [01c10f0]
- Updated dependencies [38a04c9]
  - @megasaver/shared@1.1.0
  - @megasaver/output-filter@1.2.0

## 1.0.1

### Patch Changes

- Updated dependencies [7b978d3]
- Updated dependencies [19def67]
  - @megasaver/output-filter@1.1.0

## 1.0.0

### Major Changes

- b7f35e3: Mega Saver v1.0 — Context Gate / Mega Saver Mode.

  Session-scoped, GUI-controlled, MCP-backed output compression ships
  complete: the `tokenSaver` session setting, the Context Gate
  orchestrator, the output-filter redaction/ranking pipeline, the
  content store, retrieval (BM25) and stats packages, the real
  `@megasaver/mcp-bridge` over stdio with four tools, the GUI
  TokenSaverPanel + Agent Setup Doctor, and the additive
  `MEGA SAVER:CONTEXT_GATE` connector instruction block. One click
  enables token saving per session; raw evidence stays local; the agent
  receives only the most relevant excerpts with measurable byte savings.

### Minor Changes

- a8b6531: Add the `@megasaver/content-store` package: ChunkSet persistence for
  the context-gate pipeline. Stores one JSON file per chunkSet under
  `<storeRoot>/content/<projectId>/<sessionId>/<chunkSetId>.json` with an
  in-package atomic write (temp + fsync + rename, POSIX dir-fsync,
  symlinked-parent refusal). Public surface: `saveChunkSet`,
  `loadChunkSet`, `listChunkSets`, `deleteChunkSet`, and an injected-clock
  `pruneOlderThan`, plus the `chunkSet`/`chunk` Zod schemas and a closed
  `contentStoreErrorCodeSchema` enum. The store root is injected by the
  caller; content-store never imports `@megasaver/core` (cycle guardrail).
  The `redacted` flag is persisted verbatim and round-trips intact.

### Patch Changes

- Updated dependencies [93840ac]
- Updated dependencies [ae41534]
- Updated dependencies [b7f35e3]
- Updated dependencies [0498b79]
- Updated dependencies [4a56e4c]
  - @megasaver/shared@1.0.0
  - @megasaver/output-filter@1.0.0
