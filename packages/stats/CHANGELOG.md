# @megasaver/stats

## 1.4.0

### Minor Changes

- b91c052: Saver metrics honesty wave 5 (F30-F34): every reported number now counts
  the bytes actually delivered to the model, and no ratio divides mismatched
  scopes. `recordAndFilterOverlayOutput` computes the persisted
  returnedBytes/bytesSaved/savingRatio from the FINAL delivered text — D16
  elision markers plus the recovery footer, which now renders inside record
  (new canonical `buildRecoveryFooter` + `includeFooter` flag, wired through
  the saver hook and the daemon /excerpt schema) — and degrades to
  passthrough with ZERO side effects when a compressed replacement would be
  net-negative. Overlay events carry `secretsRedacted`/`chunksStored`, so
  summary rebuilds recover both counters without carryForward, and the GC
  reconcile counts schema-valid lines only (garbage lines no longer force a
  rebuild every sweep). The proxy usage reader tolerates torn JSONL lines
  and `mega audit usage` reports the skipped count, matches a GLOBAL savings
  numerator to the global usage denominator, adds a per-workspace savings
  breakdown (no unattributable ratios), and carries a scoped-ratio branch
  for future workspace-keyed usage rows. The proxy supervisor re-applies a
  removed route in place (lease kept; counter surfaced by the new
  `saver-proxy-route` doctor check), and metering is no longer framed as
  saving: `saver_mediated_token_savings`, `mediation: "saver_hook"`, and an
  explicit metering note in the audit report.
- 5695012: Saver observability wave 4 (E21-E29): a dead saver is now visible. The
  per-workspace heartbeat registry becomes a full liveness ledger — hook
  failures (with a coarse kind), successful completions, and daemon
  fallbacks are recorded best-effort and surfaced in `mega session saver
resolve`, `mega hooks status`, and a new `mega doctor` verifier section
  (registration, binary, store bake, heartbeat liveness, spawned self-test,
  daemon ping). Corrupt per-session overlay summaries self-heal from their
  events JSONL (stamped `rebuiltAt`); summary read-modify-writes are
  serialized by a new stale-aware `withFileLock` in `@megasaver/shared`
  (which also unfreezes the heartbeat lock), and the daily GC sweep
  reconciles summaries that lag their JSONL. `mega hooks install` now
  registers hooks by absolute CLI path with explicit timeouts, bakes
  `--store` for non-default stores, and migrates legacy bare entries in
  place; `mega hooks status <id>` also resolves live overlay sessions, and
  the no-arg form aggregates savings and liveness across workspaces.

### Patch Changes

- Updated dependencies [815445a]
- Updated dependencies [5695012]
- Updated dependencies [3905c30]
  - @megasaver/output-filter@1.5.0
  - @megasaver/shared@1.3.0

## 1.3.0

### Minor Changes

- 14b2c6c: Savings headline: surface saved tokens as a visible, defensible value.

  MegaSaver already computed tokens saved but showed them only as raw bytes/tokens
  buried in an audit command. This turns that number into a value a person feels:
  a cumulative `≈$X saved (est.) · ≈Z sessions' worth of context reclaimed` on the
  GUI home strip and the `mega audit report` output.

  - **@megasaver/stats**: new pure `computeSavingsHeadline` (byte entry) +
    `savingsHeadlineFromTokens` (token entry) share one price/window model —
    `INPUT_PRICE_PER_MTOK_USD = 3.0` and `CONTEXT_WINDOW_TOKENS = 200_000`. Tokens
    reuse the existing `tokensFromBytes` (bytes/4) model. New
    `readAllWorkspaceTokenSaverTotals` aggregates every workspace with a blended
    ratio for the cumulative headline. A browser-safe `@megasaver/stats/headline`
    subpath lets the GUI client import the const without pulling the node store.
  - **@megasaver/cli**: `mega audit report` renders a `$` headline line + a
    one-line footnote after the summary, and carries the `SavingsHeadline` object
    under `--json`. Zero savings renders an honest
    `No savings recorded in this window yet.` — never a fake `$0.00` flex.
  - **@megasaver/gui**: a new `GET /api/token-saver/all-workspaces` bridge route
    returns the summed totals; the home strip renders
    `≈$X saved (est.) · ≈Z sessions reclaimed` with the estimate assumption in a
    hover footnote, and an honest `No savings recorded yet — enable the saver to
start.` empty state.

  Honesty: the `$` is always labeled `(est.)` because the one modeled assumption is
  the per-model input price. Saved tokens were compressed away and never sent, so —
  unlike the conversation proxy's `$` — they carry no prompt-cache discount to
  double-count. The 200K-per-session divisor deliberately UNDER-counts real
  sessions (a session rarely fills 200K), so reclaim is never overstated.

