# @megasaver/cli

## 1.12.0

### Minor Changes

- 3080a4a: mega firewall: context-firewall audit (Pro). policy now detects checksummed
  PII (credit card/Luhn, IBAN/mod-97, TR national id) alongside secrets and
  counts emails without redacting them; every blocked secret-path read,
  redaction, and observation is logged value-free to <store>/firewall/
  events.jsonl (always on); `mega firewall` renders the windowed audit —
  blocked reads, redactions by detector, observed emails, fixes.

## 1.11.0

### Minor Changes

- 91f1d46: mega cache: prompt-cache doctor. Reads the metering proxy's counts-only usage
  log, groups calls into conversations, detects four cache-miss signatures
  (no-cache, unstable-prefix, ttl-expiry, model-switch), prices the burn against
  the house input rate, and prints a one-line fix per finding. Read-only;
  advice-only; never reads message content.

## 1.10.0

### Minor Changes

- 79d8269: mega compress: reversible extractive compression of memory/doc files. Dry-run by
  default (preview + token/$ savings); --apply overwrites after writing a mandatory
  <file>.bak, atomically, behind a git-dirty guard. savings-fix R5 advice now points
  at the command.

## 1.9.0

### Minor Changes

- 057eb11: `mega bench` — runs a command twice (raw vs saver pipeline) and reports
  tokens kept out of context, wall-time overhead, and an outcome-parity
  verdict; `--assert` turns it into a CI regression gate. Records nothing.

## 1.8.0

### Minor Changes

- e853984: `mega teardown` — composes a publish-ready, share-safe waste exposé
  (markdown + SVG card) from the workspace's recorded events: the bill,
  per-source per-turn averages, what was clawed back, and the treatments.

## 1.7.0

### Minor Changes

- aa52164: `mega savings fix` — turns waste findings into a deterministic fix plan;
  `--apply` executes the safe fixes (workspace saver settings only) and the
  rest ship as ready-to-run advice.

## 1.6.1

### Patch Changes

- Fix the published bundle inlining stale workspace builds: `prepack` now
  builds the CLI's full workspace dependency closure (`turbo build
--filter=@megasaver/cli...`) before bundling. The 1.6.0 tarball had baked a
  pre-roi `@megasaver/pro-analytics` dist, so the entitled `mega roi` path
  crashed with "computeRoi is not a function"; 1.6.0 is deprecated in favor of
  this release.

## 1.6.0

### Minor Changes

- 5c6a60f: `mega roi` — the month's measured savings divided by the Pro
  price, as an honest ROI multiple (saved-so-far + on-pace projection).

## 1.5.0

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

- f66d02b: `mega gui`: serve the packaged desktop console from the published CLI.

  `npm install -g @megasaver/cli && mega gui` now starts the GUI bridge and opens
  the console in your browser — no clone, no `pnpm`, no build. The command binds
  loopback-only, mints a per-run bearer token, serves the bundled GUI dist plus
  the `/api` bridge same-origin, prints the tokenized URL, and opens the browser
  (skip with `--no-open`). It runs in the foreground; Ctrl-C stops it.
  `--port <n>` pins the port, `--store <dir>` selects the store.

  - **@megasaver/cli**: new `mega gui [--port <n>] [--no-open] [--store <dir>]`
    command. The build now inlines the GUI bridge into the standalone bundle and
    ships the built frontend at `dist-bundle/gui`, resolved relative to the bundle
    at runtime.
  - **@megasaver/gui**: the bridge is hardened for distribution — loopback bind, an
    always-on bearer-token wall on every `/api` route (query token accepted for
    SSE), origin-derived CORS, and static serving of the built GUI. A new
    `@megasaver/gui/bridge` entry exposes `startGuiBridge` + `resolveShippedGuiDistDir`
    as the single boot path shared by the dev server and `mega gui`.

  Security: there is no code path where `mega gui` starts the packaged GUI without
  the token wall — no flag and no env disables `/api` auth.

- 2fe01eb: Add `mega init` — one-command onboarding that installs the Claude Code hooks
  and MCP bridge, enables the workspace saver (default mode `balanced`), and opens
  the GUI. Auto-runs with a per-step summary; `--yes` skips the confirmation
  prompt, `--no-gui` keeps it headless, and `--mode`/`--store` override the
  defaults. A failed step never aborts the rest and the exit code reflects any
  failure.
- 3ebc27d: Pro entitlement + historical savings analytics (open-core).

  The CLI core stays MIT and fully functional with no license. A new offline,
  Ed25519-signed license gates NEW Pro features; the first is historical savings
  analytics.

  - **@megasaver/entitlement** (new, MIT): fail-closed `checkEntitlement` +
    offline Ed25519 `verifyLicense` + license storage (`activateLicense`,
    `licenseStatus`, `deactivateLicense`). Anything tampered, expired, wrong-key,
    or malformed resolves to "not entitled" — never propagates a throw. Powers the
    new `mega license activate | status | deactivate` command.
  - **@megasaver/cli**: new `mega savings history [--by day|week|project]
