---
title: Wiki Index
updated: 2026-06-04
---

# Wiki Index — Mega Saver

> **Session start: read this file first.** It tells you what exists in the wiki and where to look.

## Decisions (locked-in choices)

- [[decisions/bootstrap-matrix]] — the 10 foundation decisions (path, repo, stack, MVP, language, git…)
- [[decisions/policy-is-bb3]] — `@megasaver/policy` ships at BB3 (v0.5), not the v0.9 roadmap.
- [[decisions/content-store-no-core-edge]] — AA1 §3c: the 5 leaf packages must not import core.
- [[decisions/context-gate-extraction]] — AA1 §2a folded-vs-extracted outcome (post-BB7b LOC audit).

## Concepts (cross-cutting ideas)

- [[concepts/contextops]] — what "ContextOps" means; product category.
- [[concepts/agent-agnostic-core]] — non-negotiable: agents connect to core, never reverse.
- [[concepts/risk-aware-development]] — LOW / MEDIUM / HIGH / CRITICAL gating skills.
- [[concepts/superpowers-discipline]] — mandatory chain on every feature.
- [[concepts/wiki-first-token-discipline]] — wiki is the only sanctioned project memory; question → entry mapping; hard rules to avoid raw spec/code reads.
- [[concepts/context-gate-pipeline]] — Mega Saver Mode: redact → chunk → rank → fit → summarize; redaction flow; AA1 package roles + cycle direction.

## Entities

