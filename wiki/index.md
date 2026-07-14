---
title: Wiki Index
updated: 2026-07-05
---

# Wiki Index — Mega Saver

> **Session start: read this file first.** It tells you what exists in the wiki and where to look.

## Decisions (locked-in choices)

- [[decisions/bootstrap-matrix]] — the 10 foundation decisions (path, repo, stack, MVP, language, git…)
- [[decisions/policy-is-bb3]] — `@megasaver/policy` ships at BB3 (v0.5), not the v0.9 roadmap.
- [[decisions/content-store-no-core-edge]] — AA1 §3c: the 5 leaf packages must not import core.
- [[decisions/context-gate-extraction]] — AA1 §2a folded-vs-extracted outcome (post-BB7b LOC audit).
- [[decisions/lazy-load-heavy-deps]] — heavy deps (TS compiler via [[entities/indexer]]) must be lazy dynamic-imported, never statically imported, in core hot-path packages; PR #182 root-cause fix + no-eager-load guard test.
- [[decisions/bundle-externalize-native-chain]] — the standalone `mega.mjs` externalizes the transformers/onnxruntime native chain (optionalDependency) while keeping typescript inlined; PR #209/v1.2.1 fix for the 15.7MB→1.9MB tarball with 0 native binaries.
- [[decisions/decision-trace-inline-not-join]] — Decision-Trace Viewer records memory ids + redaction INLINE on the registry trace, not via the (inert) replay-trace↔evidence chunkSetId join; the two stores are populated by disjoint seams. PR #227.

## Concepts (cross-cutting ideas)