[--json|--csv|--out]` and `mega savings export --format csv|json [--out]`.
    `checkEntitlement` gates FIRST: with no license each command prints an honest
    one-line upsell and exits 0, importing and computing nothing; only an entitled
    run lazily imports the Pro module, reads events (through `@megasaver/core`), and
    renders. The free CLI is unaffected.

  The proprietary Pro compute lives in `@megasaver/pro-analytics` (private,
  source-available, not MIT — see `packages/pro-analytics/LICENSE`), so it is not
  part of this changeset's published surface.

  Honesty: the gate is MIT/open-source and therefore bypassable by editing the
  source — inherent to open-core, stated plainly, no security theater. What is not
  forgeable is the license itself: keys are Ed25519-signed by an offline private
  key and verified against a public key baked into the CLI, fully offline.

- 1d448ee: Add `mega savings forecast` — a Pro-gated run-rate savings projection with an
  optional `--goal` pace, on the existing offline license.
- 9a47aaf: Add `mega savings insights` — a Pro-gated waste/efficiency breakdown (where
  tokens are still spent, by source/label) on the existing offline license.
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

### Patch Changes

- 019af14: Bake the production Ed25519 license-verification public key into the CLI. Real
  Pro license keys now validate; the placeholder (whose private half was discarded)
  is replaced. The matching private key is held offline by the vendor and is never
  committed.
- 21eaac5: Harden the published license disclosure for the bundled-Pro tarball. The
  `license` field is now `SEE LICENSE IN NOTICE` (the tarball inlines the
  proprietary `@megasaver/pro-analytics`, so a bare `MIT` overclaimed the whole
  package), and both the MIT `LICENSE` and the proprietary `PRO-LICENSE` now ship
  in the tarball alongside `NOTICE` so every referenced license text is present.

## 1.4.1

### Patch Changes

- Fix `npm i -g @megasaver/cli` failing with a 404. `@megasaver/proxy-control`
  was the only workspace package left in the CLI's `dependencies` (added with the
  persistent-proxy-routing work), so `changeset version` rewrote it to a concrete
  version that is never published. Move it to `devDependencies` like every other
  `@megasaver/*` package so tsup inlines it into the bundle and the publish-manifest
  strip removes it — the published package no longer references an unpublished dep.

## 1.4.0

### Minor Changes

- 69ce82f: Audit overlay fallback: when a session has no recorded audit overlay, fall back
  to the last known good overlay instead of rendering an empty panel, so the audit
  view stays useful across sessions that predate overlay capture.

  - `@megasaver/stats`: overlay resolution degrades gracefully — a missing
    per-session overlay resolves to the most recent available overlay rather than
    returning nothing.
  - `@megasaver/cli`: the audit command surfaces the fallback overlay and flags it
    as inherited so the operator knows the data is not session-specific.

- 297ebc2: Persistent proxy routing: one explicit CLI/GUI action persistently enables the
  local proxy for future supported Claude launches, owned by a dedicated
  supervisor LaunchAgent that reconciles desired↔actual state and never touches a
  foreign route or a process it did not start. Fixes the 2026-07-02 finding where
  the proxy was healthy but no client was routed (zero metering), and removes the
  GUI's boot/shutdown route-clearing that could strand a session.

  - `@megasaver/llm-proxy`: a nonce-bound ownership health endpoint (HMAC
    challenge-response) answered in-process and never forwarded upstream.
  - `@megasaver/proxy-control` (NEW, agent-agnostic): strict versioned control/
    runtime state stores; fenced owner identity + locks (pid + start-token +
    boot-id, PID-reuse-safe); the reconciliation recovery matrix as a pure,
    exhaustively-tested decision (a foreign route is never removed, no route is
    applied in a disable/drain transition, remove targets only a leased exact
    owned url); supervisor wiring (startup fixpoint + 5s monitor); and a macOS
    LaunchAgent adapter (structured plist, legacy-service-present manual bootout,
    idempotent-by-observation, foreign untouched).
  - `@megasaver/connector-claude-code`: a value-guarded Claude route adapter
    (inspect/apply/removeExpected/ensureHooks) that owns the `~/.claude/settings.json`
    route and never overwrites/removes a foreign value.
  - `@megasaver/cli`: `mega proxy start` (persist an enable intent + install the
    supervisor LaunchAgent), `stop` (enter drain) and `stop
--confirm-clients-restarted` (finish drain: stop the listener + reach terminal
    idle), `status [--json]` (read-only; separated facts + saver liveness from the
    heartbeat registry), `service uninstall --confirm`,
    and the internal `proxy supervise` daemon. The daemon binds a health-capable
    loopback listener and runs the reconcile state machine on a 5s cadence under a
    fenced transition lock, so a persisted enable intent becomes a live, verified
    route (closing the "healthy but unrouted" gap). `--upstream` is schema-
    validated and a non-default origin requires `--confirm-credential-forwarding`.
    **Public behavior break:** the old foreground `mega proxy start` is now
    `mega proxy supervise`.
  - `@megasaver/gui`: the proxy toggle persists desired state through the shared
    control plane (also under the transition lock) and no longer owns a listener,
    clears the route, or runs osascript.

  Security hardening (CRITICAL review): the handler forwards with
  `redirect:"manual"` (a cross-origin 3xx can't re-send the API key) and answers
  the reserved health path locally (never forwarded); the route mutator fsyncs and
  preserves file mode; the usage log is 0600/0700, symlink-refusing, with a bounded
  control-char-stripped model label; the lock re-judges quarantined content so a
  live owner is never stolen; the LaunchAgent verifies the managed plist byte-exact
  and restores a backed-up legacy plist on bootstrap failure.

  Deferred (flagged): the full GUI auth bootstrap (launch capability → HttpOnly
  SameSite cookie + CSRF) and cross-process supervisor discovery (runtime.json +
  control server). The single self-driving supervisor needs neither to route.

- b956259: Idempotent proxy start: a redundant `mega proxy supervise` bind no longer
  crashes on `EADDRINUSE`. Fixes the launchd crash-loop where a respawn (or a
  second `mega proxy start`) hit `listen EADDRINUSE 127.0.0.1:8787`, rejected the
  bind promise uncaught, and let the KeepAlive LaunchAgent respawn on repeat.

  `mega proxy supervise` binds through `bindWithRetry`. On `EADDRINUSE` it retries
  the bind a bounded number of times (~300 ms apart) to absorb the launchd respawn
  release-race; if a retry succeeds it starts normally. When `EADDRINUSE` persists
  across every attempt, another instance/process owns the port on a KeepAlive
  singleton, so the supervisor prints one clear stderr line and exits 0 —
  `KeepAlive{SuccessfulExit:false}` does not respawn a clean exit, which stops the
  crash-loop. A non-`EADDRINUSE` bind error still surfaces (non-zero exit); no raw
  stack trace, no unhandled rejection. The port holder is never killed — launchd
  owns lifecycle and the plist is unchanged.

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

- Updated dependencies [297ebc2]
  - @megasaver/proxy-control@0.2.0

## 1.3.0

### Minor Changes

- f9482db: feat(cli): `mega audit usage` — estimated savings vs your real Claude usage

  Fuses saver-hook tool-output compression savings (numerator) with the metering
  proxy's real per-call token counts from `usage.jsonl` (denominator) to estimate
  what fraction of your actual Claude token usage Mega Saver saved — the
  `% of total` view `audit honest` couldn't give (it only covers the mediated
  tool-output slice). Reports `saved of new context` and `saved of total processed`
  plus the raw token counts.

  Honest by construction: the numerator is windowed to the proxy's metering period,
  and the ratio **fail-closes** — when `saved > new context` (the fingerprint of
  partial proxy routing or a skewed window) both percentages are suppressed in
  favor of the raw counts and a "route all traffic through `mega proxy`" hint, so a
  partial-coverage 97% never masquerades as your real bill savings. Needs
  `mega proxy` running with your agent pointed at it.

## 1.2.1

### Patch Changes

- f58cb90: fix(cli): externalize the transformers/onnxruntime chain from the standalone bundle

  The v1.2.0 tarball shipped at 15.7MB because `tsup.bundle.config.ts` used
  `noExternal: [/.*/]`, which inlined `@huggingface/transformers` and copied six
  `onnxruntime_binding-*.node` native binaries into `dist-bundle/`. Those natives
  are built for a single CI OS, so they are dead weight on every other platform
  and bloat every install.

  The embeddings package already loads transformers through a guarded dynamic
  `import()` (lazy, first `embed()` call only) and every call site degrades on
  failure, so the chain is safe to resolve at runtime. The bundle now externalizes
  `@huggingface/transformers` + `onnxruntime-node`, and the CLI declares
  `@huggingface/transformers` as an optionalDependency so npm installs the correct
  platform binary on supported platforms (or skips it, leaving embeddings cleanly
  disabled) instead of every user carrying six wrong-platform `.node` files.

  Result: `mega.mjs` drops from 13.2MB to 11.2MB, the tarball loses all six native
  binaries, and semantic features work via the host-platform native. The inlined
  TypeScript compiler stays put so `mega index` still runs from a bare
  `node mega.mjs` download.

## 1.2.0

### Minor Changes

- edb9f06: Phase 5: `mega office` CLI commands + engine hoist

  - `@megasaver/agent-office`: hoisted `OFFICE_PROJECT_ID` + `ensureOfficeProject` from the bridge into the engine so CLI and bridge share one canonical office project id.
  - `@megasaver/cli`: new `mega office` command group — role/agent CRUD, assign, run (supervisor drain + fake-launcher injection), status, logs, pause/resume/stop. Safe-by-default: `full` roles blocked without `--allow-full`/`MEGA_OFFICE_ALLOW_FULL=1`.
  - `@megasaver/gui`: bridge `apps/gui/bridge/routes/office.ts` now imports and re-exports `OFFICE_PROJECT_ID` + `ensureOfficeProject` from `@megasaver/agent-office` (1-line swap, no behaviour change).

- ca611a8: Seed the office with a 24-role catalog modeled on addyosmani/agent-skills
  (one role per skill, grouped by lifecycle phase), replacing the 13 generic
  roles. Add `ensurePredefinedRoles` (idempotent) and wire it into the bridge
  startup + a `mega office role seed` command, so the roster actually appears in
  the GUI and CLI on first run. All seeded roles are `permissionMode: "plan"`
  (safe-by-default) and carry their skill slug in `skillPacks`.
- 62b3c65: Add honest token-reduction metrics: token-weighted eligible reduction reported
  alongside eligible/proxied/passthrough/mediated fractions, a GA gate pairing
  reduction with an evidence-sufficiency floor, and `mega audit honest`. Passthrough
  outputs never create positive savings; the headline reduction is reported as
  eligible-mediated-context-only and cannot be inflated by eligibility-set selection.
- da6e687: Intent-aware hook (Phase 6b): a UserPromptSubmit hook captures the latest prompt
  and fills it as the ranking intent for PostToolUse-captured native output when no
  explicit intent is present (fill-gap). Daemon /excerpt accepts an optional intent.
- f674fdd: Add an opt-in local Anthropic-API proxy (Phase 0): `@megasaver/llm-proxy` +
  `mega proxy start`. It binds 127.0.0.1, forwards `/v1/messages` (and all paths)
  to the upstream **unchanged** (transparent passthrough, streaming preserved),
  and records each round-trip's real token usage from Anthropic's `usage` —
  counts + model only, never prompts, responses, or auth keys. This is the
  measurement foundation for conversation-token saving (compression is a later
  phase). Relaxes mission §1 "not a model proxy" to permit this opt-in proxy.
- 031f6de: M4 transcript→memory: deterministically distill a recorded session's failures
  into `suggested` memories for the human approval gate (claude-mem-class session
  distillation, the no-LLM variant).

  - `@megasaver/core`: new pure `extractSessionMemories(input)` derives candidate
    memories from a session's structured `FailedAttempt` rows — a test-shaped
    failure → a `test_behavior` candidate, a generic one → a `bug` candidate
    (source `test_failure`), a `DECISION:` marker → a `decision` candidate
    (source `session_summary`). Identical candidates within a session collapse by
    content hash. No model, no I/O, no clock.
  - `@megasaver/cli`: `mega memory from-session <session>` stages the candidates
    as `suggested` (never auto-approves) and prints `suggested=N skipped=M`
    (`--json` available). Idempotent — a per-candidate dedupe key carried in the
    memory's keywords means a re-run stages no duplicates.
  - `@megasaver/mcp-bridge`: `mega_memory_from_session` MCP tool with the same
    behaviour (`{ sessionId } -> { suggested, skipped }`).

  Suggested memories are not recallable until a human approves them (M3 then
  surfaces semantic duplicates at the approve gate), so a noisy extractor never
  leaks into recall. Additive; no change to the memory data model, the approval
  gate, or existing FORGE/learn behaviour.

- 66817e2: Memory Graph — Phase 1: a typed projection of the memory you already capture into
  a navigable network, plus a visual graph view.

  - New leaf package `@megasaver/memory-graph`: pure `buildGraph(input)` projecting
    the existing entities into typed nodes (`project · session · memory · evidence