- 223fa0a: Savings share card: the product generates its own shareable savings image.

  The savings screenshot is the niche's native currency, so MegaSaver becomes its
  own ad creative. A new pure `renderSavingsCardSvg(headline, { windowLabel })`
  turns a `SavingsHeadline` into a 1200×630 direction-B card (minimal editorial:
  light `#f6f5f2` ground, dark `#17181a` ink, one big `$` number, "Mega Saver"
  mark, three sub-stats, footer "Less tokens. More signal."). It lives in the
  browser-safe `@megasaver/stats/headline` barrel so the GUI and a future
  `mega share` reuse one renderer; all text derives from the real headline (no
  invented numbers), carries `(est.)`, and untrusted window labels are escaped.

  - New GUI **Share** button beside the savings strip, shown only when
    `bytesSavedTotal > 0`. It opens a modal previewing the card and exporting it:
    **Download PNG** (zero-dep SVG→canvas→`toBlob`), best-effort **Copy image**
    (guarded when the clipboard API is missing), and **Share on X** (a tweet-intent
    whose honest, `(est.)`-carrying text comes from the same `computeSavingsHeadline`
    — one source, no overstatement). X can't auto-attach the image, so the modal
    tells the user to download the card then attach it.

### Patch Changes

- Updated dependencies [20977aa]
  - @megasaver/output-filter@1.4.0

## 1.2.0

### Minor Changes

- 69ce82f: Audit overlay fallback: when a session has no recorded audit overlay, fall back
  to the last known good overlay instead of rendering an empty panel, so the audit
  view stays useful across sessions that predate overlay capture.

  - `@megasaver/stats`: overlay resolution degrades gracefully — a missing
    per-session overlay resolves to the most recent available overlay rather than
    returning nothing.
  - `@megasaver/cli`: the audit command surfaces the fallback overlay and flags it
    as inherited so the operator knows the data is not session-specific.

- b5c6c0d: Workspace token-saver totals: aggregate per-session token-saver stats into a
  workspace-wide total so the GUI can report savings across every session in a
  repository, not just the active one.

  - `@megasaver/stats`: totals aggregation over the session set — sums input,
    output, and saved tokens across sessions and derives the workspace savings
    rate from the aggregate rather than averaging per-session rates.
  - `@megasaver/gui`: the token-saver panel reports the workspace-wide totals
    alongside the active session's figures.

### Patch Changes

- Updated dependencies [26106bc]
- Updated dependencies [794be8b]
- Updated dependencies [4269f42]
  - @megasaver/shared@1.2.0
  - @megasaver/output-filter@1.3.0

## 1.1.0

### Minor Changes

- 62b3c65: Add honest token-reduction metrics: token-weighted eligible reduction reported
  alongside eligible/proxied/passthrough/mediated fractions, a GA gate pairing
  reduction with an evidence-sufficiency floor, and `mega audit honest`. Passthrough
  outputs never create positive savings; the headline reduction is reported as
  eligible-mediated-context-only and cannot be inflated by eligibility-set selection.
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

