# @megasaver/gui

## 1.3.0

### Minor Changes

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

- b5c6c0d: Workspace token-saver totals: aggregate per-session token-saver stats into a
  workspace-wide total so the GUI can report savings across every session in a
  repository, not just the active one.

  - `@megasaver/stats`: totals aggregation over the session set — sums input,
    output, and saved tokens across sessions and derives the workspace savings
    rate from the aggregate rather than averaging per-session rates.
  - `@megasaver/gui`: the token-saver panel reports the workspace-wide totals
    alongside the active session's figures.

### Patch Changes

- Updated dependencies [69ce82f]
- Updated dependencies [326ed5a]
- Updated dependencies [26106bc]
- Updated dependencies [297ebc2]
- Updated dependencies [794be8b]
- Updated dependencies [4269f42]
- Updated dependencies [b5c6c0d]
  - @megasaver/stats@1.2.0
  - @megasaver/mcp-bridge@1.2.0
  - @megasaver/connectors-shared@1.2.0
  - @megasaver/core@1.2.0
  - @megasaver/shared@1.2.0
  - @megasaver/context-gate@0.4.0
  - @megasaver/llm-proxy@0.2.0
  - @megasaver/proxy-control@0.2.0
  - @megasaver/connector-claude-code@1.2.0
  - @megasaver/daemon@0.1.1
  - @megasaver/agent-office@0.1.1
  - @megasaver/connector-generic-cli@1.1.1
  - @megasaver/content-store@1.1.1
  - @megasaver/context-pruner@0.2.1
  - @megasaver/evidence-ledger@0.2.1
  - @megasaver/indexer@0.2.1
  - @megasaver/memory-graph@1.1.1
  - @megasaver/policy@1.2.1

## 1.2.0

### Minor Changes

- a06fe95: Add `/api/office/*` bridge routes: role CRUD, workspace-scoped agent/task CRUD,
  fire-and-forget run, pause/resume/stop control, audit log, status snapshot, and
  SSE live stream. Adds `office_not_configured` and `office_not_found` to
  `BridgeErrorCode`. Production server wires `createClaudeCodeLauncher` +
  `createLauncherRegistry` into the bridge automatically; `MEGA_OFFICE_ALLOW_FULL=1`
  env opts into full-permission mode.
- 638a5d8: Add Agent Office GUI view: role manager, agent board with live SSE status updates, per-workspace agent create/run/pause/stop/remove/assign, and full-permission warning.
- 2c2fdd4: Minimalist Editorial Workspace redesign: warm monochrome tokens, grouped cockpit tabs, hero-metric token saver, and simplified session list.
- 2134959: Expand the GUI from a sessions + memory + agent-setup shell into the full
  ContextOps surface (P0 + P1 of the GUI analysis).

  **New bridge endpoints** (each with zod boundary schema, error-code mapping, and
  tests): `POST /api/projects` (create; validates rootPath exists/dir/readable,
  rejects duplicate names); `PATCH`/`DELETE /api/memory/:id` (approve/reject/edit/
  delete); typed-memory fields + `query`/`limit`/`offset` on `GET /api/memory`;
  and read-only `GET /api/projects/:id/{audit,rules,index,index/search,context,
tasks,tools}`.

  **New views + IA**: a left sidebar (Workspace / Tools groups) replacing the
  3-link top nav; an **Overview** dashboard landing (audit savings cards with a
  counts/MCP fallback for new projects); a header **New project** form; Rules,
  Index (status + search), Context preview, Tasks, and Tools-router views; and
  memory approve/reject/delete + search controls.

  **Contract additions**: three `BRIDGE_ERROR_CODES` — `index_unavailable`,
  `memory_entry_not_found`, `rootpath_invalid` — with copy + type-pin updates;
  `DELETE` added to the CORS allow-list. New workspace deps: `@megasaver/indexer`,
  `@megasaver/context-pruner`.

  Long-running mutations (index build, connector sync, audit export) and
  command-running tools remain CLI-only by design (they need the job/progress
  model and policy gating described in the analysis).