· chunkset`) and edges (`contains · scope · project-memory · cites · chunk-of ·
from-session · conflict · supersede · duplicate`). Depends only on `shared`+`zod`
    (no core import); the IO/loading lives in the bridge/CLI, so the projection is
    unit-tested entirely with fixtures.
  - `apps/gui` bridge endpoint `GET /api/claude-sessions/:dir/:id/memory/graph`
    loads overlay memory + evidence, computes conflict edges (`checkConflicts`),
    and returns the graph JSON; a new cockpit **Memory Graph** panel renders it with
    cytoscape.js (color by node kind, provenance arrows, conflict edges dashed,
    click a node for detail).
  - `mega memory graph <project> --json` prints the project-scoped graph
    (project/session/memory + conflict edges) for scripting and tests.

  Read-only projection — never mutates memory/evidence or user files; redacted
  evidence/chunk labels are rendered as-is. Code/symbol/wiki nodes, a memoization
  cache, and live SSE growth are Phase 2/3.

- 1e3bbe1: Memory Graph — Phase 2: unify the wiki + code layers into the graph, bridged by
  shared file nodes.

  - `@megasaver/memory-graph` (leaf) gains `file · symbol · wiki` node kinds and
    `code-link · wiki-link · wiki-source · wiki-cite` edge kinds, plus a pure
    `parseWikiPage(relPath, content)` (frontmatter title/tags/status/sources,
    `[[link]]` targets with alias/anchor stripped, and path-shaped `(source: path)`
    body citations). `buildGraph` projects `files`/`symbols`/`wikiPages` into the
    new nodes/edges, resolving `[[link]]`/`sources` to wiki pages by
    path/basename/title (collision-safe: an ambiguous basename/title resolves to
    nothing rather than the wrong page). The leaf stays shared+zod only — no fs,
    no yaml.
  - The bridge endpoint and `mega memory graph` now walk the project's
    `<cwd>/wiki/{entities,concepts,decisions,syntheses,workflows,sources}` (strictly
    path-confined to `<cwd>/wiki/`, symlinks skipped) and derive `file` nodes from
    `memory.relatedFiles` ∪ wiki `(source: …)` citations — so a file referenced by
    both a memory and a wiki page is ONE node, bridging runtime memory ↔ code ↔
    wiki knowledge.
  - The cockpit Memory Graph panel renders the new kinds (file slate, symbol
    grey-blue, wiki violet) with Wiki/Code layer toggles that hide a layer's nodes
    and their incident edges.

  Read-only — never mutates the wiki or user files; the wiki walk never reads
  outside `<cwd>/wiki/`. A materialization cache and live SSE growth remain Phase 3.

- 391e659: Add an on-demand memory-index build so semantic memory recall goes live
  (WS3 increment 2). `embedMemoryEntries` previously had no production
  caller, so the `get_relevant_memories` coverage guard always fell back to
  BM25.

  - `@megasaver/core`: `buildMemoryIndex(storeRoot, projectId, entries,
embedFn?)` — the missing caller. Reads the prior id→hash manifest,
    runs the incremental embedder (carry-forward unchanged memories), then
    rewrites the manifest. Returns `{ embedded, carried, total }`.
  - `mega memory index <project>` — CLI command building the per-project
    vector sidecar on demand (loads the model; never on the save hot path).
  - `mega_index_memory` — MCP tool doing the same build for an agent.

  `embedFn` is injectable so the command/tool logic is tested with a
  counting fake; the real model path is E2E-gated and CI stays model-free.

- 31238a3: M5 task-scope the `memoryRelevance` signal in the context pruner. Closes the
  WS3-inc1 §1B "Known imprecision (v1, accepted)" follow-up: both context-pruning
  boundaries fed ALL approved memory's `relatedFiles` to `memoryRelevance`,
  boosting every memory-touched file on every task regardless of task relevance.

  New pure core helper `taskRelevantMemoryFiles(memories, { taskVector,
memoryVectors, topK })` ranks approved, non-stale memories by
  cosine(taskVector, memoryVector), keeps the top-K above a small floor, and returns
  the deduped union of THEIR `relatedFiles` (the narrowed counterpart of
  `approvedMemoryFiles`). Eligibility mirrors `approvedMemoryFiles` EXACTLY
  (`approval === "approved" && !stale`, no validity/tier gating) so the scoped set
  is always a task-filtered subset of the fallback — the signal never flips on
  whether a sidecar exists. A best-effort orchestrator `taskScopedMemoryFiles` loads
  the project's memory-vector sidecar, reuses the task vector the pruner already
  computes for the code-block signal (MCP) or embeds the task itself (CLI), and
  returns null on no/empty sidecar, no task vector, or any failure.

  Both boundaries (`mcp-bridge` context-pruning.ts + `cli` context/shared.ts) now
  use `taskScopedMemoryFiles(...) ?? approvedMemoryFiles(memories)`: task-scoped
  when embeddings are available, falling back to all-approved otherwise. Additive,
  best-effort (never throws), recall-safe (no-sidecar behavior is byte-identical to
  today), deterministic, CI model-free (injected vectors in tests; real `embed()`
  E2E-gated). `staleMemoryFiles` is unchanged.

- abfaf3b: Add bi-temporal valid-time to memories (M1). `MemoryEntry` (and the
  overlay variant) gain optional, backward-compatible `validFrom` /
  `validTo` (valid time, alongside the existing `createdAt` / `updatedAt`
  transaction time) and `supersedesId`. New `isCurrent(memory, asOf)` and
  `isRecallable(memory, asOf)` helpers: `isRecallable` is the single shared
  recall predicate (approved AND currently valid) that every recall surface
  routes through — BM25 + semantic search, the MCP `recall` tool, the
  daemon recall handler, and the GUI connector-context builder — so the
  bi-temporal filter cannot drift between surfaces. `searchMemoryEntries`
  and `searchMemoryEntriesSemantic` filter to currently-valid memories and
  accept an optional `asOf` for time-travel ("what did we believe as of
  T"); the MCP `recall` / `get_relevant_memories` tools and the daemon
  recall route thread `asOf`. `save_memory` accepts `supersedesId`.
  Approving a memory that supersedes an older one closes the old memory's
  `validTo` (it drops out of default recall but is kept for time-travel —
  lossless); the supersede target is validated (same project + scope,
  not self, must exist) so an agent-controlled `supersedesId` cannot close
  a memory it should not touch or vanish itself. The CLI/GUI memory graphs
  emit a `supersede` edge from the recorded `supersedesId`. Rows without
  temporal fields are treated as current, so existing stores load
  unchanged.
- a2b5643: Add tiered memory + confidence decay to memories (M2, Letta/MemGPT-class
  working/recall/archival). Deterministic, no LLM, no background timer;
  additive and backward-compatible.

  `MemoryEntry` (and the overlay variant + update patch) gain an optional
  `tier` (`working` | `recall` | `archival`); an absent tier reads as
  `recall`, so existing stores load unchanged. The centralized recall
  predicate `isRecallable` is now tier-aware — it excludes `archival` by
  default and includes it only with `{ includeArchival: true }` — so all
  recall surfaces (BM25 + semantic search, the MCP `recall` /
  `get_relevant_memories` tools, the daemon recall handler, and the GUI
  connector-context builder) inherit tier filtering with no per-surface
  re-implementation. `searchMemoryEntries` / `searchMemoryEntriesSemantic`
  accept `includeArchival` and filter `archival` by default.

  New `effectiveConfidence(memory, now)` pure helper (exported) weights a
  memory's base confidence by age (30-day half-life) and tier (small
  working boost); it is read-time only and never mutates stored
  confidence. `searchMemoryEntries` multiplies BM25 scores by it so an
  aged/low-confidence memory ranks below a recent/high one — strictly a
  down-rank, never a drop. New `mega memory sweep <project>` CLI command
  and `mega_memory_sweep` MCP tool apply the one deterministic, lossless
  mutation: an approved, currently-valid memory that is closed/superseded,
  stale, or low-confidence-and-inactive is demoted to `tier = "archival"`
  (reversible, never deleted). Both report `archived=N scanned=M` (with
  `--json`) and are idempotent.

- d9eb170: Office agent `workdir` is now derived from the project directory instead of being
  chosen manually. The CLI `office agent create` command drops its `--workdir` flag
  and uses the invocation cwd; the GUI add-agent form no longer has a workdir field
  and uses the selected workspace's directory. The bridge now rejects an agent
  `workdir` that does not match its workspace (`encodeWorkspaceKey(workdir) === wk`).
- 900ce56: Phase 1 (DIMMEM) read/write surface over the typed memory schema.

  Core: `CoreRegistry` gains `updateMemoryEntry` (mutable-in-place patch,
  bumps `updatedAt`, rejects immutable-field changes), `deleteMemoryEntry`
  (hard delete; empties remove the project's JSONL rather than leaving a
  zero-byte file), and `searchMemoryEntries` — local, offline BM25
  (`@megasaver/retrieval`) over title+content+keywords with type/
  confidence/scope filters, stale excluded by default, newest-first when
  no text. New exports: `memoryEntryUpdatePatchSchema`,
  `memorySearchQuerySchema`, `searchMemoryEntries`, `MemorySearchQuery`.

  CLI: `mega memory create` gains typed flags (`--type --title --keyword
