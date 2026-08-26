# @megasaver/evidence-ledger

## 0.2.4

### Patch Changes

- Updated dependencies [297f9ac]
  - @megasaver/shared@1.3.2

## 0.2.3

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

- 07a4e3d: Collect the evidence records that were already on disk. The previous fix
  stamped `expiresAt` on new writes only, so every record the saver had written
  before it — one per compressed tool output, each carrying a
  `returnedChunkRefs` entry per 40-line chunk of the full raw output — kept
  `expiresAt: null`, which `gcEvidence` reads as "never expires" and skips.
  `maybeRunOverlayGc` therefore swept those stores daily and degraded nothing:
  the records stayed `available` with refs dangling into chunk sets the
  content-store prune had already deleted, and the GUI memory-graph route kept
  `JSON.parse`ing and zod-parsing all of them on every request — the exact bloat
  the previous changeset claimed to fix, untouched on every pre-existing store.

  `gcEvidence` now takes an optional `fallbackExpiryMs`: when a record has no
  `expiresAt`, it expires at `createdAt + fallbackExpiryMs`. `sweepEvidenceStore`
  passes `EVIDENCE_RETENTION_MS`, so legacy rows age out on the same 30-day clock
  as the ones written after the fix. The window is a caller-supplied policy, not
  a ledger default — the ledger owns no retention policy (the same reason
  redaction is a port) and a direct caller that passes nothing still sees the
  documented "null means no expiry". Retention exemptions are unchanged: `pinned`
  and `manual_hold` are skipped before expiry is considered, and a legacy record
  still inside the 30-day window keeps its chunk set.

- 07a4e3d: Make evidence-ledger GC actually collect. `gcEvidence` was dead code in two
  independent ways: nothing outside the package ever called it, and every record
  the saver writes was stamped `expiresAt: null`, which its own loop skips. One
  evidence record per compressed tool output therefore accumulated forever, each
  one carrying a `returnedChunkRefs` entry per 40-line chunk of the _full_ raw
  output, pretty-printed. Meanwhile the chunk set those refs point at is deleted
  by the content-store prune after 30 days, so the store filled with permanently
  dangling evidence — and `/api/claude-sessions/:dir/:id/memory/graph` re-reads,
  `JSON.parse`es and zod-parses every one of them on each request.

  Measured on a 348,889-byte command output (1,000 chunks, `mode: "aggressive"`):
  the evidence record is **96,932 bytes** — 28% of the raw output it describes —
  and before this change it stayed 96,932 bytes forever. After the retention
  window it is now degraded to **1,120 bytes**, an 86x drop, and its chunk set is
  deleted.

  Three parts, all at the single site each concern routes through:

  - `@megasaver/context-gate` — the only production writer of evidence
    (`recordAndFilterOverlayOutput`) now stamps `expiresAt` at
    `createdAt + EVIDENCE_RETENTION_MS` (30 days), the same clock the content
    store prunes overlay chunk sets on, so a record cannot outlive the chunks it
    references.
  - `@megasaver/context-gate` — new `sweepEvidenceStore`, a store-wide wrapper
    over the per-workspace `gcEvidence` that resolves each record's chunk set via
    `locateChunkSet` and deletes it through `deleteOverlayChunkSet`. It lives
    here, not in the CLI, because the CLI must not depend on
    `@megasaver/evidence-ledger` directly.
  - `@megasaver/cli` — the existing daily throttled `maybeRunOverlayGc` hook now
    calls `sweepEvidenceStore` alongside the chunk/intent/seen sweeps.
    Best-effort: a failure never fails the GC pass.
  - `@megasaver/evidence-ledger` — degrading a record to
    `retained_metadata_only` now also clears `returnedChunkRefs`. Every ref
    pointed into the chunk set just deleted, and on a large output they are
    ~99% of the record's bytes — they account for the whole 96,932 → 1,120
    collapse above.

  Retention exemptions are unchanged: `pinned` and `manual_hold` records still
  survive ordinary GC.

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

- Updated dependencies [ad32371]
  - @megasaver/shared@1.3.1

## 0.2.2

### Patch Changes

- Updated dependencies [5695012]
  - @megasaver/shared@1.3.0

## 0.2.1

### Patch Changes

- Updated dependencies [26106bc]
- Updated dependencies [794be8b]
  - @megasaver/shared@1.2.0

## 0.2.0

### Minor Changes

- 9fc766e: Add @megasaver/evidence-ledger: canonical evidence schema with revoke/pin
  invariants, append-only store with in-record audit transitions, ledger-computed
  post-redaction digests, pin/unpin session round-trip, best-effort revocation
  (tombstone-before-delete: null digests + null chunk ref + scrubbed sourceRef +
  cleared pins, then ChunkDeletePort delete), and retention GC that degrades to
  metadata-only while exempting pinned + manual_hold. No @megasaver/core or
  content-store dependency.

### Patch Changes

- da9d3a7: Defense-in-depth security hardening (PR #146 follow-up)

  **evidence-ledger / context-gate**: `appendEvidence` now requires a `redactSourceRef`
  port (compile-time fail-closed: every caller must wire it). The port is applied to
  `sourceRef` before schema parse, so the stored record can never contain an
  unredacted secret-bearing field. `context-gate/record-output` wires
  `policyRedactSourceRef` which runs `@megasaver/policy` redact over
  command/args/url/query/path/label (hookTool left as-is — it's a tool name, not
  secret-bearing).

  **mcp-bridge**: The server-owned expansion-guard `Set<string>` is replaced with a
  FIFO-bounded `BoundedSet(EXPANSION_GUARD_CAP)` (cap = 4096). A long-lived server
  process can no longer grow the allowed-chunkSet set without bound. Per-session
  keying is deferred: `mega_fetch_chunk` args carry no `sessionId`, so keying by
  session would require a breaking wire-protocol change; stdio MCP is single-session-
  per-process in practice.

- f46ce66: Reliable save: approve_memory now runs a deterministic validator (schema,
  evidence-for-non-human, safe related files, bounded content, advisory
  heuristics) plus a conflict checker (duplicate/supersession/contradiction)
  before flipping a suggested memory to approved. Hard failures and conflicts
  leave the row suggested with reasons; an exact duplicate of an approved memory
  is rejected (never a second approved row); nothing auto-approves. Adds a
  regression test locking that agent-facing retrieval returns approved-only memory.

  Plan 3b (evidence-ports): the secret gate is now ACTIVE. approve_memory resolves
  evidenceIds to real EvidenceRecord objects via @megasaver/evidence-ledger; it
  rejects approval when any referenced evidence has unresolvedHighRisk (unresolved
  secret finding), is revoked/tombstoned, or belongs to a different canonical
  workspace (cross-workspace leak prevention, spec §6). The unresolvedSecret input
  to validateSave is derived from the real redactionReport, not a false default.

- Updated dependencies [7fcd881]
- Updated dependencies [fde8e86]
- Updated dependencies [4be82f8]
- Updated dependencies [f7cbc28]
- Updated dependencies [12c8e9e]
- Updated dependencies [f7bb136]
- Updated dependencies [ed46198]
- Updated dependencies [00bd97e]
- Updated dependencies [38a04c9]
  - @megasaver/shared@1.1.0