- e2f7867: Add workspace-scoped Saver Mode activation to the live GUI. A new "Saver Mode"
  workspace tab toggles Mega Saver Mode for a folder by writing the CONTEXT_GATE
  block into <cwd>/CLAUDE.md (sentinel-bounded, atomic) and reports MCP-install
  status. connectors-shared exposes renderContextGateBlockText +
  upsertContextGateBlockText for the render-in-bridge path.
- fde8e86: Live-first Phase 0 — surface per-turn telemetry the live Claude Code
  transcript already carries, read-only and additive, without touching the
  project model.

  **parse**: `normalizeLine` now retains an optional `meta` (`model`,
  `usage`, `gitBranch`) on `NormalizedMessage`, omitted entirely when the
  line has no signal — existing `{ role, ts, blocks }` consumers (transcript
  renderer, SSE) are byte-for-byte unchanged.

  **reader**: `readSessionTitles` additionally reads `isArchived`, `model`,
  `permissionMode` from `local_*.json`; `ClaudeSessionMeta` gains those plus
  the already-read `lastActivityAt`, each type-guarded with a safe default.

  **telemetry**: new pure `aggregateTelemetry(messages)` → token totals,
  model mix (turn-desc), turn/tool-call counts, duration, and git branch.

  **endpoint**: `GET /api/claude-sessions/:dir/:id/telemetry` returns the
  aggregate, mirroring the snapshot route's 400/404/405/500 envelopes and
  the identical `safeSessionPath` traversal guard.

  **GUI**: a read-only telemetry panel (LLM context tokens — distinct from
  the token-saver proxy metric), an archived filter (default hide), and
  `model`/archived row badges in the sessions view.