--confidence --source --reason --goal --file --expires`, all optional
  with neutral defaults); new `mega memory search/update/delete/explain`
  (`delete` requires `--yes`; `--json` on read commands).

  MCP bridge: three new tools — `save_memory`, `search_memory`,
  `get_relevant_memories` — widening the closed tool enum to seven.

- f1fe1d3: Phase 10 (Team/Cloud — local slice): memory approval workflow.
  `MemoryEntry` gains `approval` (`suggested | approved | rejected`);
  `backfillMemoryEntry` defaults existing rows to `approved` (backward
  compat). Agent `save_memory` writes default to `suggested`, human
  `mega memory create` to `approved`. `suggested`/`rejected` memory is
  gated out of connector sync, memory search / relevant-memories /
  context packs, and the MCP `get_project_context` / `mega_recall` tools —
  only approved memory is shared with agents/teammates. New: `mega memory
approve|reject`, `--all` review, the `approve_memory` MCP tool (24 → 25),
  `buildPrMemoryComment` + `mega github pr-comment`. Team-shared memory =
  a shared `--store` path + the approval gate. Hosted cloud sync, auth,
  private deployment, org rules, hosted audit, and a web approval UI are
  explicitly deferred.
- f7cbc28: Phase 2 (Semantic Repo Index): new `@megasaver/indexer` package that
  parses a repo into typed `CodeBlock`s — AST extraction for TS/JS/TSX via
  the TypeScript compiler API, structural extraction for Markdown (heading
  sections) and JSON (top-level keys + package.json `script:<name>`), an
  ignore-aware traversal-safe `scanRepo` (never follows symlinks; honors
  always-ignore + .gitignore + .megaignore; skips secret/binary/oversized
  files), an atomic JSON-directory store with `contentHash` incremental
  `buildIndex`, and BM25 `searchBlocks`. New `CodeBlockId` in
  `@megasaver/shared`. CLI gains `mega scan` and `mega index
