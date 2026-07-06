# @megasaver/context-gate

## 0.5.0

### Minor Changes

- 20977aa: Decision-Trace Viewer: surface the causal chain behind each context decision.

  Registry/proxy outputs now record their ranking decision inline on the replay
  trace — the classification, the selected/omitted chunks with their EngineScore
  breakdown, the memory ids that boosted the ranking (`rankedByMemoryIds`), and the
  redaction summary. Replay tracing is now **on by default** (disable with
  `MEGASAVER_SEAM_TRACE=false`), bounded by a retention cap on trace-session dirs.

  - New `readSessionDecisionTrace` reader joins the trace's inline attribution into
    a per-output `SessionDecisionTrace` (output granularity).
  - New CLI: `mega trace explain <sessionId> --project <name> [--workspace <key>]
[--json]` renders the causal chain for a registry session.
  - New GUI: a Cytoscape decision-flow panel with a project-scoped session picker
    (traces come from proxy/registry sessions for the workspace).

  Note: the memory attribution is _ranking-causal_ (which memory boosted the
  output's ranking), distinct from the evidence ledger's retention `pinnedByMemoryIds`.
  `highRiskFindings` is the seam's redaction count. Traces exist only for
  registry/proxy sessions; pure cockpit/overlay sessions show an honest empty state.

### Patch Changes

- Updated dependencies [20977aa]
- Updated dependencies [14b2c6c]
- Updated dependencies [223fa0a]
  - @megasaver/output-filter@1.4.0
  - @megasaver/stats@1.3.0
  - @megasaver/content-store@1.1.2

## 0.4.0

### Minor Changes

- 26106bc: Live Context Seam: capture agent failures as first-class evidence and feed them
  back into the next task's context selection, closing the loop between what an
  agent got wrong and what it sees on the retry.

  - `@megasaver/shared`: new `sessionFailureIdSchema` — the branded id boundary for
    a persisted failure record, so a failure id is validated once at the edge and
    trusted internally thereafter.
  - `@megasaver/core`: new `SessionFailure` type plus registry methods
    `createSessionFailure(input)` and `listSessionFailures(query)`. Failures are
    stored alongside sessions with the same metadata discipline as memory
    (source, timestamp, scope), and `listSessionFailures` is the read side the
    ranking path consumes.
  - `@megasaver/context-gate`: failure capture wires recorded `SessionFailure`
    rows into the gate, and failure-aware ranking boosts files/blocks implicated
    in recent failures so a retry surfaces the evidence the last attempt missed.
    Additive — with no recorded failures the ranking is byte-identical to today.
  - `@megasaver/mcp-bridge`: new `get_task_context` MCP tool exposes the
    failure-aware context selection to connected agents, returning the ranked
    context for a task including any failure-boosted evidence.

- 794be8b: Saver activation inheritance across Git worktrees: a repository-family setting is
  inherited by every worktree sharing the same canonical Git common directory, so an
  enabled repo covers its `.claude/worktrees/...` sessions. Fixes the live case where
  an enabled main repo left its worktree sessions uncompressed.

  - `@megasaver/shared`: new `RepositoryFamilyKey` branded type (`gf1_` + base64url
    SHA-256), browser-safe validator.
  - `@megasaver/context-gate`: canonical-path family identity (platform/volume-aware,
    durable across reboot/remount/restore), a bounded Git common-directory resolver
    (no subprocess; separate-git-dir main + worktrees converge; foreign worktree-admin
    pointers rejected), a hardened v1 activation store (exact/family/global records +
    legacy-shape normalization, atomic 0600/0700 writes, digest fail-closed, activation
    lock), the `resolveWorkspaceTokenSaverSettings` precedence (exact → repository →
    legacy-root → global → disabled; degraded git never resurrects a legacy record but
    the global default still applies), a bounded heartbeat registry (256/30d/future-skew,
    derived `latest`/`latestCompression`, non-mutating reads) that also feeds proxy
    status, and the shared `resolveActivationScope`/`writeActivation` helpers.
  - `@megasaver/cli`: the PostToolUse saver hook now resolves activation through the
    repository-family precedence (a worktree inherits its repo's enable) and writes
    invocation/compression liveness heartbeats. `mega session saver workspace
{enable,disable}` is repository-aware (family record by default in a repo, `--exact`
    for this checkout only, scope echo); new `default {enable,disable}` writes the global
    default; new `resolve` shows the resolved activation + liveness. **Public behavior
    change:** the activation record shape is now strict v1 and the workspace toggle
    defaults to family scope inside a repo.
  - `@megasaver/gui`: the workspace saver toggle writes through the same shared scope
    helper (family inside a repo) and reports the effective inherited activation + source.

- 4269f42: Live Context Seam phase 2: harden failure capture, feed failures back through
  every read path, and make the seam observable and switchable end to end.

  - `@megasaver/context-gate`: overlay failure store persists captured failures
    through the registry; failure-aware ranking now applies on registry read
    paths, with new memory and conventions hint sources feeding the gate.
    Hint building is best-effort per source — a corrupt store file degrades to
    a non-fatal `session hints skipped` warning instead of failing the read.
    Capture filtering skips evidence-free exit-1 runs, redacts the full raw
    output before the 4000-char evidence cap, and failure signatures are
    restricted to a code-extension allowlist so non-code noise never becomes a
    signature. Seam replay traces are recorded with an A/B switch, gated behind
    opt-in `MEGASAVER_SEAM_TRACE=true`.
  - `@megasaver/output-filter`: new kill switch resolver disables the seam per
    scope, `seamTraceEnabledByEnv` gates trace recording, and
    `readReplayTraces` exposes recorded replay traces to consumers.
  - `@megasaver/cli`: new `mega audit seam` command reports seam effectiveness
    from recorded replay traces.

### Patch Changes

- Updated dependencies [69ce82f]
- Updated dependencies [26106bc]
- Updated dependencies [794be8b]
- Updated dependencies [4269f42]
- Updated dependencies [b5c6c0d]
  - @megasaver/stats@1.2.0
  - @megasaver/shared@1.2.0
  - @megasaver/output-filter@1.3.0
  - @megasaver/content-store@1.1.1
  - @megasaver/evidence-ledger@0.2.1
  - @megasaver/policy@1.2.1

## 0.3.0

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

- da6e687: Intent-aware hook (Phase 6b): a UserPromptSubmit hook captures the latest prompt
  and fills it as the ranking intent for PostToolUse-captured native output when no
  explicit intent is present (fill-gap). Daemon /excerpt accepts an optional intent.
- ede092b: Lazy-load the TypeScript compiler out of the eager import graph. The
  semantic AST chunker imported `@megasaver/indexer` (which statically
  imports the multi-MB `typescript` compiler) at the top of
  `output-filter`, so importing `@megasaver/output-filter` — and thus
  every per-tool-call hook, the daemon, and the CLI — eagerly paid a
  multi-second compiler load on startup. The indexer is now imported
  dynamically inside `chunkBySemantic`, gated behind a supported-extension
  precheck, so `typescript` only loads when a source file is actually
  chunked.

  This makes `filterOutput` and `chunkByFormat`/`chunkByFormatWithMeta`
  (`@megasaver/output-filter`) and `filterRaw` (`@megasaver/context-gate`)
  async — they now return promises. All in-tree callers await them; the
  semantic chunker still never throws (parse error or unsupported source
  falls back to line chunking).

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

- b1978fa: feat: outline-first read mode

  `mega_read_file` accepts `outline: true`: for a supported source file it
  returns the file skeleton (imports + top-level signatures + line ranges +
  chunk ids) and persists every body as a fetchable chunk, so an agent expands
  only the bodies it needs via `mega_fetch_chunk`. Lossless, additive, and
  falls back to a normal read for non-source / unsupported / unparseable files.

- 3e678e3: Realize Saver Mode on native tool output: a `mega hooks saver` PostToolUse hook
  compresses large Read/Bash/Grep/Glob/LS output (evidence-preserving — the full
  redacted output is stored as a recoverable chunk), feeds the model the
  compressed result via `updatedToolOutput`, and records per-session overlay
  events that populate the live GUI Token saver tab. Gated on the Saver Mode
  toggle + mode budget; never blocks (exit 0; any error or multi-modal output ⇒
  original untouched). `mega hooks install` now installs both the PreToolUse
  telemetry hook and the PostToolUse saver hook. Adds context-gate
  `recordAndFilterOverlayOutput`.
- 4fe5749: runOutputPipeline now records a TokenSaverEvent per file read
  (RunOutputResult widens with store_write_failed), core re-exports the
  stats read/append surface, and `mega session saver stats` reads the
  real stats store (text totals + eventStats in --json; BB6 stub retired).

### Patch Changes

- 7c916db: Fix `recordAndFilterOverlayOutput` storing every overlay chunk-set with
  `source: { kind: "file", path: label }` regardless of the tool. A Bash
  command or grep was recorded as a file path in the stored chunk-set's
  `source` metadata. The `input.sourceKind` is now mapped to the matching
  `OverlayChunkSet["source"]` variant (`command` / `grep` / `fetch` /
  `file`). Cosmetic correctness only — the hook's behaviour and lossless
  raw recovery are unaffected; the overlay event already recorded the
  correct `sourceKind`.

  Note: the `fetch` variant's `url` is schema-validated (`z.string().url()`),
  so a future `sourceKind: "fetch"` caller must pass the actual URL as the
  label. No current caller emits `fetch` (hook matcher is
  `Read|Bash|Grep|Glob|LS`), so there is no behaviour change today.

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

- 97ccb98: Redact the source label before it is persisted on the saver hot path. The
  overlay chunk-set `source` (command/url/grep-query/file-path) and the overlay
  stats event `label` previously stored the raw label — a credential-bearing
  command line (`curl -H "Authorization: Bearer ..."`), a token-bearing fetch
  URL, or a secret-laden path landed on local disk even though the chunk CONTENT
  was already redacted. `recordAndFilterOverlayOutput` now runs the
  `@megasaver/policy` `redact` over the label once and feeds the redacted form to
  both write points, mirroring the `policyRedactSourceRef` port on the evidence
  path. Redaction keeps the label readable (secret → marker, not blanked); a
  redacted fetch URL still passes the `overlayChunkSetSchema` `z.string().url()`
  guard, so `mega audit`/recall display the same source minus the secret.

  Scope: this closes the leak for the `recordAndFilterOverlayOutput` overlay path
  and for the secret shapes `redact` recognises (prefix/structure-based: `ghp_`,
  `sk-`, `AKIA`, `Bearer <tok>`, JWT, private-key blocks, quoted env values, DB
  URLs). Generic secrets with no recognised shape (e.g. a bare `?token=<hex>`
  query param or `user:pass@host` basic-auth) are still not caught — the same
  blind spot the content redactor has. The parallel `run-command.ts`
  (`proxy_run_command`) and `run.ts`/`read.ts` file-read saver paths persist their
  own raw command/args/path and are NOT covered here; both are tracked as
  follow-ups.

- aa42dbd: Redact the source label/command/args/path before persistence on the remaining
  saver paths. PR #148 fixed only `recordAndFilterOverlayOutput`; the parallel
  live paths still wrote the raw label to disk:

  - `run-command.ts` (`runOutputExecCommand` legacy + `runOverlayOutputExecCommand`
    overlay — the latter wired into `proxy_run_command`) persisted
    `source.command` + `source.args` and the stats event `label` raw. Because it
    stores the real `args` array, a bearer token in `curl -H "Authorization:
Bearer ..."` landed verbatim in `source.args` on disk.
  - `run.ts` (legacy + overlay file pipelines) persisted the file `path` raw in the
    stats event `label`.
  - `read.ts` `persistChunkSet` + `persistOverlayChunkSet` persisted the file
    `path` raw in `source.path`.

  Each sink now applies `@megasaver/policy` `redact` (the same detector used for
  chunk content): the command and each `args` element are redacted element-wise,
  the joined event label is rebuilt from the redacted parts, and the file path is
  redacted at the `persist*` sink (covering every caller of those exported
  functions) and again for the event label in `run.ts`. Redaction stays readable
  (secret → marker, not blanked).

  Known limit (unchanged from #148): `redact` only catches prefix/structure-shaped
  secrets, so a bare `?token=<hex>` query param or `user:pass@host` basic-auth in a
  command/path is still not caught — the same blind spot the content redactor has.
  Hardening `packages/policy/src/redaction-patterns.ts` is tracked separately.

- Updated dependencies [7fcd881]
- Updated dependencies [c12a575]
- Updated dependencies [c12a575]
- Updated dependencies [7fcd881]
- Updated dependencies [66ac31e]
- Updated dependencies [62b3c65]
- Updated dependencies [66ae179]
- Updated dependencies [8580701]
- Updated dependencies [46dce69]
- Updated dependencies [9fc766e]
- Updated dependencies [0a3256b]
- Updated dependencies [da9d3a7]
- Updated dependencies [42207dd]
- Updated dependencies [b2e39cd]
- Updated dependencies [ede092b]
- Updated dependencies [fde8e86]
- Updated dependencies [fde8e86]
- Updated dependencies [4be82f8]
- Updated dependencies [b1978fa]
- Updated dependencies [3b1cf6e]
- Updated dependencies [f7cbc28]
- Updated dependencies [12c8e9e]
- Updated dependencies [f7bb136]
- Updated dependencies [ed46198]
- Updated dependencies [484f243]
- Updated dependencies [00bd97e]
- Updated dependencies [8b735fb]
- Updated dependencies [39e5eb6]
- Updated dependencies [39e5eb6]
- Updated dependencies [39e5eb6]
- Updated dependencies [39e5eb6]
- Updated dependencies [39e5eb6]
- Updated dependencies [f46ce66]
- Updated dependencies [5431672]
- Updated dependencies [ede092b]
- Updated dependencies [3a6ed28]
- Updated dependencies [41751db]
- Updated dependencies [489d4ac]
- Updated dependencies [01c10f0]
- Updated dependencies [38a04c9]
  - @megasaver/shared@1.1.0
  - @megasaver/output-filter@1.2.0
  - @megasaver/content-store@1.1.0
  - @megasaver/stats@1.1.0
  - @megasaver/evidence-ledger@0.2.0
  - @megasaver/policy@1.2.0

## 0.2.0

### Minor Changes

- bb3d179: Load and enforce project permissions (`.megasaver/permissions.yaml`).

  New public API: `loadProjectPermissions(projectRoot): ProjectPermissions | null`
  — synchronously reads `<projectRoot>/.megasaver/permissions.yaml`, parses it with
  the new `yaml@^2` dependency (safe-by-default `parse`, no custom tags / code-exec),
  and delegates validation to the pure `policy.parseProjectPermissions`. An absent
  file returns `null` (baseline only); every other failure mode (non-ENOENT fs error,
  YAML syntax error, schema violation) becomes a single typed `PolicyLoadError` —
  fail-closed.

  `resolveEffectiveSettings` now loads the permissions once per resolve (via an
  injectable loader, default = the real fn) and returns a discriminated
  `ResolveResult` (`session_not_found` | `policy_load_failed` | `ok`); `EffectiveSettings`
  carries the loaded `ProjectPermissions | null`, threaded into `evaluateCommand`
  and `runTwoGates`. A present-but-malformed file denies the operation in resolve,
  before any spawn or `fs.readFile`. Adds the `yaml@^2` runtime dependency.

### Patch Changes

- Updated dependencies [7b978d3]
- Updated dependencies [bb3d179]
- Updated dependencies [19def67]
  - @megasaver/output-filter@1.1.0
  - @megasaver/policy@1.1.0
  - @megasaver/content-store@1.0.1
  - @megasaver/stats@1.0.1

## 0.1.0

### Minor Changes

- a2526d3: Extract the context-gate orchestrator out of `@megasaver/core` into a
  standalone `@megasaver/context-gate` package (AA1 BB12 — §2a
  deferred-extraction trigger fired: 553 LOC > 500). Behavior-preserving:
  the orchestrator's `context-gate -> core` edge (a type-only `CoreRegistry`
  import in 4 files) is broken by a 3-property structural `OrchestratorRegistry`
  port defined in the new package; core's `CoreRegistry` structurally
  satisfies it, so no call site changes. `@megasaver/core` now re-exports the
  orchestrator from `@megasaver/context-gate`, so `apps/cli` and
  `@megasaver/mcp-bridge` consumers keep importing `runOutputPipeline`,
  `runOutputExecCommand`, `fetchChunk`, and `locateChunkSet` from
  `@megasaver/core` unchanged. No runtime behavior changes.