- fde8e86: Live-first Phase 5: make the GUI app project-free.

  The live session cockpit is now the only shell. Deletes from `apps/gui`:

  - the legacy project-scoped bridge routes (projects/sessions/memory/
    audit/rules/context/tasks/tools/index/retention and the legacy
    `/api/sessions/:id/token-saver`); handler.ts now 404s those paths.
  - the unused Core `registry` from the bridge `RouteContext`,
    `BridgeHandlerOptions`, and `server.ts` wiring (it remains only as
    `createMcpOps`' own dependency).
  - the project-scoped views (overview/sessions/memory/rules/index/
    context/tasks/tools) and the components only they used (project
    picker/create form, memory/session forms, legacy token-saver
    panel/modal/stats, savings/badges, retention controls).
  - the project/legacy endpoints from the api client (only `fetchHealth`
    and the MCP setup endpoints remain) and the project-scoped view ids.

  The live + workspace + session-overlay surface (F0–F4) and `agent-setup`
  are unchanged. `@megasaver/core`, the CLI, and `@megasaver/mcp-bridge`
  are untouched.

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

- fac4421: Talk to an office agent (Phase B). The transcript panel gains a message box:
  sending a message posts to a new `POST /api/office/:wk/agents/:id/chat` endpoint
  that records a `user` turn in the transcript, queues it as a task, and runs the
  agent — resuming its claude session so the conversation has continuity. The
  reply streams back into the same live feed. Adds a `user` transcript role.
- 4be82f8: Add a live agent transcript (Phase A). The supervisor now projects each claude
  stream-json event into a compact `TranscriptEntry` (assistant text, tool calls,
  results) and persists it per-agent; the bridge exposes a backlog route and a
  live SSE stream; the GUI office board opens a read-only activity feed when you
  click an agent. New `officeTranscriptId` branded id in `@megasaver/shared`.
- 07bd0a7: Store path, GUI bridge store path, and skill-packs global packs root now
  use %LOCALAPPDATA%\megasaver on Windows (falling back to
  %USERPROFILE%\AppData\Local), and the env boundary reads
  HOME→USERPROFILE so the default location is correct on Windows. The
  win32 default fails loud (throws) when no base dir is resolvable rather
  than writing to a relative path. POSIX behavior is byte-identical. A new
  readStoreEnv() boundary centralizes the env read across CLI commands.

### Patch Changes

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
- 75e99fc: feat(gui): surface context daemon status (GET /api/daemon + cockpit panel)
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

- d9eb170: Office agent `workdir` is now derived from the project directory instead of being
  chosen manually. The CLI `office agent create` command drops its `--workdir` flag
  and uses the invocation cwd; the GUI add-agent form no longer has a workdir field
  and uses the selected workspace's directory. The bridge now rejects an agent
  `workdir` that does not match its workspace (`encodeWorkspaceKey(workdir) === wk`).
- 7d2d1be: Token-saver panel now shows when each save happened: a "when" column on the
  per-save table (local date + time to the second, `YYYY-MM-DD HH:MM:SS`) and a
  "Last save" row in the session summary. Render-only — uses the `createdAt` /
  `updatedAt` timestamps already present on the saver event/stats records.
- Updated dependencies [7fcd881]
- Updated dependencies [8ff3003]
- Updated dependencies [de4ffb2]
- Updated dependencies [edb9f06]
- Updated dependencies [ca611a8]
- Updated dependencies [c12a575]
- Updated dependencies [c12a575]
- Updated dependencies [7fcd881]
- Updated dependencies [a3306ec]
- Updated dependencies [44931b7]
- Updated dependencies [5250357]
- Updated dependencies [f10c761]
- Updated dependencies [62b3c65]
- Updated dependencies [46dce69]
- Updated dependencies [9fc766e]
- Updated dependencies [968f76b]
- Updated dependencies [0a3256b]
- Updated dependencies [7c916db]
- Updated dependencies [da9d3a7]
- Updated dependencies [32f852a]
- Updated dependencies [a71f06e]
- Updated dependencies [e2f7867]
- Updated dependencies [b2e39cd]
- Updated dependencies [da6e687]
- Updated dependencies [ede092b]
- Updated dependencies [fde8e86]
- Updated dependencies [fde8e86]
- Updated dependencies [f674fdd]
- Updated dependencies [f62f88f]
- Updated dependencies [031f6de]
- Updated dependencies [66817e2]
- Updated dependencies [32f852a]
- Updated dependencies [1e3bbe1]
- Updated dependencies [391e659]
- Updated dependencies [31238a3]
- Updated dependencies [4e8c6e8]
- Updated dependencies [abfaf3b]
- Updated dependencies [a2b5643]
- Updated dependencies [fac4421]
- Updated dependencies [4be82f8]
- Updated dependencies [b1978fa]
- Updated dependencies [97ccb98]
- Updated dependencies [aa42dbd]
- Updated dependencies [900ce56]
- Updated dependencies [900ce56]
- Updated dependencies [f1fe1d3]
- Updated dependencies [f7cbc28]
- Updated dependencies [a0e05f7]
- Updated dependencies [12c8e9e]
- Updated dependencies [27960fb]
- Updated dependencies [f7bb136]
- Updated dependencies [ed46198]
- Updated dependencies [484f243]
- Updated dependencies [00bd97e]
- Updated dependencies [1db07df]
- Updated dependencies [39e5eb6]
- Updated dependencies [39e5eb6]
- Updated dependencies [39e5eb6]
- Updated dependencies [3e678e3]
- Updated dependencies [f46ce66]
- Updated dependencies [3290664]
- Updated dependencies [5431672]
- Updated dependencies [14868ee]
- Updated dependencies [4fe5749]
- Updated dependencies [4c184db]
- Updated dependencies [38a04c9]
  - @megasaver/agent-office@0.1.0
  - @megasaver/shared@1.1.0
  - @megasaver/connectors-shared@1.1.0
  - @megasaver/connector-claude-code@1.1.0
  - @megasaver/context-gate@0.3.0
  - @megasaver/content-store@1.1.0
  - @megasaver/indexer@0.2.0
  - @megasaver/context-pruner@0.2.0
  - @megasaver/daemon@0.1.0
  - @megasaver/stats@1.1.0
  - @megasaver/evidence-ledger@0.2.0
  - @megasaver/policy@1.2.0
  - @megasaver/core@1.1.0
  - @megasaver/mcp-bridge@1.1.0
  - @megasaver/memory-graph@1.1.0
  - @megasaver/llm-proxy@0.1.0
  - @megasaver/connector-generic-cli@1.1.0

## 1.1.0

### Minor Changes

- 76ebfb8: Add a token-savings trend chart and raw-output retention controls to the
  Mega Saver Mode panel.

  - **Savings chart (3c):** a hand-rolled inline-SVG bar chart (no charting
    dependency) of per-event `savingRatio`, embedded in the token-saver stats
    block. Accessible as `role="img"` with an `aria-label` summarising the trend
    ("Savings trend: N events, avg X%"); empty state when there are no events.
  - **Retention controls (3d):** new bridge routes
    `GET /api/sessions/:id/retention` (chunk-set count, total bytes, oldest
    timestamp), `POST .../retention/clear`, and `POST .../retention/prune`
    ({days}) — all strictly scoped to the session's own stored output via
    `@megasaver/content-store`. The GUI shows the stored-output summary and a
    destructive "Clear stored raw output" action behind an explicit two-click
    in-UI confirm, with the result announced through a polite live region.

### Patch Changes

- @megasaver/content-store@1.0.1
- @megasaver/core@1.0.2
- @megasaver/mcp-bridge@1.0.2
- @megasaver/stats@1.0.1
- @megasaver/connector-generic-cli@1.0.2
- @megasaver/connectors-shared@1.0.2

## 1.0.1

### Patch Changes

- 55d54fb: Fix WCAG 2.1 AA color-contrast (SC 1.4.3) on two GUI active/selected states in
  light mode.

  The active nav item (`bg-accent/15`, `aria-current="page"`) and the active
  segmented "+ New …" chip (`bg-accent/20 border border-accent/30`) labelled
  their text with `text-accent`. Composited over the page background, the amber
  label cleared only 4.03:1 (nav) and 3.75:1 (chip) — below the 4.5:1 normal-text
  threshold. The label colour is now `text-text-primary`, which composites to
  13.6:1 (nav) and 12.6:1 (chip) in light and 13.8:1 / 12.4:1 in dark; every
  state now passes AA in both themes. The accent tint fill, accent border, and
  `font-medium` remain as the selected-state signal (SC 1.4.1 was already met by
  fill + border + weight), so the visual language is unchanged. Component class
  strings only; no token values changed.

- 3e6ad88: Fix WCAG 2.1 AA color-contrast failures in two GUI design tokens.

  `--color-accent` (light) darkened `#c4681a` → `#a25616` so `text-accent`
  (status labels, links, Retry) clears 4.5:1 on every surface and the
  primary button label (white on accent) clears 4.5:1. `--color-text-muted`
  darkened in light `#9ea3ad` → `#646b77` and lightened in dark
  `#565b66` → `#8b909d` so secondary/instruction text clears 4.5:1 in both
  themes. Hue and saturation preserved (warm amber / neutral grey); the dark
  accent already passed AA and is unchanged. CSS token values only.

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

- 9139ccc: Add the GUI Mega Saver Mode surface (AA1 BB10): TokenSaverPanel
  (enable/disable + mode picker), token-saver modal + stats, and a
  savings badge in the sessions list. New bridge routes under
  `/api/sessions/:id/token-saver/{enable,disable,status,stats,events,events/:eventId/raw,events/:eventId/sent}`.
  The panel renders only on open sessions; ended sessions show no
  mutation surface. Events/raw/sent return empty/null honestly when no
  content-store entries exist (no fabricated stats).
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

### Patch Changes

- Updated dependencies [93840ac]
- Updated dependencies [0c30651]
- Updated dependencies [a8b6531]
- Updated dependencies [6078dc9]
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
  - @megasaver/content-store@1.0.0
  - @megasaver/stats@1.0.0
  - @megasaver/core@1.0.0
  - @megasaver/connector-generic-cli@1.0.0