build/status/search/show`. `typescript` is a CLI runtime dependency
  (externalized from the bundle).
- a0e05f7: Phase 3 (Context Pruning / LAMR): new `@megasaver/context-pruner`
  package — task-aware selection that scores the Phase 2 `CodeBlock` index
  with an 8-factor model (semantic BM25, userMention, testFailure,
  recentEdit, memory, dependency; stale/noise penalties), selects a
  6–8-block context pack under a token budget with dependency closure
  (never silently dropping a named/failing-test block), and emits per-block
  reasons + a savings audit. CLI gains `mega context
build/explain/audit/export`; the MCP bridge gains `get_relevant_context`,
  `get_relevant_code_blocks`, `explain_context_selection`, and
  `get_context_budget_report`. Memory relevance is passed in as data
  (no `@megasaver/core` edge); leaf package depends only on indexer +
  retrieval + shared.
- 27960fb: Phase 5 — FORGE failed-run learning. Adds failure-similarity search,
  convert-failure-to-rule (caller-supplied insight; engine does linkage,
  evidence seeding, and the convertedToRule flip atomically), and scored
  applicable-rule retrieval. New: 2 pure ranking modules + 3 CoreRegistry
  methods (updateFailedAttempt, searchFailedAttempts, convertFailureToRule),
  3 MCP tools (convert_failure_to_rule, find_similar_failures,
  get_applicable_rules; bridge now 18 tools), and CLI (mega fail, mega rules,
  mega learn from-failure). No LLM, no embeddings — reuses rankBm25.
- f7bb136: Phase 6 — Task Engine. Adds a deterministic task state machine: TaskPlan
  with embedded typed TaskSteps (scan/retrieve_context/plan/edit/test/debug/
  document/save_memory), dependency-aware status rollup, and selective retry
  (reset only the failed step + its transitive dependents, never the whole
  plan). The engine is a state tracker, not an executor — the calling agent
  runs each step and reports the outcome. New: branded TaskPlanId/TaskStepId,
  1 pure transition module, 5 CoreRegistry methods (createTaskPlan, getTaskPlan,
  listTaskPlans, recordTaskStep, retryTaskStep), 6 error codes, 4 MCP tools
  (build_task_plan, get_task_status, record_task_step, retry_failed_step;
  bridge now 22 tools), and CLI (mega task plan/status/step/retry/explain).
  Phase 5 (FailedAttempt) and Phase 1 (MemoryEntry) reuse is opt-in. No LLM,
  no embeddings.
- ed46198: Phase 7 — Tool Router. Adds a deterministic, per-project tool router. New
  first-class ToolDefinition entity (name/description, category enum
  [filesystem/search/git/test/package/database/deploy/browser/dangerous],
  risk enum [safe/medium/dangerous], normalized keywords, opaque
  z.unknown() inputSchema/outputSchema — descriptive only, never executed),
  stored as per-project JSONL. New pure routeToolsForTask(tools, query)
  reusing rankBm25: a security gate runs BEFORE relevance — a tool is
  blocked (never routed to a plain task) when risk=dangerous OR category in
  {dangerous, deploy, database}; among the rest, score>0 tools are allowed
  (descending score, id tiebreak), irrelevant tools are omitted. Returns
  { allowedTools, blockedTools, reason }. New branded ToolDefinitionId,
  4 CoreRegistry methods (createToolDefinition, getToolDefinition,
  listToolDefinitions, routeToolsForTask), 2 error codes
  (tool_definition_already_exists, tool_definition_not_found), 1 MCP tool
  route_tools_for_task (bridge now 23 tools), and CLI mega tools
  add/list/route/explain. Registration is CLI-only; the router only advises
  (no execution, no enforcement at a call site). No LLM, no embeddings.
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
- 00bd97e: Phase 9 — Multi-Agent Connectors. `agentIdSchema` widens to eight
  members (adds `continue`, `gemini`, `windsurf`).
  `@megasaver/connector-generic-cli` ships three new flat-file targets:
  `geminiTarget` (`GEMINI.md`), `windsurfTarget` (`.windsurfrules`),
  `continueTarget` (`.continue/rules/megasaver.md`) — each a frozen
  target object reusing the existing sync path (no new sync code). The
  CLI registers them in `KNOWN_TARGETS` and adds two commands:
  `mega connector list` (known targets + present/absent, exit 0) and
  `mega connector doctor` (per-target exists/writable/in-sync vs stale,
  exit 1 on any stale/not-writable/error). Cross-agent shared memory is
  proven by an integration test (project memory synced to two agents
  lands byte-identically in both files). `vscode`/`jetbrains` (native IDE
  plugins) and a `mega connect` alias are out of scope. The four shipped
  targets (`claude-code`/`codex`/`cursor`/`aider`) are byte-identical.
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

- 3e678e3: Realize Saver Mode on native tool output: a `mega hooks saver` PostToolUse hook
  compresses large Read/Bash/Grep/Glob/LS output (evidence-preserving — the full
  redacted output is stored as a recoverable chunk), feeds the model the
  compressed result via `updatedToolOutput`, and records per-session overlay
  events that populate the live GUI Token saver tab. Gated on the Saver Mode
  toggle + mode budget; never blocks (exit 0; any error or multi-modal output ⇒
  original untouched). `mega hooks install` now installs both the PreToolUse
  telemetry hook and the PostToolUse saver hook. Adds context-gate
  `recordAndFilterOverlayOutput`.
- d811e38: Real skill-packs subsystem: loadPack (manifest validation, path-escape
  and symlink guards), filesystem discovery (workspace beats global),
  atomic workspace installer with skill-id conflict detection, and the
  `mega pack {install,list,remove,info}` CLI. Retires the
  not_implemented placeholder error code.
- 4fe5749: runOutputPipeline now records a TokenSaverEvent per file read
  (RunOutputResult widens with store_write_failed), core re-exports the
  stats read/append surface, and `mega session saver stats` reads the
  real stats store (text totals + eventStats in --json; BB6 stub retired).
- 07bd0a7: Store path, GUI bridge store path, and skill-packs global packs root now
  use %LOCALAPPDATA%\megasaver on Windows (falling back to
  %USERPROFILE%\AppData\Local), and the env boundary reads
  HOME→USERPROFILE so the default location is correct on Windows. The
  win32 default fails loud (throws) when no base dir is resolvable rather
  than writing to a relative path. POSIX behavior is byte-identical. A new
  readStoreEnv() boundary centralizes the env read across CLI commands.

### Patch Changes

- 968f76b: Compress WebFetch output via the PostToolUse saver hook. `WebFetch` is added to
  the saver matcher and mapped to the `fetch` source kind, and the tool-response
  reader now handles WebFetch's shapes (a bare string or `{ result: string }`),
  swapping in compressed text while preserving the original schema. Output that is
  already small still passes through unchanged.
- 0a3256b: Fix three bugs surfaced by a full feature-test pass.

  - `rules apply --files` now matches `appliesTo` glob patterns. Matching
    used a plain `startsWith` prefix check, so globs like `*.ts` /
    `**/*.ts` never matched any path — the `--files` filter silently
    returned nothing. It now compiles globs through the policy
    `compileGlob` engine (newly exported from `@megasaver/policy`) while
    keeping the literal directory-prefix behaviour (`src/db/`).
  - `mega output file|filter|exec` now surface the secret-redaction
    warning (`redacted N secret(s) before processing`) in text mode. The
    warning was produced and stored in the result but only visible via
    `--json`, hiding a security-relevant signal from CLI users.
  - `mega index show <project> <bad-id>` now reports
    `invalid block id "<value>"` for a malformed block id instead of the
    misleading `name must be non-empty`.

- b01b09d: Fix the standalone `mega.mjs` bundle crashing at startup with
  `__filename is not defined in ES module scope`. The bundle inlines the
  TypeScript compiler (pulled in via `@megasaver/indexer`), which reads
  `__filename`/`__dirname` at module load — undefined in ESM. The
  `tsup.bundle` banner now shims `__filename` and `__dirname` (alongside
  the existing `require` shim) so every command, including `mega index`
  and `mega mcp serve`, runs from the single self-contained file with no
  `node_modules`. A CI bundle smoke (`node mega.mjs doctor`) and a
  local guarded test prevent the regression from returning.
- 42207dd: Never blind the model on zero excerpts. A specialized compressor could empty its
  input (misclassified output whose pattern never matches, e.g. grep results flagged
  as typescript), or every chunk could exceed the byte budget — both returned zero
  excerpts, leaving the model only a "0 kept" summary. `filterOutput` now applies a
  no-blind floor: when the compressed path yields no excerpts it re-chunks the
  normalized (uncompressed) output generically and keeps the top-ranked content
  within budget, truncating the single top chunk when even one chunk overflows.
  `fitBudget` keeps its byte-budget semantics; the floor lives in the pipeline.
- 32f852a: Fix memory `relatedFiles` and wiki `(source:)` citations splitting into two
  file nodes when the same path is referenced both ways. `parseWikiPage`
  canonicalizes `fileCites` (strips wrapping backticks/quotes, a `:line[-range]`
  suffix, and a leading `./`), but both graph loaders only stripped a leading
  `./` from `relatedFiles`. A `relatedFiles` entry like `src/x.ts:12` or
  `` `src/x.ts` `` therefore produced a distinct file-node id from the wiki
  fileCite `src/x.ts`, so the intended single bridged node — carrying both the
  `code-link` and the `wiki-cite` edge — never formed.

  The path canonicalization is extracted into a pure `canonicalizeFilePath`
  helper exported from `@megasaver/memory-graph` (shared + zod only; no fs/yaml).
  `parseWikiPage` calls it (fileCite behaviour unchanged), and both the CLI and
  bridge loaders apply it to `relatedFiles` at the loader boundary so the same
  canonical string feeds both the file-node set and `buildGraph`. `buildGraph`
  stays a pure projection.

- 2546fc2: Compress the real Claude Code Read output shape.

  Claude Code's Read tool delivers the file body at
  `tool_response.file.content`, but `readOutputShape` only matched a
  top-level `content` string/array, so every real Read result silently
  passed through uncompressed — the largest outputs (whole files) saved
  nothing. `readOutputShape` now handles the `{ type, file: { content } }`
  shape, swapping `file.content` while preserving the surrounding file
  metadata.

  Also adds unit coverage for the captured real `tool_response` shapes of
  Read, Grep (content mode → compresses) and Glob (filename list →
  evidence-preserving passthrough, never compressed). LS is not a real
  Claude Code tool, so the matcher entry is inert.

- 2546fc2: Fix the PostToolUse Saver hook reading the wrong payload field.

  `mega hooks saver` read the tool output from `tool_output`, but Claude
  Code delivers a PostToolUse hook's output under `tool_response`. The
  field was always absent, so `readOutputShape` returned `null` and every
  real tool call passed through uncompressed — Saver Mode recorded zero
  savings despite being enabled. The hook now reads `tool_response`, so
  eligible Read/Bash/Grep/Glob/LS output is actually compressed and
  recorded. The unit fixtures used the same wrong field name, masking the
  bug; they now use the real `tool_response` shape.

- a71f06e: Add an in-app "Connect Saver hook" toggle. The Token saver panel can now
  install/uninstall the global Claude Code Mega Saver hooks
  (`~/.claude/settings.json`) in the background, replacing the terminal-only
  `mega hooks install claude-code`. Hook-settings logic moved into
  `@megasaver/connector-claude-code` (new `uninstall`/`status` functions),
  exposed via a global bridge route `/api/hooks/claude-code` (GET/POST/DELETE)
  and a symmetric CLI `mega hooks uninstall claude-code`.
- 32f852a: Harden the Memory Graph against real-world data after Phase 2 (bug-fix sweep).

  - `buildGraph` now namespaces `file`/`symbol`/`wiki` node ids by kind
    (`file:` / `symbol:` / `wiki:`). These ids derive from free-form strings
    (paths, symbol names, wiki page paths) that can collide across kinds — a wiki
    page cited by its `.md` path, or one bare module name used as both a file path
    and a symbol — which previously produced two nodes sharing one id (the second
    silently dropped, one of its edges collapsed). The three id spaces are now
    disjoint, and `add` is idempotent on node id for within-kind repeats.
  - `parseWikiPage` strips a trailing ` #anchor` from `(source:)` citations so an
    anchored reference no longer yields a junk file-node id.
  - The bridge parents workspace-scoped overlay memories to a synthetic workspace
    project node, so project-scoped memories get their `project-memory` edge
    instead of rendering as orphans (matching the CLI graph shape).
  - GUI: the header node/edge counts reflect the _visible_ graph after a layer
    toggle (not the raw server totals); a selected node's detail panel clears when
    its layer is toggled off; `decision` memories get a distinct hue; empty meta
    arrays no longer render as blank detail rows.
  - Removed a dead lexical path-confinement guard (the symlink skip is the real,
    now-tested confinement) and added tests that exercise the symlink-escape path,
    `edgeCount == edges.length`, and `graphSchema` rejection.

- 1db07df: Plan 3c — per-target projection conformance. Add a fail-closed `projectionPreflight`
  (spec §11 matrix + §14 "projection preflight failure aborts the connector write")
  that validates the final rendered connector output before the atomic write: exactly
  one balanced Mega Saver managed block, a balanced `CONTEXT_GATE` block when present,
  and surviving header/frontmatter for header targets (Cursor). It reuses `parseBlock`,
  rewraps a `block_conflict` as a new `projection_invalid` error code, and is
  agent-agnostic (takes the rendered string + `{ expectHeader }`, not a `ConnectorTarget`).

  `mega connector sync` now runs the preflight before each write (seed + update paths);
  an unconformant projection aborts only that connector's write — the store and other
  targets are untouched. A unified conformance matrix test across all 7 known targets
  (Claude Code, Codex, Cursor, Aider, Gemini, Windsurf, Continue) pins §11 as a
  regression guard. Preflight is defense-in-depth: `upsertBlock` is already correct, so
  this guards against a future renderer/merge regression silently corrupting a user's
  agent-config file.

- 4c184db: Connector drift detection now classifies in-sync/noop by EOL-normalized
  comparison, so a file whose halves merely disagree on line ending (CRLF
  vs LF, common on Windows) is no longer misreported as drift. The
  EOL-preserving bytes written on a real change are unchanged. New
  `normalizeEol` export on `@megasaver/connectors-shared`.

## 1.0.2

### Patch Changes

- 7936a25: Packaging polish for `@megasaver/cli` ahead of npm publish.

  - The displayed version now comes from a build-time `__MEGA_CLI_VERSION__`
    define in the standalone bundle and from `package.json` in the unbundled
    build. No environment variable is consulted, so a stray `MEGA_CLI_VERSION`
    no longer overrides the reported version.
  - The published tarball no longer carries the build-only `devDependencies`
    (the 8 private `@megasaver/*` workspace packages plus citty and zod). A
    `prepack`/`postpack` step strips them from the packed manifest while leaving
    the source `package.json` untouched, so the self-contained bundle ships with
    zero dependencies and SCA tooling sees no references to unpublished packages.

- 3b499c5: Make `@megasaver/cli` publishable as a self-contained package.

  The `mega` CLI is now distributed two ways: a standalone `mega.mjs` bundle
  attached to GitHub Releases, and (when a maintainer supplies `NPM_TOKEN`) the
  `@megasaver/cli` npm package. The published package ships only the inlined
  bundle — every `@megasaver/*` workspace dependency and npm dependency (citty,
  zod, the MCP SDK) is bundled in, so the package has no runtime dependencies and
  the 13 internal `@megasaver/*` packages stay private. `bin.mega` points at the
  bundle and `publishConfig.access` is `public`.

## 1.0.1

### Patch Changes

- Updated dependencies [a2526d3]
  - @megasaver/core@1.0.1
  - @megasaver/connector-generic-cli@1.0.1
  - @megasaver/connectors-shared@1.0.1
  - @megasaver/mcp-bridge@1.0.1

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

- 4660d37: Add the `mega session saver {enable,disable,status,stats}` command surface
  (AA1 epic, BB2). `enable` toggles Mega Saver Mode on a session with a
  required `--mode safe|balanced|aggressive`, persisting `tokenSaver`
  settings via `CoreRegistry.updateTokenSaver`; `disable` clears the
  enabled flag; `status` and `stats` report current state. `--mode` is
  rejected on the non-enable subcommands. `stats` reports settings only and
  signals that per-call event stats arrive with BB6 (no faked data source).
  A new `invalidModeMessage` / `unexpectedModeMessage` pair is exported from
  `apps/cli/src/errors.ts`.
- 67d66dc: Add the `mega output {file,filter,chunk}` CLI surface. `mega output file`
  reads an on-disk file through the two-gate path-safety pipeline, runs it
  through `filterOutput`, and optionally persists the resulting chunk-set.
  `mega output filter` runs an existing log file through the same filter
  pipeline (sandbox resolver only) so `pnpm test > log.txt && mega output
filter` works. `mega output chunk` returns a single stored chunk from a
  previously persisted chunk-set, located by `<chunk-set-id>` alone. No
  child-process execution is introduced (enforced by a `no-child-process`
  guard test); the commands wire `@megasaver/policy`,
  `@megasaver/output-filter`, and `@megasaver/content-store` into the CLI
  behind the existing path-safety and redaction gates.
- 751df6c: Add `mega output exec` — the first user-visible child-process spawn in
  Mega Saver. A new core orchestrator `runOutputExecCommand`
  (`packages/core/src/context-gate/run-command.ts`, re-exported from the
  `context-gate.ts` barrel) spawns a policy-gated child process and runs
  its combined stdout+stderr through the redact -> filter -> store ->
  stats pipeline; the `mega output exec` CLI command is a thin adapter
  that calls it, and BB8's MCP `mega_run_command` will reuse the same
  entry point.

  Security invariants enforced and tested: `policy.evaluateCommand` runs
  BEFORE spawn (deny-before-spawn, with a spawn-never-called assertion on
  every denial branch — `command_not_allowed`, `dangerous_pattern`,
  `recursive_megasaver`); `MEGASAVER_ORIGIN_PID` is set on the spawned
  child env and checked on entry so a descendant re-entering Mega Saver is
  denied `recursive_megasaver`; redaction runs before persistence (the
  raw unredacted output is never stored). The child's exit code is
  mirrored on a clean run; `--timeout`/`--max-bytes` bounds (defaults 300s
  / 20MB) force-terminate but still persist the partial output as exit 1.

  `@megasaver/core` now depends on `@megasaver/stats` for the stats step;
  this is acyclic (stats never imports core) and the dependency-direction
  allow-list is widened accordingly. `@megasaver/cli` gains no direct
  stats dependency — it consumes the orchestrator through
  `@megasaver/core` only.

- 0e9be7a: BB8: real MCP bridge over stdio (four tools: mega_fetch_chunk,
  mega_read_file, mega_recall, mega_run_command), McpBridgeErrorCode
  widened to 16 members, McpToolName closed enum, the
  `mega mcp install/repair/serve/status/uninstall` CLI, and the
  `McpSetupOps` facade (with `aggregateMcpStatus` reporting
  `mcpInstalled`/`connectorSynced`/`restartRequired`/`restartHint`
  per agent) wired into the GUI bridge as the production `mcpOps`.
  Replaces the v0.3 not_implemented placeholder. createBridge API
  preserved (AA1 §2c).

  `mega mcp serve` is the long-running stdio launch entry an agent
  spawns to reach the bridge: it resolves the store + a
  JsonDirectoryCoreRegistry (as `mega output exec` does), starts the
  bridge over stdio, and shuts down cleanly on stdin-EOF / SIGINT /
  SIGTERM. To make the installed config runnable, `installMcp` now
  writes `{ command, args }` (idempotency compares both) and
  `mega mcp install`/`repair` default to `command: "mega"`,
  `args: ["mcp", "serve"]` instead of the unlaunchable `"mega-mcp"`
  literal (gap found by the AA1 §16 live smoke).

- 367d325: feat: add session CRUD CLI commands and core endSession method

  `@megasaver/core` gains `CoreRegistry.endSession(id, { endedAt })`
  on both registry implementations and a new `session_already_ended`
  error code. `@megasaver/cli` gains four `mega session` subcommands
  (`create`, `list`, `show`, `end`) plus the supporting CLI error
  helpers.

- cfab2fa: Add `mega connector status <projectName> [--target <id>]` — read-only
  report of per-target sync state. Status words: `in-sync`, `drift`,
  `no-block`, `missing`, `error`. Exit `0` when every line is `in-sync`
  or `missing`; `1` if any line is `drift`, `no-block`, or `error`.
- aa6bee3: feat: add `mega connector sync` CLI command

  Wires the existing `@megasaver/connectors-shared` and
  `@megasaver/connector-generic-cli` primitives into a single user-facing
  verb. `mega connector sync <projectName>` writes a Mega Saver block
  into each known agent file (`CLAUDE.md`, `AGENTS.md`) under the
  project's `rootPath`. Default behaviour skips files that do not
  already exist; `--target <id>` opts a specific target into seeding.
  Best-effort partial failure: each target reports its status (`wrote`,
  `noop`, `created`, `skipped`, `error`) on stdout; exit 1 if any
  target failed.

- 04987a8: Add `mega session update <sessionId> [--title …] [--risk …] [--agent …]`
  for partial mutation of an open session. Empty `--title ""` clears
  to `null`; ended sessions are rejected (`session_already_ended`);
  `mega session update <id>` with no flags emits `error: nothing to
update`. `@megasaver/core` exports `sessionUpdatePatchSchema` and a
  new `CoreRegistry.updateSession(id, patch)` method on both the
  in-memory and JSON-directory implementations. `apps/cli`'s
  `commands/session.ts` is split into a `commands/session/`
  directory closing v0.1 backlog item I5.
- 7a199b6: Add `mega memory create/list/show` subcommands as a thin CLI layer
  over the existing `CoreRegistry.{createMemoryEntry,getMemoryEntry,
listMemoryEntries}` surface. Append-only ledger; no `delete` or
  `update`. `--content` rejects empty / control-char / multi-line at
  the CLI boundary via a new `contentSchema` (mirrors `titleSchema`).
  Cross-field guard: `--scope project` rejects `--session`;
  `--scope session` requires `--session <uuid>`. `mega connector
sync` / `status` continue to pass `memoryEntries: []` to
  `buildConnectorContext` — wiring to read real entries is a
  separate slot.

### Patch Changes

- 0c30651: Ship the final AA1 epic surface (BB11): GUI AgentSetupDoctor + connector
  CONTEXT_GATE block.

  `@megasaver/connectors-shared` gains `renderContextGateBlock` (rendered only
  when `session.tokenSaver?.enabled === true`) plus the `MEGA SAVER:CONTEXT_GATE`
  sentinel constants. `parseBlock(content, sentinels?)` is now parameterised by
  sentinel pair (defaulting to the legacy pair, so every existing caller is
  byte-unaffected) and `upsertBlock` manages the legacy + CONTEXT_GATE blocks in
  one pass.

  `@megasaver/mcp-bridge` hoists `DEFAULT_MCP_COMMAND` / `DEFAULT_MCP_ARGS`
  (`mega` + `["mcp","serve"]`) and threads an optional `args` through
  `buildMcpSetupOps` so the written MCP config is a runnable launch command.

  `@megasaver/gui` adds the Agent setup view (`agent-setup-doctor` +
  `agent-setup-row`), four zod-validated bridge routes under `/api/mcp/*`
  (status/install/repair/uninstall) consuming BB8's `McpSetupOps`, the
  `mcp_setup_failed` bridge error code, api-client methods, and the
  `agent-setup` nav tab. The GUI bridge now writes a runnable `mega mcp serve`
  launch command on install.

  `@megasaver/cli` connector-sync now seeds a brand-new agent file via
  `upsertBlock` (so it also receives the CONTEXT_GATE block when the session has
  Mega Saver Mode enabled); output stays byte-identical for tokenSaver-off
  sessions.

- 084123d: Extract the context-gate output orchestrator into `@megasaver/core`. The
  redact/gate/read/filter/persist pipeline and chunk lookup now live in
  `packages/core/src/context-gate/` behind the `context-gate.ts` barrel,
  exposing `runOutputPipeline`, `fetchChunk`, and `locateChunkSet` plus the
  supporting helpers. The `mega output {file,filter,chunk}` CLI commands
  become thin adapters that call the core orchestrator instead of owning the
  pipeline locally; behavior is preserved. This gives BB8 a single
  package the MCP bridge can import (§2a/§8d). A dependency-direction test
  enforces the §3c cycle guard: core depends only on shared, policy,
  output-filter, and content-store, and never on mcp-bridge or apps.
- b0e4382: Wire `mega connector sync` and `mega connector status` to read
  real memory entries via `registry.listMemoryEntries(project.id)`.
  The connector context now includes project-scoped entries plus
  session-scoped entries belonging to the target's
  currently-picked open session. Other agents' session-scoped
  memory is filtered out. Empty-memory projects continue to render
  `- none` byte-identically.
- abd3414: Fix `mega connector status`: swap `pickLatestOpenSession` to a
  `Date.parse` numeric comparator (correct ranking under mixed
  RFC 3339 offsets) and emit the `session=<id|none>` suffix on the
  `error` status line for column symmetry across all five status
  words. Sync output is unchanged.
- 0498b79: Add Cursor as a connector target. `agentIdSchema` widens to four
  members (adds `"cursor"`); `@megasaver/connector-generic-cli`
  ships a new `cursorTarget` writing `.cursor/rules/megasaver.mdc`
  and gains an optional `ConnectorTarget.header` field that the CLI
  prepends on first seed (used to write Cursor's required YAML
  frontmatter once). Existing `claude-code` and `codex` paths are
  byte-identical. `mega session create --agent cursor` and
  `mega connector sync demo --target cursor` work end-to-end.
- Updated dependencies [93840ac]
- Updated dependencies [0c30651]
- Updated dependencies [61efb28]
- Updated dependencies [a8b6531]
- Updated dependencies [ae41534]
- Updated dependencies [084123d]
- Updated dependencies [751df6c]
- Updated dependencies [0e9be7a]
- Updated dependencies [b7f35e3]
- Updated dependencies [522fad4]
- Updated dependencies [367d325]
- Updated dependencies [a3a4401]
- Updated dependencies [a3a4401]
- Updated dependencies [d0003b5]
- Updated dependencies [a0f0c94]
- Updated dependencies [256eb34]
- Updated dependencies [0498b79]
- Updated dependencies [04987a8]
- Updated dependencies [4a56e4c]
  - @megasaver/shared@1.0.0
  - @megasaver/connectors-shared@1.0.0
  - @megasaver/mcp-bridge@1.0.0
  - @megasaver/policy@1.0.0
  - @megasaver/content-store@1.0.0
  - @megasaver/output-filter@1.0.0
  - @megasaver/core@1.0.0
  - @megasaver/connector-generic-cli@1.0.0