- [[entities/cli]] — `@megasaver/cli` `mega` command; `mega output exec`, `mega mcp {install,repair,status,uninstall,serve}`; standalone bundle `dist-bundle/mega.mjs` (zero runtime deps) shipped to GitHub Releases on `v*` tag via `release.yml` (#91, #94).
- [[entities/connectors-claude-code]] — `@megasaver/connector-claude-code` root `CLAUDE.md` adapter (merged).
- [[entities/connectors-generic-cli]] — `@megasaver/connector-generic-cli` manifest-driven connector (v0.1 = Codex `AGENTS.md`).
- [[entities/connectors-shared]] — `@megasaver/connectors-shared` block helpers + context schema; additive `MEGA SAVER:CONTEXT_GATE` block (BB11, #84).
- [[entities/core]] — `@megasaver/core` agent-agnostic engine; BB1 adds `Session.tokenSaver` + `updateTokenSaver`; BB12 (#88) moved the orchestrator OUT to `@megasaver/context-gate` (core re-exports it).
- [[entities/gui]] — `@megasaver/gui` localhost web shell; AgentSetupDoctor + `/api/mcp/*` routes (BB11, #84); WCAG AA contrast pass (#85, #87); token-savings inline-SVG chart + raw-output retention controls (#97, gui@1.1.0).
- [[entities/shared]] — `@megasaver/shared` contracts package (v0.1; BB1 adds `TokenSaverMode` + `modeToBudget`).

### AA1 Context Gate packages (v0.5 → v1.1)

- [[entities/policy]] — `@megasaver/policy` command/path gates + redact + `PolicyDenyCode` (BB3); `parseProjectPermissions` + `permissions.yaml` tighten-only rules + `policy_load_failed` (#96, v1.1.0).
- [[entities/output-filter]] — `@megasaver/output-filter` `filterOutput` pipeline, `resolveSafeReadPath`, `RankFeatureName`, `OutputSourceKind` (BB5); +pytest/go/cargo/eslint parsers (#92); CamelCase `*Error` + `panicked` ranker (#95) — output-filter@1.1.0.
- [[entities/content-store]] — `@megasaver/content-store` ChunkSet persistence, `ContentStoreErrorCode` (BB4; no core edge).
- [[entities/retrieval]] — `@megasaver/retrieval` BM25 + `DerivedIntent` (BB6).
- [[entities/stats]] — `@megasaver/stats` `SessionTokenSaverStats` + `TokenSaverEvent` (BB6).
- [[entities/mcp-bridge]] — `@megasaver/mcp-bridge` real MCP stdio server over `stdio`, 4 tools, `mega mcp serve`, `buildMcpSetupOps` facade, 16-member `McpBridgeErrorCode` (BB8; AA1 §8).
- [[entities/context-gate]] — `@megasaver/context-gate@0.2.0` extracted from core (BB12, #88); orchestrator functions (`runOutputPipeline`, `runOutputExecCommand`, `fetchChunk`, `loadProjectPermissions`); `OrchestratorRegistry` structural port; core re-exports surface (consumers unchanged).

More subsystem pages land as features get built. Entity pages still pending: `skill-packs`, `conventions-sync`.

## Workflows

- [[workflows/cli-test-pattern]] — Citty handler test shape, env injection, biome ↔ TS strict conflict resolution.

Slots reserved for future workflow pages: `multi-agent-dogfood`, `design-skill-routing`, `core-registry-consumer-pattern`.

## Syntheses (cross-page answers)

- [[syntheses/mega-saver-product]] — what the product is, six subsystems, v0.1 slice.

## Sources (pointers to raw + project artifacts)

- [[sources/fikri-original]] — original 1421-line product idea (`raw/mega-saver-platform-fikri.txt`) with section index. Read this instead of the raw file.
- [[sources/spec-bootstrap]] — pointer to `docs/superpowers/specs/2026-05-03-mega-saver-bootstrap-design.md`.
- [[sources/plan-bootstrap]] — pointer to `docs/superpowers/plans/2026-05-03-mega-saver-bootstrap-plan.md`.

## Raw

- `raw/mega-saver-platform-fikri.txt` — original Turkish product idea, 1421 lines. **Do NOT read whole.** Use `sources/fikri-original.md`.

## Quick links by question

| Question                                          | Read                                            |
|---------------------------------------------------|-------------------------------------------------|
| What is Mega Saver?                               | [[syntheses/mega-saver-product]]                |
| What did we decide for the bootstrap?             | [[decisions/bootstrap-matrix]]                  |
| Why is the core agent-agnostic?                   | [[concepts/agent-agnostic-core]]                |
| What process do I follow for a new feature?       | [[concepts/superpowers-discipline]]             |
| Which wiki page answers my question?              | [[concepts/wiki-first-token-discipline]]        |
| What risk level applies and what does it gate?    | [[concepts/risk-aware-development]]             |
| What schemas / registry / errors does Core export? | [[entities/core]]                              |
| What commands / flags does the CLI support?       | [[entities/cli]]                                |
| What does the Claude Code connector write?        | [[entities/connectors-claude-code]]             |
| What does the generic-CLI connector ship?         | [[entities/connectors-generic-cli]]             |
| Where do shared connector helpers live?           | [[entities/connectors-shared]]                  |
| What types / IDs does Shared export?              | [[entities/shared]]                             |
| How do I write a CLI handler test?                | [[workflows/cli-test-pattern]]                  |
| What's in the original product idea?              | [[sources/fikri-original]]                      |
| Where's the bootstrap spec/plan?                  | [[sources/spec-bootstrap]] / [[sources/plan-bootstrap]] |
| What does `mega connector status` report?         | [[entities/cli]]                                |
| What does `mega memory` ship?                      | [[entities/cli]]                                |
| What is Mega Saver Mode / the Context Gate?        | [[concepts/context-gate-pipeline]]              |
| How does redaction work / where does it run?       | [[concepts/context-gate-pipeline]] / [[entities/policy]] |
| What does `mega session saver` do?                 | [[entities/cli]]                                |
| What does `mega output {file,filter,chunk,exec}` do? | [[entities/cli]]                              |
| What does `mega mcp` do?                           | [[entities/cli]]                                |
| What does the output-filter pipeline ship?         | [[entities/output-filter]]                      |
| What is `@megasaver/context-gate`?                 | [[entities/context-gate]]                       |
| Was BB12 executed? Where is the orchestrator?      | [[decisions/context-gate-extraction]] / [[entities/context-gate]] |
| How does the standalone CLI bundle work?           | [[entities/cli]]                                |
| What is in permissions.yaml?                       | [[entities/policy]]                             |
| Where are chunk sets persisted?                    | [[entities/content-store]]                      |
| Why is policy a v0.5 package?                       | [[decisions/policy-is-bb3]]                      |
| Why can't content-store import core?               | [[decisions/content-store-no-core-edge]]        |

## Status

## v1.1.0 — SHIPPED (2026-06-04)

Advanced-roadmap release. Package versions: cli 1.0.2, core 1.0.2,
context-gate 0.2.0 (NEW), mcp-bridge 1.0.2, output-filter 1.1.0,
policy 1.1.0, gui 1.1.0, stats 1.0.1, retrieval 1.0.0,
content-store 1.0.1, shared 1.0.0. main @ `729f8e8`.

**Post-v1.0 arc (PRs #80–#100):**

- BB12 extracted `@megasaver/context-gate` from core (PR #88).
- CI pipeline added (`ci.yml` + `release.yml`) — verify on PR/push,
  standalone `mega.mjs` bundle uploaded to GitHub Releases on `v*` tag,
  npm publish gated on `NPM_TOKEN` (PRs #90, #91, #93, #94).
- `output-filter` gained 4 language parsers (pytest/go/cargo/eslint)
  and CamelCase/`panicked` ranker fixes (PRs #92, #95).
- `policy` permissions.yaml + `parseProjectPermissions` + `policy_load_failed`
  deny-code (PR #96, adversarial security review).
- GUI token-savings chart + raw-output retention controls + `aria-live`
  (PR #97).

**Releases:** `v1.0.0` (2026-05-13) → `v1.0.1` (a11y + BB12, 2026-06-03)
→ `v1.1.0` (advanced roadmap, 2026-06-04).

## v1.0 — SHIPPED (2026-05-13)

Context Gate / Mega Saver Mode epic (AA1) complete: BB1–BB11 merged,
v1.0 closeout (CC) tagged `v1.0.0`. Session-scoped, GUI-controlled,
MCP-backed output compression — "Open GUI → Click Enable → Done"
(plan L1672–L1702). Five new packages (`policy`, `content-store`,
`output-filter`, `retrieval`, `stats`); real `@megasaver/mcp-bridge`
over stdio; GUI `TokenSaverPanel` + AgentSetupDoctor; additive
`MEGA SAVER:CONTEXT_GATE` connector block. End-to-end acceptance test
at `apps/cli/test/e2e/v1-closeout-flow.test.ts`; all 8 AA1 §17 enum
pins audited. `pnpm verify` green; all 14 packages bumped to 1.0.0.

## AA1 Context Gate — BB1–BB7a SHIPPED (2026-05-11)

First batch of the AA1 Context Gate / Mega Saver Mode epic (11 sub-PRs
BB1…BB11; spec `docs/superpowers/specs/2026-05-10-aa1-context-gate-epic.md`).
Seven sub-PRs landed; BB8–BB11 (mcp-bridge, GUI panel, doctor +
CONTEXT_GATE connector block) remain.

- **BB1 (#67, `acebb6c`)** — `Session.tokenSaver` schema +
  `TokenSaverMode` hoisted to `@megasaver/shared`. See [[entities/shared]],
  [[entities/core]].
- **BB2 (#68, `4660d37`)** — `mega session saver {enable,disable,status,stats}`
  CLI over `updateTokenSaver`. See [[entities/cli]].
- **BB3 (#69, `61efb28`)** — `@megasaver/policy`: `evaluateCommand`,
  `evaluatePathRead`, `redact`, `PolicyDenyCode`. See [[entities/policy]],
  [[decisions/policy-is-bb3]].
- **BB5 (#70, `ae41534`)** — `@megasaver/output-filter`: `filterOutput`
  pipeline, `resolveSafeReadPath`, `RankFeatureName`, `OutputSourceKind`
  (imports `policy.redact`). See [[entities/output-filter]].
- **BB6 (#71, `6078dc9`)** — `@megasaver/retrieval` (BM25, `DerivedIntent`)
  + `@megasaver/stats` (`SessionTokenSaverStats`, `TokenSaverEvent`). See
  [[entities/retrieval]], [[entities/stats]].
- **BB4 (#72, `a8b6531`)** — `@megasaver/content-store` ChunkSet
  persistence; merged after BB5/BB6 (depends on `OutputSourceKind`).
  Cycle-fix: no core dep (§3c). See [[entities/content-store]],
  [[decisions/content-store-no-core-edge]].
- **BB7a (#73, `67d66dc`)** — `mega output {file,filter,chunk}` CLI.
  Shipped-vs-spec: pipeline composed CLI-side in
  `apps/cli/src/commands/output/shared.ts`, NOT the proposed
  `packages/core/src/context-gate/` orchestrator; no stats wiring yet.
  See [[concepts/context-gate-pipeline]].

Workspace 10 → 15 buildable units (added `policy`, `output-filter`,
`content-store`, `retrieval`, `stats`). All §3c cycle guardrails hold;
each new package ships a `dependency-graph.test.ts`.

## v0.3 — SHIPPED (2026-05-10)

First v0.3 batch — 4 PRs merged 2026-05-10, all opened in parallel
worktrees (GG/HH/II/JJ teammates), each carrying its own spec + plan.

- **PR #51 (`e9ae54a`)** — GG: real Windows durability for
  `atomicWriteFile`. Replaces v0.2's reactive
  `EISDIR`/`EPERM`/`ENOTSUP` try-catch around the parent-directory
  fsync with a proactive `IS_WIN32` branch in
  `packages/core/src/json-directory-store.ts`. POSIX path unchanged
  (open `parentDir` → `fsyncSync` → `closeSync` after rename); on
  Windows the dir fsync is skipped entirely (NTFS journals rename
  metadata; `FlushFileBuffers` on a directory handle is a documented
  no-op). `IS_WIN32` captured at module load so a unit test pins
  the contract by stubbing `process.platform`. Real EPERM (sandbox /
  AV / seccomp) now surfaces as `store_write_failed` instead of
  silent swallow. Risk HIGH; supersedes FF deferral spec §1 (fsync).
- **PR #52 (`c8cb6c5`)** — HH: `@megasaver/mcp-bridge` and
  `@megasaver/skill-packs` placeholder packages. Public surfaces
  locked from day one with closed-enum tuple-ordering pins:
  `McpTransport = ["stdio", "sse"]`, `SkillPackKind = ["prompt",
  "skill", "workflow"]`, `SkillPackCapability = ["network",
  "read-memory", "write-memory"]`. `createBridge()` and `loadPack()`
  reject with structured `not_implemented` error codes; manifest
  type for skill packs (kebab name, SemVer, kind, skills,
  capabilities). Reserved future codes documented in spec §7 for
  schema-widening when real loaders land. Workspace 7 → 9 packages.
- **PR #53 (`d64a256`)** — II: `apps/gui` bootstrap (`@megasaver/gui`).
  Vite + React SPA + tiny `node:http` bridge importing `@megasaver/core`
  directly (no subprocess). Two views (Sessions / Memory entries),
  view switcher pinned with `ViewId = ["memory", "sessions"]` closed
  enum. `pnpm --filter @megasaver/gui dev` (Vite, port 5173) +
  `pnpm --filter @megasaver/gui bridge` (port 5174). Tauri / Electron
  rejected for bootstrap (toolchain / weight). Detail views, write
  actions, native packaging, single-command dev all deferred to v0.4.
- **PR #54 (`dff9575`)** — JJ: `pnpm conventions:sync` automation.
  Tagged-block mirroring: `<!-- conventions:start id="..." source="..." -->`
  ... `<!-- conventions:end id="..." -->` blocks in `AGENTS.md` and
  the three `.cursor/rules/*.mdc` are populated from
  `docs/conventions/*.md`. `pnpm conventions:check` (default mode,
  exit 1 on drift) folded into `pnpm verify`; `pnpm conventions:sync`
  writes. `MODES = ["check", "write"]` and `CONSUMERS = [...]`
  pinned with `.test-d.ts` tuple-ordering. CLAUDE.md intentionally
  untouched (long-form reference; managed blocks may follow).
  Built on Node `--experimental-strip-types` (no transpiler runtime
  dep beyond `citty`).

### v0.3 — what shipped

| Subsystem | Capability |
|---|---|
| **Windows durability** | NTFS-aware `atomicWriteFile`: data fsync via libuv `FlushFileBuffers`; dir fsync skipped on win32 (journaled). Real EPERM surfaces; no silent swallow. POSIX path bit-identical. |
| **`mcp-bridge` package** | Public surface reserved: `createBridge(config)` factory; `McpTransport` closed enum (`stdio` ⇒ `sse`); `not_implemented` error code with reserved widening list (auth_failed, transport_closed, …). |
| **`skill-packs` package** | Public surface reserved: `loadPack(path)`; `SkillPackKind` (`prompt`/`skill`/`workflow`); `SkillPackCapability` (`network`/`read-memory`/`write-memory`); manifest schema (kebab name + SemVer + skills + capabilities). |
| **GUI bootstrap** | `apps/gui` (Vite + React SPA + node:http bridge) renders sessions + memory entries from `@megasaver/core`. Bridge proxied via Vite (`/api/*` → 5174). |
| **Conventions sync** | One canonical source (`docs/conventions/*.md`) → 4 tagged-block consumers (AGENTS.md + 3 `.mdc`). Drift-detect folded into `pnpm verify`. CLAUDE.md preserved as long-form reference. |

### v0.3 — process metrics

- **PRs merged**: 4 v0.3 PRs (PR #51-#54) on top of v0.2's 50 → 54 total since project bootstrap.
- **Tests on main**: 587 (v0.2 baseline) → 626 passed (62 test files).
- **Workspace**: 7 packages → 9 + 1 app = 10 buildable units (added `mcp-bridge`, `skill-packs`, `apps/gui`).
- **Closed-enum surfaces added**: `McpTransport`, `McpBridgeErrorCode`, `SkillPackKind`, `SkillPackCapability`, `SkillPackErrorCode`, `ViewId`, `Mode` (conventions), `ConsumerId` (conventions) — each with `.test-d.ts` tuple-ordering pin per AA3.
- **Parallel dispatch**: 4 teammates, 4 worktrees, all merged via rebase chain on the same day.

### v0.3 — open backlog (deferred to v0.4)

- ~~**GUI v1**: project picker, session/memory detail views, write actions (create/end/update), single-command `dev` (Vite + bridge under one process)~~ — **SHIPPED 2026-05-10 (LL).** See [[entities/gui]] and `wiki/log.md`. Native packaging (Tauri/Electron) deferred to v1.1+.
- **mcp-bridge real implementation**: stdio transport first, MCP tools (`session.list`, `memory.list`), MCP resources (read-only views over the JSON store).
- **skill-packs real implementation**: pack discovery, install/uninstall, manifest validation, conflict resolution.
- **Windows port remainder**: case-insensitive path resolution audit, CRLF normalization in connector outputs, lock file semantics audit, Windows CI runner. Fsync layer now closed (PR #51).
- **CLAUDE.md tagged blocks**: extend `pnpm conventions:sync` to manage CLAUDE.md sections (currently AGENTS.md + 3 `.mdc` only).
- **Connector aider sync**: `mega connector sync --target aider` end-to-end (CONVENTIONS.md still hand-written today).

---

## v0.2 — SHIPPED (2026-05-10)

Final close-out batch (3 PRs merged 2026-05-10):

- **PR #47 (`9fa2414`)** — FF Windows port deferral spec.
  Documents v0.2's graceful Windows degradation (dir fsync
  swallows EISDIR/EPERM/ENOTSUP) and v0.3 scope (case-insensitive
  paths, CRLF normalization, lock semantics, Windows CI gate).
  Spec at `docs/superpowers/specs/2026-05-10-windows-port-deferral.md`.
- **PR #48 (`c1c0389`)** — T6 full sync text symmetry.
  Promotes T6 from PARTIAL (PR #45 — error-only) to FULL: every
  `mega connector sync` text-mode line now carries
  `session=<id|none>` matching `mega connector status` format.
  Byte-compat break for skipped/created/noop/wrote (intentional,
  documented). ~10 test sites updated.
- **PR #49 (`460a66e`)** — EE cleanup batch (3 sub-items): tuple-
  ordering pin assertions on `agentIdSchema.options` (alphabetic),
  `riskLevelSchema.options` (severity-ascending),
  `memoryScopeSchema.options` (semantic) per AA3 — 3 new
  `.test-d.ts` regression assertions; `RunConnectorSyncInput.json`
  optional → required (parity with sibling Run inputs); JSON
  output policy doc appended to `wiki/entities/cli.md`. +
  inline pre-existing biome lint fix (session/end.ts type +
  json-store format).

### v0.2 — what shipped

| Subsystem | Capability |
|---|---|
| **Connectors** | 4 built-in targets: `claude-code` (CLAUDE.md), `codex` (AGENTS.md), `cursor` (.cursor/rules/megasaver.mdc), `aider` (CONVENTIONS.md). One file per target; sentinel-bounded blocks; user content outside block preserved. |
| **CLI** | 11 subcommands: `mega doctor`, `project create/list`, `session create/list/show/end/update`, `memory create/list/show`, `connector sync/status`. All read+write commands support `--json` (10/10 — full read/write parity). |
| **`--json` flag** | Type=boolean, default=false, description="Emit JSON output." across 10 commands. Failure path: text stderr, exit 1, no stdout (12 enforcement tests). Drift guards via `describe.each` (30 assertions). |
| **Schema discipline** | Closed-enum bug class compile-time enforced via vitest typecheck mode + 4 `.test-d.ts` regression suites for `KnownTargetId` (4), `AgentId` (5), `RiskLevel` (4 severity-asc), `MemoryScope` (2 semantic). Tuple-ordering pinned per AA3. |
| **Durability** | `atomicWriteFile` POSIX-durable: temp fsync BEFORE rename, parent dir fsync AFTER rename, Windows graceful no-op (EISDIR/EPERM/ENOTSUP swallow). |
| **Connector status** | `mega connector status` reports `in-sync`/`drift`/`no-block`/`missing`/`error` per target; symmetric format with sync (every line `session=<id|none>`); concurrent-sync race policy documented (best-effort, §11). |
| **Multi-agent dogfood** | All 4 agent files (CLAUDE.md, AGENTS.md, .cursor/rules/, CONVENTIONS.md) auto-derivable from `docs/conventions/*.md`; PR diff drift catch (sync script deferred to v0.2.x). |
| **Closed-set surfaces** | Schema-derived: errors.ts messages + 5 citty `--help` description strings + 2 connector `--target` descriptions; auto-update on member addition. |

### v0.2 — process metrics

- **PRs merged**: 49 PRs total (PR #1-#49) from project bootstrap.
- **Tests on main**: 587 passed (587), 55 test files. From v0.1 baseline ~196 → v0.2 587.
- **Critic-flagged follow-ups closed across this development cycle**: ~40+ items spanning S/T/U/V/W/X/Y/Z/AA/CC/DD/EE/FF/T6 series.
- **Risk discipline**: every PR ≥ MEDIUM gated through full superpowers chain (spec → plan → TDD → verify → code-review → critic → merge); HIGH PRs (DD2 BB hardening) added architect consultation.

### v0.2 — open backlog (deferred to v0.3)

- **FF Windows port** (full): case-insensitive resolution, CRLF normalization in connector outputs, lock file semantics audit, Windows CI gate. Currently graceful no-op per DD2/PR #47. Spec: `docs/superpowers/specs/2026-05-10-windows-port-deferral.md`.
- **mcp-bridge** package: scaffolded placeholder; no spec yet.
- **skill-packs** package: scaffolded placeholder; no spec yet.
- **GUI app**: deferred (CLI-first per v0.1 decision; design skills available when phase begins).
- **`pnpm conventions:sync`** script: manual sync today; full automation deferred.

---

**v0.2 main feature: `--json` write-side (PR #45 merged 2026-05-10):**

- **PR #45 (`89a25f9`)** — `--json` flag on 5 write-mutation
  commands + T6 closure. Mirrors read-side pattern (PRs #30/#31/
  #32, DD1) onto: `session create` (full Session), `session end`
  (ended Session), `session update` (updated Session), `memory
  create` (full MemoryEntry), `connector sync` (per-target
  records `[{id, relativePath, status, session}, ...]`).
  Default text byte-compat preserved for 4/5 commands; sync
  text `error` lines now carry `session=<id|none>` (partial T6:
  non-error statuses keep 3-column format — full symmetry with
  `connector status` would break byte-compat, deferred per spec
  §2 trade-off; JSON mode carries `session` on every record).
  cli 281 → 301 (+20: 5 success + 5 failure-path + 10
  drift-guard expansion). Drift guards now span all 10 `--json`
  commands (5 read-side + 5 write-side) × 3 assertions = 30 total.
  Critic REVISE round 1 (2 CRITICAL: T6 spec drift + missing
  failure-path tests; 3 MAJOR: form drift, §13 anti-pattern,
  count fabrication); all closed inline (`173d820`).

After PR #45:
- All 10 `--json` commands consistent: `type: "boolean"`,
  `default: false`, `description: "Emit JSON output."`,
  `json: !!args.json` consumption form (DD1 drift fully closed).
- Failure-path policy enforced bidirectionally: 12 failure-path
  tests in `apps/cli/test/json-failure-paths.test.ts` cover
  every `--json` command (text stderr, no stdout, exit 1).
- T6 sync error symmetry shipped (with documented partial-scope
  trade-off for byte-compat preservation).
- v0.2 main feature complete: read+write `--json` parity.

Open backlog (post-PR #45):
- **EE cleanup batch** (DD critic minors): tuple-ordering pin
  on `agentIdSchema.options` (alphabetic), `riskLevelSchema.
  options` (severity-ascending), `memoryScopeSchema.options`
  (semantic) per AA3; dedicated core-level cross-process lock
  test (DD2 used V1 evidence); JSON-failure policy doc in
  `wiki/entities/cli.md`.
- **T6 followup** (deferred): full sync text symmetry (every
  line carries `session=<id|none>`), accepting byte-compat
  break for non-error statuses.
- **FF**: full Windows port (currently graceful no-op on dir
  fsync per DD2; needs broader filesystem semantics review).

Total tests on main: ~575 → **587 passed (587)**, 55 test files.

**v0.2 hardening + cleanup round 2 (DD batch, 4 PRs merged 2026-05-10):**

- **PR #40 (`88d9aa6`)** — DD1 AA cleanup: 5 MINOR followups
  consolidated from PR #28-#33 critics. Explicit `default: false`
  on 3 boolean `--json` flags, citty-wrapper drift guards on 5
  commands (15 assertions via `describe.each`), `--json`
  failure-path tests (7 across 5 commands), init-notice stderr
  pinning (`startsWith` → `toBe`), dead `memories.json` fixture
  removed. All 5 `--json` descriptions aligned to canonical
  "Emit JSON output." Critic ACCEPT-WITH-RESERVATIONS; 2 MAJOR
  (drift-guard scope mismatch + description drift) closed inline
  (`2066979`).
- **PR #41 (`bf582ae`)** — DD4 deferred items resolution: S8
  closed as already-accurate post-AA2 (PR #25); W7 closed
  wontfix-v0.1 (codepoint-only truncation; one-line WHY comment
  in `apps/cli/src/commands/memory/shared.ts` `truncate()`); T6
  still deferred with explicit ownership note (bundled with
  `--json` write-side batch). Bonus: 3 pre-existing biome errors
  fixed in `connector-status.test.ts` + `connector/shared.test.ts`.
- **PR #42 (`82e6c7f`)** — DD2 BB hardening (HIGH risk):
  `atomicWriteFile` durability — temp file fsynced BEFORE rename
  (data on disk before link), parent dir fsynced AFTER rename
  (link metadata durable). Windows-friendly degradation: dir
  fsync swallows `EISDIR`/`EPERM`/`ENOTSUP` only; data fsync
  errors propagate. macOS + Linux for v0.1; Windows graceful
  no-op. S10 closed: spec §11 added documenting status best-
  effort policy under concurrent sync; §6 cross-references §11.
  Cross-process lock evidence: V1 (CC4 PR #36) at `apps/cli/
  test/session/update-concurrency.test.ts` already exercises
  the lock primitive. Critic REVISE round 1 (4 findings:
  fabricated 552 vs actual 540 count, missing Windows guard,
  §6/§11 silent contradiction, missing wiki entry); all closed
  inline (`36bf561` + `72dea63`).
- **PR #43 (`0578ae1`)** — DD3 Z2/Z3 type-safety: vitest
  typecheck mode wired in 6 packages (per-package
  `tsconfig.test-d.json` + `typecheck: { enabled: true }`). 4
  `.test-d.ts` regression suites: `KnownTargetId` (4 members +
  `@ts-expect-error` non-member guard), `AgentId` (5 members),
  `RiskLevel` (4 members severity-ascending), `MemoryScope`
  (2 members semantic). Type-error proof: deliberate
  `expectTypeOf<string>().toEqualTypeOf<number>()` confirmed
  vitest catches it (TypeCheckError, exit 1). Critic
  REQUEST-CHANGES (1 CRITICAL stale base + 3 HIGH false
  deferral / unwired typecheck / missing proof); rebased + false
  deferral note replaced with working `@ts-expect-error` guard
  (`d0c7a04`).

After this batch:
- Closed-enum bug class structurally enforced at compile time
  (vitest typecheck + `.test-d.ts` regression suite for 4 enums).
- `atomicWriteFile` POSIX-durable across crash boundaries
  (fsync before rename for data + fsync parent dir for metadata;
  Windows graceful).
- Read-side `--json` consistency: 5 commands × {type, default,
  description} pinned via drift guards.
- 3 deferred items resolved (S8 closed post-AA2, W7 wontfix-v0.1,
  T6 ownership reassigned to `--json` write-side batch).

Open backlog (post-DD batch):
- **`--json` write-side**: session create/end/update, memory
  create, connector sync (5 commands; T6 bundled — sync error
  line carries `session=<id|none>` for symmetry with status).
- **EE cleanup batch** (DD critic minors): `riskLevelSchema.options`
  / `agentIdSchema.options` / `memoryScopeSchema.options` tuple-
  ordering pin per AA3; `args.json === true` vs `!!args.json`
  consumption form alignment; JSON-failure policy doc in
  `wiki/entities/cli.md`; dedicated core-level cross-process
  lock test (DD2 used V1 evidence).
- **FF**: full Windows port deferred to v0.3 (graceful no-op on
  dir fsync in v0.2; case-insensitive resolution, CRLF
  normalization, cross-platform CI gate target for v0.3). Spec:
  [[specs/2026-05-10-windows-port-deferral]].

Total tests on main: 539 → ~575 across the DD batch (+13 cli
drift-guards + failure-paths from DD1, +1 fsync ordering from
DD2, +9 type-safety regressions from DD3).

**v0.2 critic-backlog cleanup batch (4 PRs merged 2026-05-10):**

- **PR #34 (`2d97b29`)** — CC1 docs/wiki cleanup (9 items):
  S9 spec §4 gutter, T7 worked-example annotation, T8 X-series
  list format, U4 cursor frontmatter contract, U8/W8 README
  refresh (4 connectors + CLI reference), U10 known-targets
  cross-package comment, V9 wiki entity test counts, X6 LOC
  tracker (369 → 419). Critic 1 MAJOR (S9 still wrong, fixed
  inline `84e8c61`).
- **PR #35 (`8c6c0a2`)** — CC2 `connector.ts` split + S6:
  419-LOC `apps/cli/src/commands/connector.ts` split into
  `connector/{sync(117),status(179),shared(140),index(22)}.ts`
  mirroring PR #18's `session/` pattern. S3 `resolveProjectAndRoot`
  prologue extracted. S6 byte-equality regression fixture (4
  tests, one per known target) inoculates `noop` predicate.
  Behavior byte-identical: cli 214 → 218. Critic ACCEPT, 3
  non-blocking minor followups noted.
- **PR #36 (`4e6c84d`)** — CC4 session/memory test coverage
  (8 items): V1 concurrent-update via process spawn, V2 partial-
  write recovery via `vi.mock("node:fs")`, V3 fast-check property
  test (numRuns: 50), V4 whitespace-title rejection PIN (already
  correct since PR #23 — test pins contract), V6 update-then-end
  durability, V7 multi-flag error precedence, V8 `kind:
  "session_update"` Zod format pin (`startsWith` → `toBe`), W10
  NODE_ENV save/restore. cli 214 → 218, core 129 → 134. Critic
  ACCEPT-WITH-RESERVATIONS (V4 framing misleading; PR body
  corrected pre-merge).
- **PR #37 (`48cbcac`)** — CC5 defensive + policy (8 items):
  U7 mkdir failures wrapped as `ConnectorError(file_write_failed)`,
  U9 `ConnectorTarget.header` registration-time sentinel guard,
  W4 reject `memory create --scope session` on ended sessions,
  W5 explicit `memory_entry_already_exists` mapper branch, W6
  `contentSchema`/`titleSchema` reject U+2028/U+2029 (esbuild
  fix: `  ` escapes), W9 parse-on-handoff consistency
  policy doc, X4 filter-then-cap-by-recency for `memoryEntries`
  (drop `.max(20)` hard-fail; sort+slice 20 most-recent), X5
  delete dead continuation-indent path. Critic REJECT initial
  (4 CRITICAL: false GREEN claim, fake W6 session test, `vi.spyOn`
  frozen ESM, X4 substring false-positive); all fixed in
  `34d60e2` + `856ab16` (chmod-based U7 EACCES with root-skip,
  literal U+2028/2029 inserted, word-boundary regex, biome
  lint:fix + manual template literal). Rebased on CC2 split
  (manually ported U7 mkdir wrap to `connector/sync.ts` and X4
  sort+slice to `connector/shared.ts`). User-locked policies:
  W4 reject, X4 cap-by-recency.

After this batch:
- ~28 critic-flagged follow-ups closed across 6 series (S, T,
  U, V, W, X) — was ~44, leaves CC3 (11 items, in review) + 2
  deferred (T6 → --json write-side, S10 → BB hardening) +
  2 closed-in-DD4 (S8 by AA2, W7 wont-do v0.1).
- `connector.ts` 419 LOC split (S4 closed) — every CLI command
  file now well under §8 300-line threshold.
- Schema policy compile-time enforced: W4 ended-session reject
  on memory create, X4 graceful cap-by-recency replaces hard-fail,
  W6 unicode separator block on title + content schemas.
- cli tests: 218 → 226 (+8 from CC4 to CC5 over CC2's 218 base).

**CC3 in review (PR #39, branch `feat/cc3-connector-tests`):** all
11 connector test coverage items closed — T1 (`pickLatestOpenSession`
unit tests), T3 (same-instant tie-break "first wins"), T4 (numeric
UTC vs lex divergence via `+02:00` offset on shared date prefix),
T5 (1ms-precision picks later), S5 (read-path symlink semantics
documented in `packages/connectors/shared/test/filesystem.test.ts`),
S7 (3-session ordering), S11 (`targets.length>0` invariant after
`--target` filter), U2 (cursor-specific `no-block` test), U3
(cursor sync into existing user-content via `joinWithManagedBlock`),
U5 (cursor multi-open-session no cross-leak), U6 (chmod 0o500 on
`.cursor` reaches mkdir EACCES path, U7 wrap verified). Critic
REVISE round 1: U6 false-impossibility claim (reviewer's chmod
0o500 repro showed reachability) + T4 timestamps shared date prefix
(lex test would pass even buggy) + wiki not updated; all closed
inline (`c69423d`). +3 yan-etki test corrections to
`packages/connectors/{shared,claude-code}/test/*.test.ts` for X4
schema relaxation + X5 dead-path deletion (turbo cache masked at
CC5 merge).

**v0.2 second-day team batch (7 PRs merged 2026-05-10):**

- **PR #27 (`7ba650b`)** — AA4 wiki/entities/cli.md schema-derived
  surface table. New section maps 4 closed-sets to derived CLI
  surfaces with PR refs (#22, #23, #25). Critic flagged
  CRITICAL (memoryScopeSchema package wrong) + 2 MAJOR
  (drift-guard pattern overgeneralization, KNOWN_TARGETS
  source/surface conflation); all closed inline (`c395ac6`).
- **PR #28 (`e8cd129`)** — project test gap fixes (3 OBSERVATION
  gaps from PR #26 critic): `--root foo/bar`, `/nonexistent`,
  `""`. Pure test additions, zero production change.
- **PR #29 (`07aedfa`)** — Y5 aider sync coverage: noop test +
  stale-block-replace test in `connector.test.ts`. Closes PR
  #21's coverage gap; tests document existing correct behavior.
- **PR #30 (`68971ae`)** — `--json` flag for `mega project list`
  + `mega project create`. Default byte-identical; `--json`
  emits compact JSON of all `Project` fields. Empty-store
  divergence (text empty stdout vs JSON `[]`) documented +
  pinned. 4 new tests.
- **PR #31 (`e7207ff`)** — `--json` flag for `mega memory list`
  + `mega memory show`. JSON shape: flat per-entry, all 6
  `MemoryEntry` fields, `null` for sessionId on project scope,
  full content (not truncated). 3 new tests.
- **PR #32 (`9711675`)** — `--json` flag for `mega connector
  status`. Per-target collect-then-emit pattern; 4 records as
  `{id, relativePath, status, session}`. Pre-loop failures
  preserve text/stderr + exit 1. 3 new tests.
- **PR #33 (`debfa93`)** — AA3 schema member-ordering convention
  docs + drift-guard tests. WHY comments on
  `agentIdSchema` (alphabetic), `riskLevelSchema`
  (severity-ascending), `memoryScopeSchema` (semantic).
  3 drift-guards via `.toEqual([...])` exact-match — future
  reorder fails CI. Closes PR #23 critic AA1.

After this batch:
- v0.1 connector matrix complete (4 targets) ✓
- Closed-enum tripwire bug class structurally closed across
  ALL surfaces (errors.ts + citty descriptions + connector
  --target) ✓
- Schema-derived surfaces documented in wiki as canonical
  reference ✓
- Read-side `--json` complete (project list/create + memory
  list/show + connector status) — 5 commands.
- Schema member-ordering convention compile-time enforced ✓

Open backlog (post-batch):
- **--json write-side**: session create/end/update, memory
  create, connector sync (5 commands)
- **AA cleanup batch** (consolidates MINOR backlog from PR
  #28-#33 critics): default:false consistency, citty-wrapper
  tests, --json failure-path tests, init-notice stderr pinning
- **BB hardening**: atomicWriteFile + fsync, cross-process
  lock test (HIGH risk)
- **Z2** vitest typecheck mode wire
- **Z3** .test-d.ts regression suite for KnownTargetId

Total CLI tests landed today: 196 → 207 (+11 across 7 PRs).

**v0.2 first-day team batch (3 PRs merged 2026-05-10) via `megasaver-v02-parallel` team:**

- **PR #24 (`f0135f7`)** — Y3 docs drift fix: `CLAUDE.md §7` /
  `AGENTS.md` / `.cursor/rules/mega-context.mdc` / new
  `docs/conventions/multi-agent-dogfood.md` now enumerate 4 agent
  file scopes (CLAUDE.md, AGENTS.md, `.cursor/rules/*.mdc`,
  `CONVENTIONS.md`). New invariant: every CLAUDE.md §1-§13 has its
  own conventions file (count: 12 → 13 canonical conventions
  files). `CONVENTIONS.md` is connector output (not repo-tracked).
  Critic ACCEPT-WITH-RESERVATIONS, MAJOR #1 inline fix `f7d07f6`
  (replaced deleted parenthetical with positive "one per
  §1-§13" invariant).

- **PR #25 (`a8fb044`)** — AA2 connector `--target` description
  derive: extends PR #22+#23's schema-derived pattern to the 4th
  closed-enum surface. Both `connectorSyncCommand` and
  `connectorStatusCommand` `--target` descriptions now derive from
  `KNOWN_TARGET_IDS.join(" | ")` (launch order:
  `claude-code | codex | cursor | aider`). `--help` text auto-updates
  on future target additions. +2 `toBe` drift-guard tests parallel
  to PR #23's pattern. Critic ACCEPT, no merge blockers.

- **PR #26 (`b20c9b6`)** — `mega project create --root <dir>`:
  optional `--root` flag added; default behavior (omit) preserves
  byte-identical `rootPath = process.cwd()`. With `--root`,
  `path.resolve(args.root)` (absolute, supports relative inputs).
  No existence check at create time — downstream `assertProjectRoot`
  is the validation gate (Option B). +3 tests (absolute pass-through,
  relative resolve, omit-default regression). Critic ACCEPT, no
  merge blockers.

Total cli test count: 197 → 199 (+2 from AA2, +3 - 1 from
project-root which had no behavior changes for omit-path tests).
Open: aa3-schema-docs teammate still working on AA3 (schema
member-ordering convention docs); will land separately.

Previously: Citty description derive (Z1) landed via PR #23 (`4722a3a`):
closes the closed-enum bug class on the **help-text** surface
(PR #22 closed the **error-message** surface). 5 citty
`description` strings in `apps/cli/src/commands/session/create.ts`,
`session/update.ts`, `memory/create.ts` now derive from
`agentIdSchema.options` / `riskLevelSchema.options` /
`memoryScopeSchema.options` via module-load template
interpolation. All 5 "Keep in sync with X in Y" comments
removed. After this slot, adding a member to any of the 3
schemas auto-updates BOTH error messages AND `--help` text —
the recurrence-prevention promise is now structurally
delivered for both surfaces. Critic re-pass returned
ACCEPT-WITH-RESERVATIONS: CRITICAL #1 (PR body falsely
claimed byte-identical for `--agent` strings while order
shifted from brand-prominent to schema-canonical alphabetic)
+ MAJOR AA1 (toContain drift-guards tautological — caught
member drift but not format drift). Both closed inline
(`1cfb2d9`): all 5 drift-guards (this PR's 3 + Y1+Y2's 2)
converted from `toContain` loops to `toBe` pinned-format
assertions that catch member AND format drift; PR body
edited to honestly disclose the agent order shift (matching
PR #22's `errors.ts` convention). cli 191 → 194, total
474 → 477 (+3 net drift-guards). Open **AA-series backlog**:
**AA2** derive `connector --target` description from
`KNOWN_TARGET_IDS` (4th closed-enum surface, parallel pattern
to Z1); **AA3** document schema member-ordering convention
in `packages/shared/src/agent-id.ts` / `risk-level.ts` /
`packages/core/src/memory-entry.ts` with one-line WHY
comments (alphabetic for agent, severity for risk, semantic
for scope); **AA4** update `wiki/entities/cli.md` to
enumerate which closed-set surfaces are schema-derived
(promoted from Z4). **Z2** (vitest `typecheck: true` mode)
and **Z3** (`.test-d.ts` regression suite) remain open.
Previously: Closed-enum tripwire refactor landed via PR #22 (`489f7d0`):
the broken `as const satisfies readonly T[]` mirror pattern in
`apps/cli/src/errors.ts` (4 sites: `AGENT_VALUES`, `RISK_VALUES`,
`KNOWN_SCOPE_IDS`, local `KNOWN_TARGET_IDS`) is replaced with
schema-derived sources: `agentIdSchema.options` /
`riskLevelSchema.options` from `@megasaver/shared`,
`memoryScopeSchema.options` from `@megasaver/core`,
`KNOWN_TARGET_IDS` from a new `apps/cli/src/known-targets.ts`
canonical registry (`KNOWN_TARGETS.map((t) => t.id)`). New
file owns `CLAUDE_CODE_TARGET`, `KNOWN_TARGETS`,
`KnownTargetId` literal union, `isKnownTargetId` helper. The
duplicated `KNOWN_TARGET_IDS` in `connector.ts` collapses to
the same import. Individual `codexTarget`/`cursorTarget`/
`aiderTarget` `: ConnectorTarget` annotations dropped so
`(typeof KNOWN_TARGETS)[number]["id"]` resolves to the literal
union (verified empirically with `@ts-expect-error` probe).
+8 net tests (5 known-targets + 3 errors drift-guards). Mid-
execution `43205c8` regressed `KnownTargetId` to `string` by
removing `as const` from `CLAUDE_CODE_TARGET`; recovered in
`79eb9d8` (revert + `Object.hasOwn`-style header absence
checks in `targets.test.ts`). Critic re-pass IMPORTANT-2
(loop-cast structural smell at `connector.ts:128`) +
IMPORTANT-3 (expectTypeOf runtime no-op clarification) closed
inline (`67b6515`). Behavior byte-identical: 4 smoke strings
match before/after. Closes the bug class behind cursor PR #17
+ aider PR #21 CRITICAL fix-ups for **error messages**. Open
**Z-series backlog**: **Z1** *FIRST-CRITICAL* — citty
`description` strings in `apps/cli/src/commands/session/create.ts`,
`session/update.ts`, `memory/create.ts` still hand-mirror the
same enum lists with "Keep in sync" comments → next agent
widening recreates the bug class on the help-text surface;
**Z2** vitest `typecheck: true` mode wire (so `expectTypeOf`
catches regressions in `vitest run` alone, not just via
`pnpm typecheck`); **Z3** add `.test-d.ts` regression suite
with `@ts-expect-error` directives pinning the literal union;
**Z4** document in `wiki/entities/cli.md` which closed-set
surfaces are schema-derived (errors.ts) vs still hand-mirrored
(citty descriptions). Previously: Aider connector target
landed via PR #21 (`184b13d`): 4th built-in connector target
ships — `aider` → `CONVENTIONS.md`
(plain markdown, no frontmatter; user wires `aider --read
CONVENTIONS.md` themselves). Closes the v0.1 connector matrix
promised in `CLAUDE.md §1` (claude-code + codex + cursor +
aider). `agentIdSchema` widens to 5 members (alphabetic-first
insert); `aiderTarget` joins `builtinTargets`; CLI
`KNOWN_TARGETS` appends in launch order. Critic re-pass caught
CRITICAL Y1 (silent stale `AGENT_VALUES` in
`apps/cli/src/errors.ts` — `as const satisfies readonly
AgentId[]` permits subset, so the supposed tripwire failed open
and `mega session create --agent <typo>` lied to the user with a
4-member valid-agent list) and MAJOR Y2 (parallel `update.ts`
`--agent` description drift + missing drift-guard test for
`sessionUpdateCommand`); both closed inline before merge (Y1 in
`585554f`, Y2 in `dbad49e`). Open Y-series backlog: **Y3** docs
drift (`CLAUDE.md §7` / `AGENTS.md` / `.cursor/rules/*.mdc`
enumerate 3 agent files but 4 now ship); **Y4** add `aiderTarget`
assertion to `packages/connectors/generic-cli/test/public-export.test.ts`;
**Y5** noop + stale-block-replace coverage holes for aider sync;
**Y6** repo-wide closed-enum drift-guard refactor (replace
`as const satisfies readonly T[]` with proper `Equal<>`
exhaustiveness check or use `schema.options` directly — the
recurring fix-up pattern across cursor + aider proves the current
tripwire is structurally insufficient); **Y7** document
launch-order vs alphabetic convention in `docs/conventions/`.
Previously: Connector memoryEntries wiring landed via PR #20
(`b0e4382`): `mega connector sync` and `mega connector status`
now read real memory entries via
`registry.listMemoryEntries(project.id)` and filter them
per-target to "project-scoped + current-session-scoped".
Empty-memory projects continue to render `- none`
byte-identically. Critic backlog item W11 (deferred-state lock
test) closes by superseding — the wiring slot itself locks the
real state. Previously: `mega session update` + I5 split landed via PR #18 (`04987a8`):
new `mega session update <sessionId> [--title …] [--risk …]
[--agent …]` for partial mutation of an open session. `--title ""`
clears to `null`; ended sessions are rejected. `@megasaver/core`
exports `sessionUpdatePatchSchema` and a new
`CoreRegistry.updateSession(id, patch)` method on both the
in-memory and JSON-directory implementations. `apps/cli`'s
`commands/session.ts` (511 LOC > §8 300 threshold) is split into
`commands/session/{create,list,show,end,update,shared,index}.ts`
closing v0.1 backlog item I5. Previously: Cursor connector target landed via PR #17 (`f2d7f63`): `agentIdSchema`
widens to four members (adds `"cursor"`),
`@megasaver/connector-generic-cli` ships `cursorTarget` writing
`.cursor/rules/megasaver.mdc` with optional `ConnectorTarget.header`
for first-seed YAML frontmatter, and the CLI registers cursor in
`KNOWN_TARGET_IDS` / `KNOWN_TARGETS`. `mega session create --agent
cursor` and `mega connector sync demo --target cursor` work
end-to-end. Existing `claude-code` and `codex` paths byte-identical.
Previously: `mega connector status` landed via PR #15 (`b1a81cc`): new
`mega connector status <projectName> [--target <id>]` adds read-only
per-target reporting on top of the connector primitives.
Status words: `in-sync` | `drift` | `no-block` | `missing` | `error`.
Exit `0` when every line is `in-sync` or `missing`; `1` otherwise.
The previously-shipped `mega connector sync` (PR #14, `204f922`)
remains unchanged.

Critic v0.2 followups I1–I4 closed via PR #13
(`0facd09`, NODE_ENV gate on `MEGA_TEST_*` env-vars + `readTestEnv`
helper + workflow doc) and PR #12 (`5b3923a`, `session_already_ended`
mapper case + outer-catch ctx using `kind: "session"` + spec §4
title control-char drift correction). CLI Session CRUD itself
landed on `main` via PR #11 (`9c5a388`): four `mega session`
subcommands (`create`, `list`, `show`, `end`),
`CoreRegistry.endSession(id, { endedAt })` mutation on both
in-memory and JSON-directory registries, `session_already_ended`
error code, CLI errors module widened with discriminated
`ZodContext` + 7 helpers + `as const satisfies` drift guards.
Six packages on `main`: `@megasaver/shared` (24 tests),
`@megasaver/core` (128 tests, 15 files), `@megasaver/cli`
(176 tests), `@megasaver/connectors-shared` (56 tests),
`@megasaver/connector-claude-code` (45 tests, byte-identical
render parity), and `@megasaver/connector-generic-cli` (26 tests,
Codex `AGENTS.md` + Cursor `.cursor/rules/megasaver.mdc` targets). 455 total. Previously merged: core
M3+M4 PR #10 (`ac27142`), connector follow-ups + core M1/M2 PR #9
(`0dc2e29`), generic-cli connector PR #8 (`8679c4c`), README
refresh PR #7, Claude Code connector PR #6, CLI project CRUD
PR #5, bootstrap PRs. Open v0.2 follow-ups: I5 closed in PR #18
(commands/session.ts split into commands/session/), cross-process
lock integration test (forked process), `atomicWriteFile` + `fsync`
durability, plus the deferred slices `mega project create --root
<dir>`, Aider YAML target, MemoryEntry CLI commands, `--json`
output flag pass. Critic v0.2 followups for PR #15 (`mega connector status`):
S1 + S2 + S12 closed in PR #16 (`eb21060`) — `pickLatestOpenSession`
switched to `Date.parse` numeric compare; `error` status line now
carries `session=<id|none>` for column symmetry; S12 closed by
decision (the duplicate compute inside `buildConnectorContext`
is kept deliberately to preserve its self-contained shape).
Still open: S3 extract `resolveProjectAndRoot` shared prologue
between sync + status when third consumer arrives; S4 split
`apps/cli/src/commands/connector.ts` (366 LOC) into
`connector/{sync,status,shared,index}.ts`; S5 harden read-path
symlink semantics (`readTargetFile` lstat-first or
`assertTargetWithinProject`); S6 regression-fixture asserting
`upsertBlock(existing, ctx) === existing` for seeded files
inoculates byte-equality predicate; S7 multi-open-session
tie-break test; S8 `--target` help-text divergence (filter ≠
seed) — **CLOSED by AA2 / PR #25 (`a8fb044`)**; S9 spec §4 example uses 3-space gutter, impl + tests use
2; S10 spec §11 concurrency stanza for status vs concurrent
sync; S11 `targets.length > 0` invariant after filter.
Critic v0.2 followups for PR #16 (S1+S2 followups slot): T2
(error+open-session cross-product test) closed inline in
PR #16 (`aaa4607`). Still open: T1 direct unit test on
`pickLatestOpenSession` (export as `_internal` or sibling
helper); T3 same-instant tie-break test (parallels S7); T4
DST-transition ranking test; T5 millisecond-precision test;
T6 sync error line carries `session=<id|none>` for
cross-command symmetry — **STILL DEFERRED, owned by --json write-side batch**;
T7 §4 worked-example annotation in
`2026-05-09-mega-connector-status-design.md` clarifying the
three lines are from multiple runs; T8 restructure
`wiki/index.md` Status section paragraph into a list when next
critic finding closes.
Critic v0.2 followups for PR #17 (cursor connector target slot):
U1 (session `--agent` help text drift) closed inline in PR #17
(`c9ddfc8`) with a snapshot test that derives the expected agent
list from `agentIdSchema.options`. Still open: U2 cursor-specific
`no-block` test (current coverage tests claude-code only); U3
test cursor sync into existing user-content `.cursor/rules/*.mdc`
file (humanContent path through `joinWithManagedBlock`); U4
document user-edit frontmatter contract (which edits survive
`upsertBlock` round-trip); U5 cursor multi-open-session test for
`pickLatestOpenSession` correctness when both claude-code and
cursor sessions are open; U6 `mkdir({recursive:true})` failure
path test (EACCES / ENOSPC / ENOTDIR); U7 wrap mkdir failures as
`ConnectorError("file_write_failed", …)` for consistent error
shape (today they fall through the unexpected-failure branch);
U8 README refresh — `Claude Code connector` section is stale,
codex (PR #8) and cursor (PR #17) targets unmentioned;
U9 validate `ConnectorTarget.header` does not contain
`MEGA_SAVER_BLOCK_START` / `MEGA_SAVER_BLOCK_END` literals at
registration time (latent footgun for external targets); U10
add `// claude-code lives in @megasaver/connector-claude-code;
this aggregates across packages.` comment at
`apps/cli/src/commands/connector.ts:48` so the cross-package
`KNOWN_TARGETS` aggregation is discoverable for new contributors.
Critic v0.2 followups for PR #18 (session update + I5 split slot):
IMPORTANT-1 (UX asymmetry between create/update for --risk/--agent
error format) and V5 (--title control-char/newline guard bypass on
update) both closed inline in PR #18 (`6841bbb`) by parsing
agentIdSchema/riskLevelSchema/titleSchema at the CLI boundary in
`update.ts` and extracting `titleSchema` into
`commands/session/shared.ts`. Still open: V1 concurrent-update
race test (process fork) — pairs with the existing cross-process
lock integration test followup; V2 partial-write recovery test
(kill between temp-write and rename in `json-directory-store.ts`);
V3 schema drift property test (fast-check) ensuring every random
session × random patch keys merges cleanly through `sessionSchema`;
V4 whitespace-only `--title "   "` semantics decision (today
update accepts, create rejects); V6 update-then-end durability
test (open → `update --risk high` → `end` → assert ended session
carries `riskLevel: "high"`); V7 multi-flag error precedence pin
(`update <bad-uuid> --risk bogus --agent unknown` — assert which
error surfaces first); V8 pin `kind: "session_update"` Zod-error
message format in a test (currently asserts only `startsWith
"error:"`); V9 wiki entity refresh — `wiki/entities/core.md`
test-count line still claims 116 instead of 128 post-merge.
Critic v0.2 followups for PR #19 (MemoryEntry CLI slot):
W1 + W2 + W3 closed inline in PR #19 (`b186679`) — `projectNameSchema`
hoisted to `commands/shared/schemas.ts` (5-site consolidation +
cross-command consistency test); `readTestEnv` deduplicated to the
canonical `session/shared.ts` copy; `session_project_mismatch`
mapper branch with canonical CLI message + cross-project create
test. Still open: W4 decide `mega memory create --scope session`
policy on ended sessions (today accepts; spec silent); W5
explicit `memory_entry_already_exists` mapper branch (defensive
parallel to `memory_entry_not_found`); W6 widen `contentSchema`
regex to block U+2028 / U+2029 (also affects `titleSchema`); W7
switch list `truncate` to `Intl.Segmenter` for grapheme-aware
splitting — **CLOSED as WONT-DO (v0.1 codepoint-only accepted; WHY comment in `memory/shared.ts`)**; W8 README refresh —
list all v0.1 subcommands (chronic drift since PR #11); W9
parse-on-handoff consistency policy between `memory create` (re-
parses) and `session create` (trusts registry); W10 restore
NODE_ENV in `apps/cli/test/memory.test.ts` afterEach (mirror
session.test.ts save/restore pattern); W11 closed in PR #20
(`b0e4382`) by superseding — the wiring slot itself locks the
real state via integration tests asserting block contents after
`mega memory create` + `mega connector sync`.
Critic v0.2 followups for PR #20 (connector memoryEntries wiring slot):

- X1 + X2 closed inline in PR #20 (`65cbd12`) — 3 stale references
  in `2026-05-09-mega-connector-sync-design.md` (§0 TL;DR + §2 +
  §3d pseudocode) corrected; redundant `assertConnectorContext`
  call dropped from `buildConnectorContext` (renderer already
  validates at the boundary).
- X4 — decide and document `memoryEntries.length > 20` policy
  (`ConnectorContextSchema` enforces `.max(20)` — current behavior
  is hard-fail; filter-then-cap-by-recency is the natural answer).
  *Locked: filter-then-cap-by-recency, scheduled in CC5.*
- X5 — delete dead continuation-indent path in
  `packages/connectors/shared/src/render.ts:32-37` (CLI
  `contentSchema` rejects newlines so the path is unreachable
  through the public surface) or document the invariant.
  *Scheduled in CC5.*
- X6 — fix S4 backlog tracker entry: actual `apps/cli/src/commands/connector.ts`
  LOC is now 419 (was tracked as 369; +50 net since PR #20 across
  cursor + aider + closed-enum + connector status `--json` slots).
  CC2 (`feat/cc2-connector-split`) closes S4 by splitting the file
  into `connector/{sync,status,shared,index}.ts`; X6 supersedes on
  CC2 merge.