- [[concepts/contextops]] — what "ContextOps" means; product category.
- [[concepts/agent-agnostic-core]] — non-negotiable: agents connect to core, never reverse.
- [[concepts/risk-aware-development]] — LOW / MEDIUM / HIGH / CRITICAL gating skills.
- [[concepts/superpowers-discipline]] — mandatory chain on every feature.
- [[concepts/wiki-first-token-discipline]] — wiki is the only sanctioned project memory; question → entry mapping; hard rules to avoid raw spec/code reads.
- [[concepts/context-gate-pipeline]] — Mega Saver Mode: redact → chunk → rank → fit → summarize; redaction flow; AA1 package roles + cycle direction.
- [[concepts/windows-support]] — full Windows support (PRs #104–#108): win32 store path, CRLF drift fix, lowercase ids, atomic-write `r+` fsync, `windows-latest` CI matrix.
- [[concepts/structured-memory-engine]] — DIMMEM, roadmap Phase 1: typed engineering memory (10 MemoryTypes + metadata); reconciles the v0.1 MemoryEntry primitive.
- [[concepts/memory-superset]] — WS3: superset of mem0/Letta/Zep/Cognee/Memori/claude-mem on our stack. Increment 1 shipped: semantic memory recall (per-project vector sidecar + boundary-embed fallback), `memoryRelevance` wiring (all approved memory's relatedFiles), entity node/edge layer (deterministic, no-LLM); (3)-(6) deferred.
- [[concepts/semantic-repo-index]] — roadmap Phase 2: parse repo into typed CodeBlocks (AST) so retrieval works on blocks, not files.
- [[concepts/context-pruning-engine]] — LAMR, roadmap Phase 3: task-aware multi-factor scoring → 6–8-block context pack; repo-side cousin of context-gate-pipeline.
- [[concepts/failed-run-learning]] — FORGE, roadmap Phase 5: find similar failures, convert a failure to a rule, rank applicable rules; deterministic (BM25 + path overlap).
- [[concepts/task-engine]] — roadmap Phase 6: deterministic TaskPlan state machine (typed steps + dependsOn) with selective retry; state tracker, not executor.
- [[concepts/tool-router]] — roadmap Phase 7: task-scoped tool allow/block (fewer schemas + dangerous tools blocked); advisor, not enforcer.
- [[concepts/audit-dashboard]] — roadmap Phase 8: one windowed, persisted token-savings summary; extends @megasaver/stats with an AuditEvent family.
- [[concepts/structured-memory-engine#approval-gate]] — roadmap Phase 10: agent-suggests → human-approves memory gate; team = shared store + gate; cloud SaaS deferred. (was `concepts/memory-approval`, merged 2026-07-04)
- [[concepts/proxy-mode]] — Proxy Mode v1.2 (7 phases shipped): public naming mode, output classifier, vitest/tsc compressors + passthrough, `proxy_search_code`, flagged engine-aware ranking, hook telemetry + adoption/interception metrics, replay trace.
- [[concepts/persistent-proxy-routing]] — proposed dedicated proxy supervisor: persistent CLI/GUI opt-in, nonce/lease route ownership, LaunchAgent lifecycle, drain-safe stop.
- [[concepts/saver-activation-inheritance]] — proposed exact → Git-family → legacy-root → global Saver activation plus hook heartbeat.
- [[concepts/context-ledger-architecture]] — proposed next architecture: split specs for ContextGate honest ~90% reduction + reliable save ledger.
- [[concepts/intent-aware-hook]] — Phase 6b (PR #180): UserPromptSubmit hook captures the prompt → fill-gap ranking intent for PostToolUse-captured output.
- [[concepts/diff-on-reread]] — PR #181: unchanged re-reads return a lossless `unchanged-marker` (prior chunkSetId) via a per-session sha256 read-index; skips re-filter/re-persist.
- [[concepts/semantic-ast-read]] — PR #182: source-file reads chunk on AST boundaries (reuses [[entities/indexer]] extractors, lazy-loaded); line-chunk fallback for everything else.
- [[concepts/outline-first-read]] — opt-in skeleton reads: signatures + line ranges + chunk ids; bodies fetch-on-demand (lossless, additive).

> **Drafts / proposals** (not yet locked; kept as draft):
> [[concepts/context-ledger-architecture]] — proposed next architecture splitting
> the umbrella spec into Evidence Ledger Interface + ContextGate honest ~90%
> reduction + Reliable Save Ledger. Status `draft`; read as a proposal, not a
> decided direction.

## Entities

- [[entities/cli]] — `@megasaver/cli` `mega` command; `mega output exec`, `mega mcp {install,repair,status,uninstall,serve}`, `mega hooks {install,uninstall,status,log,saver}` (telemetry + PostToolUse saver; uninstall PR #141); standalone bundle `dist-bundle/mega.mjs` (zero runtime deps) shipped to GitHub Releases on `v*` tag via `release.yml` (#91, #94).
- [[entities/connectors-claude-code]] — `@megasaver/connector-claude-code` root `CLAUDE.md` adapter (merged) + Claude Code hook-settings (`install/uninstall/readClaudeCodeHookStatus`, atomic write, command-level strip) — single source for CLI + GUI bridge (PR #141).
- [[entities/connectors-generic-cli]] — `@megasaver/connector-generic-cli` manifest-driven connector (v0.1 = Codex `AGENTS.md`).
- [[entities/connectors-shared]] — `@megasaver/connectors-shared` block helpers + context schema; additive `MEGA SAVER:CONTEXT_GATE` block (BB11, #84); v1.2 Proxy Mode biases the block to `proxy_*` tool names + "prefer proxy tools / expand before assuming omitted" guidance.
- [[entities/core]] — `@megasaver/core` agent-agnostic engine; BB1 adds `Session.tokenSaver` + `updateTokenSaver`; BB12 (#88) moved the orchestrator OUT to `@megasaver/context-gate` (core re-exports it).
- [[entities/brain-portability]] — E5 2.0 flagship: `mega brain export/import`, portable SHA-256-hashed `.megabrain` knowledge bundle (approved project memories + rules + failures), firewall-redacted export, suggested-gate merge. Branch `feat/brain-portability`.
- [[entities/brain-sync]] — E7 2.1 flagship: `mega brain sync` — E2E-encrypted (AES-256-GCM, projectId-AAD) BYO S3 sync of the `.megabrain` brain; keyfile + recovery code, content-addressed objects + manifest CAS, conditional-write init probe; `@aws-sdk/client-s3` externalized from the bundle. Risk CRITICAL. Branch `worktree-brain-sync`.
- [[entities/gui]] — `@megasaver/gui` localhost web shell; AgentSetupDoctor + `/api/mcp/*` routes (BB11, #84); WCAG AA contrast pass (#85, #87); token-savings inline-SVG chart + raw-output retention controls (#97, gui@1.1.0); live-first session cockpit + Token saver tab; **Connect Saver hook** toggle + global route `/api/hooks/claude-code` (GET/POST/DELETE, PR #141).
- [[entities/shared]] — `@megasaver/shared` contracts package (v0.1; BB1 adds `TokenSaverMode` + `modeToBudget`; agent-office adds `roleId`/`officeAgentId`/`officeTaskId` brands).
- [[entities/agent-office]] — `@megasaver/agent-office` multi-agent office: roster, rich roles, per-agent task queues, live board; hybrid launch via a new agent-agnostic `AgentLauncher` connector capability (claude-code adapter first). Phase 0 (engine data layer: schemas + atomic-json stores + 13 safe-by-default seed roles) shipped on `worktree-feat+agent-office`; risk CRITICAL (spawning) gated to Phases 1-2.

### AA1 Context Gate packages (v0.5 → v1.1)

- [[entities/policy]] — `@megasaver/policy` command/path gates + redact + `PolicyDenyCode` (BB3); `parseProjectPermissions` + `permissions.yaml` tighten-only rules + `policy_load_failed` (#96, v1.1.0).
- [[entities/output-filter]] — `@megasaver/output-filter` `filterOutput` pipeline, `resolveSafeReadPath`, `RankFeatureName`, `OutputSourceKind` (BB5); +pytest/go/cargo/eslint parsers (#92); CamelCase `*Error` + `panicked` ranker (#95) — output-filter@1.1.0; v1.2 Proxy Mode adds `classifyOutput`, vitest/tsc compressors + passthrough decision bands, flagged engine-aware ranking, replay trace.
- [[entities/content-store]] — `@megasaver/content-store` ChunkSet persistence, `ContentStoreErrorCode` (BB4; no core edge).
- [[entities/retrieval]] — `@megasaver/retrieval` BM25 + `DerivedIntent` (BB6).
- [[entities/stats]] — `@megasaver/stats` `SessionTokenSaverStats` + `TokenSaverEvent` (BB6); v1.2 Proxy Mode adds proxy-adoption + hook-based-interception metrics (honest-metrics: interception only when hook log exists); Phase 8 adds the `AuditEvent` family + `summarizeAudit`.
- [[entities/indexer]] — `@megasaver/indexer` (Phase 2) typed `CodeBlock` AST/structural extraction, ignore-aware scan, incremental build, BM25 `searchBlocks`; `mega scan` + `mega index *` (no core edge).
- [[entities/context-pruner]] — `@megasaver/context-pruner` (Phase 3 / LAMR) 8-factor block scoring → context pack (dependency closure, token budget, never drops named/failing blocks); `mega context *` + 4 MCP tools (no core edge).
- [[entities/skill-packs]] — `@megasaver/skill-packs` real loader/discovery/installer (2026-06-10); 7-member error enum; `mega pack` CLI; symlink + path-escape guards.
- [[entities/mcp-bridge]] — `@megasaver/mcp-bridge` real MCP stdio server over `stdio`, **26 tools** (25 ContextOps Phase 0–10 tools + v1.2 `proxy_search_code`), `MEGASAVER_TOOL_NAMING` proxy/legacy naming mode, `mega mcp serve`, `buildMcpSetupOps` facade, 16-member `McpBridgeErrorCode` (BB8; AA1 §8; v1.2 Proxy Mode).
- [[entities/context-gate]] — `@megasaver/context-gate@0.2.0` extracted from core (BB12, #88); orchestrator functions (`runOutputPipeline`, `runOutputExecCommand`, `fetchChunk`, `loadProjectPermissions`, `recordAndFilterOverlayOutput` — powers the saver hook; #140 maps stored chunk-set `source` to `sourceKind`); `OrchestratorRegistry` structural port; core re-exports surface (consumers unchanged).

- [[entities/conventions-sync]] — repo dogfood drift tooling (`scripts/conventions-sync/`); syncs `AGENTS.md` + 3 `.cursor/rules/*.mdc` from `docs/conventions/`; `CLAUDE.md` not yet managed (roadmap #2).

More subsystem pages land as features get built.

## Workflows

- [[workflows/cli-test-pattern]] — Citty handler test shape, env injection, biome ↔ TS strict conflict resolution.

Slots reserved for future workflow pages: `multi-agent-dogfood`, `design-skill-routing`, `core-registry-consumer-pattern`.

## Syntheses (cross-page answers)

- [[syntheses/mega-saver-product]] — what the product is, six subsystems, v0.1 slice.
- [[syntheses/gtm-plan-2026-07]] — GTM & monetization plan (3-element framework applied; decisions locked 2026-07-05: open-core Pro $10–15/mo, TR+EN parallel; Phase 0 = sellability).
- [[syntheses/pro-differentiation-portfolio]] — subscription differentiation portfolio, realigned 2026-07-07 to the shipped launch wave (#231–#251): Pro m1–m3 live (history/insights/forecast), free proof surface live; next sequence roi → fix → teardown → bench; $7.99-vs-$10–15 price-drift flag. Awaiting module-4 pick → spec cycle.
- [[syntheses/proxy-first-party-cache-parity]] — Claude Code custom-base-URL cache tax root cause, first-party route fix, upgrade safety, and 4-task real-billing result (0/4 loss → 4/4 win; measured 1.30x cost geomean).
- [[syntheses/post-v1.1-roadmap]] — post-v1.1 arc (PRs #102–#110 resolved: stats, skill-packs, Windows port + follow-ups) + remaining work, priority-ordered (npm publish gap, conventions:sync, GUI packaging, i18n, fikri §16 backlog).
- [[syntheses/contextops-roadmap]] — **strategic Phase 0–10 roadmap** (DIMMEM/LAMR/FORGE), **all 10 phases shipped** on `main` (PRs #114–#123, 2026-06-12); MCP surface 4 → 25 tools (26 with the v1.2 `proxy_search_code`). Keeps the original 22-agent-audit done/partial/gap framing for the historical record.
- [[syntheses/release-history]] — full chronological release/status narrative (every PR, critic round, process metric, open-backlog note) for Phase 9/10, v1.1.0, v1.0, AA1 BB1–BB7a, v0.3, v0.2. Split out of `index.md` on 2026-07-04 to keep the catalog lean; the `## Status` section below is the one-line-per-release digest.
- [[concepts/proxy-mode]] / Proxy Mode v1.2 — public naming mode, output classifier, vitest/tsc compressors, `proxy_search_code`, flagged engine-aware ranking, hook telemetry + adoption/interception metrics; full spec+plan written and shipped on `docs/contextops-roadmap-phases`.

## Sources (pointers to raw + project artifacts)

- [[sources/fikri-original]] — original 1421-line product idea (`raw/mega-saver-platform-fikri.txt`) with section index. Read this instead of the raw file.
- [[sources/spec-bootstrap]] — pointer to `docs/superpowers/specs/2026-05-03-mega-saver-bootstrap-design.md`.
- [[sources/plan-bootstrap]] — pointer to `docs/superpowers/plans/2026-05-03-mega-saver-bootstrap-plan.md`.
- [[sources/roadmap-phases-v2]] — summary of `~/Desktop/MegaSaver_Roadmap.txt` (Phase 0–10 strategic roadmap, 2026-06-11). Synthesized into [[syntheses/contextops-roadmap]].
- [[syntheses/post-v1.1-roadmap#3-feature-spec-index]] — pointers to the 3 shipped ContextOps feature specs+plans (intent-aware hook #180, diff-on-reread #181, semantic AST read #182). (was `sources/post-v1.1-features`, merged 2026-07-04)

## Raw

- `raw/mega-saver-platform-fikri.txt` — original Turkish product idea, 1421 lines. **Do NOT read whole.** Use `sources/fikri-original.md`.

## Archive

Stale/rotated/merged pages, kept for grep + history (never deleted; schema hard-rule #6). Update the live target, not these.

- `archive/log-2026-05.md` — rotated older `log.md` entries (107 entries, 2026-05-03 → 2026-05-13). Live `log.md` retains June 2026 onward.
- `archive/agent-channel-resolved.md` — resolved/closed inter-agent messages moved out of the live `agent-channel.md` (8 messages). Live channel keeps only open threads.
- `archive/memory-approval.md` — **merged** into [[concepts/structured-memory-engine#approval-gate]] (2026-07-04). Body preserved verbatim; redirect in frontmatter.
- `archive/post-v1.1-features.md` — **merged** into [[syntheses/post-v1.1-roadmap#3-feature-spec-index]] (2026-07-04). Body preserved verbatim; redirect in frontmatter.

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
| What does `mega pack` do / where do packs install? | [[entities/skill-packs]] / [[entities/cli]]     |
| Was BB12 executed? Where is the orchestrator?      | [[decisions/context-gate-extraction]] / [[entities/context-gate]] |
| How does the standalone CLI bundle work?           | [[entities/cli]]                                |
| What is in permissions.yaml?                       | [[entities/policy]]                             |
| Where are chunk sets persisted?                    | [[entities/content-store]]                      |
| Why is policy a v0.5 package?                       | [[decisions/policy-is-bb3]]                      |
| Why can't content-store import core?               | [[decisions/content-store-no-core-edge]]        |
| What are all 10 ContextOps phases / their status?  | [[syntheses/contextops-roadmap]]                |
| How does failed-run learning / FORGE work?         | [[concepts/failed-run-learning]]                |
| What is the task engine / selective retry?         | [[concepts/task-engine]]                         |
| How does the tool router decide allow/block?       | [[concepts/tool-router]]                         |
| How is the token-savings audit computed?           | [[concepts/audit-dashboard]]                     |
| How does memory approval / the team gate work?     | [[concepts/structured-memory-engine#approval-gate]] |
| What are the 25 MCP tools?                          | [[entities/mcp-bridge]]                          |
| Is Windows supported / how?                         | [[concepts/windows-support]]                    |

## Status

> Full release/status narrative (all PR-level detail) moved to
> [[syntheses/release-history]] on 2026-07-04. One line per release below;
> follow the link for the complete history.

- **v1.13.0 — anomaly alerts + persistent budgets (N7)** — PUBLISHED to npm 2026-07-09 (`latest`): `mega alerts` (median+MAD spike detection over traffic/source/ratio/firewall + budget pace, value-free firewall axis preserving F-FW-1), `mega savings budget set|show|clear` (`stats/budget.json`), forecast auto-loads the stored budget. Bundles #272 firewall-strip + #273 url_basic_auth patches. code-reviewer APPROVE + critic REQUEST-CHANGES→resolved (4 mutation-coverage tests, kills proven). Published-tarball entitled smoke verified. Tag `v1.13.0`. [[syntheses/pro-differentiation-portfolio]]
- **v1.6.1 — mega roi + bundle fix** — PUBLISHED to npm 2026-07-07 (`latest`): Pro module 4 `mega roi` (PR #252) + prepack dependency-closure fix; 1.6.0 deprecated (broken bundle — stale pro-analytics dist inlined). Published-tarball activation e2e-verified. Tag `v1.6.1`.
- **v1.5.0 — Pro launch wave** — versioned 2026-07-06 (#231–#251), PUBLISHED to npm 2026-07-07 08:19Z: entitlement seam + 3 Pro analytics modules (`savings history/insights/forecast`), free proof surface (headline, GUI share card, `mega init`, `mega gui`), landing + /pro + Gumroad checkout live at megasaver.dev ($7.99/mo).
- **Phase 10 — Team/Cloud (local approval slice)** — SHIPPED 2026-06-12. Agent-suggests → human-approves memory gate; `approve_memory` (24 → 25 MCP tools); cloud SaaS deferred. Roadmap complete through all 10 phases.
- **Phase 9 — Multi-Agent Connectors** — SHIPPED 2026-06-12. `agentIdSchema` 5→8 (continue/gemini/windsurf); 3 new flat-file targets; `mega connector list`/`doctor`.
- **v1.1.0** — SHIPPED 2026-06-04. Advanced-roadmap release; post-v1.0 arc PRs #80–#100 (context-gate extract, CI pipeline, output-filter parsers, policy permissions, GUI chart).
- **v1.0** — SHIPPED 2026-05-13 (`v1.0.0` tag). Context Gate / Mega Saver Mode epic (AA1) complete: 5 new packages, real mcp-bridge over stdio, GUI TokenSaverPanel; all 14 packages at 1.0.0.
- **AA1 Context Gate — BB1–BB7a** — SHIPPED 2026-05-11. First batch of the AA1 Context Gate / Mega Saver Mode epic (11 sub-PRs).
- **v0.3** — SHIPPED 2026-05-10. See release-history for what-shipped / process-metrics / deferred-backlog detail.
- **v0.2** — SHIPPED 2026-05-10. `--json` read+write parity, connector matrix (4 targets), DD/CC hardening batches; 587 tests on main.

See [[syntheses/release-history]] for the full chronological narrative including every PR, critic round, and open-backlog note.