- 484f243: Phase 8 — Context Audit & Token-Savings Dashboard. Extends
  @megasaver/stats (no new core entity) with an additive AuditEvent
  discriminated union (context_pack_built, rule_applied, failure_avoided,
  memory_retrieved, tool_route — scalar-only, no core types so the cycle
  guard holds), written to a sibling <store>/stats/<projectId>/<sessionId>
  .audit.jsonl (the byte .events.jsonl is untouched — no duplicate
  token-saver accounting). New pure summarizeAudit(events, { window, now })
  folds events in one exhaustive switch with window filtering
  (session|week|all) and derives tokensSaved/percentageSaved using the
  same formula as PackAudit; it imports no token estimator — tokensBefore/
  After arrive already-estimated from Phase 3's auditPack (estimateSpanTokens)
  carried verbatim into a context_pack_built event. New appendAuditEvent /
  readAuditEvents JSONL writer+reader (reuses StatsError schema_invalid /
  store_corrupt — no new codes). Core re-exports the audit surface (CLI/MCP
  never import @megasaver/stats directly). One read-only MCP tool
  audit_token_usage (bridge now 24 tools) and a mega audit CLI group
  (report / last / session / export --format json) returning the dashboard
  cards and the headline "would've been N tokens, was M, P% saved". Ships
  the context_pack_built emission on the build path to prove the demo;
  rule_applied/failure_avoided/memory_retrieved/tool_route emissions are
  fast-follows (the summarizer already handles all five kinds). No LLM, no
  new estimator, no GUI changes.
- 39e5eb6: Proxy Mode v1.2 Phase P5 — adoption + measurement (D7-rest, D8, D9).

  `@megasaver/stats` gains proxy metrics: `readEvents` reads the per-call
  audit trail, `aggregateAdoption` computes the universal adoption block
  (adoption rate, call count, calls-by-type, expand rate, proxy-mediated
  token savings, raw stored output count, average compression ratio),
  `ingestHookLog` + `computeInterception` derive the hook-based
  interception rate, and `buildProxyMetrics` assembles the combined shape
  (adoption always present; interception only when a Claude Code hook log
  exists, otherwise the verbatim install hint). Zero-denominator cases
  yield `0.0`; malformed JSONL lines are skipped.

  `@megasaver/cli` gains a `hooks` command group:

  - `mega hooks install claude-code` idempotently writes a `PreToolUse`
    telemetry hook into an injectable Claude Code `settings.json`,
    preserving unrelated keys.
  - `mega hooks log` is the metadata-only, best-effort, always-exit-0
    logger the hook invokes (never logs file contents, never blocks the
    tool call).
  - `mega hooks status <sessionId>` prints proxy adoption metrics always
    and hook-based interception only when the log exists, with honest
    wording that never overclaims universal interception.

  `mega doctor` now reports Claude Code hook telemetry as installed or
  missing (with the install hint). Connector instruction blocks bias
  agents to `proxy_*` tools and to expanding chunks before assuming
  omitted content is irrelevant. The README documents Proxy Mode as
  opt-in with the approved category-comparison framing and no
  competitor-specific headline.

### Patch Changes

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

- 6078dc9: Add the `@megasaver/retrieval` and `@megasaver/stats` packages.

  `@megasaver/retrieval` provides standalone, pure BM25 ranking over chunked
  output text plus `DerivedIntent` derivation, giving the context gate a
  deterministic relevance signal without spawning git or holding a persistent
  index. `@megasaver/stats` adds the `SessionTokenSaverStats` and
  `TokenSaverEvent` Zod schemas with append/update helpers that persist under an
  injected store root (`<store>/stats/<projectId>/<sessionId>.json` +
  `.events.jsonl`) using the atomic-write pattern from `@megasaver/core`, so
  token-saver telemetry survives crashes without corrupting partial writes. Both
  expose their public surface from `index.ts` with closed, alphabetically pinned
  error-code enums.

### Patch Changes

- Updated dependencies [93840ac]
- Updated dependencies [ae41534]
- Updated dependencies [b7f35e3]
- Updated dependencies [0498b79]
- Updated dependencies [4a56e4c]
  - @megasaver/shared@1.0.0
  - @megasaver/output-filter@1.0.0
