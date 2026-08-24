---
title: Wiki Log
type: append-only
---

# Wiki Log

Append-only timeline. New entries at the bottom.

Entry format:

```
## [YYYY-MM-DD] <op> | <description>
```

Ops: `ingest`, `query`, `lint`, `archive`, `schema`.

---

> **📁 Archived entries (loss-free rotation, 2026-07-04).** Older log
> entries were moved to dated archive files to keep this live log within
> the recent-activity window. **Nothing was deleted** — every archived
> entry is preserved verbatim and is grep-findable in its archive file.
> This live log retains June 2026 onward (103 entries). Archive index:
>
> | Archive file | Period | Entries |
> |---|---|---|
> | [[archive/log-2026-05]] (`wiki/archive/log-2026-05.md`) | 2026-05-03 → 2026-05-13 | 107 |
>
> Total across live log + archives: 103 + 107 = **210** dated entries
> (unchanged from pre-rotation).

---

## [2026-06-03] feat | BB12 executed — @megasaver/context-gate extracted (PR #88)

BB12 performed the extraction queued by the v1.0 closeout decision.
The 605-LOC orchestrator directory moved from `packages/core/src/context-gate/`
to the new standalone `packages/context-gate/` package
(`@megasaver/context-gate@0.2.0`):

- `runOutputPipeline`, `runOutputExecCommand`, `fetchChunk`,
  `loadProjectPermissions` are the exported orchestration functions.
- `OrchestratorRegistry` is a structural port of the original
  `CoreRegistry` interface; `context-gate` never imports `@megasaver/core`
  (zero core dep — breaks the cycle AA1 §3c warned against).
- `@megasaver/core` re-exports the entire `context-gate` surface so
  all existing callers (`mega output exec`, `mega_run_command`, …) import
  via core unchanged.
- Dependency-direction guard (`dependency-graph.test.ts`) relocated to
  the new package.
- `context-gate` deps: `content-store`, `output-filter`, `policy`,
  `shared`, `stats`, `yaml`.

Source: [[decisions/context-gate-extraction]], [[entities/context-gate]].

## [2026-06-03] release | v1.0.1 tagged (PR #89)

Patch release bundling the a11y changesets (#85, #87) and the BB12
extraction changeset (#88). Annotated tag `v1.0.1` created.

## [2026-06-03] feat | CI pipeline + standalone bundle (PRs #90, #91, #93, #94)

Two interrelated infra tracks that close the distribution story:

**CI (PRs #90, #93):**

- **PR #90**: `.github/workflows/ci.yml` added — `pnpm verify` runs on
  every PR and push; Node 22; Turborepo cache. Closes MM#62 by wiring
  `turbo typecheck dependsOn ["^build"]` so cold `pnpm verify` is
  self-sufficient.
- **PR #93**: adds `build` to `typecheck dependsOn` (the `^build`
  covers deps, the naked `build` covers the package itself). Completes
  the MM#62/CC#90 family.

**Standalone bundle (PRs #91, #94):**

- **PR #91**: `apps/cli/dist-bundle/mega.mjs` built via a second tsup
  config (`tsup.bundle.config.ts`, `noExternal: [/.*/]`, `version-define`,
  `createRequire` banner). `.github/workflows/release.yml` uploads it to
  GitHub Releases on every `v*` tag. npm publish gated on `NPM_TOKEN`
  (maintainer secret). Strategy: published `@megasaver/cli` carries zero
  runtime deps; workspace internals stay private.
- **PR #94**: hardened version source (env→define, removed stray
  `MEGA_CLI_VERSION`); `prepack`/`postpack` strips workspace devDeps from
  the published manifest.

## [2026-06-03] feat | Advanced roadmap: parsers + ranker + permissions (PRs #92, #95, #96)

- **PR #92** (`output-filter` parsers): pytest/go/cargo/eslint format
  detection and parsing added under `src/parsers/`. These are ordered
  BEFORE the generic `test-output` parser in the `chunkByFormat` cascade,
  so language-specific structured output is parsed with higher fidelity.
- **PR #95** (`output-filter` ranker): `rank.ts` ERROR-signal matcher
  extended to recognise CamelCase `*Error` suffixes and the Rust/Go
  `panicked` signal. Failure chunks now score non-zero in the ranker.
- **PR #96** (`policy` permissions): `.megasaver/permissions.yaml`
  tighten-only project permission rules. `policy.parseProjectPermissions`
  (pure, Zod-validated) + `context-gate.loadProjectPermissions` (yaml@^2
  I/O). `policy_load_failed` deny-code added. Four invariants enforced:
  tighten-only, deny-precedence, fail-closed, path-glob. Adversarially
  security-reviewed (HIGH risk).

## [2026-06-04] feat | GUI observability (PR #97)

- Token-savings inline-SVG chart added to the `TokenSaverPanel`.
- Raw-output retention controls: `GET /api/sessions/:id/raw-output/summary`
  + two-click destructive clear (session-scoped). `<output>` element
  carries `aria-live` for screen-reader announcements.

## [2026-06-04] fix | CI hotfix (PR #98)

- Biome format fix for retention test code introduced in PR #97.
- `NPM_TOKEN` gate moved to a `gate` job at the job level (previously
  the step-level condition was evaluated too early). Restores main green.

## [2026-06-04] release | v1.1.0 tagged (PR #99)

Advanced-roadmap release. Bundles: parsers (#92), ranker (#95),
permissions (#96), GUI observability (#97). Annotated tag `v1.1.0`
created. Package versions: cli 1.0.2, core 1.0.2, context-gate 0.2.0,
mcp-bridge 1.0.2, output-filter 1.1.0, policy 1.1.0, gui 1.1.0,
stats 1.0.1, retrieval 1.0.0, content-store 1.0.1, shared 1.0.0.

## [2026-06-04] chore | tsup bundle config header fix (PR #100)

Corrected `tsup.bundle.config.ts` header comment — both
`tsup.config.ts` and `tsup.bundle.config.ts` inline the entire
workspace graph via `noExternal`. Docs-only; no behaviour change.

## [2026-06-10] feat | stats wiring completion (PR #102)

Gap A: runOutputPipeline now appends a sourceKind:"file" TokenSaverEvent
(mirrors exec path); RunOutputResult widened with store_write_failed
(also wraps the previously-unwrapped persistChunkSet throw); mapped in
mega output file/filter + MCP mega_read_file. Gap B: mega session saver
stats reads readSummary via core re-export (BB6 stub retired; text
totals + eventStats in --json). Core re-exports stats surface so
apps/cli keeps its dependency-graph pin. Spec/plan:
docs/superpowers/{specs,plans}/2026-06-10-stats-wiring-completion-*.md.
pnpm verify green; smoke: output file → saver stats shows events: 1.

## [2026-06-10] feat | skill-packs real implementation (PR #103)

Last placeholder subsystem made real (risk HIGH; architect pass
GO-WITH-CHANGES folded into spec). loadPack with containment +
symlink guards; discoverPacks (workspace beats global, skip+warn);
shadow-aware scanSkillIdConflicts; atomic installPack (.tmp staging);
removePack; `mega pack {install,list,remove,info}` CLI with --root +
--json parity. Error enum widened to 7 members (not_implemented
retired). apps/cli dependency allow-list admits skill-packs. 74 new
tests across library + CLI; pnpm verify green; e2e smoke round-trip
captured. Spec/plan: docs/superpowers/{specs,plans}/2026-06-10-skill-packs-real-*.md.

## [2026-06-11] feat | Windows port remainder COMPLETE (PRs #104–#108)

Full Windows support; deferral spec 2026-05-10-windows-port-deferral.md
superseded. Sub-PRs: #104 docs (spec+plan); #105 (B) CRLF mixed-EOL
drift fix (normalizeEol); #106 (C) lowercase id contract; #107 (A)
win32 store path (%LOCALAPPDATA%, HOME→USERPROFILE, readStoreEnv
boundary, ~19 call sites, GUI bridge + skill-packs resolvers); #108 (D)
windows-latest CI matrix. Audit found deferral-spec claims largely
stale (case-collision theoretical — lowercase UUIDs). The windows-latest
leg surfaced + fixed real Windows bugs only a real runner shows:
.gitattributes LF (biome/autocrlf), atomic-write open temp `r+` for
FlushFileBuffers (core/stats/content-store), POSIX-only dir-fsync test
guard, per-OS symlink/chmod test skips, host-independent path
assertions. HIGH risk; architect + critic (REVISE→ACCEPT on A). Both
CI legs green. Deferred follow-ups: 2-process lock test, tsconfig
test-typecheck, mcp HOME fallback. See concepts/windows-support.md.

## [2026-06-11] feat | mcp HOME→USERPROFILE fallback (PR #109)

`mega mcp {status,install,uninstall}` read `process.env.HOME ?? ""` with no
USERPROFILE fallback → empty/relative agent-config paths on Windows. Extracted
`resolveHomeDir(env)` into apps/cli/src/store.ts (HOME→USERPROFILE→""), reused
in readStoreEnv (DRY) + the 3 mcp boundaries. detect-agent.ts config paths are
uniform join(home, …) so no platform branch needed. Unit-tested; verify green
both CI legs.

## [2026-06-11] fix | test-typecheck no-op + 113 pre-existing errors (PR #110)

apps/cli + apps/gui tsconfig.test.json extended a base whose exclude:["test"]
was inherited (TS does not merge exclude across extends), so `tsc -p
tsconfig.test.json` checked ZERO test files — a silent no-op. Added
exclude:["dist","node_modules",".turbo"] (cli also "test/e2e/**") so include
wins. Surfaced 109 (cli) + 4 (gui) pre-existing type errors — all fixed in test
files (bracket access, branded `as`, narrow citty-arg casts, ambient .d.mts for
a .mjs script); no src changes, no any/@ts-ignore. e2e excluded (cross-package
source import via ../../../../apps/gui; still run by vitest). Now 33 cli + 38
gui test files actually type-checked. code-reviewer ready-to-merge; both CI
legs green.

## [2026-06-11] query | "update wiki incl. remaining roadmap" → updated post-v1.1-roadmap.md

Post-v1.1 arc summarized (PRs #102–#110 resolved). Remaining roadmap re-ranked:
(1) npm publish [needs maintainer NPM_TOKEN], (2) conventions:sync→CLAUDE.md,
(3) GUI native packaging, (4) i18n tr, (5) fikri §16 backlog. Deferred
follow-ups tracked (2-process lock test, e2e typecheck gap).

## [2026-06-11] housekeeping | roadmap remaining-items pass (wiki side)

User: "complete remaining roadmap items in order." Wiki-completable items done:
(1) wrote pending entity page entities/conventions-sync.md — scripts/conventions-sync/
CONSUMERS (AGENTS.md + 3 .cursor/rules/*.mdc), docs/conventions/ source-of-truth,
CLAUDE.md gap (#2), distinct from `mega connector sync --target aider` product
feature. (2) Fixed syntheses/mega-saver-product.md stale "plan execution pending"
→ v1.1-shipped reality. (3) Struck stale v0.3 "connector aider sync" (shipped PR
#21 184b13d + #29). Updated index.md (entities list + cleared pending note + date)
and roadmap housekeeping section. Code items #1–#5 NOT done here: #1 npm publish
BLOCKED on maintainer NPM_TOKEN; #2–#5 need superpowers chain (multi-session).

## [2026-06-11] lint | index.md v0.3 "open backlog" 4/5 stale → struck

Lint of index.md:244 "v0.3 — open backlog (deferred to v0.4)": mcp-bridge real
impl (shipped PR #83 0e9be7a BB8), skill-packs real impl (PR #103), Windows port
remainder (PRs #104–#108 + #109/#110), connector aider sync (PR #21+#29) all
struck with citations. Only "CLAUDE.md tagged blocks" (roadmap #2) remains open.
No contradictions introduced; all new `[[links]]` resolve; conventions-sync not an
orphan (inbound from index.md + roadmap).

## [2026-06-11] feature | roadmap #2 conventions:sync → CLAUDE.md (PR #112)

Made CLAUDE.md a managed conventions:sync consumer (§0 wiki-first + §1–§13,
placed first). Full superpowers chain: spec→plan→TDD→reconcile→verify→critic→PR.
KEY DISCOVERY: billed "small/cosmetic" but a normalized scan then a 13-agent
adversarial audit showed CLAUDE.md had drifted from docs/conventions/*.md;
sources were already a content SUPERSET for 11/13 sections (sim 0.35–1.00).
Real work = HIGH-risk per-section reconciliation. Enriched 2 sources
(stack-and-commands config filenames; multi-agent-dogfood source-of-truth +
synced-reality, dropping the now-false "CLAUDE.md canonical/manual" block).
Promoted hand-added §0 to agent-neutral wiki-first.md → regenerated into
CLAUDE.md + AGENTS.md. Engine fact: sync REPLACES existing sentinel blocks,
never inserts → one-time hand-bootstrap of 14 sentinel pairs then --write.
Evidence: conventions:test 53/53; pnpm verify green (30 turbo tasks +
conventions:check 5/5 ok); critic verdict ship (no content loss, no
agent-specific leak). Branch feat/conventions-sync-claude-md, 8 commits.

## [2026-06-11] merge | PR #112 conventions:sync → CLAUDE.md (main @ c2ee52a)

Roadmap #2 merged. CLAUDE.md is now a managed conventions:sync consumer; dogfood
drift fully closed (all agent files regenerate from docs/conventions/). Wiki
updated open→shipped: entities/conventions-sync, post-v1.1-roadmap, index.

## [2026-06-11] ingest+synth | Phase 0–10 strategic roadmap (DIMMEM/LAMR/FORGE)

Ingested ~/Desktop/MegaSaver_Roadmap.txt (Phase 0–10 product roadmap) and
produced planning artifacts (docs + wiki only, no code). Reconciled every phase
against shipped v1.1 via a 22-agent workflow (11 map + 11 adversarial verify).
RESULT done/partial/gap: P0 partial, P1 partial (DIMMEM enrichment net-new), P2
gap, P3 partial (LAMR task-aware net-new), P4 partial (4 tools locked by AA1;
wider surface rides on P1/2/5), P5 gap, P6 gap, P7 gap, P8 partial (token-byte
stats only), P9 partial, P10 gap. Verifier nuance captured: P1/P4 "done vs
locked v0.1/v1.0 spec" but "partial vs roadmap vision" — both framings
documented. Wrote: syntheses/contextops-roadmap (master), sources/roadmap-
phases-v2, concepts/{structured-memory-engine,semantic-repo-index,context-
pruning-engine}; full spec+plan for the 3 near-term gap phases (1 DIMMEM,
2 repo-index, 3 LAMR) under docs/superpowers/{specs,plans}/2026-06-11-phase{1,2,3}-*.
Phases 4–10 stay roadmap-level. index.md + post-v1.1-roadmap cross-linked.
Branch docs/contextops-roadmap-phases (PR #113). Process: brainstorming (scope
locked via AskUserQuestion: docs-only / master+near-term / reconcile) → authored
solo for cross-doc coherence after the parallel code audit.

## [2026-06-11] feat | Phase 1 DIMMEM memory engine (registry + CLI + MCP)

Roadmap Phase 1 read/write surface over the typed memory schema, on branch
feat/phase1-structured-memory (PR #114). THREE TDD slices + two review passes,
all green via pnpm verify (30/30 tasks; core 230, cli 469, mcp-bridge 68,
connectors-shared 74, gui 252).
- Core: CoreRegistry.updateMemoryEntry/deleteMemoryEntry/searchMemoryEntries
  (mutable-in-place; BM25 via @megasaver/retrieval over title+content+keywords;
  stale excluded by default). memory-search.ts + memoryEntryUpdatePatchSchema.
  Bug found+fixed by TDD: delete-all wrote a zero-byte JSONL that readJsonLines
  rejected → writeMemoryEntriesForProject now removes the file on empty.
- CLI: mega memory create typed flags (--type/--title/--keyword/--confidence/
  --source/--reason/--goal/--file/--expires, optional w/ neutral defaults) +
  new search/update/delete(--yes)/explain subcommands.
- MCP: save_memory, search_memory, get_relevant_memories (closed enum 4→7).
Smoke: real `mega` run of create→search→explain→update(stale)→delete loop
captured (stale excluded from default search; delete refuses without --yes).
Review: code-reviewer + critic both ship (fresh contexts); first pass fix-first
(boundary validation, backfill guard, rm-error) → confirming pass clean.

## [2026-06-11] feat | Phase 2 Semantic Repo Index (@megasaver/indexer)

Roadmap Phase 2 on branch feat/phase2-semantic-index. New leaf package
@megasaver/indexer + CLI surface, 6 TDD slices + 2 review passes, pnpm
verify green (32 tasks; indexer 33 tests). See [[entities/indexer]],
[[concepts/semantic-repo-index]] (status gap→shipped).
- CodeBlock schema (8 types) + CodeBlockId in shared.
- extractTs (TypeScript compiler API): fn/class/interface→schema/arrow;
  PascalCase+tsx→component; *.test→test. extractMd (ATX sections +
  (intro)), extractJson (top-level keys + package.json script:<name>,
  key-anchored lineOf).
- scanRepo: traversal-safe, never follows symlinks; always-ignore +
  .gitignore + .megaignore (ignore lib); skips secret/binary/oversized.
- buildIndex: atomic store (blocks.jsonl + manifest.json), contentHash
  incremental, self-heals corrupt/torn index by re-extracting.
- searchBlocks BM25 (in the package, NOT the CLI — §3c forbids a
  CLI→retrieval edge; dependency-graph guard updated to allow indexer).
- CLI mega scan + mega index build/status/search/show. typescript is a
  CLI runtime dep, externalized from the bundle (it uses __filename at
  load, cannot inline into ESM) — single-file bundle no longer strictly
  zero-dep for the index feature.
Smoke: dogfood on the indexer package itself — build added 21 files/71
blocks; search "extract typescript ast" ranked extractJson/Md/Ts first;
rebuild unchanged=21. Review: code-reviewer + critic fix-first
(self-heal, key-anchored lineOf, ENOENT-only ignore swallow) →
confirming pass + security-reviewer.

## [2026-06-11] feat | Phase 3 Context Pruning / LAMR (@megasaver/context-pruner)

Roadmap Phase 3 on branch feat/phase3-context-pruning. New leaf package
@megasaver/context-pruner + CLI + MCP, 6 TDD slices, pnpm verify green
(34 tasks). See [[entities/context-pruner]], [[concepts/context-pruning-engine]]
(status partial→shipped).
- score.ts: 8-factor model (semantic normalized-BM25, userMention
  near-decisive, testFailure/recentEdit/memory from passed-in file sets,
  stale/noise penalties) + named WEIGHTS; memory relevance is DATA in
  (no core edge, §3c).
- select.ts: force-include named/failing (safety invariant — never
  silently dropped; budget overflow reported via usedTokens), fill to
  limit under token budget (line-span estimate; blocks carry no text so
  spec's chars/4 N/A), dependency closure over `calls`.
- pack.ts buildContextPack + reasons; audit.ts savings (feeds Phase 8).
- CLI mega context build/explain/audit/export; MCP get_relevant_context
  /get_relevant_code_blocks/explain_context_selection/
  get_context_budget_report (closed enum 7→11).
Smoke ("fix the login bug"): login ranked #1 (named in task + cited by
memory + semantic), 5 blocks → 2 included, tokens 120→48, saved 60%.

## [2026-06-12] schema | Phase 9 multi-agent connectors

Branch `feat/phase9-connectors`. Spec:
`docs/superpowers/specs/2026-06-12-phase9-connectors-design.md`.
Plan: `docs/superpowers/plans/2026-06-12-phase9-connectors.md`.

Result: `pnpm verify` green (lint 704 files, typecheck all 17 packages,
541 cli tests / 46 test files, conventions:check ok). Task 8 required
no `main.ts` edit — `connector: connectorCommand` was already registered
and `list`/`doctor` were already wired in `connector/index.ts`.

Changes:
- `@megasaver/shared`: `agentIdSchema` 5→8 members (continue, gemini,
  windsurf; alphabetical). Both drift-guard test files updated.
- `@megasaver/connector-generic-cli`: `geminiTarget`, `windsurfTarget`,
  `continueTarget` frozen objects; `builtinTargets` 3→6.
- `@megasaver/cli`: `KNOWN_TARGETS` 4→7; `mega connector list` +
  `mega connector doctor` commands; cross-agent integration test proves
  project memory lands byte-identically in two agent files.
- `@megasaver/gui`: `AGENT_LABEL` record + `AGENT_IDS` tuple + bridge
  mirror updated for three new agents.

Wiki pages updated: `entities/connectors-generic-cli`,
`entities/shared`, `entities/cli`, `syntheses/contextops-roadmap`
(Phase 9 partial→done), `index.md` (Phase 9 status block).

## [2026-06-12] feat | Phase 10 Team/Cloud (local approval slice)

MemoryEntry.approval (suggested|approved|rejected), backfill→approved.
Gate: search (incl. relevant/context-pack) + buildConnectorContext (CLI
+GUI) + get_project_context + mega_recall. CLI approve/reject + --all;
approve_memory MCP tool (24→25); buildPrMemoryComment + mega github
pr-comment. Team = shared store + gate. Cloud/auth/deploy/org/hosted-
audit/web-UI/visibility deferred. Spec+plan 2026-06-12-phase10-team-cloud.

Roadmap complete through all 10 phases.

Wiki pages updated: `entities/core` (approval field + gate point 1 +
buildPrMemoryComment), `entities/mcp-bridge` (25 tools, approve_memory,
gated tools), `entities/cli` (approve/reject, --all, github pr-comment,
connector gate), `syntheses/contextops-roadmap` (Phase 10 done, roadmap
complete, deferred-cloud items recorded), `index.md` (Phase 10 status block).

## [2026-06-12] docs | README + wiki refresh for completed 10-phase ContextOps roadmap

Documentation-only pass on branch `docs/readme-wiki-roadmap-complete`
(off main `f1fe1d3`, all 10 phases merged). No code changes.

README.md:
- Status line → all 10 ContextOps phases complete on `main` (PRs
  #114–#123); kept package versions (cli 1.0.2, gui 1.1.0, core 1.0.2).
- New "The ContextOps layer" section (per-phase engine table) + TOC entry.
- New "MCP tools" section listing all **25** tools grouped (memory /
  context / rules-failures / tasks / routing-audit), descriptions copied
  verbatim from `packages/mcp-bridge/src/server.ts` `TOOL_DEFS`.
- CLI reference: added memory (approve/reject/search --all/update/delete/
  explain), scan, index, context, fail, rules, learn, task, tools, audit,
  connector list/doctor, github pr-comment — all from `apps/cli` source.
- Connectors: 4 → **7** targets (added gemini/windsurf/continue);
  vscode/jetbrains + `mega connect` noted deferred.
- Architecture diagram + repo-layout + Mega Saver Mode MCP note updated
  (indexer, context-pruner, 25 tools). Roadmap section: all 10 phases
  shipped + deferred cloud-SaaS slice listed.

Wiki:
- `syntheses/contextops-roadmap.md`: reconciliation table now shows all
  10 phases `done` + PR refs + concept links (kept the original audit
  done/partial/gap framing as a second column); phase-detail headings
  4–8 → "done (was …)" with shipped notes; planning-artifacts now lists
  all 10 specs; build-order section reframed past-tense.
- New concept pages (matching existing style): `failed-run-learning`
  (FORGE), `task-engine`, `tool-router`, `audit-dashboard`,
  `memory-approval`. Cross-linked into index + roadmap synthesis.
- Entity consistency fixes — the phase batches had updated entities for
  Phases 9–10 only: added Phase 1/5/6/7 entity summary to
  `entities/core.md`, Phase 2/3/5–8 command groups to `entities/cli.md`,
  Phase 8 audit section to `entities/stats.md`. Confirmed
  `entities/{mcp-bridge,shared,connectors-generic-cli}` already accurate
  (25 tools / 8 agent ids / 6 generic-cli targets).
- `index.md`: 5 new concept links, quick-links rows, synthesis blurb,
  date bump.

Verify: `pnpm conventions:check` green (README + wiki are not
conventions-managed; ran to confirm CLAUDE.md/AGENTS.md/.cursor untouched).

## [2026-06-12] lint | dead wiki-link sweep

Scanned all 425 `[[wiki-links]]` across `wiki/`. One genuine broken
target: `index.md` linked `[[specs/2026-05-10-windows-port-deferral]]`
(no `wiki/specs/` folder — the doc lives at
`docs/superpowers/specs/2026-05-10-windows-port-deferral.md`). Fixed to
the backtick path, matching the same doc's two other references in
`index.md` (lines 312, 351). The other two `[[...]]` matches are false
positives that render as code, not links: the prose word `[[links]]`
in an older log line and the syntax example `[[wiki-link]]` in
`wiki/CLAUDE.md` §page-format. All real wiki-links now resolve.

## [2026-06-14] feat | Proxy Mode v1.2 — 7 phases shipped

Implemented the full Proxy Mode v1.2 roadmap (spec+plan vendored to
docs/superpowers/{specs,plans}/2026-06-12-proxy-mode-v1.2-*). Branch
feat/proxy-mode-v1.2, 7 commits, each TDD → pnpm verify green → external
review → changeset. Full verify 30/30 tasks, 1828 tests.
Phases: P0 tool naming mode (49b002e), P1 output classifier (c356e04),
P2 vitest/tsc compressors + passthrough (6f65d10), P3 proxy_search_code
(31bd0d7), P4 flagged engine-aware ranking (7a3c85b), P5 hook installer +
adoption/interception metrics + connector bias (07040de), P6 replay trace
(3873ae0). Reconciliations (repo vs spec, "confirm in repo" resolved):
grep not rg (LOCKED allowlist; rg/index-first → v1.3), retrieval = in-memory
BM25 (no persistent index), no P0 stubs (§13), mega_recall unrenamed,
MEGASAVER_ENGINE_RANKING default off. P3/P5 implemented via delegated
executor agents, independently re-verified + reviewed (P3 +path-traversal
guard, P5 +security review). New page concepts/proxy-mode. CLI smoke
captured: mega hooks install idempotent into temp settings, logger exit 0,
unknown target exit 1.

## [2026-06-14] merge | Proxy Mode v1.2 ← origin/main Phase 0–10 ContextOps

Merged origin/main (all 10 ContextOps phases, MCP 4→25 tools) into the v1.2
Proxy Mode branch. UNION resolution — nothing lost from either side. mcp-bridge
now exposes 26 tools (25 ContextOps + proxy_search_code); McpToolName is a
26-member enum. tool naming layer (tool-naming.ts) renames only
mega_read_file/mega_run_command/mega_fetch_chunk → proxy_* and passes every
other name through in both modes. CLI registers all Phase 0–10 subcommands plus
the hooks group. stats exports both the v1.2 proxy metrics and the Phase 8
AuditEvent family. README kept at the v1.2 version.

<!-- back-filled 2026-07-08 during stash triage from an uncommitted stash on the
     deleted branch feat/live-first-architecture; entries authored 2026-06-14 -->

## [2026-06-14] analysis | GUI gap audit

Reviewed `/Users/halitozger/Desktop/MegaSaver_GUI_Analiz.md` against the GUI,
bridge, CLI, and core sources. Confirmed the analysis' main claim: GUI exposes
agent setup, memory list/create, sessions, token-saver status/events/stats, and
retention, but not project create, memory approve/update/delete/search/explain,
rules, failures, index, context, task plans, tools, or audit dashboard. Added a
coverage-audit note to `wiki/entities/gui.md`, including the implementation
caveat that new GUI features must carry bridge enum/schema/test/store-root
work, not just a route and React view.

## [2026-06-14] analysis | GUI rev2 recheck

Rechecked revised `/Users/halitozger/Desktop/MegaSaver_GUI_Analiz.md`. Rev.2
now captures bridge contract cost, store-root/file-backed concerns,
typed-memory, long-running actions, and mutation safety classes. Remaining
corrections: do not cite `CoreRegistry` for index/context/audit (they live in
`@megasaver/indexer`, `@megasaver/context-pruner`, and `@megasaver/stats`);
avoid saying "doctor view yok" without distinguishing general health doctor
from the existing AgentSetupDoctor; add version/permission and data-volume
sections before implementation.

## [2026-06-14] analysis | GUI rev3 recheck

Rechecked rev.3 of `/Users/halitozger/Desktop/MegaSaver_GUI_Analiz.md`. Prior
corrections are incorporated: package ownership, AgentSetupDoctor wording,
project `rootPath`, audit-empty fallback, context-build classification,
pagination/data caps, and version/permission/unreadable-root file-backed
errors. Remaining notes are narrow: project `rootPath` validation should say
exist/readable instead of writable for create (writes happen later in
connector/index flows), index store currently self-heals some corrupt reads
instead of surfacing every corruption, and implementation should separate
design-time desired bridge errors from existing bridge mappings.

## [2026-06-14] analysis | External roadmap architecture correction

Reviewed and revised `/Users/halitozger/Desktop/MegaSaver_Detayli_Roadmap_ve_Mimari.txt`.
Main corrections: keep current Node 22/TypeScript/pnpm/`mega` CLI foundation;
treat Rust as a benchmark-gated future dataplane option, not a rewrite; preserve
the agent-agnostic Core boundary by keeping proxy/provider/agent logic in
connectors, MCP bridge, or gateway packages; reframe P0 as a gateway extension
on top of shipped ContextOps Phase 0-10 rather than a greenfield build; split
OSS, Team/Cloud, and Enterprise scope; add missing decision gates for
license/open-core, privacy/KVKK/GDPR, threat model, protocol conformance,
benchmark provenance, migration/rollback, and kill criteria.

## [2026-06-15] feature | GUI workspace-scoped Saver Mode activation

Re-hosted token-saver activation after the live-first pivot (PR #134) orphaned
it. Investigation: `tokenSaver.enabled` is NOT a runtime compression gate —
runtime compression (`filterOutput`) keys on `mode`/budget only; `enabled` is
read solely by `connectors-shared/context-gate-block.ts` to decide whether to
render the `CONTEXT_GATE` block into `<cwd>/CLAUDE.md`. So real activation is
inherently per-workspace (cwd), not per Claude session (the MCP bridge never
receives a Claude session id per call → no per-session runtime isolation).

Shipped (Engine Option A — render-in-bridge): connectors-shared
`renderContextGateBlockText` + `upsertContextGateBlockText` (CG-only, no
ConnectorContext); GUI bridge route
`/api/claude-sessions/:dir/:id/token-saver/workspace` (cwd server-derived,
writes CLAUDE.md via sentinel-bounded atomic helpers, reports `mcpInstalled`);
GUI `ws-token-saver` "Saver Mode" workspace panel. Followed full superpowers
chain (HIGH risk, worktree, spec+plan, TDD, two-stage subagent review).
Follow-up tracked: explicit `ConnectorError` mapping in bridge error-mapping.
Spec: docs/superpowers/specs/2026-06-14-gui-workspace-token-saver-activation-design.md.

## [2026-06-15] ci | fix pre-existing Windows verify failures (PR #136)

`verify (windows-latest)` had accumulated pre-existing failures (masked while
earlier PRs merged via owner CI-bypass; the Windows build failed first). After
#135 fixed the build (shared `@types/node`) and a path assertion
(workspace-resolver), Windows surfaced timeout-class failures one package at a
time — windows-latest fs is slow, so fs-heavy suites exceeded vitest's default
5000ms `testTimeout` (e.g. skill-packs `discover.test.ts` at 10800ms). Fix:
raised `testTimeout` + `hookTimeout` to 30s in all 14 package `vitest.config.ts`.
Audited path-assertion and `file://` classes too — assertions are symmetric
`resolve`/`join` or string passthroughs, and file URLs use `fileURLToPath(new
URL(...))` (win32-safe), so timeouts were the only remaining class. Both
`verify (ubuntu-latest)` and `verify (windows-latest)` now green — first
fully-green CI on both platforms (no bypass). See [[concepts/windows-support]].

## [2026-06-15] refactor | merge Saver Mode tab into Token saver tab

Per user request, collapsed the two cockpit tabs into one. The standalone
`ws-token-saver` "Saver Mode" workspace tab is removed; its controls now render
as a `SaverModeActivation` sub-component inside the single `token-saver` "Token
saver" tab (activation on top, this-session stats below). Both client calls key
on (dir,id) so no new props. Sub-headings keep the scope distinction explicit
(activation = workspace-wide; stats = this session). GUI-only; bridge routes and
client functions unchanged. See [[entities/gui]].

## [2026-06-15] feature | realized Saver Mode PostToolUse hook

Wired the previously-unbuilt overlay-stats producer so the live Token saver tab
actually populates AND Saver Mode realizes token savings. New `mega hooks saver`
PostToolUse hook: on an eligible native tool (Read/Bash/Grep/Glob/LS) in a
Saver-Mode-enabled workspace, when output exceeds the mode budget, it
evidence-preservingly compresses the output (filterOutput), stores the FULL
redacted output as a recoverable chunk, records the per-session overlay event
keyed by (workspaceKey=encode(cwd), liveSessionId=session_id — the hook's
session_id is the missing key the MCP bridge never had), and returns
`updatedToolOutput` so the model ingests the compressed result. New context-gate
primitive `recordAndFilterOverlayOutput`. `mega hooks install` now installs both
PreToolUse (telemetry) + PostToolUse (saver). SAFETY: always exit 0; any error /
multi-modal (text+image) output ⇒ original untouched (passthrough); full output
recoverable via proxy_expand_chunk. HIGH risk, full superpowers chain (spec/plan/
TDD/two-stage subagent review incl. opus safety pass). See [[entities/cli]],
[[entities/context-gate]]. Spec: docs/superpowers/specs/2026-06-15-realized-saver-hook-design.md.

## [2026-06-15] fix | chunk-set source maps to sourceKind (PR #140)

`recordAndFilterOverlayOutput` stored every overlay chunk-set with
`source: {kind:"file", path:label}` regardless of tool, so a Bash command/grep
was recorded as a file path. Now maps `input.sourceKind` → the matching
`OverlayChunkSet["source"]` variant (`command`/`grep`/`fetch`/`file`) via an
exhaustive switch. Cosmetic metadata only — hook behaviour + lossless recovery
unaffected; the overlay event already carried the right `sourceKind`. TDD; merged
via squash to main (commit 7c916db). See [[entities/context-gate]].

## [2026-06-15] feature | Connect Saver hook GUI toggle (PR #141)

In-app toggle to install/uninstall the GLOBAL Claude Code Mega Saver hooks
(`~/.claude/settings.json`), replacing terminal-only `mega hooks install`.
Hook-settings logic MOVED into `@megasaver/connector-claude-code` (single source
for CLI + GUI; `apps/gui` cannot import `apps/cli`) with new `uninstall` + status
fns and ATOMIC writes (temp+rename). New CLI `mega hooks uninstall claude-code`.
Global bridge route `GET|POST|DELETE /api/hooks/claude-code` (injectable
`claudeSettingsPath`). `HookConnection` toggle in the Token saver panel, honestly
labelled global, confirm-on-disconnect. HIGH risk, full superpowers chain;
executed as a 6-task subagent workflow (per-task spec+quality review). Critic
review caught a CRITICAL pre-merge bug: uninstall filtered whole entries by
command → would delete co-located unrelated user hooks; fixed to command-level
strip + regression test, critic re-verified (27/27 adversarial probes). Squash-
merged to main (commit a71f06e). See [[entities/gui]], [[entities/connectors-claude-code]],
[[entities/cli]]. Spec: docs/superpowers/specs/2026-06-15-gui-connect-saver-hook-design.md.

## [2026-06-16] finding | saver activation mechanics (operational)

While verifying live saving on the dev machine, captured the gotchas that make
"enabled but not saving" the default surprise:
(1) Claude Code loads hooks at **session start** — a hook connected mid-session
takes effect only after `/hooks` review or a NEW session.
(2) The installed hook command `mega hooks saver` must resolve on **PATH** — if
`mega` is absent the hook fails silently (always exit 0) → passthrough, zero
events. `pnpm link --global` needs `PNPM_HOME`/`pnpm setup`; fallback is a symlink
of `dist-bundle/mega.mjs` into a PATH dir (e.g. `~/.local/bin`). The on-disk
bundle must be rebuilt (`pnpm --filter @megasaver/cli bundle`) to include the
saver hook.
(3) Hook **install** (global, `settings.json`) and per-workspace **enable**
(`stats/<wk>/workspace-token-saver.json`, keyed by `encodeWorkspaceKey(cwd)`) are
ORTHOGONAL — both required, plus output > mode budget (safe 32000 / balanced 12000
/ aggressive 4000 B). Verified end-to-end: `mega hooks saver` compressed a 72000 B
payload → 44 B (99.94%), recording the overlay event. See [[entities/connectors-claude-code]],
[[entities/cli]], [[entities/gui]].

## [2026-06-16] architecture note | DFMT comparison direction

User shared Claude Code's DFMT comparison and asked whether MegaSaver should avoid
becoming a DFMT clone. Read [[concepts/agent-agnostic-core]],
[[concepts/contextops-roadmap]], [[concepts/proxy-mode]],
[[concepts/context-gate-pipeline]], and [[entities/mcp-bridge]]. Assessment:
Claude's timing diagnosis is directionally right — PostToolUse is a fallback and
MCP/proxy tools are the reliable pre-context hot path — but MegaSaver's
differentiator should be a broader ContextOps Gateway: agent-agnostic proxy
tools + optional hot local data plane + memory/repo/failure-aware ranking +
policy/redaction + replay/audit + expansion handles. This keeps DFMT's useful
"raw output never enters context first" lesson without copying its product shape.

## [2026-06-16] spec | Context Ledger reliable save architecture

User approved a save-first architecture target: cover all save error classes
(false memory, overwrite/conflict, secrets, broken agent config) with save as the
main focus, while targeting roughly 10% returned context / ~90% savings on
eligible MegaSaver-mediated large outputs. Wrote
`docs/superpowers/specs/2026-06-16-context-ledger-reliable-save-design.md` and
new concept page [[concepts/context-ledger-architecture]]. Core decision:
agent `save_memory` creates a candidate, not approved memory; evidence ledger +
validator + conflict checker + approval policy decide whether memory can enter
agent projections.

## [2026-06-16] review | Context Ledger spec split after Claude review

Claude Code review found real draft blockers: unpurgeable missed secrets in an
append-only ledger, silent Phase-10 `save_memory` contract change, candidate/raw
evidence MCP leak paths, 90% metric gaming, missing sufficiency metric, unbounded
retention, replay-vs-GC contradiction, and an over-broad one-plan scope. Revised
the design by marking the original umbrella spec superseded and splitting the
work into two narrower specs:
`2026-06-16-contextgate-honest-90-design.md` and
`2026-06-16-reliable-save-ledger-design.md`. Key corrections: ContextGate naming
only; token-weighted savings + eligible/mediated fractions; evidence sufficiency
counter-metrics; redaction revocation/tombstones; retention/pinning semantics;
candidate == existing Phase-10 suggested MemoryEntry; agent-facing MCP leak
invariant; per-connector projection matrix including Aider/Gemini/Windsurf/
Continue.

## [2026-06-16] review | Evidence Ledger residuals resolved

Second Claude Code re-check marked all prior blockers resolved and approved the
split direction, with two plan-blocking residuals: shared ledger schema ownership
and an overstrong `crypto-shred` phrase against the plaintext content-store.
Added `docs/superpowers/specs/2026-06-16-evidence-ledger-interface-design.md`
as the canonical package/schema/revocation/retention interface. Revised
ContextGate to consume that interface and describe secret purge honestly as
logical tombstone + best-effort local delete unless future encrypted-at-rest
storage lands. Also folded minor review items into Reliable Save: sidecar
atomicity, per-workspace/CAS approval serialization, and connector projection
validation staying out of Core.

## [2026-06-16] plan+review | Evidence Ledger plan + security review

Wrote `docs/superpowers/plans/2026-06-16-evidence-ledger.md` (13-task TDD plan
for the `@megasaver/evidence-ledger` leaf, grounded in the content-store
template + dependency-graph guard). Ran code-reviewer + adversarial critic.
BLOCKING finding: revoke does not actually remove a leaked secret — it survives
in `sourceRef` (command/url/query), in caller-supplied `rawDigest` (oracle), and
in a redundant `events.jsonl` sidecar; revoke tests passed without asserting the
secret was gone (false confidence). Plus compile/lint blockers (branded
`WorkspaceKey` param vs string literals; duplicate `node:fs` imports) and
integrity gaps (no atomicity between record write + event append; revoke deletes
chunk before tombstone; `retentionClass: pinned` survives revoke). Handed
spec-contract deltas to Codex via `wiki/agent-channel.md` (redact `sourceRef`,
ledger-computed + revoke-nulled digests, drop events sidecar, GC-exempt
`manual_hold`, boundary `workspaceKey` validation). Next: Codex amends interface
spec → Claude revises plan + re-checks. CLAUDE.md gained a hand-kept Session
Directives block (superpowers-for-everything + caveman ultra) outside managed
sentinels.

## [2026-06-16] spec | Evidence Ledger security amendments

Amended `2026-06-16-evidence-ledger-interface-design.md` from the plan-review
handoff. Spec now treats `sourceRef` as secret-bearing: redact at append time and
scrub to a non-reversible label on revoke. Digests are ledger-computed over
post-redaction content only, never caller-supplied, and are nulled on revoke.
Revocation atomically tombstones the record before best-effort raw chunk delete,
uses in-record `transitions[]` as the only audit trail, and explicitly drops
plaintext `events.jsonl`. Retention coherence added: pinned requires available,
manual_hold and pinned are GC-exempt, GC degrades only transient/session evidence,
pin/unpin is session→pinned→session, and IO validates `workspaceKey` at the
boundary while asserting loaded records match the requested workspace.

## [2026-06-16] plan-v2 | Evidence Ledger plan revised + re-verified

Codex hardened the interface spec (commit cd6b634); Claude revised
`docs/superpowers/plans/2026-06-16-evidence-ledger.md` to match: digests are
ledger-computed from passed post-redaction content (input carries no digest) and
nulled on revoke; revoke scrubs `sourceRef` + clears pins + resets retention,
tombstoning atomically BEFORE best-effort chunk delete; `events.jsonl` removed
(audit = in-record `transitions[]`); `workspaceKey` params are plain strings
parsed at the boundary with a record-match guard; pin is legal only from
`session`; GC exempts `manual_hold`; planted-secret purge tests added (assert
`JSON.stringify(record)` no longer contains the secret). Independent critic
re-verification confirmed all 8 prior blockers CLOSED, and found 2 new
compile/lint blockers (`nowTransition` violating `exactOptionalPropertyTypes`;
`store.ts` biome import order) + 1 minor — all fixed with the critic's verified
forms. Plan ready to execute. Next: execute Plan 1 in a worktree, or author
Plan 2 (ContextGate) + Plan 3 (Reliable Save).

## [2026-06-16] plans | ContextGate honest-90 + Reliable Save plans written

Wrote two more implementation plans (explore-grounded against real surfaces).
`docs/superpowers/plans/2026-06-16-contextgate-honest-90.md` — honest-metrics
engine in `@megasaver/stats`: token-weighted eligible reduction + eligible/
proxied/passthrough/mediated fractions + GA gate pairing reduction with a
sufficiency floor + `mega audit honest`. Critic found 2 blockers (persisted
overlay events carry no mediation/decision → loader can't honestly source
observations; unused `estimateTokens` import) + 2 important (threshold invariant
undocumented; load-bearing decision default) — all FIXED: mediation now assigned
by log source via a tested `recordedEventsFromLogs` projection, decision required,
threshold invariant documented. Sufficiency fixtures / evidence-write / MCP
expansion scoped as Plans 2b/2c/2d.
`docs/superpowers/plans/2026-06-16-reliable-save-ledger.md` — validator + conflict
checker + approval gate in `@megasaver/core` (candidate == suggested; no parallel
entity; MemoryValidation sidecar; deterministic hard checks + advisory heuristics;
dup/supersession/contradiction; approve_memory gated). Discovered MCP leak (§10) +
connector approval gate (§11) are ALREADY enforced today — plan locks them with a
regression test rather than rebuilding. Found a spec error: reliable-save §11 calls
Aider CONVENTIONS.md "full-file no sentinel" but shipped `aiderTarget` is
sentinel-based — flagged to Codex via agent-channel; Plan 3c (projection conformance)
+ Plan 3b (evidence linkage, needs Plan 1) scoped as follow-ons. Plan 3 critic pass
still pending.

## [2026-06-17] plan-review | Reliable Save plan critic + fixes

Independent critic on the Reliable Save plan found 3 blockers + 5 important/minor,
all FIXED: (1) approving an exact duplicate of an approved memory now REJECTS the
suggested row instead of creating a second approved row (spec §8) + test; (2)
`ApproveMemoryResult` extension specified concretely (optional `validation`/
`conflict`) instead of prose; (3) exact insertion anchor given (real handler has no
`approval==="approved"` branch — gate inserted after the no-op equality check,
before the flip); (4) §8 per-workspace serialization/CAS flagged as deferred to 3b
(in-memory registry makes sequential approval safe); (5) dead/speculative
`MemoryValidation` sidecar dropped — only the `validationStatus` enum ships (full
sidecar = 3b where it's read); (6) changeset states the unresolved-secret gate is
inert until 3b (evidence-presence gate active); (7) contradiction test assertion
tightened; (8) conflict-check precedence documented. All three plans (evidence-ledger,
contextgate-honest-90, reliable-save) now critic-verified and execution-ready;
follow-ons 2b/2c/2d/3b/3c named. Pending: Codex §11 Aider matrix correction.

## [2026-06-17] implement | Evidence Ledger package shipped → PR #143

Executed Plan 1 subagent-driven in an isolated worktree (`feat/evidence-ledger`, off
`main`). `@megasaver/evidence-ledger` built TDD across 14 commits: enums, sub-schemas
(+ sourceRef scrub), evidence record schema with revoke/pin/GC superRefine invariants,
read-boundary backfill, errors + ledger digest + ChunkDeletePort, atomic-write +
boundary workspaceKey parse, append-only store with ledger-computed digests +
workspace-match guard, list/pin/unpin/revoke(tombstone-before-delete)/explain/gc,
public surface + changeset. Implementer hit + correctly resolved 3 strict-TS/tooling
deviations (backfill TS4111+useLiteralKeys → named-interface cast; test-d describe
wrapper; store.ts single-write). Two-stage review: spec-compliance PASS (all 8
security invariants, file:line evidence, secret-purge test confirms revoked JSON has
no planted secret) + code-quality APPROVED-WITH-NITS (2 nits fixed: honest
`scrubSourceRef()` signature, restored atomic-write Windows-durability WHY comments).
Gates: 58/58 tests, tsc clean, biome clean, `pnpm verify` green. Deps exactly
{shared, zod} (dependency-graph test enforces no core/content-store edge). Pushed +
PR https://github.com/haJ1t/MegaSaver/pull/143 (base main).
**MERGED** (squash `9fc766e`) after CI green on ubuntu + windows-latest (the windows
verify validates the `IS_WIN32` atomic-write paths); remote branch + worktree cleaned
up. `@megasaver/evidence-ledger` (25 files) now on `main`. Next: wire
ChunkDeletePort→content-store in ContextGate (Plan 2c), then execute Plan 2 / Plan 3.

## [2026-06-17] implement | ContextGate honest-90 metrics shipped → PR #144

Executed Plan 2 subagent-driven in worktree (`feat/contextgate-honest-90`, off `main`).
`@megasaver/stats/src/honest-metrics.ts` (8 TDD commits): token-weighted
`eligibleReduction = 1 − Σreturned/Σraw` over the eligible set + eligible/proxied/
passthrough/mediated fractions (no per-output-mean gaming), `classifyObservation`
(passthrough/light/native never create savings), `recordedEventsFromLogs` (mediation
assigned by log source: overlay→saver_hook, session→proxy, hook→native), `meetsGaGate`
(reduction AND sufficiency floor), and a `mega audit honest` CLI. CLI reaches stats via
`@megasaver/core` re-export (CLI→core→stats; direct CLI→stats forbidden by the cycle
guard). Two-stage review: spec found + fixed a `--json` stdout-corruption bug (caveat
now gated behind `!args.json`); code-quality APPROVED-WITH-NITS, fixed (trimmed core
re-export 13→4 symbols, stale audit description, tautological token test made
load-bearing). Gates: stats 116 + cli 628 tests, tsc + biome clean, `pnpm verify`
36/36. **MERGED** (squash `62b3c65`) after CI green ubuntu + windows. `mega audit honest`
ships wired+tested but reports an empty set until Plan 2c supplies the
liveSessionId→workspaceKey loader (named-deferral, no silent cap). Deferred: 2b
(sufficiency fixtures), 2c (evidence-write + loader), 2d (MCP expansion). Next: Plan 3
(Reliable Save) — validator/conflict/approve-gate in core; Codex §11 Aider matrix fix
still pending.

## [2026-06-17] implement | Reliable Save validator+conflict+gate shipped → PR #145

Executed Plan 3 subagent-driven in worktree (`feat/reliable-save-ledger`, off `main`),
with superpowers skills invoked properly per step (using-git-worktrees →
subagent-driven-development → finishing-a-development-branch) after the operator flagged
that Plan 2 reused the pattern without re-invoking. 10 commits in `@megasaver/core` +
`@megasaver/mcp-bridge`: `validation-status` enum, `save-validator` (fail-closed hard
checks + downgrade-only advisory heuristics), `conflict-checker` (deterministic
dup/supersession/contradiction, precedence-ordered), exports, and the `approve_memory`
gate (runs validate+conflict before the suggested→approved flip; exact duplicate of an
approved memory → suggested row REJECTED, never a second approved row; non-valid/
conflicted → stays suggested with reasons). Two-stage review: spec PASS (all 6
invariants; the agent-no-evidence BLOCK path confirmed tested) + a completeness gap
fixed (MCP leak lock extended from 2→4 tools: search_memory, get_relevant_memories,
mega_recall, get_project_context — all pass against existing gates, regression lock).
Code-quality APPROVED-WITH-NITS, fixed (hoist NEGATIONS, document conflict precedence,
single-source duplicate reason). Gates: core 467 + mcp-bridge 183 tests, tsc + biome
clean, verify 36/36. **MERGED** (squash `f46ce66`) after CI green ubuntu + windows.
Known limitation (in changeset): `unresolvedSecret` defaults false → secret gate inert
until Plan 3b wires evidence ports; evidence-presence gate active. Deferred: 3b
(evidence linkage + workspace identity + approval serialization/CAS + `mega memory
review`/`explain`), 3c (projection conformance — needs Codex §11 Aider matrix fix
first). All three context-ledger implementation plans now on `main` (#143/#144/#145).

## [2026-06-17] implement | Context-ledger follow-ons shipped via dynamic workflow → PR #146

Ran a dynamic Workflow (18 agents: parallel design → sequential TDD build → per-slice
adversarial review) on a main-based worktree to finish the full remaining follow-on
scope. Six slices, all merged (squash `c25cadf`): 2b sufficiency counter-metrics +
fixture corpus (stats); 2d MCP expansion guard (`expansion_blocked`); 2c ContextGate
evidence-write wiring + honest-audit `liveSessionId→workspaceKey` loader (`mega audit
honest` now reports real numbers); 3b evidence linkage that ACTIVATES the secret gate
(evidence-resolver + workspace match + revoked/missing block); 3b approval
serialization (critical-section re-check); 3b `mega memory review`/`explain` +
persisted MemoryValidation sidecar. CRITICAL LESSON: `pnpm verify` was 36/36 green but
the per-slice adversarial reviewers caught THREE fail-open security gaps green tests
missed — (1) `sourceRef.label` persisted unredacted (secret leak), (2) unconsumed
`missingIds` (a memory citing a non-existent evidenceId approved), (3) the MCP
expansion guard never wired into the production `createBridge` path (agent could browse
any chunkSet). A focused opus security-fix pass closed all three with RED→GREEN tests
on the real path (e6cfc55 redact label, 6fd50ed block missing evidence, 5d941c4
per-server returnedChunkSetIds set); an independent security verification confirmed
closure, no new fail-open/over-block. Gates: `pnpm verify` 36/36 green, CI green ubuntu
+ windows. Two latent residuals filed as a follow-up task (appendEvidence should redact
sourceRef itself, not rely on the caller; expansion guard set is per-server not
per-session + unbounded). 3c (projection conformance) still deferred — blocked on Codex
§11 Aider-matrix fix (agent-channel). Context Ledger architecture now fully implemented
on `main` except 3c. Takeaway: green gates ≠ secure; adversarial review after green is
load-bearing, especially for evidence/secret-handling code.

## [2026-06-17] fix | Evidence sourceRef redaction + bounded expansion guard → PR #147

Closed the two latent defense-in-depth residuals from #146 (subagent-driven, worktree
off main, skills invoked per step). `fix(evidence-ledger)` (`da9d3a7` squash): `appendEvidence`
now takes a REQUIRED `redactSourceRef: SourceRefRedactor` port applied to `record.sourceRef`
before schema-parse + persist — compile-time fail-closed, leaf stays policy-free, spec §3
redaction now enforced at the append boundary instead of relying on the caller; the
ContextGate composer wires `policy.redact` over command/args/url/query/path/label (single
redaction source, removed the e6cfc55 call-site dup). `fix(mcp-bridge)`: expansion-guard
`returnedChunkSetIds` is now a `BoundedSet` (FIFO cap 4096); per-session keying deferred (the
`mega_fetch_chunk` wire carries no sessionId; stdio is single-session-per-process — documented).
RED empirically reproduced (planted marker in all 6 sourceRef fields survived without the port).
Adversarial review: Part A CLOSED (no production identity-redactor bypass, no regression),
Part B SOUND. Gates: pnpm verify 36/36, CI green ubuntu+windows. Review surfaced a NEW
pre-existing out-of-scope leak (filed as task chip): the raw `label` (command/url/path) still
reaches `OverlayChunkSet.source` + the overlay stats event UNREDACTED on the shipping saver
path — separate code path, not an evidence-ledger regression. Five context-ledger PRs now on
main (#143–#147). Still open: 3c projection conformance (Codex §11 blocker) + the overlay-source
label-redaction follow-up.

## [2026-06-17] fix | Overlay source-label redaction → PR #148

Closed the overlay-source label-redaction leak flagged by #147's adversarial review (worktree
off main, full superpowers chain, skills invoked per step). `fix(context-gate)` (`97ccb98`
squash): `recordAndFilterOverlayOutput` persisted the RAW `label` to two on-disk sinks — the
overlay chunk-set `source` (command/url/grep-query/file-path, via `chunkSetSource` →
content-store) and the overlay stats event `label` (→ @megasaver/stats) — so a credential-bearing
command line, token-bearing fetch URL, or secret path landed unredacted even though the chunk
CONTENT was redacted. Fix computes `redactedLabel = redact(input.label).redacted` once (same
`@megasaver/policy` `redact` as content) and feeds both sinks; evidence `sourceRef` untouched
(redacts via its own #147 port). TDD: 3 RED tests (secret in command/event/fetch-URL → present
on disk) + 2 contract-lock tests (grep/file) — all assert on the reloaded on-disk artifact, not
in-memory. Empirically confirmed a redacted fetch URL still passes `overlayChunkSetSchema`
`z.string().url()`. Gates: pnpm verify 36/36, CI green ubuntu(2m55s)+windows(4m48s). Adversarial
review (3 lenses + synthesis): APPROVE, no must-fix; surfaced honest residuals → (a) tightened
changeset wording (redact only catches prefix/structure-shaped secrets, not bare `?token=<hex>`
or `user:pass@host` — same blind spot as content path); (b) NEW follow-up task chip
(`task_18423994`): the parallel saver paths still leak raw command/args/path —
`run-command.ts` (the LIVE `proxy_run_command`, persists the real `args` array so a bearer token
in `-H` lands in `source.args`), `run.ts:207`, `read.ts:213`; pre-existing, untouched here.
Six context-ledger PRs now on main (#143–#148). Still open: 3c projection conformance (Codex §11
blocker) + the parallel-path label leak (`task_18423994`). Takeaway reconfirmed: adversarial
review after green gates is load-bearing — it caught the changeset overstatement AND a more
severe sibling leak (raw args on the live MCP command path) that the green suite never touched.

## [2026-06-17] fix | Parallel saver-path label redaction → PR #149

Closed the parallel-path label leak (`task_18423994`) flagged by #148's review (worktree off
main, full superpowers chain, skills per step). `fix(context-gate)` (`aa42dbd` squash): #148 only
redacted the label inside `recordAndFilterOverlayOutput`; the other live saver paths still wrote
the RAW label to disk — `run-command.ts` (`runOutputExecCommand` legacy + `runOverlayOutputExecCommand`
overlay, the latter behind `proxy_run_command`) persisted `source.command`, `source.args`, and the
event `label` raw (it stores the REAL args array → a `curl -H "Authorization: Bearer ..."` token
landed in `source.args` on disk); `run.ts` (legacy+overlay file pipelines) persisted the file
`path` raw in the event label; `read.ts` `persistChunkSet` + `persistOverlayChunkSet` persisted
the file `path` raw in `source.path`. Fix applies `@megasaver/policy` `redact` (same detector as
content) at every sink: command+args redacted element-wise, the event label rebuilt from the
redacted parts, the file path redacted at the `persist*` sink (covers all callers of the exported
fns) + the `run.ts` event label. TDD: 4 RED on-disk round-trip tests (legacy+overlay × command+file,
assert secret body absent + `[REDACTED]` marker on the persisted chunk JSON + events.jsonl) → GREEN.
Gates: pnpm verify 36/36, 55/55 context-gate, CI green ubuntu+windows. Adversarial review (3 lenses
+ synthesis): APPROVE, no must-fix; acted pre-merge on its findings → reverted a no-op `redact` the
initial `replace_all` over-applied to `readAndFilter`'s `filterOutput` call (not a persistence sink;
`filterOutput` reads `source` only for command-classification), strengthened the 2 legacy tests with
positive `[REDACTED]` marker assertions. Seven context-ledger PRs now on main (#143–#149). Known
limits (tracked, not regressions): `redact` misses bare `?token=<hex>` / `user:pass@host` (detector
blind spot, shared with content path → `redaction-patterns.ts` hardening follow-up); `secretsRedacted`
metric undercounts secrets that appear only in label/args/path. Still open: 3c projection conformance
(Codex §11 blocker) + redactor-pattern hardening. The secret-on-disk leak class across the saver
persistence paths is now closed for all structurally-detectable secrets.

## [2026-06-17] feat | Contextual no-prefix secret redaction → PR #150

Closed the redactor detector blind spot (`task_00c4363d`) flagged across #148/#149 reviews
(worktree off main, full superpowers chain). `feat(policy)` (`b2e39cd` squash): `redact()` —
the SINGLE detector shared by chunk content + every saver sink + evidence sourceRef — matched
only prefix/structure-shaped secrets, so contextual secrets (secret-named URL query/fragment
param, userinfo creds on non-db schemes, secret CLI flag value, api-key/Basic header) passed
through verbatim and reached disk. Added 5 LOOKBEHIND patterns after the locked baseline
(additive-only, baseline untouched; backrefs avoided because `redact()` applies replacements via
a function → `$1` would be literal): `url_basic_auth`, `url_query_secret` (query+fragment),
`cli_secret_flag_eq` + `cli_secret_flag_spaced` (quoted-only), `api_key_header`,
`basic_auth_header`. A generic high-entropy matcher for CONTEXTLESS opaque tokens was
deliberately omitted (indistinguishable from SHAs/UUIDs/hashes → mass false positives).

**Adversarial review earned its keep — BLOCK → fix → re-APPROVE.** First 3-lens review (false-
positive / coverage / regression+ReDoS) BLOCKED with 4 verified defects the green suite missed:
(C1 critical) OAuth **fragment** tokens `#access_token=` leaked (lookbehind took only `[?&]`);
(C2 critical) `url_basic_auth` forbade `/` in the password → slash-passwords leaked the whole
cred, strictly weaker than the baseline `db_url` it copied; (I1 important) the cli flag space
form ate the next token / prose / shell operators (`&&`,`|`,`>`) → corrupted the first-failure
evidence the saver preserves; (I2 important) empty-username userinfo (`redis://:pw@`) leaked.
All fixed via TDD (RED tests for each leak + each over-redaction negative): `[?&]`→`[?&#]`,
basic-auth class `[^\s/@]*:[^\s@]+(?=@)`, cli flag SPLIT into `=`-form (unquoted) + space-form
(quoted-only). A focused 2-lens re-review empirically confirmed all 4 CLOSED + no new
leak/false-positive (17-case benign battery clean, no ReDoS <5ms/500KB, every redacted URL still
passes `z.string().url()`). Gates: pnpm verify 36/36, policy 143/143, context-gate 15/15, CI green
ubuntu+windows. Documented minors (non-leaks): `@`-in-password short tail (RFC requires
%-encoding; first-`@` anchor), baseline-shaped query value double-counted, `Authorization: Basic
<prose-word>` cosmetic over-redaction. Eight context-ledger PRs now on main (#143–#150). Still
open: 3c projection conformance (Codex §11 blocker). Takeaway, reconfirmed hardest here:
adversarial review after green is load-bearing — green `pnpm verify` shipped 2 CRITICAL credential
leaks (OAuth fragment, slash-password) that only the adversarial pass caught.

## [2026-06-18] feat | Token-saver completion (4 slices, dynamic workflow) → PR #151

Closed the buildable gaps keeping the auto-saver (`mega hooks saver` PostToolUse) from being fully
usable end-to-end. Built as ONE dynamic Workflow: sequential TDD implement (4 slices share
`apps/cli/src/hooks/saver.ts` → serialized, subagent-driven, git-safe) + parallel per-slice
adversarial review + full verify. `feat(cli)` (`1565d40` squash, 4 commits, 695+/7−, surgical):
- **S1 activation CLI** (`ab988a4`): `mega session saver workspace enable|disable [--mode]` writes/
  toggles `<storeRoot>/stats/<wk>/workspace-token-saver.json` (exact `z.object({enabled,mode})` the
  hook reads, atomic, `--mode` validated) → saver usable WITHOUT the GUI (was GUI-only). New
  `workspace` subgroup to avoid colliding with the session-scoped `enable/disable`.
- **S2 evidence wire** (`20bb885`, HIGH): live saver now passes `evidenceStoreRoot: deps.storeRoot`
  into `recordAndFilterOverlayOutput` → evidence-ledger rows written on the AUTO path, not only MCP/
  memory. Same `<storeRoot>/evidence/<wk>/` convention; best-effort intact (4-line prod change).
- **S3 honest token metrics** (`3a5b35d`): inline pointer + `session saver stats` now report
  token-weighted savings (`~A→B tokens, P%`) via the `@megasaver/stats` estimator (was byte-only);
  `--json` additive/backward-compatible.
- **S4 truncation-honest recovery** (`be6684b`): if input pre-truncated by the harness (end-anchored
  marker, low false-positive), pointer says recovered chunk is PARTIAL instead of lying "Full output
  recoverable" — the buildable core of the native-truncation shadowing finding.
Final pointer composes all three saver.ts slices:
`[Mega Saver: compressed X→Y B (~A→B tokens, P%). <Full output recoverable | PARTIAL note>.]`
Gates: 4/4 slice reviews APPROVE (only cosmetic minors), self-run `pnpm verify` exit 0, CI green
ubuntu(3m5s)+windows(4m48s). Workflow note: first run failed on a paren bug in the review phase
(`(await parallel(...).filter(...))` → `await` bound to the Promise, not the array) AFTER all 4
implements had committed; fixed paren + resumed with `resumeFromRunId` → implements returned cached,
review+verify ran live. Nine context-ledger/saver PRs now on main (#143–#151).

**Out of scope (stated, not buildable here):** npm publish (`NPM_TOKEN` maintainer secret) · GUI
approval UX (v0.3+ deferred) · 3c projection conformance (Codex §11 Aider-matrix blocker, pending).
Token saver now works end-to-end in-session: enable via the CLI, compress + redact (#147–#150) +
evidence (#143) + honest token metrics + honest partial-recovery signal.

## [2026-06-18] spec | Aider projection matrix corrected

Addressed Claude Code's 3c blocker in
`docs/superpowers/specs/2026-06-16-reliable-save-ledger-design.md` §11. Verified
`packages/connectors/generic-cli/src/targets.ts`: `aiderTarget` is in
`builtinTargets` with no special full-file path, so it uses the shared
`MEGA_SAVER:BEGIN` / `MEGA_SAVER:END` sentinel block like Codex, Gemini,
Windsurf, and Continue. Spec now marks Aider `CONVENTIONS.md` as sentinel-based;
Cursor remains the only current generic target with header/frontmatter outside
the sentinel block.

## [2026-06-18] feat | Plan 3c projection conformance → PR #152 (LAST platform item)

Codex corrected §11 (`43e9709`: all connector targets sentinel-based; only Cursor carries
frontmatter outside the sentinel) → 3c unblocked, executed end-to-end under the full chain
(worktree off main, writing-plans, TDD, adversarial review). `feat(connectors)` (`1db07df` squash):
added `projectionPreflight(content, {expectHeader})` in `@megasaver/connectors-shared` — validates
the FINAL rendered connector output before the atomic write (exactly one balanced managed sentinel
block via `parseBlock`, balanced `CONTEXT_GATE` block when present, seed-path-only Cursor frontmatter
survival). New `projection_invalid` error code mapped in all three exhaustive `ConnectorErrorCode`
consumers (generic-cli + claude-code `mapSharedErrorCode` → block-conflict, completeness-only since
preflight lives in the CLI; apps/cli message map). Wired into `connector sync` before each write
(seed + update); a `projection_invalid` throw hits the existing per-target try/catch → only that
connector's write aborts, store + other targets intact, exit 1 (spec §11/§14). Agent-agnostic (no
`ConnectorTarget` import; core untouched). Conformance matrix across all 7 targets + corrupt-isolation
+ a `vi.mock` call-site abort test proving the guard fires + disk unchanged. Self-verify caught a real
regression MID-BUILD: initial `expectHeader`-on-update falsely aborted a header-less Cursor re-sync
(broke U5) → fixed seed-only (header prepended only on seed; out-of-block text is user-owned on
update). Adversarial review (2 lenses + synthesis): APPROVE, no must-fix; acted pre-merge on minor
coverage findings. Gates: pnpm verify 36/36, CI green ubuntu(3m11s)+windows(4m29s). Ten PRs on main
(#143–#152).

**Platform status: all buildable items shipped.** Remaining non-code items are maintainer-only: npm
publish (`NPM_TOKEN` secret + `@megasaver` scope claim — verified publish-ready) and the GUI (v0.3+
deferred; saver activation already covered by the #151 CLI). Context-ledger + reliable-save +
token-saver arc complete.

## [2026-06-18] release | @megasaver/cli@1.0.2 PUBLISHED to npm

`@megasaver/cli@1.0.2` is live on npm (`registry.npmjs.org/@megasaver/cli/1.0.2`) — installable
via `npm i -g @megasaver/cli` (`mega` bin). Closes the MVP→installable-product gap (post-v1.1
roadmap #1). Maintainer claimed the `@megasaver` org/scope + write token + `NPM_TOKEN` secret;
`v1.0.2` tag triggered `release.yml`. CI npm-publish could NOT pass 2FA: account/org enforces
2FA-for-writes; granular token + account "auth only" still EOTP; maintainer uses a security key
(FIDO/WebAuthn) not TOTP, so `--otp` is impossible in CI. Resolution: `npm pack` the released `main`
code into a tarball, then `npm publish <tarball> --access public` LOCALLY, completing the
security-key 2FA in the browser. For hands-off CI releases later: disable 2FA-for-writes at the ORG
level (per-account change was overridden by org enforcement) or use a 2FA-bypass token. Bundle is
self-contained (single ~11MB `dist-bundle/mega.mjs`, 0 workspace refs). Ten PRs (#143–#152) + this
release: the context-ledger / reliable-save / token-saver arc is complete AND shipped to npm.

## [2026-06-22] feature | agent-office Phase 0 (engine data layer)

New feature **Agent Office** (spec docs/superpowers/specs/2026-06-22-agent-office-design.md,
plan docs/superpowers/plans/2026-06-22-agent-office-phase0-engine.md). Brainstorming locked:
hybrid launch+track; four agent kinds by interface with claude-code adapter first; rich roles
(persona+model+tools/skills+permission+workdir, seeded from CLAUDE.md §6 + custom); per-agent
task queue with lifecycle; headless `claude -p --resume` execution; engine package + GUI board +
thin `mega office` CLI; safety risk CRITICAL — safe-by-default (`plan`), opt-in writes per role,
workdir confinement, evidence-ledger audit (user sign-off recorded in spec frontmatter).

Phase 0 shipped on branch `worktree-feat+agent-office`: new agent-agnostic package
`@megasaver/agent-office` (deps: `@megasaver/shared` + zod only; no core edge yet). Delivered the
data layer — zod `.strict()` schemas `Role`/`OfficeAgent`/`OfficeTask` (+ enums), new shared
branded ids `roleId`/`officeAgentId`/`officeTaskId`, atomic-json stores mirroring content-store
(temp→fsync→rename, `assertSafeSegment` incl. NUL guard, typed `AgentOfficeError`), and
`buildPredefinedRoles` (13 seed roles, ALL `permissionMode: plan`). 57 tests, `pnpm verify` green.
Built subagent-driven (4 batches, two-stage spec+quality review each). New entity page
[[entities/agent-office]]. Phases 1-5 (launcher → supervisor → bridge → GUI → CLI) deferred to
their own specs; the CRITICAL spawning lands in Phases 1-2. Follow-ups noted: tighten
`workspaceKey` to the branded schema in Phase 2; harden `atomicWriteFile` dir-fsync edge across
content-store + agent-office.

## [2026-06-22] feature | agent-office Phase 1 (launcher capability)

Shipped the spawning capability on branch `worktree-feat+agent-office-phase1` (spec
docs/superpowers/specs/2026-06-22-agent-office-phase1-launcher-design.md, plan
.../plans/2026-06-22-agent-office-phase1-launcher.md). Grounded against installed `claude`
2.1.177: all assumed flags exist; persona via `--append-system-prompt`, session continuity via
`--session-id` (new) / `--resume` (later); permission map plan→plan, acceptEdits→acceptEdits,
full→bypassPermissions.

Added agent-agnostic `AgentLauncher` interface + `LauncherError` + `launcherPermissionMode`/
`launcherModel` zod schemas to `@megasaver/connectors-shared`, and the claude-code adapter
(`buildClaudeArgs` pure builder + `createClaudeCodeLauncher` with injectable spawn,
StringDecoder-based UTF-8-safe stdout line parsing, one-shot onExit latch, SIGTERM cancel) to
`@megasaver/connector-claude-code`. Workdir confinement (cwd only, no --add-dir); argv array (no
shell injection). Risk HIGH; every test injects a fake spawn — no real `claude` spawned.

Built subagent-driven; reviewed by code-reviewer + adversarial critic. Critic caught two real bugs
fixed before merge: double `onExit` on ENOENT (error+close both fire) and UTF-8 multibyte
chunk-split corruption — both now have regression tests. `pnpm verify` green; changeset minor×2.
Phase 2 carry-overs recorded on [[entities/agent-office]]: event buffering for async subscribers,
SIGKILL escalation, gate full/bypassPermissions, listener teardown, brand `workspaceKey`.

## [2026-06-22] feature | agent-office Phase 2 (supervisor)

Wired the launcher into the office on branch `worktree-feat+agent-office-phase2` (spec
docs/superpowers/specs/2026-06-22-agent-office-phase2-supervisor-design.md). `@megasaver/agent-office`
now deps `core` + `connectors-shared`. Added: `resolveLauncherPermission` (safe-by-default gate —
`full` refused unless `allowFull` explicitly granted), `createLauncherRegistry`, an append-only
office audit log, and `createSupervisor` (processNextTask/drainAgent/runWorkspace). Branded
`workspaceKey` on agent/task schemas; added `cancel(signal?)` to the launcher handle.

Decision: used a lightweight dedicated audit log instead of `@megasaver/evidence-ledger` — the
ledger's appendEvidence is content-redaction-shaped (redactSourceRef/redactedRawContent/policyVersion),
a poor fit for spawn events. Full ledger integration deferred.

Risk CRITICAL. Reviewed by code-reviewer + critic + security-reviewer. security-reviewer: PASS — the
safe-by-default permission gate is airtight (impossible to spawn bypassPermissions without
allowFull), workdir confinement holds (cwd only, no --add-dir, argv array), audit metadata complete.
critic first returned DO NOT SHIP on failure-path correctness; fixed before merge: try/catch settles
task→failed + agent→error on ANY throw (no poisoned running/working persisted state), endSession
exactly once, terminal audit row per spawn, `taskTimeoutMs` (30 min default) SIGKILLs a hung child,
agent→error persisted first on double-fault, claudeSessionId persisted on failure too. Also closed a
cleartext-secret sink (core Session title no longer the instruction → `Office: <role>`). Crash-injection
+ hang tests added; critic re-verify: SHIP. 105 agent-office tests; `pnpm verify` green; changeset
minor×3. Tests use a fake launcher + in-memory CoreRegistry — no real `claude` spawned.

## [2026-06-22] feature | agent-office Phase 3 (bridge /api/office)

Exposed the office over the GUI bridge on branch `worktree-feat+agent-office-phase3` (spec
docs/superpowers/specs/2026-06-22-agent-office-phase3-bridge-design.md). Added `/api/office/*` REST
routes (role/agent/task CRUD, run, control, audit, status, audit-tail SSE) in `apps/gui/bridge`,
HTTP-boundary zod validation, dispatch wiring, and production server deps (json-directory core +
claude-code launcher registry + `MEGA_OFFICE_ALLOW_FULL` env). `apps/gui` gained deps on
agent-office + connector-claude-code (lockfile committed).

Risk HIGH. Reviewed by code-reviewer + critic + security-reviewer. critic returned DO NOT SHIP on a
PROVEN production-breaker: `OFFICE_PROJECT_ID` was never created as a Project, so the json-directory
`createSession` throws `project_not_found` → every office task fails in prod; the run test missed it
(fire-and-forget, never awaited the drain). Fixed: `ensureOfficeProject` seeds the office Project at
server startup + a real integration test awaits `drainAgent` and asserts task `done` + spawn/task_done
audit. Also fixed: concurrent-run guard (no double-spawn), `wk`/`agentId` validation at the route
layer (400/404, closes a 500+segment-echo + an SSE watch-path traversal gap), SSE cleanup armed before
the snapshot await, DELETE→204, drain-rejection logged, and the `allowedTools` leading-`-` flag-guard
hoisted into `roleSchema` (launcher trust boundary). security-reviewer: PASS with remediations —
safe-by-default holds over HTTP (allowFull env-only/default-off, full fails closed, no flag injection,
instruction kept out of cleartext sinks). Documented localhost/no-auth + unconfined-`workdir` posture
and that `control stop` doesn't cancel an in-flight spawn (Phase 4). gui 318 / agent-office 107 tests;
`pnpm verify` green; no real claude/HTTP in tests.

## [2026-06-22] feature | agent-office Phase 4 (GUI office board)

Added the `agent-office` GUI view on branch `worktree-feat+agent-office-phase4` (spec
docs/superpowers/specs/2026-06-22-agent-office-phase4-gui-design.md). `apps/gui/src`: workspace
selector + global role manager (CRUD, full-permission warning) + per-workspace agent board
(AgentCard with status dot/current task/last event + run/pause/resume/stop/remove/assign +
add-agent), a `lib/office-client.ts` wrapping the Phase 3 API + `openOfficeStream` SSE (disposer),
and live board updates on the SSE `status` event. Built consistent with the existing utilitarian GUI;
a dedicated visual-design pass (huashu/taste) is a noted follow-up.

Risk MEDIUM. Reviewed by code-reviewer + critic (UI). critic found two reproduced UX-correctness bugs,
fixed before merge: (1) stale-response overwrite race — a late `fetchOfficeStatus` for a previous
workspace could overwrite the current board (fixed with a per-effect-run ignore flag gating
setBoardStatus/setStatusError, and an ignoreRef on the manual refresh path; closeStreamRef removed as
redundant); (2) sticky "Live stream disconnected" banner — EventSource auto-reconnects but the banner
never cleared (now cleared on every successful status push). Both regression-tested (verified
fail-without-fix). Also cleaned dead imports/test vars + a loadRoles spurious-refetch. 360 gui tests;
`pnpm verify` green; tests stub fetch + EventSource (no real bridge/claude). Phase 5 (CLI `mega office`)
remains.

## [2026-06-22] feature | agent-office Phase 5 (CLI) — feature complete

Added `mega office` CLI on branch `worktree-feat+agent-office-phase5` (spec
docs/superpowers/specs/2026-06-22-agent-office-phase5-cli-design.md): Citty subcommands
role/agent CRUD, assign, run (drives the supervisor, awaits drainAgent, exit 1 on failure),
status, logs, pause/resume/stop — thin handlers over the engine, mirroring the memory command
pattern. wk = encodeWorkspaceKey(cwd); roles global. Hoisted OFFICE_PROJECT_ID + ensureOfficeProject
from the bridge into @megasaver/agent-office (engine) so CLI + bridge share one canonical office
project id; bridge re-exports them. apps/cli gained agent-office + connector-claude-code devDeps
(bundled by tsup; lockfile committed).

Risk HIGH. Reviewed by code-reviewer (APPROVED) + critic (SHIP WITH FIXES) + security-reviewer (PASS).
Safe-by-default holds: allowFull only via --allow-full / MEGA_OFFICE_ALLOW_FULL=1 (default off),
full fails closed with no spawn (test-asserted launcher-not-called); allowedTools leading-`-` guard
inherited from roleSchema (triple-layered); argv-array spawn (no shell injection); assertSafeSegment
on all paths; instruction kept out of the audit store. Critic-found fixes applied before merge:
office-specific ZodError messages (bad agent id no longer says "name must be non-empty"); run/assign
report "agent not found" (not "task not found"); assign prechecks the agent exists (no orphan tasks);
instruction trimmed (z.string().trim().min(1)); run prints a note when nothing drains. cli 719 /
agent-office 113 / gui 360 tests; pnpm verify green; fake launcher + in-memory core (no real claude).

**Agent Office is feature-complete: Phases 0-5 all on `main`** (engine → launcher → supervisor →
bridge → GUI → CLI). Usable end to end. Follow-ups tracked on [[entities/agent-office]].

## [2026-06-22] feature | agent-office predefined roles from addyosmani/agent-skills

Replaced the 13 generic predefined roles with a 24-role catalog modeled on
https://github.com/addyosmani/agent-skills (one role per skill, grouped by lifecycle phase:
Define/Plan/Build/Verify/Review/Ship/Meta) on branch `worktree-feat+agent-office-skill-roles` (spec
docs/superpowers/specs/2026-06-22-agent-office-skill-roles-design.md). Each role: kind claude-code,
permissionMode plan (safe-by-default), allowedTools [], skillPacks [skill-slug], persona from the
skill's purpose, model tiered (opus reasoning / sonnet build / haiku docs).

Found + fixed a latent gap while verifying in the running GUI: `buildPredefinedRoles` was exported +
tested but NEVER called at runtime (Phase 0 deferred seeding-to-disk to a phase that never landed), so
the office showed zero roles. Added `ensurePredefinedRoles` (idempotent — no-op once any role exists),
wired into the bridge startup (server.ts) + a new `mega office role seed` CLI command. Now the roster
appears in the GUI role manager + `mega office role list` on first run. agent-office 117 / cli 721 /
gui tests green; changeset minor (agent-office, cli) + patch (gui).

## [2026-06-22] feature | office auto agent workdir

Agent `workdir` now derived from the project dir, not user-chosen. CLI dropped
`office agent create --workdir` (uses cwd); GUI add-agent dropped its workdir
input (uses selected workspace label); bridge enforces `encodeWorkspaceKey(workdir)
=== wk`. Branch `feat/office-auto-workdir`, 4 commits, `pnpm verify` green
(cli 721 / gui tests pass), CLI smoke confirms no `--workdir` flag + workdir===cwd.
role.defaultWorkdir left inert (follow-up).

## [2026-06-23] feature | office live transcript (Phase A)

Click an office agent → live read-only feed of its activity. Captured the
launcher stream-json events the supervisor was dropping (`onEvent(()=>{})`):
`projectEvent` → compact `TranscriptEntry` → per-agent `transcript-store` →
bridge backlog GET + SSE (`office-transcript-bus`, in-process) → GUI
`TranscriptPanel` (click-to-open). New `officeTranscriptId` brand. Branch
`feat/office-agent-transcript`, 8 commits, TDD, `pnpm verify` green
(agent-office + gui 108 office tests). Phase B (talk to agent) deferred.

## [2026-06-23] feature | agent chat (Phase B)

Talk to an office agent: message box in the transcript panel → `POST .../chat` →
`user` turn + queued task + drain (resumes claude session for continuity) → reply
streams into the Phase A feed. Per-agent drain serializer (in-process Map) fixes
double-spawn TOCTOU + stranded chat follow-ups; 409 on non-runnable agent; server
trims blank messages. Branch `feat/office-agent-chat`; reviewed by code-reviewer +
critic (3 race findings fixed); `pnpm verify` green; agent-office + gui tests pass.

## [2026-06-24] feature | local llm-proxy Phase 0

New @megasaver/llm-proxy + `mega proxy start`: opt-in transparent local Anthropic
proxy (127.0.0.1) that forwards verbatim + meters real token usage per /v1/messages
(counts only — never prompts/responses/keys). Foundation for conversation-token
saving (compression = Phase 1). Relaxed mission §1 ("not a model proxy" → opt-in
allowed) via conventions:sync. Risk CRITICAL; security+critic+code reviews applied
(SSE-undercount + backpressure + loopback fixes). Branch feat/llm-proxy-phase0.

## [2026-06-26] feature | 3 ContextOps features shipped (#2→#1→#3)

Three features built (brainstorm→spec→plan→TDD→verify→adversarial review per
feature; #1/#3 via dynamic multi-agent workflows) and merged to main in the
recommended build order:
- **intent-aware hook** (Phase 6b, PR #180) — UserPromptSubmit hook `mega hooks
  intent` writes the redacted prompt to `session-intent.json`; saver hook
  fill-gap-injects it as ranking intent. Risk MEDIUM. See [[concepts/intent-aware-hook]].
- **diff-on-reread** (PR #181) — unchanged re-reads return a lossless
  `unchanged-marker` (prior chunkSetId) via a per-session sha256 read-index,
  skipping re-filter/re-persist. Risk HIGH. See [[concepts/diff-on-reread]].
- **semantic AST read** (PR #182) — source files chunk on AST boundaries (reuses
  [[entities/indexer]] extractors), line-chunk fallback otherwise. Risk HIGH. The
  indexer is lazy dynamic-imported so the TS compiler stays off the hot path
  (filterOutput is now async) — see [[decisions/lazy-load-heavy-deps]] and
  [[concepts/semantic-ast-read]]. Two CI failures caught + fixed before merge
  (ubuntu eager-load timeout; windows ESM-URL guard test).

## [2026-06-26] update | wiki sync for the 3 features

Updated 10 pages (entities output-filter/context-gate/cli/content-store/
connectors-claude-code/indexer; concepts context-gate-pipeline/context-pruning-engine/
semantic-repo-index; synthesis post-v1.1-roadmap), created 5 (concepts
intent-aware-hook/diff-on-reread/semantic-ast-read; decision lazy-load-heavy-deps;
source post-v1.1-features), and catalogued the new pages in index.md.

## [2026-06-29] feature | outline-first-read

Spec + plan authored, 7-task subagent-driven implementation across 4 packages
(`@megasaver/output-filter`, `context-gate`, `daemon`, `mcp-bridge`): `outlineFile`
parser, `partitionFile(Infinity)` bodies-as-chunks persist, `\0outline` read-index
key, daemon forwarding, e2e round-trip test. Lossless skeleton reads — agents
expand only the bodies they need via `mega_fetch_chunk`.

## [2026-06-29] review | outline-first-read final pass

code-reviewer (ready-to-merge) + adversarial critic. Critic blocker fixed:
co-located decls sharing a line collapsed to duplicate `#id`s + inflated count
→ dedupe skeleton by chunk id (`fix(output-filter): dedupe co-located decls`).
Verified safe: redaction (skeleton + bodies on post-redact text), fetch-id
ordering, `\0outline` slot isolation, line coverage. Known limitation (opt-in):
skeleton may exceed raw bytes on tiny/dense files; no size-threshold fallback.

## [2026-06-29] feat | outline size floor

Closed the "skeleton may exceed raw bytes" limitation above. `filterOutput`
now takes the outline branch only when `skeletonBytes < 0.9 * rawBytes`
(`OUTLINE_MAX_SKELETON_RATIO`); otherwise falls through to the normal
rank/fit read (lossless — it persists its own chunks). TDD: tiny/dense file
falls back, body-dominant file still outlines. Reviewer: 1 redundant-decl
cleanup + 1 test-assertion tightened (assert the 0.9 ratio, not just <raw).
`pnpm verify` green (44/44). patch changeset @megasaver/output-filter.

## [2026-06-29] feat | context-pruner git co-change ranking signal

Added a deterministic git-history co-change factor to the LAMR scorer
(spec: docs/superpowers/specs/2026-06-29-context-pruner-cochange-signal-design.md,
risk MEDIUM). New `packages/context-pruner/src/cochange.ts`:
`parseNumstat(raw)` builds a per-file co-change map + churn + global
peak from `git log --numstat` text; `coChangeStrength(map, file,
changedFiles)` scores co-evolution with the edit site, normalized 0..1
by the global peak. Wired `coChangeRelevance` into `ScoreFactors`
(strict schema), `scoreBlocks`, `finalScore`, with `WEIGHTS.coChange =
0.5` (below `dependency`). Raw text injected via
`ScoreInput.coChangeLog`, memoized per process (no shell-out in the
scored core — pure/no-LLM/no-I/O). No-op on empty/absent history:
factor 0, ranking byte-identical, never throws. TDD: 10 new tests
(map+churn from a fixture numstat string, factor raises a co-changing
block's score, unrelated file stays 0, empty history no-op).
context-pruner suite 54/54 green; typecheck + biome green; downstream
mcp-bridge/cli typecheck green (optional field, backward compatible).
minor changeset @megasaver/context-pruner.

## [2026-06-29] fix | wire git co-change into production callers (review)

Review caught the signal was inert end-to-end: the engine was correct
but no shipped caller passed `coChangeLog`, so `coChangeRelevance` was 0
in every production path. Added the I/O edge
`packages/context-pruner/src/read-cochange-log.ts` —
`readCoChangeLog(cwd)` shells out `git log --max-count=1000 --numstat`
once per cwd (memoized via a `Map`), returns `""` on any failure (not a
git repo / git missing / empty history) so the scorer treats it exactly
like an absent log. Kept out of the scored core (`score.ts` stays pure).
Wired into the MCP `packFor` (`project.rootPath`) and CLI `loadPack`
(`ctx.project.rootPath`). GUI `workspace-context` route intentionally
left unwired with a `ponytail:` note: the workspace key is a one-way
FNV hash (encodeWorkspaceKey) with no cwd reverse-lookup, so there is no
repo path to run `git log` against — deferred to Phase 4 cwd-scoped work
(same blocker as memoryFiles). Integration test added to
`packages/mcp-bridge/test/tools/context-tools.test.ts`: a real temp git
repo whose `migrations/001.md` co-changes with `src/auth.ts` across 3
commits proves the migration's `coChangeRelevance > 0` through
`handleGetRelevantContext` (the MCP entrypoint), vs 0 for the no-git
baseline. context-pruner 54/54, mcp-bridge 238/238, typecheck + biome
green on changed files. changeset updated to note the new
`readCoChangeLog` export.

## [2026-06-30] feat | WS2 cross-file call resolution (import bindings)

Branch `feat/indexer-binding-resolution`. Added light import-binding
call resolution to `@megasaver/indexer` (no `ts.Program`): `resolve-fqn.ts`
(`resolveModulePath`/`resolveCallFqn`/`blockFqn`), `extractTs` now attaches
a transient per-file `importBindings` map, `buildIndex` writes additive
optional `resolvedCalls`/`resolvedCalledBy` FQN edges on `CodeBlock`.
FQN `<module>#<name>`: relative specifier → repo file path
(`.ts/.tsx/.mts/.cts/.js/.jsx` + `/index.*`), bare npm specifier kept,
local call upgraded to same-file FQN. Two same-named functions in
different files now disambiguate → no false cross-file `calledBy`.
Consumers (context-pruner `selectImpact`, `selectPack`) prefer resolved
edges via a `byFqn` map, fall back to name-based when absent (py/go/rust
+ old indexes unaffected). Proof test: name-based `calledBy` lists BOTH
useA+useB on each same-named `parse` (the bug); `resolvedCalledBy` lists
only the true caller. Incremental rebuild keeps resolved edges on reused
blocks. `pnpm verify` green (46/46 turbo tasks, exit 0); indexer 97+2skip,
context-pruner 61, mcp-bridge impact 4. Deferred to full-LSP:
re-exports/barrels, dynamic import, namespace-member calls, path aliases.
Spec: docs/superpowers/specs/2026-06-30-binding-resolution-design.md.
Updated entities/indexer.md + entities/context-pruner.md.

## [2026-06-30] review | WS2 per-edge name fallback fix

Code review (cavecrew-reviewer) caught 2 reds: (1) namespace-member
calls (`ns.run()`) extract bare `run`, binding is `ns`, so the FQN stays
unresolved `#run`; (2) a present-but-incomplete `resolvedCalls`/
`resolvedCalledBy` suppressed the name fallback → lost edges the name
path had (recall regression). Root-cause fix: build records unresolved
caller edges under `#<name>` and unions that bucket into the callee's
`resolvedCalledBy`; select.ts resolves each FQN edge with a PER-EDGE
`byName(nameFromFqn)` fallback. Invariant: resolved mode is a refinement
of name mode (removes false same-name edges only, never true ones).
New regression tests: indexer namespace end-to-end + pruner per-edge
fallback. verify green exit 0.

## [2026-06-30] fix | WS2 recall-safe reverse call resolution

Independent critic found 2 CRITICAL recall-loss bugs (true callers
DROPPED from mega_impact), both reproduced RED end-to-end. Root cause
(asymmetry): reverse traversal uses build-time-materialized
`resolvedCalledBy`; an edge resolving to an FQN that owns no current
block landed in no readable bucket → caller lost once another caller
populated the bucket. C1: NodeNext `.js` ESM specifiers (`./m.js` for
source `m.ts`) didn't resolve. C2: incremental staleness — a reused
caller keeps a stale resolvedCalls FQN after its target file is renamed.
Fixes: (1) resolveModulePath remaps `.js/.jsx/.mjs/.cjs` → TS-source
suffix so idiomatic `.js` imports resolve PRECISELY; (2) build invert
pass buckets any DANGLING edge (FQN owns no current block) under the
`#name` floor, recovered by select.ts per-edge byName fallback. Precise
edges stay precise → false same-name cross-file edges still excluded (not
a blunt name-union, which the critic verified breaks impact-resolved).
Invariant: resolvedCalledBy ⊇ all true callers. 2 RED→GREEN e2e repros
+ a `.js`-precise disambiguation test in
packages/context-pruner/test/impact-recall-e2e.test.ts; impact-resolved
stays green. verify exit 0 (indexer 98+2skip, context-pruner 65,
mcp-bridge impact 4). Updated build.ts ponytail comment to reflect real
dangling-edge behavior.

## [2026-06-30] feat | WS3 memory superset increment 1

Built three additive layers on the existing memory stack (DIMMEM +
memory-graph + embeddings substrate); kept the moat (evidence ledger +
approval gate + agent-agnostic shared + lossless local). Spec:
`docs/superpowers/specs/2026-06-30-memory-superset-design.md` (HIGH risk;
feature matrix vs mem0/Letta/Zep/Cognee/Memori/claude-mem; layers 3-6
deferred as named sub-specs). New wiki page [[concepts/memory-superset]].
(1) Semantic recall: per-project sidecar
`<storeRoot>/memory/<projectId>.embeddings.jsonl` keyed by memory id
(`embedMemoryEntries` in packages/core/src/embed-memory.ts), incremental
by a title+content hash, opt-in (no model on import). New
`searchMemoryEntriesSemantic` ALONGSIDE BM25; `get_relevant_memories`
boundary-embeds the task best-effort, semantic-ranks when a sidecar
exists, else falls back to BM25 (never throws). Mirrors the WS1
embed-blocks / context-pruning pattern. (2) memoryRelevance wiring: CLI
(apps/cli/.../context/shared.ts) + MCP (context-pruning.ts) now feed the
pruner factor from ALL approved non-stale memories' relatedFiles
(`approvedMemoryFiles`) instead of a BM25-narrowed subset that silently
dropped approved memories whose prose missed the task. (3) Entity layer:
`entity` node kind + `entity-mention` edge kind in memory-graph;
deterministic (NO LLM) extraction from relatedSymbols/relatedFiles
(`entity:symbol:` / `entity:file:` prefixes). CI model-free: vectors
injected in tests, real embed() gated `it.skipIf(!MEGA_EMBED_E2E)`;
`pnpm verify` exit 0 under `TRANSFORMERS_OFFLINE=1` (46/46 tasks; core
488, memory-graph 58, context-pruner 65, mcp-bridge 244, cli 739).
MEGA_EMBED_E2E=1 smoke passed (real multi-dim vector written). Changeset
minor: core, memory-graph, mcp-bridge.

## [2026-06-30] fix | WS3 partial-sidecar silent recall loss (critic BLOCKER)

Independent HIGH-risk critic caught a Critical recall-loss bug (same class
as the WS2 reverse-call bug) in `semanticMemoryRanking`
(packages/mcp-bridge/src/tools/get-relevant-memories.ts). It fell back to
BM25 only when the sidecar was ABSENT or empty; a PARTIAL sidecar (vectors
for some approved memories, not all) proceeded to semantic ranking, which
drops any memory whose vector is missing → a true approved memory silently
vanished, reported as success. This is the DEFAULT steady state: no
production path embeds on write, so any memory created/approved after the
last manual sidecar build is un-vectored. Fix: a full-coverage guard at
the existing decision point — if any approved non-stale candidate lacks a
vector in the loaded map, return null → BM25 fallback (returns all
matches). Net guarantee: results are full-coverage semantic OR BM25, never
a silently-truncated mix. Surgical (one filter + one guard, +17/-5 lines,
no new abstraction). Regression test (RED→GREEN): 3 approved memories all
matching, sidecar covers 2 → handler returns all 3 (pre-fix returned 2).
Kept: full-coverage sidecar → semantic ranking; no sidecar → BM25. Attack
B (all-approved-memory memoryRelevance wiring) ruled acceptable for v1 by
the critic (binary per file, weight 0.7, bounded) — noted in the spec as a
known imprecision to re-scope to task-relevant memories in a follow-up.
`pnpm verify` exit 0 under `TRANSFORMERS_OFFLINE=1` (46/46; mcp-bridge now
245). Spec 1A + 1B updated with the coverage guard + the imprecision note.

## [2026-06-30] feat | WS3 inc-2: memory index build (semantic recall goes live)

`embedMemoryEntries` had zero production callers, so the memory-vector
sidecar was never populated and `get_relevant_memories` always tripped its
full-coverage guard → BM25. Added the missing on-demand build (mirrors
`mega index build` for code, NOT auto-embed on save — that would load the
~50MB model on the memory write hot path).

- `@megasaver/core`: `buildMemoryIndex(storeRoot, projectId, entries,
  embedFn=embed)` (packages/core/src/embed-memory.ts). The vector sidecar
  stores `{id, vector}` only (no hash), so incrementality needs a manifest
  the way blocks have one: added a tiny id→hash sidecar
  `<projectId>.embeddings.hashes.json`, written after each build, read back
  as `priorHashById` next build. Unchanged memory (vector present AND hash
  matches) carries forward; only new/changed re-embed. Returns
  `{ embedded, carried, total }`.
- CLI `mega memory index <project>` (apps/cli/src/commands/memory/index-build.ts).
- MCP `mega_index_memory` (packages/mcp-bridge/src/tools/index-memory.ts +
  server.ts dispatch + tool-name.ts; tool enum 27→28, no proxy twin).

End-to-end gap-closed proof (model-free, fake embed): before a build,
`handleGetRelevantMemories` returns the BM25 fallback (a lexical-only
memory); after `handleIndexMemory`, full coverage exists → semantic path
returns a vector-ranked order BM25 cannot produce. TDD red→green. Per-pkg
suites green: core 492, cli 742, mcp-bridge 247. `embedFn` injected in
tests; real embed E2E-gated (MEGA_EMBED_E2E) so CI loads no model.
Changeset minor: core, cli, mcp-bridge.

## [2026-06-30] feat | M1: bi-temporal memory validity (Zep/Graphiti-class)

Sub-spec 3 of the memory superset, shipped. Two time axes: transaction
time (`createdAt`/`updatedAt`, already existed) and valid time (new). A
fact can be superseded by a newer one without deleting the old one — the
lossless moat (audit / time-travel preserved).

- `@megasaver/core` (memory-entry.ts): additive optional `validFrom`,
  `validTo` (null/absent = still valid), `supersedesId` on `MemoryEntry`
  AND `overlayMemoryEntrySchema`; `validTo` added to the update patch.
  `isCurrent(memory, asOf)` = `validFrom <= asOf && (validTo == null ||
  asOf < validTo)` (half-open upper bound). Rows without the fields read
  as current → old stores load unchanged (back-compat).
- Recall (memory-search.ts + memory-search-semantic.ts): both filter to
  `isCurrent(entry, asOf ?? now)` alongside the existing approved/non-
  stale gates; both gained an optional `asOf` time-travel parameter.
- Supersede gate (mcp-bridge/approve-memory.ts): approving a memory whose
  `supersedesId` is set closes the superseded memory's `validTo = now`
  (kept, not deleted). `save_memory` accepts `supersedesId`; `recall` /
  `get_relevant_memories` thread `asOf`.
- Graph: the pre-existing `supersede` edge kind is now emitted from the
  recorded `supersedesId` by the CLI (graph.ts) and GUI overlay
  (memory-graph route) builders — no change to memory-graph/src.

Deterministic, no LLM, no embeddings for this layer. TDD red→green:
isCurrent bounds, supersede+time-travel (asOf before the close still
returns the old fact; supersede edge present), back-compat (no-bounds =
current). `pnpm verify` green (46/46 tasks); per-pkg: core 509, memory-
graph 58, mcp-bridge 250, cli 743. Changeset minor: core, mcp-bridge,
cli. Recall-loss check: a CURRENT memory cannot be wrongly dropped —
absent bounds ⇒ current, so every legacy + normal-new memory stays.

## [2026-06-30] fix | M1 review: centralize current-filter + validate supersedesId

Two independent reviews found the current-by-default filter was
re-implemented in 4 recall surfaces and 2 were missed — so a superseded
memory still returned on every path except the in-process MCP one.

- ROOT-CAUSE FIX: added ONE shared predicate `isRecallable(memory, asOf)`
  = `approval === "approved" && isCurrent(memory, asOf)` in
  `core/memory-entry.ts`, exported from core. Routed ALL recall surfaces
  through it: `memory-search.ts`, `memory-search-semantic.ts`, MCP
  `recall.ts`, daemon `handlers-registry.ts` (recallRegistryHandler), GUI
  `connector-context.ts`. Surfaces can no longer drift.
- BLOCKER 1+2 (daemon): `recallRegistryRequestSchema` was `.strict()`
  without `asOf` (a forwarded asOf → 400 → silent fallback) AND the
  handler filtered approval+scope only, never isCurrent — so with a
  daemon running, a closed-validTo memory STILL returned. Added `asOf`
  to the schema; filter via isRecallable(m, asOf ?? now). New daemon
  tests: closed memory filtered out of default recall; asOf round-trips
  (time-travel before the close returns the old fact).
- BLOCKER 3 (supersedesId tamper): supersedesId is agent-controlled
  (save_memory passes it; only UUID-shape checked). The approve gate now
  closes a target ONLY if it is a DIFFERENT memory in the SAME
  project+scope that exists and is still open. Prevents (a) closing a
  current memory in another project, (b) self-reference closing its own
  validity (approved-yet-vanished). New tests: cross-project not closed;
  self-reference stays current.
- MAJOR 4 (connector-context): wrote superseded memories into per-agent
  connector CONFIG FILES; now gated by isRecallable.
- MINOR 5: get-relevant-memories passed UNFILTERED entries to the
  semantic search while gating coverage on the filtered candidates; now
  passes `candidates` so gate and ranked-input are the same set.
- TEST-GAP: pinned the flaky default-recall test (it relied on wall-clock
  now > 2026-06-20, the fixture close date — would have failed in CI
  before that); added a clock-independent default-now case; added an
  isCurrent offset-format (`+03:00` vs `Z`) equivalence assertion; added
  isRecallable unit tests.

`pnpm verify` green (46/46). Per-pkg: core 514, daemon 107, mcp-bridge
252. Changeset now minor: core, mcp-bridge, daemon, cli.

## [2026-06-30] feat | M2: tiered memory + decay (Letta/MemGPT-class)

Built on M1. Deterministic, no LLM, no background timer; additive +
backward-compatible. Marks superset sub-spec 4 DONE.

- **Schema (`packages/core/src/memory-entry.ts`).** Optional `tier`
  (`working` | `recall` | `archival`) on `memoryEntrySchema`, the
  overlay variant, and the update patch. Absent ⇒ `recall` via the one
  `tierOf` helper, so legacy/normal rows keep their behavior. `tier` is
  patchable so the sweep can demote it.
- **Tier rides the centralized predicate.** `isRecallable(memory, asOf,
  { includeArchival? })` now excludes `archival` by default (sibling
  `isArchived`). All four isRecallable surfaces (MCP recall,
  get_relevant_memories, daemon recall, GUI connector-context) inherit it
  for free — no per-surface drift (the thing M1 fixed). The two search
  surfaces (`searchMemoryEntries` / `searchMemoryEntriesSemantic`) gained
  a matching `includeArchival` + archival field-filter.
- **Decay = read-time pure fn.** `effectiveConfidence(memory, now)` =
  baseWeight(confidence) × ageDecay(now − updatedAt, 30-day half-life) ×
  tierWeight(tier, working +10%). Wired into `searchMemoryEntries` as a
  multiplier on BM25 scores → aged/low ranks below recent/high. ADDITIVE:
  always > 0, only down-ranks, never drops a current memory.
- **Sweep = the ONLY mutation.** `mega memory sweep <project>` CLI +
  `mega_memory_sweep` MCP tool (registered in tool-name.ts/server.ts,
  bumping the closed tool set 28→29 and its drift guards). Deterministic,
  lossless policy: closed/superseded OR stale OR (low confidence AND
  inactive ≥ 90d) → `tier=archival` via `updateMemoryEntry`. Working tier
  never swept. `--json` ⇒ `{archived, scanned}`; idempotent.
- **RECALL-SAFETY** test (`memory-tier-decay.test.ts`): a current
  working/recall memory is recallable, has effectiveConfidence > 0, and is
  never a sweep candidate — even old + low. All time pinned (no
  wall-clock), avoiding the M1 flake class.

Per-pkg green: core 67 files / 539 (+2 skip), mcp-bridge 39 / 255,
daemon 10 / 107, cli 75 / 747. Changeset minor: core, mcp-bridge, cli,
daemon (daemon re-exports core).

## [2026-06-30] feat | M3: semantic canonicalization on approve (mem0/Cognee-class)

Sub-spec 5 of the memory-superset design, marked DONE. SURFACE-only
near-duplicate detection at the approval gate — never auto-block, never
auto-mutate; the human + the M1 supersede gate do the canonicalizing.

- **Where.** `packages/mcp-bridge/src/tools/approve-memory.ts`, on the
  approve SUCCESS path only, AFTER the existing exact-dup hard-reject and
  the validation/conflict gate. The memory has already flipped to
  `approved`, so a near-dup is SURFACED on a still-successful approval.
- **Pass.** `semanticDuplicates(env, candidate)`: read the memory-vector
  sidecar (`memoryEmbeddingsSidecarPath`), embed the candidate's
  `title+content` (`memoryEmbedText`), cosine-compare to the sidecar
  vectors of the OTHER approved+current (`isRecallable`) memories.
  `cosine >= NEAR_DUP_THRESHOLD` (0.95, deterministic const) ⇒ collect id.
  Archival / closed / unapproved memories are NOT targets.
- **Surface.** A match writes a `semantic-duplicate` reason + the matched
  id(s) in the validation sidecar's `conflictIds` (status stays `valid`),
  and the same is returned in the result so the human sees it. They then
  re-approve with `supersedesId` (M1) to merge. One threshold, one reason.
- **Best-effort / graceful.** No sidecar / no candidate vector / `embed`
  throws ⇒ the pass yields no matches; approval and the exact-dup behaviour
  stay byte-identical and NEVER throw. Mirrors get-relevant-memories'
  semantic pass (try/catch-returns-empty). `ApproveMemoryEnv` gains an
  optional injectable `embedFn` (defaults to real `embed`); the server
  does not pass it ⇒ production uses the real model, CI uses injected
  vectors (model-free).
- **TDD (model-free).** New `approve-memory-canonicalization.test.ts`:
  near-dup surfaced (approval succeeds + reason + matched id), far ⇒ no
  reason, no sidecar ⇒ graceful, archival target ignored, embed-throws ⇒
  approval unaffected. Real-embed E2E gated `MEGA_EMBED_E2E` (verified once
  manually: model loaded, near-identical memory surfaced end-to-end). Time
  pinned, no wall-clock.

Full `pnpm verify` green (46/46 turbo tasks, model-free) — covers the
daemon's dist-resolution of core. mcp-bridge 40 files / 260 (+5 new,
1 E2E skip). Changeset minor: mcp-bridge (only `ApproveMemoryEnv` public
shape changed).

## [2026-06-30] feat | M4: transcript→memory (claude-mem-class, deterministic)

Realizes the deferred memory-superset roadmap item 6 — session distillation
— DETERMINISTICALLY, no LLM (overrides the spec's "LLM opt-in" framing for
this increment). Spec:
`docs/superpowers/specs/2026-06-30-memory-from-session-design.md`.
Branch `feat/memory-from-session`.

- **Source = FailedAttempt rows, not raw chunk-sets.** A session's recorded
  failures already live in the registry as `FailedAttempt` (keyed by
  sessionId, with structured `task`/`failedStep`/`errorOutput`/`relatedFiles`/
  `suspectedCause`). The output-filter parsers (`parseTestOutput`,
  `parseTsDiagnostic`, `parseStacktrace`) return bare `Chunk[]`
  (`{ text, startLine, endLine }`) — classified TEXT, no structured fields —
  so re-parsing them would reimplement what FORGE structured at record time.
  Reuse the structured rows instead.
- **Extractor** (`packages/core/src/session-memory.ts`, pure):
  `extractSessionMemories({ sessionId, projectId, failedAttempts })`. Test-
  shaped failure → `test_behavior`, else `bug` (source `test_failure`);
  `DECISION:`/`decided to` marker → `decision` (source `session_summary`).
  Each candidate: `scope:"session"`, `confidence:"low"`, `approval:"suggested"`,
  title from `failedStep` first-line, content = step + first error line +
  suspected cause, relatedFiles carried. Dedupe within session by contentHash
  (sha256 of type+title+content, 16 hex). `dedupeKey = failureId:contentHash`.
- **CLI** `mega memory from-session <session>` + **MCP** `mega_memory_from_session`
  ({ sessionId } → { suggested, skipped }). Resolve session→project via
  `getSession`, filter `listFailedAttempts` to the session, create suggested
  memories, print `suggested=N skipped=M` (--json). Never auto-approves.
- **Idempotent.** Each staged memory carries `from-session:<dedupeKey>` in its
  keywords; the command skips a candidate whose dedupeKey is already staged on
  the project. Re-run ⇒ `suggested=0 skipped=N`. Lossless (never deletes).
- **Recall-safe.** Suggested memories fail `isRecallable` and are excluded from
  `searchMemoryEntries` (only `includeUnapproved` surfaces them) — they don't
  leak into recall until a human approves. M3 then surfaces semantic dups at
  the approve gate.
- **TDD, model-free.** core: 6 tests (classify, dedupe-collapse, decision,
  empty, NOT-recallable-until-approved). cli: 4 (stage + dup collapse +
  cross-session filter, idempotent, --json, unknown-session). mcp: 4 (stage,
  idempotent, unknown-session, malformed). Tool-count regression tests bumped
  29→30 (+`mega_memory_from_session`, no proxy twin). Time/ids pinned.
- **Smoke:** built CLI run twice on a seeded store ⇒ `suggested=2 skipped=0`
  then `{"suggested":0,"skipped":2}`; staged rows are `suggested` test_behavior
  + bug; `memory search` surfaces neither.

Changeset minor (core + cli + mcp-bridge public surface). Additive — no change
to the memory data model, approval gate, or FORGE/learn behaviour.

## [2026-06-30] feat | M5: task-scope memoryRelevance (final memory-depth layer)

Closes the WS3-inc1 §1B "Known imprecision (v1, accepted)" follow-up. Both
context-pruning boundaries fed ALL approved memory's `relatedFiles` to the
`memoryRelevance` factor, boosting every memory-touched file on every task
regardless of task relevance (broad, signal-diluting). Spec follow-up marked
DONE: `docs/superpowers/specs/2026-06-30-memory-superset-design.md` §1B.
Branch `feat/memory-relevance-taskscope`.

- **Pure core helper** (`packages/core/src/task-relevant-memory-files.ts`):
  `taskRelevantMemoryFiles(memories, { taskVector, memoryVectors, topK, floor })`
  ranks approved, non-stale memories that have a sidecar vector by
  `cosine(taskVector, memoryVector)`, keeps the top-K (default 10) above a small
  floor (0.1), returns the deduped, order-stable union of THEIR `relatedFiles`.
  The narrowed counterpart of `approvedMemoryFiles`. **Eligibility mirrors
  `approvedMemoryFiles` EXACTLY** (`approval === "approved" && !stale`, no
  validity/tier gating) so the scoped set is always a task-filtered SUBSET of the
  fallback — never stricter — and the signal cannot flip on whether a sidecar
  exists (review fix; the first pass over-gated via `isRecallable`, which excluded
  expired/archival approved memories the no-sidecar fallback would include).
  Deterministic: ties break by id.
- **Best-effort orchestrator** (same file): `taskScopedMemoryFiles({ storeRoot,
  projectId, memories, task, taskVector?, topK?, floor?, embedFn? })` loads the
  memory-vector sidecar via `readVectors(memoryEmbeddingsSidecarPath(...))`, uses
  the INJECTED task vector (reused) or embeds `task`, calls the pure helper.
  Returns null on no/empty sidecar, no task vector, or ANY failure → never throws.
  Mirrors `get-relevant-memories.ts` / `embeddingSignalFor`.
- **Both boundaries** now `taskScopedMemoryFiles(...) ?? approvedMemoryFiles(...)`:
  - MCP `context-pruning.ts`: threaded an optional `embedFn` into
    `ContextToolEnv` + `embeddingSignalFor`; REUSES the task vector the
    code-block `embeddingRelevance` signal already computes (no double-embed).
  - CLI `context/shared.ts`: no pre-computed task vector → orchestrator embeds
    best-effort via core's real `embed` only when a sidecar exists; CLI gains NO
    new `@megasaver/embeddings` dep edge (the embed lives inside core).
  - `staleMemoryFiles` unchanged.
- **Recall-safe.** No-sidecar / no-task-vector / embed-failure all fall back to
  the all-approved set → today's behavior is byte-identical; a genuinely
  task-relevant memory's file is never dropped.
- **TDD, model-free.** core: 10 tests (pure: near-in/far-out, topK, dedupe,
  approved+non-stale gating, EXPIRED-included [eligibility mirrors
  `approvedMemoryFiles`, not stricter], recall-safety; orchestrator: scoped with
  sidecar+injected vector, null no-sidecar, embeds when no vector injected,
  null/no-throw on embed failure). mcp: +4 (irrelevant-not-boosted with sidecar,
  relevant-boosted, fallback-identical no-sidecar, fallback-on-embed-failure).
  cli: +2 (all-approved fallback boost no-sidecar, never-throws). Injected
  vectors; real `embed()` E2E-gated. Daemon resolves core from dist → core
  rebuilt before mcp/cli tests.

Changeset minor (core + mcp-bridge + cli public surface). Additive, surgical,
best-effort, deterministic, CI model-free.

**Review fix (2026-06-30, target-set asymmetry).** Both the spawned reviewer and
the coordinator's independent critic flagged one Important finding: the scoped
helper's eligibility gate (`isRecallable || stale`) applied bi-temporal validity
+ archival-tier filters that the fallback `approvedMemoryFiles` (`approved &&
!stale`) does not, so an approved+non-stale-but-EXPIRED/ARCHIVAL memory's files
were dropped from the scoped set but kept in the fallback — the `memoryRelevance`
signal flipped on whether `mega memory index` had run. Fixed: scoped gate now
mirrors `approvedMemoryFiles` exactly; task ranking (cosine top-K) is the only
narrowing. `asOf` dropped from both helper signatures (unused after the fix).
+1 core test (EXPIRED-included). Full `pnpm verify` green (46/46), model-free.

## [2026-07-01] fix | v1.2.1: externalize transformers from CLI bundle

- **Bug (published v1.2.0).** `@megasaver/cli@1.2.0` shipped at 15.7MB:
  `apps/cli/tsup.bundle.config.ts`'s `noExternal:[/.*/]` inlined
  `@huggingface/transformers`, so esbuild copied six `onnxruntime_binding-*.node`
  natives (CI-built for one OS) into the tarball — dead weight off that OS, and
  embeddings broke on every other platform (the inlined natives were the wrong ABI).
- **Fix (PR #209).** Externalize the `@huggingface/transformers` + `onnxruntime-node`
  chain; declare transformers an `optionalDependency` so npm pulls the host-platform
  native. tsup's `noExternal` beats esbuild's `external`, so the blanket rule became a
  negative lookahead excluding the chain. typescript stays inlined (static import, no
  graceful fallback) so standalone `mega index` still runs. See
  [[decisions/bundle-externalize-native-chain]].
- **Guard (TDD).** `bundle-smoke.test.ts`: no `.node` files, no `onnxruntime_binding`
  inline, `mega.mjs` < 12MB. RED (13.2MB/6 natives) → GREEN (11.2MB/0).
- **Verification.** `pnpm verify` green (756 CLI tests); CI green ubuntu + windows;
  standalone bundle runs `doctor` with transformers absent; embed paths degrade
  clean. Adversarial critic verdict SAFE TO PUBLISH; diff review clean.
- **Shipped.** v1.2.1 published to npm: **3 files, 0 natives**, 1.9MB tarball,
  `optionalDependencies` present. Install smoke on darwin: `mega memory index` →
  `embedded=1` — embeddings restored on the platform v1.2.0 broke.

## [2026-07-02] query | frontend GUI bug hunt completed

Fixed stale-response race conditions in `apps/gui` data-fetching components:
- `WorkspaceSessionList` polling guard + retry via `refreshNonce`.
- `MemoryPanel`, `TasksPanel` effect guards via `live` flag + `refreshNonce`.
- `TokenSaverPanel` polling guard + retry via `refreshNonce`.
- `WorkspaceContextPanel` submit guard via monotonic request ID ref.

Added regression tests for each scenario. `pnpm verify` green (lint, typecheck, test, conventions). Bridge runtime smoke returned `{"ok":true}`.

Spec: `docs/superpowers/specs/2026-07-01-frontend-gui-bug-hunt-design.md` (on `main`).
Plan: `docs/superpowers/plans/2026-07-01-frontend-gui-bug-hunt-plan.md`.
Branch: `worktree-frontend-gui-bug-hunt`.

## [2026-07-02] lint | Agent Setup functional fix

Made the GUI `Agent Setup` view functional end-to-end:
- Added `GET /api/projects` bridge route so the doctor can list persisted projects.
- Updated `AgentSetupDoctor` to load projects, auto-select a single project, render a `<select>` for multiple projects, and pass the selected project name to `installMcp`/`repairMcp`.
- Fixed `createMcpOps.connectorSyncedResolver` to scan all projects for the connector block instead of requiring an open session for the agent.
- Guarded the doctor's status fetch with a request-id / unmount flag to prevent stale responses.
- Added/updated regression tests: `projects-route.test.ts`, `mcp-ops.test.ts`, `agent-setup-doctor.test.tsx`, `agent-setup-row.test.tsx`.

Verification: `pnpm verify` green (lint, typecheck, test, conventions). CLI e2e `v1-closeout-flow.test.ts` 5/5 pass. Bridge smoke returned the project list and MCP status correctly.

Spec: `docs/superpowers/specs/2026-07-02-agent-setup-functional-design.md`.
Plan: `docs/superpowers/plans/2026-07-02-agent-setup-functional-plan.md`.
Branch: `feat/agent-setup-functional-fix`.

## [2026-07-02] diagnose | token-saver "savings not increasing" live investigation

Live diagnosis of frozen saved-tokens counter (session 45479c3f). Findings:
1. Pipeline HEALTHY: synthetic PostToolUse payload through `mega hooks saver`
   (cwd=MegaSaver, enabled workspace e02b98f66e82b6b9) compressed 138000→89 B
   and wrote events.jsonl. Daemon (pid 64943) + store + compressor all work.
2. verifywise worktree session (workspace e7fc032a769ee0a5 =
   fnv1a("/Users/halitozger/Desktop/verifywise/.claude/worktrees/practical-euler"))
   has NO workspace-token-saver.json → saver passthrough by design
   (saver-run.ts readSettings null gate). Per-cwd workspace key means enabling
   the main repo dir does NOT cover its worktrees — product design gap.
3. Claude Code hooks stopped executing in Desktop-app MegaSaver sessions after
   2026-07-01 17:32 local: zero PreToolUse log entries, zero saver events, zero
   compression markers (main + 144 subagent transcripts) since — despite >4KB
   eligible outputs and enabled+aggressive settings (updated 2026-07-02 13:20).
   Session 90550bc0 got 4 user prompts on 07-02 but intent hook never wrote →
   hooks dead in that live session; ~/.claude/settings.json rewritten 13:19
   (GUI Connect Saver hook toggle). Restarting the session should reload hooks.
4. No model dependence in saver (bytes/4 estimator) — claude-fable-5 does not
   affect savings accounting.
5. `mega proxy` (pid 83857) up but proxy-usage/usage.jsonl last written
   06-24: no agent points ANTHROPIC_BASE_URL at it.

## [2026-07-02] design | persistent proxy routing + saver inheritance

Opened two linked designs from the live token-saver diagnosis:

- CRITICAL persistent proxy routing: dedicated `proxy supervise` service,
  shared CLI/GUI control state, nonce health + route lease, foreign-value guard,
  LaunchAgent migration/rollback, drain-safe stop, and honest traffic/hook
  status.
- HIGH Saver activation inheritance: exact → Git common-dir family → verified
  legacy root → explicit global default, with metadata-only hook heartbeats.

Independent architect and adversarial critic passes returned APPROVE after
blocking lifecycle, ownership, migration, worktree identity, concurrency, and
drain findings were resolved. Baseline `pnpm test`: 46/46 Turbo tasks green.

Specs:
`docs/superpowers/specs/2026-07-02-persistent-proxy-routing-design.md` and
`docs/superpowers/specs/2026-07-02-saver-activation-inheritance-design.md`.

## [2026-07-02] review | spec review: persistent-proxy-routing + saver-inheritance → REVISE

External reviewer pass (Claude Code, fresh 4-lens adversarial verification:
current-state fact-check, state-machine holes, git-identity edges, governance
gates). Verdict REVISE: 2 BLOCKING (proxy orphan-route unrecoverable after
SIGKILL+PID-reuse vs conjunctive stale-lock predicate; saver family-key
canonicalization lacks case/platform normalization → same repo hashes to
different families on APFS/NTFS), 12 MAJOR (disable crash-window re-route,
monitor vs SIGTERM self-unroute, kickstart -k kills draining supervisor,
drainingGeneration crash/reboot semantics, transition.lock staleness,
legacy-root key aliasing, repository-disable vs legacy exact precedence,
symlink-refusal contradiction, missing omc:tracer gate, uncited user
confirmation, aspirational security-reviewer frontmatter, missing critic
implementation pass, undefined cross-spec ordering), plus minors. Spec1
current-state claims all verified TRUE against worktree code. Full findings in
wiki/agent-channel.md 2026-07-02 19:05 entry. Plans blocked until amended.

## [2026-07-02] design | proxy + saver REVISE amendments submitted

Amended both linked specs against the external 2 BLOCKING + 12 MAJOR review.
Proxy changes include fenced PID/start-token/boot/instance ownership, strict
transition unions, route-safe crash recovery, conservative drain preservation,
journal-authoritative launchd transactions, authenticated GUI boundaries,
redacted errors, and bounded owner-only usage telemetry. Saver changes include
volume-case-aware SHA-256 repository identity, verified family schemas, legacy
precedence/alias rules, descriptor-safe activation storage, and bounded
future-skew-resistant hook heartbeats. Independent CRITICAL design passes from
security-reviewer and tracer evidence-loop returned APPROVE. Implementation
plans remain blocked until Claude Code repeats its four-lens review and approves
the amended specs. See wiki/agent-channel.md 2026-07-02 23:08.

## [2026-07-02] review | re-review of 8811bab5 → REVISE round 2 (narrower)

Same 4-lens method (2 fix-verification + 2 fresh new-hole lenses). Result:
24/26 round-1 findings verified-fixed with concrete testable rules, including
both BLOCKINGs (fenced owner identity/exit-75/--recover; file-identity +
caseMode canonicalization). Amendment introduced new findings: 1 BLOCKING
(transition_incomplete states forbid their own retry — designed deadlock; no
escape row for journal mismatch), 7 MAJOR (migration rollback crash cuts
unenumerated; fence CAS unimplementable over atomic-rename with two lock
authorities; offline_cli lease undecidable after lock release; stale
client-close confirmation reusable; single transition slot silently
overwritable in the handoff window; dev:ino family key not durable across
remount/restore → silent deactivation; dev:ino reuse activates compression in
the wrong repo) + carried #13 (security-reviewer/tracer APPROVE is
self-assertion co-committed with the amendment; artifact or pending required;
re-run needed post-round-2 regardless). Recommendation recorded: consider
cutting the auto-migration/uninstall transaction subsystem (operator-installed
plist, one machine) for a documented manual migration — removes the root of
findings 1/2/5. Full detail: wiki/agent-channel.md 2026-07-02 23:55 entry.
Plans remain blocked.

## [2026-07-03] amend | round-2 findings resolved in both specs (author: Claude Code)

User-directed (chat, 2026-07-02 evening; confirmation record in
agent-channel.md 00:15). Proxy: migration/uninstall journal subsystem CUT
(manual legacy bootout via legacy_service_present; stateless idempotent plist
ops) — removes the round-2 BLOCKING deadlock and 3 MAJORs at the root; durable
handoffDeadline decides released-transition liveness; owner rewrites serialized
under transition.lock (no CAS-over-rename); transition_in_progress guards the
single slot; --recover is the universal escape; monitor observe-only while a
transition is retained. Saver: family identity flipped to canonical
common-directory PATH (caseMode-aware) — durable across reboot/remount/restore,
inode-recycling wrong-repo activation impossible; no-commondir layouts key to
the worktree root (hostile .git-file adoption killed); degraded-precedence
fail-closed, v1 rewrite scope, toggle scope echo, non-mutating status reads,
telemetry contract pinned. Verification (fresh contexts): security-reviewer
APPROVE_WITH_NOTES + tracer evidence-loop APPROVE_WITH_NOTES (artifacts
archived under docs/superpowers/reviews/ — new standing requirement),
fix-verification APPROVE (all round-2 items closed), fresh-eyes found 3
amendment-introduced contradictions — fixed same session, all reviewer notes
incorporated. Pending gate: Codex counter-review of the round-2 amendments
(author≠reviewer), then plans in fixed order (saver first).

## [2026-07-03] review+amend | round-2/3 counter-review by fresh contexts → APPROVE

Codex out of credits; counter-review run by fresh Claude subagent contexts.
Round-2 (of the migration-cut + dev:ino-flip amendments): 2 BLOCKING + 8 MAJOR
— notably a separate-git-dir correctness regression the author's own round-2
"no-commondir→worktree-root" change introduced (main + linked worktree got
different family keys; caught against real git). Round-3 fixed all 17: revert to
common-dir keying + foreign_worktree_admin rejection; global latestCompression
in the heartbeat registry; bootstrap discriminant; recover-kind removed
(in-place recovery); executable precedence steps 0-4; v1-exact survives corrupt
.git; family write from a worktree; exact raw-key documented; full heartbeat
schema; RepositoryFamilyKey validator; ProxySafeErrorDetail mapped; telemetry
reader in stats/CLI layer. Round-3 verify: fix-verify + plan-readiness APPROVE;
fresh-eyes found one degraded-git precedence↔failure-handling contradiction →
fixed → confirmed CONSISTENT. Security + tracer round-2 artifacts stand for the
round-3 text (consistency/simplification deltas, foreign_worktree_admin a net
security gain). Artifact: docs/superpowers/reviews/2026-07-03-round2-round3-counter-review.md.
Both specs plan-ready. Next: write plans (saver 1 of 2, proxy 2 of 2).

## [2026-07-03] implement | saver activation inheritance S1–S10 shipped

Branch feat/saver-activation-inheritance. Full TDD (red→green→commit per task),
`pnpm verify` green 46/46 tasks. Delivers the fix for the 2026-07-02 live
finding (worktree sessions uncompressed under an enabled main repo). New
context-gate modules: family-identity (canonical-path key, durable across
reboot/remount/restore), git-family (bounded ≤32-ancestor/≤40-syscall common-dir
resolver, no git subprocess; separate-git-dir main+worktrees converge;
foreign_worktree_admin rejected), saver-store (v1 exact/family/global records +
legacy normalize, atomic 0600/0700, digest fail-closed, activation lock),
resolve-saver-settings (precedence steps 0–4; degraded git → global default,
legacy-under-degraded fail-closed), saver-heartbeat (256/30d/future-skew,
derived latest+latestCompression, non-mutating reads; feeds proxy status),
activation-scope (shared CLI/GUI/hook writer — no drift). shared:
RepositoryFamilyKey. Hook (saver-run.ts) resolves via family precedence +
liveness heartbeats; integration test proves worktree inheritance + compression.
CLI: workspace toggle repo-aware (family default, --exact opt-down, scope echo)
+ new `default` + `resolve`. GUI bridge + toggle repo-aware, reports effective
source. Public behavior change: v1 record shape + family-default scope
(changeset added). Reviewer gate: fresh-context code-reviewer + critic (S10).
Counts: context-gate 236, cli 765, gui 419. Remaining: proxy plan P0–P9 (2 of 2).

## [2026-07-03] implement | persistent proxy routing P0-P8

Branch feat/persistent-proxy-routing-impl (stacked on saver). TDD; `pnpm verify`
green 48/48. Delivers the metering fix (proxy healthy but no client routed) +
removes the GUI boot/shutdown route-clear stranding bug. P0 llm-proxy HMAC health
endpoint; P1-P5 new @megasaver/proxy-control (state stores, fenced PID-reuse-safe
locks, pure recovery matrix with exhaustive invariants, supervisor fixpoint+monitor
wiring, LaunchAgent installer never-stop-foreign); P3 connector value-guarded route
adapter; P6 CLI proxy start/stop/status/service-uninstall + supervise runtime
(public break: old foreground start → supervise); P8 saver telemetry into proxy
status (cross-spec contract); P7 GUI persistent toggle (singleton+osascript+route-clear
removed). Changeset added. Deferred (flagged): GUI auth bootstrap (launch cap→cookie+CSRF)
+ long-running supervise control server. Next: CRITICAL review gates (security-reviewer
+ tracer + code-reviewer + critic).

## [2026-07-03] remediate | proxy CRITICAL review round 1 → fixes

The first CRITICAL gate returned REQUEST_CHANGES from all three reviewers: 4
BLOCKING + 10 MAJOR real defects (the gate did its job). Root of the worst one:
`mega proxy supervise` ran a bare listener and never invoked the reconcile state
machine, so `start` persisted an enable intent but the route was NEVER applied —
the original zero-metering bug persisted. Fixes (commit 37f170c0, TDD, `pnpm
verify` 48/48 green): (R1) supervise validates `--upstream` + gates non-default
origin behind `--confirm-credential-forwarding`; (R2) handler uses
`redirect:"manual"` and answers the reserved health path locally (never
forwarded); (R3) new `superviseDrive` daemon binds a health-capable listener and
drives the enable transition to a verified applied route on a 5s cadence under
the transition lock; (R4) new fenced `withTransitionLock` serializes
start/stop/GUI writes (returns transition_in_progress, never clobbers); (R5)
usage store 0600/0700 + symlink refusal + bounded control-char-stripped model;
(R6) LaunchAgent byte-exact managed classification + legacy-plist restore on
bootstrap failure; (R7) lock quarantine re-judges moved content (no live-owner
steal); (R8) route mutator fsync + mode preservation; (R9) verify_route is a real
read-back gate (aborts promote/clear on a lost write); (R10) status is read-only
(no ensureHooks side-effect). Re-running the CRITICAL gate (3 fresh-context
reviewers). Still deferred: GUI auth bootstrap + cross-process supervisor
discovery (single self-driving supervisor needs neither to route).

## [2026-07-03] verify | proxy CRITICAL review converged → APPROVE

The CRITICAL gate ran to convergence across three review rounds (fresh-context
security + correctness + adversarial-tracer each round; author≠reviewer).
- Round 1 (commit 37f170c0): 4 BLOCKING + 10 MAJOR fixed (credential gate,
  redirect:manual, the daemon actually running the state machine, transition
  lock, store/route/launchagent/lock hardening, verify_route read-back, read-only
  status).
- Round 2 (6979472e): correctness + tracer BOTH found one HIGH functional bug —
  `mega proxy stop` entered a drain that never completed (no drain_complete
  writer) → key-holding listener never stopped + `service uninstall` blocked
  forever. Fixed via `stop --confirm-clients-restarted` (+ GUI) writing
  drain_complete; plus enter_drain idempotency, stale-block clearing, boot
  recovery wiring, crash-proof tick.
- Round 3 (e09787f2 + 71201d8c): the round-2 fix opened a new reachable dead-end
  (drain_complete issued directly on a routed+leased state stopped the listener
  but stranded the route + lease). Made `reconcileDrain` TOTAL: value-guarded
  remove-first on a leased-exact route, clear_lease on every terminal. Security
  also caught the round-2 plist symlink guard using existsSync (follows a
  dangling link) → switched to a direct lstat.
- Final convergence review: exhaustive 16-row enumeration of reconcileDrain over
  (route × hasLease × generationLive) — no stranding, no dead-end, no regression;
  the five security invariants hold empirically (SSRF concat-defense, no key
  forward, foreign-route/process untouched, health-path local, tight perms +
  PID-reuse-safe locks). Verdict APPROVE.

`pnpm verify` green throughout (48/48 tasks; proxy-control 68, cli 777, gui 416).
Branch feat/persistent-proxy-routing-impl. The enable path now turns a persisted
intent into a live, verified route (the original "healthy but unrouted / zero
metering" bug is closed) and the disable path reaches a clean terminal idle.
Deferred (flagged, non-blocking): full GUI auth bootstrap + cross-process
supervisor discovery.

## [2026-07-03] ship | saver + persistent proxy routing merged to main

Both features are on `main`, green on CI (ubuntu-latest + windows-latest):
`794be8b7` saver activation inheritance (#216) and `297ebc28` persistent proxy
routing (#219). The proxy PR #218 was auto-closed when #216's `--delete-branch`
removed its base branch; it was recreated as #219 (base main).

Integration incident + recovery (recorded honestly for the next agent): the
#216 squash to main briefly BROKE CI. The saver worktree carried an uncommitted
`pnpm-lock.yaml` (+`@megasaver/context-gate` in the cli importer) that was
wrongly judged a stray and excluded from the merge; it was in fact the required
lockfile sync, so CI's `pnpm install --frozen-lockfile` failed on ubuntu +
windows. Local `pnpm verify` (macOS) never runs frozen-install, so it wasn't
caught pre-merge. Recovery via #219: merged main into the proxy branch, ran
`pnpm install` to sync the lockfile (committed this time), resolved the wiki
conflicts (union), and fixed a Windows-only failure — the usage-store 0600/0700
mode assertion reads 0o666 on Windows (no POSIX mode bits), now `win32`-guarded
like the other perm/symlink tests. #219 CI passed on both platforms → merged →
main green.

Lessons: (1) never exclude an uncommitted lockfile change without checking it
against package.json — `pnpm install --frozen-lockfile` is the CI-equivalent
check to run locally; (2) `--delete-branch` on a merge closes any PR stacked on
that branch — merge or retarget the child first; (3) POSIX perm/symlink tests
need a `win32` guard.

Cleanup: merged branches deleted (remote + local); the three feature worktrees
(`proxy-routing-impl`, `saver-activation-inheritance`, `persistent-proxy-routing`)
removed; local `main` refreshed to `origin/main`. The unrelated
`agent-office-skill-roles` worktree and the `refactor/token-saver-fullwidth`
working branch were left untouched.

---

## [2026-07-03] ingest | audit overlay-fallback review nits addressed

Branch `fix/audit-session-overlay-fallback` (worktree `MegaSaver-audit-overlay`).
Three code-review nits, sanctioned by the spec
`docs/superpowers/specs/2026-07-03-audit-overlay-fallback-design.md`:

1. Biome format-only fix: `honest-overlay-fallback.test.ts` multi-line import
   collapsed to one line.
2. `--json` discriminator on the overlay-fallback path: both `audit session`
   and `audit honest` now emit `{ source: "overlay", ...summary }` instead of a
   bare `OverlaySessionTokenSaverStats`, so a machine consumer can tell the
   overlay shape from the registered summary. Human card output unchanged.
3. `audit honest` now validates its positional session id via `sessionIdSchema`
   (same lowercase-UUID contract `audit session` uses — overlay files are keyed
   by the lowercase-UUID the hook writes) BEFORE reading. A malformed/uppercase
   id now yields `error: invalid session id` + exit 1 instead of a silent
   all-zeros report. `runHonestAudit` return changed `string` →
   `{ output, exitCode }` to carry the exit code; the citty handler routes the
   error to stderr and sets `process.exitCode`.

`pnpm verify` green (788 tests). Smoke: `audit honest <UPPERCASE-UUID>` → exit 1,
matching `audit session`; valid lowercase id on an empty store still yields the
zeros report at exit 0.

---

## [2026-07-03] feature | gui-redesign-v3
Sidebar shell + amber editorial redesign. Six pages (Sessions/Token Saver/
Memory/Workspace/Agent Office/Setup). Frontend-only workspace-context seam
resolves active workspace → representative session for the session-anchored
Memory/saver routes (no bridge change). Slim cockpit: transcript + savings
rail. Spec: docs/superpowers/specs/2026-07-03-gui-redesign-v3-design.md.
Plan: docs/superpowers/plans/2026-07-03-gui-redesign-v3.md.

## [2026-07-04] archive | loss-free size rotation of log / index / agent-channel

Curated three oversized pages, moving old content to `archive/` and
`syntheses/` with pinned pointers (nothing deleted; every moved line is
grep-findable in its new home). (1) `log.md` 244K→128K: 107 May entries
(2026-05-03 → 2026-05-13) rotated to `archive/log-2026-05.md`; June+July
(103 entries) kept live under a pinned archive-index pointer. Proof:
103 + 107 = 210 original dated entries; entry bodies byte-identical
(diff exit 0). (2) `index.md` 64K→20K: the ~800-line Status/release
narrative moved verbatim to `syntheses/release-history.md`; Status now
carries 1 line per release + a `[[syntheses/release-history]]` link.
Proof: 796 moved lines byte-identical (diff exit 0). (3)
`agent-channel.md` 36K→20K: 8 resolved/superseded handoff messages moved
to `archive/agent-channel-resolved.md`; live channel keeps the in-flight
pending review chain + the CRITICAL user-confirmation process gate.
Proof: 5 live + 8 archived = 13 original messages; message region
byte-identical (diff exit 0).

## [2026-07-04] lint | orphan re-anchor + contradiction reconcile (hygiene, no content moved)

Small additive edits only; nothing moved or deleted. ORPHAN FIXES (added
outbound `[[wiki-links]]` in the page + an inbound citing link from a live
page): (1) `concepts/persistent-proxy-routing.md` gained a Related section
linking [[entities/llm-proxy]] + [[concepts/proxy-mode]] + [[syntheses/post-v1.1-roadmap]];
cited from `syntheses/post-v1.1-roadmap.md` as proposed item #6. (2)
`concepts/saver-activation-inheritance.md` gained a Related section linking
[[entities/gui]] + [[entities/stats]]. (3) `concepts/windows-support.md`
re-anchored via a new "Is Windows supported / how?" row in the index Quick-links
table (its Concepts-list inbound at index.md:27 already existed; this adds a
navigational-table anchor). (4) `concepts/context-ledger-architecture.md`
[draft] anchored under a new "Drafts / proposals" note in index.md Concepts
(kept status: draft; the existing Concepts-list line preserved).
CONTRADICTION RECONCILES (one canonical phrasing each, sources cited, pages
kept): (a) context-gate extraction — `entities/core.md` BB12 section now states
canonically that core does NOT own the pipeline post-BB12 (`@megasaver/context-gate`
does); core keeps only a backward-compat re-export shim. Reconciled with
[[decisions/context-gate-extraction]]. (b) `decisions/policy-is-bb3.md` — added
a canonical line pinning the target as BB3 = v0.5; v0.9 is only the rejected
original plan. (c) roadmap phase count — `syntheses/contextops-roadmap.md` now
states the 11-vs-10 reconciliation (source counts Phase 0; synthesis counts the
10 numbered delivery phases 1–10) and marks the Team/Cloud SaaS portion as the
genuinely future / out-of-scope slice.

## [2026-07-04] merge | two loss-free page folds + archive

Two safe merges, all source content preserved in-target, sources archived with
redirect frontmatter, inbound links repointed.

MERGE 1 — `sources/post-v1.1-features.md` → `syntheses/post-v1.1-roadmap.md`.
Folded the six spec/plan pointers for the 3 post-v1.1 ContextOps features
(intent-aware-hook #180, diff-on-reread #181, semantic-ast-read #182) into a
new "### 3-feature spec index" subsection (build order #2→#1→#3, all six
spec/plan file paths, concept-page links, and the "See also" packages
[[output-filter]]/[[context-gate]]/[[content-store]]/[[context-gate-pipeline]]
preserved verbatim). Source moved to `archive/post-v1.1-features.md`
(status: archived, redirect: syntheses/post-v1.1-roadmap.md). Inbound link in
index.md repointed to `[[syntheses/post-v1.1-roadmap#3-feature-spec-index]]`.

MERGE 2 — `concepts/memory-approval.md` → `concepts/structured-memory-engine.md`.
Folded the whole approval concept into a distinct "## Approval gate" subsection:
agent-suggests → human-approves policy, the `approval` closed-enum + backfill,
both gate points (`searchMemoryEntries.includeUnapproved` + four
`approval === "approved"` list filters), team = shared-store-+-gate, the PR #123
shipped-code reconciliation (25th MCP tool), the cloud-SaaS deferrals, and the
[[entities/mcp-bridge]] / [[entities/cli]] / [[entities/core]] links — all
preserved. Source moved to `archive/memory-approval.md` (status: archived,
redirect: concepts/structured-memory-engine.md). Inbound links repointed to
`[[concepts/structured-memory-engine#approval-gate]]` in index.md (x2),
memory-superset.md (x2), context-ledger-architecture.md (Related link;
frontmatter source dedup'd since structured-memory-engine.md already listed),
and contextops-roadmap.md (Phase 10 row).

NOT merged (kept separate per directive): semantic-ast-read, outline-first-read,
diff-on-reread. Log.md historical references to the retired pages left intact
(append-only history).

## [2026-07-04] lint | wiki optimization — rotation + merge + archive finalized

Nothing-lost audit of the wiki optimization branch (`chore/wiki-optimize`),
then catalog finalization. Result: **no information lost** — every line from
`origin/main:wiki/` is now either active or archived and remains grep-findable.

Rotation/merge/archive actions taken on this branch (audited here):
- **log.md rotation** — 210 real entries on origin split loss-free into live
  `log.md` (106 recent, June 2026 onward) + `archive/log-2026-05.md` (107,
  2026-05-03 → 2026-05-13). Union 213 = 210 original + 3 new 2026-07-04 entries;
  0 lost, 0 duplicated across the split boundary.
- **index.md release-history extraction** — the 798-line `## Status` release
  narrative (Phase 9/10, v1.1.0, v1.0, AA1 BB1–BB7a, v0.3, v0.2 + process
  metrics + backlogs) moved to `syntheses/release-history.md` (821 lines);
  index shrank 939 → 165 lines. All 726 substantive origin lines verified
  present in release-history.md.
- **agent-channel.md rotation** — 13 origin messages split into 5 live (open
  threads) + 8 `archive/agent-channel-resolved.md` (resolved); 0 lost.
- **Page merges (loss-free)** — `sources/post-v1.1-features.md` →
  `syntheses/post-v1.1-roadmap.md#3-feature-spec-index`;
  `concepts/memory-approval.md` →
  `concepts/structured-memory-engine.md#approval-gate`. Both sources archived
  byte-verbatim with redirect frontmatter; inbound links repointed; no
  dangling `[[…]]` refs to the retired slugs remain in the active tree.

Catalog finalization (this entry's writes): added an `## Archive` section to
`index.md` listing all four archived pages + their live targets, and a
`[[syntheses/release-history]]` entry under Syntheses. Every origin page absent
from the active tree (`memory-approval`, `post-v1.1-features`) is confirmed in
`archive/`; nothing merely vanished.

## [2026-07-05] ingest | Decision-Trace Viewer shipped (PR #227)

Flagship: surface the causal chain behind each context decision (ranking →
which memory boosted it → chunks + scores → redaction → output). CLI
`mega trace explain` + GUI Cytoscape panel + `readSessionDecisionTrace` reader.

**Key learning (see [[decisions/decision-trace-inline-not-join]]):** the original
chunkSetId join between replay-trace and evidence-ledger is INERT with real data
— the two stores are populated by disjoint seams (registry writes only trace,
overlay only evidence; independent ids). Fixed by recording memory ids +
redaction INLINE on the registry trace. Ranking score unchanged (parity-guarded).
Tracing now on by default (`MEGASAVER_SEAM_TRACE=false` disables) + retention
prune. Built across 8 TDD slices; holistic branch review (code+critic+security)
caught & fixed 3 surface defects incl. a `?session` path-traversal. `pnpm verify`
green; changeset added.

## [2026-07-05] ingest | GTM & monetization plan (3-element framework)

Applied the @Techburhan 3-element framework (sticky app / content / marketing)
to MegaSaver, grounded in dual research: internal product facts (wiki+repo) +
external market scan (mid-2026). New page: [[syntheses/gtm-plan-2026-07]].
Key findings: NOT a blue ocean (every pillar has free OSS; claude-mem ~72k★)
but the integrated bundle is unclaimed; demand proven (cost volatility = #1
2026 concern, $81k bill-shock viral); biggest gap is product-VISIBILITY (GUI
unpackaged, savings on-demand); largest segment (Pro/Max) feels LIMITS not
bills → "same plan, 2x sessions" framing. DECISIONS (user-approved):
open-core, Pro $10–15/mo; TR beachhead + EN parallel. Phase 0 (sellability:
Tauri GUI packaging, $/limit headline, `mega init`, landing, license metadata
fix, share card) awaits kickoff approval.

## 2026-07-06 — `mega gui` Slice C (command + packaging + bundle smoke) — Claude Code

Implemented Slice C (final) of `feat/mega-gui-command` on top of the already-landed
Slices A (bridge hardening: loopback + token wall + CORS + argv) and B (static
serving + frontend token). HIGH-risk (new public CLI command + npm packaging).

- Extracted `server.ts main()`'s boot into `startGuiBridge` (`apps/gui/bridge/start.ts`);
  dev `server.ts` delegates to it. Moved `createBridgeServer`/`deriveGuiOrigins` there
  so the inlined bridge never pulls `server.ts`'s entrypoint guard (fixed a real
  EADDRINUSE-on-:5174-every-command bug the bundle would have shipped).
- New `mega gui [--port <n>] [--no-open] [--store <dir>]` (`apps/cli/src/commands/gui.ts`,
  `runGui`); ALWAYS token-gated; registered in `main.ts`. Exposed `@megasaver/gui/bridge`
  (tsup `dist-bridge` entry) for `startGuiBridge` + `resolveShippedGuiDistDir`.
- Packaging: CLI prepack builds the GUI, tsup inlines the bridge, `copy-gui-dist.mjs`
  ships `apps/gui/dist` → `apps/cli/dist-bundle/gui`. Added `@megasaver/gui` to the CLI
  dependency-graph allow-list (acyclic — GUI never imports CLI).
- Fixed a CORS bug: derive origins from the BOUND port (else `--port 0` 403'd browser
  writes). Regression test added.
- README + `docs/getting-started.md` lead with `mega gui`; changeset `.changeset/mega-gui.md`
  (`@megasaver/cli` + `@megasaver/gui` minor).
- Evidence: `pnpm verify` green; real `npm pack` → global temp install → installed
  `mega gui` curl proof — `/` 200 html, `/api/health` no-token 401 / `?token=` 200 /
  Bearer 200 / same-origin 200 / foreign-origin 403 / bound addr 127.0.0.1.
- Reviewers pending (HIGH): code-reviewer + critic + security-reviewer (not yet run).

## [2026-07-06] query | pro-differentiation-portfolio

User asked for world-class differentiation ideas for the paid subscription
(new features + evolving shipped ones). Read gtm-plan-2026-07,
mega-saver-product, contextops-roadmap + the two 2026-07-06 Pro specs.
Filed the answer as [[syntheses/pro-differentiation-portfolio]] (6 feature
evolutions E1–E6, 6 new module candidates N1–N6, Free/Pro/Team packaging
rule, GTM-Faz-0-compatible sequence). Brainstorm stage only — no spec, no
code. Next: user picks item → superpowers spec cycle. Index updated.

## [2026-07-07] update | pro-differentiation-portfolio realigned to launch wave

User: "Pro'ya ekledik; koda göre planı düzelt." Re-checked repo: PRs #231–#251
shipped AFTER the portfolio was written — `mega gui` (npm), savings headline,
GUI share card, `mega init`, landing, entitlement seam, Pro m1 history, m2
insights, m3 **forecast** (#240 — the slot the portfolio had pitched `mega
roi` into; the forecast spec explicitly deferred ROI + anomaly alerts), /pro
pricing, prod Ed25519 key, v1.5.0 versioned, site + Gumroad checkout live.
Rewrote [[syntheses/pro-differentiation-portfolio]]: reality-check section;
`mega roi` re-slotted as module-4 top pick ($7.99 math → 10.9×); E4 share-card
half marked done (teardown remains); N7 added (anomaly alerts + persistent
budgets, from forecast-spec non-goals); sequence rewritten (step 0 = owner npm
publish blocker; Tauri item dropped — `mega gui` covers it). Flagged price
drift ($7.99 live vs locked $10–15) in the portfolio AND
[[syntheses/gtm-plan-2026-07]] (needs user decision). Index: portfolio line
updated + v1.5.0 status line added. Gap noted: [[syntheses/release-history]]
lacks the full v1.5.0 narrative (follow-up candidate).

## [2026-07-07] feature | gumroad-custom-landing-page

Built + published a custom Gumroad landing page for Mega Saver Pro
(product `txsikq` → https://megasaver.gumroad.com/l/pro). File:
`landing.html` at repo root (self-contained; "token ledger" design,
light+dark themes, mono-display type, animated token-statement hero).
Copy strictly limited to the shipped Pro surface: `mega savings
history/insights/forecast`, CSV/JSON export, offline Ed25519 license,
MIT core free (source: live product description; GTM Faz-0 "landing"
item in [[syntheses/gtm-plan-2026-07]]). Buy elements carry
`data-gumroad-option="Pro"` + `data-gumroad-recurrence="monthly"`;
live fields (name/price/description) server-interpolated. Verified:
sanitizer report clean (only inert meta/title strips), live render
both themes + FAQ/toggle/reveals, true-390px mobile emulation shows
zero horizontal overflow (CDP probe), and buy click reaches Gumroad
checkout preselected Pro/Monthly/US$7.99 (creator test-purchase
notice; Pay not clicked). Page replaces the native product page —
`gumroad products page clear txsikq --yes` restores the default.

## [2026-07-07] decision | price = site price ($7.99/mo) + module-4 pick = mega roi

User locked two decisions: (1) Pro price stays as published on the site —
$7.99/mo (Gumroad) canonical; the GTM $10–15 band revised
([[syntheses/gtm-plan-2026-07]] drift flag resolved in place). (2) Module 4 =
**mega roi** (portfolio E1). Portfolio status updated; superpowers
brainstorming started for the roi spec same session.

## [2026-07-07] plan | mega roi spec + implementation plan written

Brainstormed (4 user decisions: top-level `mega roi`, saved-so-far +
month-end projection scope, m1–m3 dollar model + "(est.)", honest ROI<1
message / no coupon mechanics in CLI), spec committed
(`docs/superpowers/specs/2026-07-07-pro-roi-design.md`, 8c7bc9c), plan
written (`docs/superpowers/plans/2026-07-07-pro-roi-plan.md`): 4 TDD tasks —
pure `computeRoi` (wraps forecastSavings) → gated `runRoi` CLI → register +
README + changeset → `pnpm verify` + e2e smoke. Execution next in worktree
`feat/cli-mega-roi`; reviewers code-reviewer + critic (MEDIUM, m3 bar).

## [2026-07-07] feature | mega roi (Pro module 4) built — worktree-feat-cli-mega-roi

Subagent-driven execution of the 4-task plan (fresh implementer + spec
reviewer + quality reviewer per task; fix loops re-reviewed): computeRoi
pure fn (2644ef03) → gated runRoi CLI (e9e8f21 + floor-display fix
a36193c) → registration/README/changeset (2adf7b51) → copy fixes
(d1fe09a/f283faa) + "(est.)" headline label (21ac77e/3e21a20). Review
catches worth remembering: (1) toFixed(1) rounded roiSoFar∈[0.95,1) up to
"1.0×" NEXT TO "hasn't paid for itself yet" — display now floors (repo
under-count convention), near-break-even regression test added; (2) README
example "$49 = 6.2×" failed its own floored division — all doc examples now
derive from one consistent set; (3) pre-existing main bug fixed en route:
readme-proxy-mode.test.ts asserted pre-#251 copy (42f94f8) — masked on main
by turbo cache replay (README not in the test task's turbo inputs). Final
holistic review: 3-lens workflow (code-reviewer + adversarial critic +
honesty/docs), 3/3 approve, 0 confirmed findings, 2 minors fixed. Evidence:
TURBO_FORCE `pnpm verify` green; binary e2e smoke with a prod-key-signed
short-expiry test license (upsell → activate → honest empty state → valid
--json RoiReport → bad --price exit 1). [[entities/cli]] Pro-tier section
added. Closure: final TURBO_FORCE verify green after the last code commit;
user chose push+PR → branch renamed `feat/cli-mega-roi`, **PR #252** opened
(https://github.com/haJ1t/MegaSaver/pull/252). Worktree preserved for PR
iteration. Note: local main carries the 3 pre-branch docs commits
(8c7bc9c/5d0af28/10f37e1) unpushed — content ships via #252; after merge,
realign local main to origin.

## [2026-07-07] merge | PR #252 squash-merged — mega roi on main

User approved merge. CI green (verify ubuntu 5m56s + windows 8m6s + Vercel),
squash-merged as 5c6a60f1 `feat: Pro module 4 — subscription ROI (mega roi)
(#252)`. Remote + local feature branch deleted; worktree removed; local main
realigned to origin (the 3 superseded pre-branch docs commits dropped via
rebase-skip — their amended content shipped inside the squash). Pro surface
on main is now m1–m4. Remaining owner action unchanged: npm publish
(changesets: next release includes `mega roi` as a minor).

## [2026-07-07] verify | npm 1.5.0 already live — activation blocker CLOSED

User asked "npm publish 1.5.0"; registry check showed **1.5.0 was already
published 2026-07-07T08:19Z** (dist-tag latest, access public via
publishConfig, npm license field `SEE LICENSE IN NOTICE`) — the checklist's
"npm still 1.4.1" blocker note was stale. Verified the PUBLISHED tarball
end-to-end via `npm exec --package=@megasaver/cli@1.5.0`: version 1.5.0;
free upsell; `mega license activate` with a prod-key-signed short-expiry
test license → "Pro activated" (baked production public key verifies real
issued keys); gated `mega savings history` runs; `mega roi` correctly absent
(merged 12:05Z, after the publish). Checklist blocker section updated to
RESOLVED (docs/launch/owner-pre-launch-checklist.md). `mega roi` awaits the
next release: pending `.changeset/pro-roi.md` → 1.6.0.

## [2026-07-07] incident+release | 1.6.0 broken bundle → 1.6.1 live with mega roi

**Incident:** 1.6.0 (owner-published after `changeset version` 15aff29) shipped
a broken tarball — entitled `mega roi` crashed with "computeRoi is not a
function". Root cause: `prepack` built ONLY the GUI before bundling; tsup's
inline-everything bundle baked whatever workspace `dist/` existed on the dev
machine, and `packages/pro-analytics/dist` there was pre-roi (the exact stale-
dist trap the Task-2 implementer flagged; sibling of the #225 proxy-control
bundle miss). Artifact-level red→green: local stale bundle reproduced the
crash; fix = prepack now runs `turbo build --filter=@megasaver/cli...` (full
dependency closure) before `bundle` (2b4668f). Gotcha logged: running
`pnpm run prepack` manually leaves package.json STRIPPED (strip-publish-
manifest) — restore with the `postpack` arg.
**Release:** 1.6.1 published (owner, OTP) + **1.6.0 npm-deprecated** ("Broken
bundle… Use 1.6.1."). Published-tarball e2e verified: upsell → real-key
activate → `mega roi` honest empty state → valid RoiReport `--json` → bad
`--price` exit 1. `latest` = 1.6.1; tag `v1.6.1` pushed (release.yml
standalone-bundle release). `mega roi` is now LIVE on npm — Pro surface
m1–m4 sellable end-to-end. Known gap: no `v1.5.0`/`v1.6.0` tags exist
(no GitHub bundle releases for those versions; intentional for broken 1.6.0).

## [2026-07-07] feature | mega savings fix (Pro module 5) built — worktree-feat-cli-savings-fix

HIGH-risk module built via subagent-driven TDD (4 plan tasks, per-task
spec+quality review workflows, then a 3-lens holistic final + a fresh critic
re-run + a targeted dry-check). **Four CONFIRMED review catches, all fixed
RED-first — textbook case for why the HIGH chain exists:**
1. R3 advice command failed the real closed enums (`--category mcp`,
   `--risk caution`) and omitted required `--description` (8a35f724).
2. `defaultSaverWriter` wrote an exact record directly → un-clearable
   override shadowing the family-scoped disable in Git repos; now routes
   through canonical `resolveActivationScope`+`writeActivation`
   (a7bf7f3b; the activation lock lives INSIDE `writeActivation` —
   wrapping it again would deadlock).
3. R3 mapped `command → dangerous`, a category the tool router hard-blocks
   from EVERY route pre-relevance — contradicting the advice's
   relevance-exclusion promise (53ca958b; sweep test pins all sourceKinds
   to non-blocked categories).
4. `--apply` asserted success blindly; a pre-existing exact override
   shadows the family write → now READS BACK effective state and prints
   `unchanged — an exact override wins` + an `--exact` hint (c4a33d98).
Plan-authoring lessons logged en route: `@megasaver/shared` dep must be
declared for type-only imports (tsc catches, vitest doesn't);
`nodeResolverDeps` is a factory (call it); `tsconfig.test.json` is the
second typecheck half; a shared fixture fires MORE rules than the one under
test. Evidence: TURBO_FORCE `pnpm verify` green at head; binary e2e smoke
incl. git-repo family write (`saver-families/gf1_*.json`, no exact leaf)
and the shadow scenario (honest message + hint + truthful JSON); dry-check
verdict **dry** (2 cosmetic minors, both deliberate). [[entities/cli]]
Pro-tier section updated. Closure: branch renamed `feat/cli-savings-fix`,
**PR #253** opened (https://github.com/haJ1t/MegaSaver/pull/253); worktree
preserved for PR iteration.

## [2026-07-07] merge | PR #253 squash-merged — mega savings fix on main

CI green (verify ubuntu 5m57s + windows 7m51s + Vercel), squash-merged as
aa52164d. Remote + local feature branch deleted; worktree removed; local
main fast-forwarded (clean — no superseded pre-branch commits this time).
Pro surface on main is now **m1–m5**. Pending owner action: npm publish —
`.changeset/savings-fix.md` (minor) is unconsumed, so the next release is
1.7.0; the prepack dependency-closure fix from the 1.6.1 incident is in
place, publish flow is `pnpm changeset version` → commit → `npm publish
--access public` (OTP) from apps/cli.

## [2026-07-07] decision | 1.x → 2.0 program LOCKED + 1.7.0 versioned

User: "1.7.0 yayınla ve kalan her şeyi 2.0'a gelmeden bitirelim."
(1) 1.7.0 versioned (9d413f8, savings-fix minor consumed); owner publishing
via OTP; registry poller + published-tarball verification queued.
(2) Program LOCKED (user-approved, all 7): 1.8 teardown → 1.9 bench →
1.10 prose-compressor (upgrades savings-fix R5 to real apply) → 1.11 cache
doctor → 1.12 context firewall → 1.13 anomaly+persistent budgets → **2.0
portable project brain**. Excluded from 1.x: leaderboard (backend),
Team tier (post-2.0), budgeted multi-agent (CRITICAL), i18n tr. Table in
[[syntheses/pro-differentiation-portfolio]]. Stale-note fix en route:
post-v1.1-roadmap's "persistent proxy routing pending review" is outdated
(#219 merged). Next: `mega teardown` brainstorm.

## [2026-07-07] feature | mega teardown (Pro module 6) built — worktree-feat-cli-teardown

Subagent-driven TDD (4 plan tasks; Task-3's 18-line copy diff was folded
into the final 3-lens review instead of its own round). **Privacy was the
headline promise and the review machine earned its keep again:**
- Task-1 quality lens EMPIRICALLY proved the one real leak vector —
  `FixMemoryFile.path` reached shareable markdown verbatim via module-5 R5
  titles; fixed AT THE SOURCE (fix.ts `baseName`, 1e825419) so the
  guarantee is engine-level, not wiring-level. Hostile-path sweeps pin it
  in both fix and teardown tests.
- Final 3-lens review: 3/3 approve, 0 confirmed findings; all three lenses
  independently traced every rendered field to the closed `sourceKind`
  enum + basenamed literals + numbers (readEvents safeParse drops
  non-conforming lines, so hostile keys can't even enter).
- Post-approve polish: md/svg empty states unified on one signal
  (`totalReturnedBytes === 0`, 4064eacd + f6085fdc — the implementer
  itself flagged the SVG half); README documents `--json`.
- Accepted minors (deliberate, sibling-convention): non-atomic double
  write; raw ENOENT on missing `--out`; compactTokens 999_999 → "1000.0k".
Recurring gotcha logged AGAIN: `changeset version` reserializes
apps/cli/package.json off-format → repo lint red until `lint:fix`
(c351c68). **Add lint:fix to the release ritual.** Evidence: TURBO_FORCE
verify green; binary smoke (upsell → both files → 5 headings → exists-guard
listing both paths → --force → valid --json). [[entities/cli]] module-6
bullet added. Pending: final verify re-run + merge decision.

## [2026-07-07] merge+release | PR #254 merged — 1.8.0 versioned; npm skips 1.7.0

CI green (verify ubuntu 5m50s + windows 7m45s + Vercel) → squash e8539843;
remote+local branch deleted; worktree removed; local main realigned. Pro
surface on main = **m1–m6**. Release housekeeping: the 1.7.0 versioning had
left `.changeset/savings-fix.md`'s on-disk deletion UNSTAGED (bf69da2 fixes
— lesson: `changeset version` commits must stage the consumed .changeset/*
deletions too, or the next changelog duplicates them). 1.8.0 versioned
(4e07288) WITH the lint:fix ritual applied proactively. **Decision: npm
skips 1.7.0** — it was never published (OTP pending when #254 landed);
one publish ships 1.8.0 directly, CHANGELOG carries both sections; npm
versions need not be contiguous. Owner action: publish 1.8.0 (OTP).

## [2026-07-07] release | 1.8.0 LIVE on npm — Pro m1–m6 sellable

Owner published (OTP); `latest` = 1.8.0. Published-tarball e2e verified
with a prod-key-signed test license: `mega savings fix` renders the plan;
`mega teardown` writes both artifacts (md title + svg), exists-guard exit 1
on rerun. Tag `v1.8.0` pushed → release.yml standalone bundle. The 1.x
program's first post-lock milestone is done: 1.8 teardown SHIPPED same day
as modules 4–5. Next per locked program: **1.9 `mega bench`**.

## [2026-07-07] feature | mega bench (Pro module 7) built — worktree-feat-cli-bench

HIGH-risk module (double child spawn) via subagent-driven TDD. **The review
machine caught TWO criticals before merge:**
1. A crashed saver pass reported MAXIMAL savings next to "did not complete"
   — incomplete passes now FORCE savings to 0 + "not measured" note
   (1960c78e; the honesty promise breaks exactly at crash time otherwise).
2. Eager permission loading in run()'s argument list crashed the FREE path
   on a malformed permissions.yaml (uncaught PolicyLoadError, reproduced on
   dist) — now lazy/memoized/fail-closed; `policy_load_failed` IS a
   PolicyDenyCode (deny-code.ts documents it for exactly this), so bench
   renders exec's byte-identical denial line (d7429bd4).
Also fixed en route: spec-mandated double-run disclosure was missing from
the methodology; raw-vs-saver attribution + savings math were unpinned
(swap mutants survived); `--json --md` polluted stdout; "vitest" as a test
fixture command self-classifies confidently from the command string alone
(classify.ts regex) — fixtures must use neutral commands. Architecture
notes: `runChild` exported from context-gate (90 subtle lines, reuse over
replication; comment carries "callers MUST gate first"); @megasaver/stats
is a FORBIDDEN CLI dep so the no-record invariant is pinned via
chunk-persist spy + upstream no-trace guard + structural unreachability.
Dry-check verdict **dry** (revert-based pin checks; bench/exec denial
byte-compare on real dist). Evidence: TURBO_FORCE verify green ×2; binary
smoke incl. live savingsNote on tiny `ls` output and dangerous_pattern
denial. [[entities/cli]] module-7 bullet added. Pending: merge decision +
1.9.0.

## [2026-07-07] merge+release | PR #255 merged — 1.9.0 versioned

CI green (verify ubuntu 5m23s + windows 7m12s + Vercel) → squash 057eb119.
Remote+local branch deleted; worktree removed; local main realigned
(clean). Pro surface on main = **m1–m7** — the 1.x program's 1.9 milestone
done. 1.9.0 versioned (abda413) with the full release ritual (changeset
deletion staged, lint:fix applied, repo lint green). Owner action: publish
1.9.0 (OTP) — ships `mega bench`.

## [2026-07-08] release | 1.9.0 LIVE — npm 11.11 `bin` gotcha fixed mid-publish

Owner's first 1.9.0 publish attempt hit TWO issues: (1) npm session
expired → PUT 404 (npm returns 404 not 401 for unauthorized publish);
`npm login` fixes. (2) **npm 11.11.1 dropped the `bin[mega]` entry as
"invalid"** because it was `"./dist-bundle/mega.mjs"` — older npm silently
normalized the `./` prefix at publish (the live 1.8.0 manifest shows the
normalized form), 11.11 instead REMOVES it, which would have shipped a
package with NO `mega` binary. Fixed at the source via `npm pkg fix` →
canonical `"dist-bundle/mega.mjs"` (03b5705). **Add to the release ritual:
the bin field must be `./`-free; watch publish output for the
"bin[...] was invalid and removed" warning.** Republished clean; `latest`
= 1.9.0, `bin` present, verified end-to-end on the published tarball:
`mega --version` 1.9.0, `mega bench -- ls` paired run with live
savingsNote, `mega bench -- rm -rf` → dangerous_pattern denial. Tag
`v1.9.0` → release.yml bundle (the npm-publish CI leg's 2FA failure is
EXPECTED — security-key 2FA can't run headless; the GitHub Release + bundle
asset succeed regardless, confirmed on v1.8.0). Pro surface m1–m7 sellable.
Next: 1.10 prose-compressor.

## [2026-07-08] build+review | module 8 `mega compress` (1.10) — review caught a CRITICAL

Feature branch `feat/cli-mega-compress` (worktree, off 461cebe2).
Subagent-driven TDD, 5 slices: **(A)** expose the EXISTING `compressProse`
from output-filter's public entry — no new dep, no new bundle path
(sidesteps the 1.6.0 bundle-resolution class); pure
`composeCompressionReport` + `renderCompressionSummary` in pro-analytics,
marker-count regexes byte-verified against the engine's `… [N paragraphs]`
output via hexdump. **(B)** gated `runCompress` — entitlement FIRST, then
`.md`/`.txt`/`.mdc` guard, **dry-run DEFAULT** (zero writes; `--json`
read-only even with `--apply`), `--apply` writes `<file>.bak` then atomic
temp-in-same-dir+rename; injected fs/git (`execFileSync` argv, no shell).
**(C)** savings-fix R5 `command: null` → `mega compress <basename>`
(basename-only so teardown stays share-safe; `appliable:false` kept).
**(D)** register + README + changeset + verify + tarball e2e.

**The review earned its keep — 1 CONFIRMED CRITICAL (2 findings, same root
cause).** `compressProse` is NOT idempotent: its own `… [N paragraphs]`
markers re-parse as paragraphs on a 2nd pass, so re-running `--apply` on an
already-compressed file has `changed=true`. The ORIGINAL spec let `--force`
override the existing-`.bak` guard → a guided re-run (the tool's own error
text said "re-run with --force") would read the already-degraded file and
`writeFile(bak, <degraded>)`, clobbering the pristine backup and DESTROYING
the original — defeating the whole reversibility premise. My per-slice
reviews MISSED it (accepted "--force overwrites .bak" as by-design). **Fix:
the backup is WRITE-ONCE** — `--force` overrides the git-dirty guard ONLY;
an existing `.bak` always refuses ("restore it (mv) or remove it"). A
fresh-context verifier confirmed CLOSED — no tool-initiated clobber path
remains; the only residual is the user manually deleting their own backup.
Spec amended (decision #2 + a Security note record the non-idempotency +
the write-once fix). **Lesson: for lossy/marker-based transforms, test
idempotency of re-runs explicitly — "reversible" dies if the backup can be
overwritten by degraded content.**

Evidence: `pnpm verify` green (cli **936** tests, tsc 18 pkgs, biome 1321
files, conventions ok); tarball e2e 14/14 (bundle resolves the lazy
pro-analytics import AND compressProse; apply 2665→106B, `.bak`==original,
`mv` restores exact, free path upsells); fix repro on the SHIPPED binary —
a 591B→571B non-idempotent skeleton REFUSED under `--apply --force`,
pristine `.bak` intact. 6 commits (c5223bbc..6a764381).
[[entities/cli]] module-8 bullet added. Pending: PR + merge + 1.10.0
release (release ritual: changeset version → stage consumed changeset
deletion → `biome check --write apps/cli/package.json` → commit → push →
owner OTP publish; `bin` must stay `./`-free).

## [2026-07-08] review | PR #256 pre-merge — `.bak` byte-fidelity blocker

Adversarial review of PR #256 (`feat/cli-mega-compress`) before merge (4
dimensions × verify). All CI was green, but the review surfaced a CONFIRMED
**data-safety blocker**: `mega compress --apply` wrote the `.bak` via a utf8
read→write of the decoded string (`writeFile(bak, original)`), so a
**non-UTF-8 source** (latin-1, UTF-16, stray bytes) got a U+FFFD-corrupted
backup and `mv`-restore yielded mojibake — silently breaking the reversibility
guarantee on a CRITICAL file-mutating command. Fix: a new `backupFile(src,
dest)` fs seam does a **byte-exact copy straight from disk** (atomic
tmp+rename), replacing the string round-trip. TDD: a red real-fs test
(BIG_DOC + invalid trailing bytes → `.bak` must byte-equal source) drove it.
Evidence: `pnpm verify` green (cli **937** tests, tsc, biome, conventions ok).
7 non-blocking follow-ups logged for later (fsync durability on the atomic
writer; `--apply` writes a LARGER file while printing "0 saved"; EISDIR/EACCES
stack trace when the path is a dir/unreadable; 3 test-coverage gaps —
atomic-mechanism pin, uppercase-extension accept, real mv-restore assertion).
**Lesson: a "byte-exact backup" needs a raw file copy, never a decode→encode
round-trip — the JS string is lossy for any non-UTF-8 input.** [[entities/cli]]

## [2026-07-08] harden | mega compress — 7 review follow-ups + regression caught

Cleared the 7 non-blocking follow-ups from the #256 review of `mega compress`
(all in apps/cli/src/commands/compress.ts + tests), TDD throughout: (1) **fsync
durability** — new `fsyncedRename` helper (fsync temp fd → rename → POSIX
parent-dir fsync, Win-aware, post-rename dir-fsync swallowed, orphan temp
rmSync'd on pre-rename throw) used by both the target write and the byte-exact
backup copy; (2) skip the write when there are **no byte savings** (`worthwhile`
guard, was writing a larger file while printing "0 saved"); (3) a dir/unreadable
path now returns a **typed error**, not an EISDIR/EACCES stack trace; (4) new
`compress-atomic-write.test.ts` pins temp+rename atomicity (mocked renameSync)
and the dir-fsync swallow; write-failure recoverability test; (5) uppercase-ext
accept; (6) the bogus "restore works" assertion now performs a real mv-restore.

A **code-reviewer+critic+test-quality** pass then caught a HIGH regression the
diff itself introduced: `fsyncedRename`'s `openSync(tmp,"r+")` **crashed EACCES
on a read-only (0o444) source**, because `backupFile`'s `copyFileSync` gave the
temp the source's read-only mode — reintroducing the exact stack-trace #3 killed.
Fixed: chmod the temp writable for the fsync, then restore the source mode so the
`.bak` is byte- AND mode-exact. A follow-up adversarial recheck flagged that the
now-reachable path let `writeFile` **widen a private (0o600/0o400) memory file to
0o644** on `--apply`; fixed by preserving the target's mode too (both mode
restores best-effort, so a chmod-hostile FS never wedges after the bytes land).

Evidence: `pnpm verify` green (cli tests incl. 6 new compress cases + 3 atomic;
tsc, biome, conventions ok); each fix landed red→green. **Lesson: copyFileSync
preserves source mode — a durable rewrite that reopens the temp "r+" or restores
perms must handle read-only sources, and a content-only edit must never widen a
sensitive file's permissions.** [[entities/cli]]

## [2026-07-08] release | 1.10.0 live — `mega compress` (Pro module 8)

`@megasaver/cli` 1.10.0 published. Ritual run: `pnpm changeset version`
(consumed `.changeset/compress.md`, CHANGELOG entry written), staged
deletion, `biome check --write apps/cli/package.json` (`bin` stays
`./`-free: `"mega": "dist-bundle/mega.mjs"`), release PR #261
(`chore(release): version packages — @megasaver/cli 1.10.0`, merge
`c632b531`), tag `v1.10.0` pushed → `release.yml` run 28952691963
**fully green**: GitHub Release created (`mega.mjs` +
`mega-1.10.0.mjs` assets) AND npm publish succeeded automatically.

**Ritual correction: the "owner OTP publish" step is obsolete.** The
1.9.0 release-run failure was `E403 cannot publish over previously
published versions: 1.9.0` — a *duplicate* publish (owner had already
published manually before tagging), NOT a token/2FA failure. The
`NPM_TOKEN` automation token publishes fine on its own. New ritual:
changeset version → biome bin check → release PR → merge → push tag —
CI does the rest. Do NOT publish manually first; that's what caused
the 1.9.0 red run.

Smoke on the published artifact: `npx @megasaver/cli@1.10.0 --version`
→ `1.10.0`; `compress notes.md` dry-run on a real file → `Savings:
906→81 bytes · ~206 tokens`, `--apply`/`.bak` guidance printed, exit 0.
Next: 1.11 cache (Pro module 9) — no spec yet. [[entities/cli]]
[[syntheses/release-history]]

## [2026-07-08] feature | mega cache (Pro module 9) built — worktree feat/cli-mega-cache

Spec `2026-07-08-cache-doctor-design.md` (HIGH) → plan → subagent-driven TDD
build. `mega cache` = the prompt-cache doctor: reads the metering proxy's
counts-only `usage.jsonl`, groups calls into conversations (messageCount+time
heuristic), detects four cache-miss signatures (D1 no-cache conversation-level;
D2 unstable-prefix / D3 ttl-expiry / D4 model-switch turn-level, one shared
trigger, priority D4>D3>D2), prices the re-paid burn (`rePaid × P × 1.15`,
capped at `priorWritten`) against the house rate, and prints a one-line fix per
finding. `reliable` flag (≥20 events ∧ ≥3 conversations) suppresses the burn
headline on thin data. Read-only, advice-only, never reads content. Pure
`diagnoseCache` in pro-analytics; CLI owns I/O behind `savings-analytics` gate;
new `proxyUsageLogPath` export in llm-proxy for a tolerant per-line read.

**Two plan defects the review gate caught before merge (both good catches by
the implementer subagents, not workarounds):** (1) a self-contradictory D1
"clamp" test — with `missed ≥ premium base` and `0.9 > 0.25`, D1 burn is
structurally positive, so the `max(0,…)` is a display-contract guard, not a
reachable branch; test corrected. (2) the plan's CLI code imported
`INPUT_PRICE_PER_MTOK_USD` directly from `@megasaver/stats`, a
dependency-graph-guard-forbidden `apps/cli→stats` edge; fixed by re-exporting
the const through `@megasaver/pro-analytics` (already a stats consumer + an
allowed CLI dep) and taking it via the existing post-gate lazy import.

Evidence: pro-analytics cache-doctor 21 tests, cli cache 12 tests,
dependency-graph guard green, `pnpm verify` green, biome+tsc clean. HIGH review
(4 lenses incl. a numerical-correctness pass, findings adversarially verified):
**merge-with-followups, 0 blockers** — the financial core is sound and the
confident `$X burned` headline is gated behind the reliability threshold, so a
paying user is never shown a confident wrong figure. Fixed pre-merge anyway (2
functional + coverage): the `--json` no-data contract break and the unbounded
`--days` RangeError, plus firing-boundary/reliable-headline/pinned-dollar tests.
Pending: PR + merge + 1.11.0 release.
**Lesson: a detailed plan still ships bugs — a self-inconsistent test and a
hidden dependency-edge violation both survived plan self-review but died at the
implementer/spec gate. The two-stage gate earns its cost.** [[entities/cli]]

## [2026-07-08] release | 1.11.0 live — `mega cache` (Pro module 9)

`@megasaver/cli` 1.11.0 published. Ritual (unchanged from the 1.10.0 lesson —
NO manual publish): `pnpm changeset version` (consumed `cache-doctor.md`,
CHANGELOG written), staged deletion, `biome check --write apps/cli/package.json`
(`bin` stays `./`-free), release PR #265 (rebase-merge `9f04b54e`), tag
`v1.11.0` → `release.yml` run 28963925937 **fully green**: GitHub Release
(`mega.mjs` + `mega-1.11.0.mjs`) AND npm publish automatic.

Feature PR #264 **squash-merged** (`91f1d460`) — the branch carried a
`fix→revert→refix` churn from resolving the dependency-edge defect, so it was
squashed per §10 (no wip pollution on main); the atomic per-slice commits stay
in the PR history.

Smoke on the published artifact: `npx @megasaver/cli@1.11.0 --version` →
`1.11.0`; `mega cache --store <empty>` → the free-tier upsell line, exit 0
(command wired end-to-end in the shipped binary).

Sellable Pro surface now m1–m9. Next in the LOCKED 1.x→2.0 program: **1.12 =
N3 context firewall** (.env/keys/PII ingress guard + blocked-leak log), then
1.13 anomaly+budgets → 2.0 portable project brain. [[entities/cli]]
[[syntheses/release-history]] [[syntheses/pro-differentiation-portfolio]]

## [2026-07-08] build | module 10 — context firewall (1.12)

Implemented per docs/superpowers/plans/2026-07-08-context-firewall-plan.md
(subagent-driven, TDD per task): policy PII validators (Luhn/mod-97/TCKN) +
validate-gated patterns + email observer; `redact()` kept its 2-field public
contract, new `redactWithFindings()` for the firewall path;
`FilterOutputResult.firewall` carries counts out of the pure filter;
context-gate value-free ledger (schema `.strict()`, F-FW-1; best-effort writes,
F-FW-3) wired at 6 orchestrator ingress sites; pro-analytics `diagnoseFirewall`
(7-day window, top-10 blocked, pinned advice); `mega firewall` CLI (gate-first,
`--days` 1..3650, `--json` always JSON, ingress-surface footer). Detection +
ledger free/always-on; report Pro.

**The two-stage gate caught FOUR plan defects before any reached a commit or
main**: (1) the `redact()` shape change broke ~20 `.toEqual` tests → split into
`redactWithFindings`; (2) the F-FW-3 write-failure test never triggered a
failure (recursive mkdir on a writable temp root succeeds) → assert against a
pre-created firewall FILE; (3) a Luhn-invalid "valid" 19-digit test constant →
recomputed the check digit; (4) an `exactOptionalPropertyTypes` mismatch
(zod-inferred `string | undefined` vs analyzer `?: string`) that only `tsc`
surfaced at the full-suite level → widened `FirewallEventInput.sourcePath`.
Evidence: per-package suites green (policy 162, output-filter 380, context-gate
250, pro-analytics 124, cli 961 + 9 firewall); `pnpm verify` green. **Lesson:
a vitest-only per-task gate misses type errors — full `tsc` only runs at the
suite level, so a verbatim-passing file can still be type-unsound across a
package boundary.**

HIGH review (4 lenses: privacy/F-FW-1, checksum correctness, code, tests;
findings adversarially verified) returned **do-not-merge with 2 blockers** —
both real privacy defects the gate exists to catch: (1) **F-FW-1 breach** — the
exec ledger `sourcePath` used `redact()`, which only OBSERVES emails, so an
email in a command line (`mega run git log --author=x@y.com`) persisted
verbatim into the "value-free" ledger; fixed with a new `redactForLedger()`
(scrubs secrets + PII + emails) at all 6 sourcePath sites. (2) **IBAN
false-negative** — the gate regex was case-sensitive while `ibanValid` upcases,
so a valid lowercase IBAN leaked unredacted; fixed with the `i` flag. Both
fixed red-first (policy 166 tests incl. lowercase-IBAN + redactForLedger email
scrub), `pnpm verify` green, re-verified by a fresh privacy pass. Two
non-blocking follow-ups: the value-free `firewall` field leaks into
agent-visible output (token waste — deferred to a task chip) and one untested
CLI prose branch (fixed inline). **Lesson: an email is PII the feature itself
classifies, yet the output path only OBSERVES it (redacting emails corrupts
git/package metadata the agent needs) — so a value-free LEDGER label needs a
STRICTER scrub than agent-visible output. Two different redaction policies for
two different sinks.** Pending: PR + merge + 1.12.0 release. [[entities/cli]]

## [2026-07-09] release | 1.12.0 live — `mega firewall` (Pro module 10)

`@megasaver/cli` 1.12.0 published. Ritual unchanged (NO manual publish): feature
PR #269 **squash-merged** (`3080a4ae` — branch carried plan-fix + review-fix
churn); `pnpm changeset version` (consumed `context-firewall.md`), release PR
#270 (rebase-merge `c59dbd4b`), tag `v1.12.0` → `release.yml` run 28991816503
**fully green**: GitHub Release (`mega.mjs` + `mega-1.12.0.mjs`) AND npm publish
automatic. Note: the first watch-then-merge job exited early on a `gh pr checks
--watch` quirk (ubuntu passed, windows still pending) — re-armed, no failure.

Smoke on the published artifact: `npx @megasaver/cli@1.12.0 --version` →
`1.12.0`; `mega firewall --store <empty>` → the free-tier upsell line, exit 0.

Sellable Pro surface now m1–m10. Two follow-up chips left open: strip the
value-free `firewall` field from agent-visible output (token waste), and fix the
pre-existing `url_basic_auth` `@`-in-password fragment (shared with `redact()`).
Next in the LOCKED 1.x→2.0 program: **1.13 = N7 anomaly alerts + persistent
budgets** (m3 forecast's deferred extensions), then **2.0 = E5 portable project
brain** (signed `.megabrain` export/import — the anti-lock-in flagship).
[[entities/cli]] [[syntheses/release-history]]
[[syntheses/pro-differentiation-portfolio]]

## [2026-07-09] feat | 1.13 anomaly alerts + persistent budgets (module 11)

`mega alerts` + `mega savings budget set|show|clear` implemented on branch
`feat/cli-anomaly-alerts`. Spec `docs/superpowers/specs/2026-07-09-anomaly-alerts-budgets-design.md`
(approved, risk MEDIUM); plan `docs/superpowers/plans/2026-07-09-anomaly-alerts-budgets-plan.md`
(6 tasks). Key decisions/facts:

- **Detector** (`@megasaver/pro-analytics` `detectAnomalies`, pure, no I/O):
  median+MAD robust statistics over trailing UTC-day baselines that NEVER
  include today, five axes — traffic, per-source, saving-ratio collapse
  (lower-tail, ACTIVE-day baseline so zero-days don't blind it), firewall-event
  surge, and budget pace (reuses `forecastSavings`+`budgetPace`). MAD=0 flat
  baselines fall back to `4×median` with per-axis absolute floors (traffic
  50k tok, source 25k tok, firewall 5 events, ratio min-drop 0.15 + 256KiB).
  Constants spec-locked (window 30, min-history 7, k-MAD 3.5).
- **Budget store** (`@megasaver/stats` `budget.ts`, re-exported through core
  per §3c allow-list): `stats/budget.json`, Zod v1 schema, atomic write,
  corrupt-vs-absent distinguished (license.json precedent).
- **Forecast auto-load**: `mega savings forecast` reads the stored budget when
  `--goal`/`--period` are absent (explicit flags win); pace line reads "stored
  budget"; `--json` gains `goalSource` (`stored` | `flag`).
- CLI Pro-gated end to end on `savings-analytics` (even budget set/show/clear
  gate FIRST); `mega alerts` registered in `main.ts` before `cache`.

TDD throughout: budget store 8, detector suite, `savings-budget` CLI 8,
`alerts` CLI 9, forecast stored-budget block 7 (savings suite 37). `pnpm verify`
green. Pending: PR #271 → CI (ubuntu+windows) → rebase-merge → 1.13.0 release.
Next and final in the LOCKED 1.x→2.0 program: **2.0 = E5 portable project
brain** (signed `.megabrain` export/import). [[entities/cli]]
[[syntheses/pro-differentiation-portfolio]]

## [2026-07-09] release | 1.13.0 live — anomaly alerts + persistent budgets

Shipped to npm as `@megasaver/cli@1.13.0` (`latest`), tag `v1.13.0`,
release.yml auto-publish green (GitHub Release + npm publish, no manual
publish). PR [#274](https://github.com/haJ1t/MegaSaver/pull/274) rebase-merged
(CI ubuntu+windows green). The release bundles two earlier patch changesets:
#272 (firewall-field-strip) + #273 (url_basic_auth fragment).

**Review (§9.6, MEDIUM — separate fresh contexts):**
- code-reviewer **APPROVE** — detector math correct, F-FW-1 (value-free
  firewall axis) preserved, gate pattern correct on both new commands
  (checkEntitlement first, upsell exit 0, lazy import after gate; spy-enforced
  no free-path reads/compute), conventions clean, tests non-tautological.
- critic **REQUEST-CHANGES → resolved.** Mutation-tested the 7 detector guards;
  found the `>=floor` conjunct + strict-`>` boundary untested (every fixture used
  a flat MAD=0 baseline where `upperStats`' own fallback already forced
  threshold ≥ floor). Added 4 regression cases (traffic+firewall MAD>0
  sub-floor, `today==threshold`, non-trivial today-exclusion) — **proved they
  kill the exact surviving mutations** (M2→2 fails, M1→1 fail; commit e720073 /
  merged 50995986). All 6 construction probes (timezone/DST, determinism,
  overflow, prototype-key labels, week-boundary budget) already clean.

**Evidence:** `pnpm verify` green independently (52/52 turbo tasks, 985 CLI +
530 GUI + 251 context-gate tests). Entitled E2E smoke on a planted store:
forecast rendered "76% of your $20.00 stored budget (behind)"; alerts fired all
four axes ([traffic]/[source]/[firewall]/[budget]) with per-axis fix: advice.
Published-tarball smoke: `npx @megasaver/cli@1.13.0 mega alerts` runs the
entitled path (no crash). npm serves 1.13.0.

Consciously-accepted review nits (non-blocking): `writeBudget` fails loud on a
symlinked store dir (fail-closed is correct for the security guard); `parseDays`
`Number()` laxity verbatim from firewall.ts/cache.ts per §8; invalid `--period`
falls through to the stored period (pre-existing forecast coercion).

**LOCKED 1.x→2.0 program COMPLETE through 1.13.** Only **2.0 = E5 portable
project brain** (signed `.megabrain` export/import) remains — the anti-lock-in
flagship. [[entities/cli]] [[syntheses/pro-differentiation-portfolio]]

## [2026-07-09] feat | 2.0 E5 brain portability implemented (feat/brain-portability)

Full superpowers chain: spec → plan → subagent-driven TDD (10 tasks, fresh
implementer + spec-review + code-quality-review per task). New entity page
[[entities/brain-portability]]; portfolio status flipped E5 → IMPLEMENTED.

**Shipped** (branch, awaiting review+merge): `@megasaver/core` `brain-bundle.ts`
(2-line NDJSON, SHA-256 payload integrity, version/hash/schema error taxonomy) +
`brain-export.ts` (approved+project-scope filter, firewall `redactWithFindings`
over every free-text field, atomic serialize) + `brain-import.ts` (verify-before-
write, merge-only, `approval: suggested`, new ids, `supersedesId` dropped,
provenance→`evidence[]`, `source` preserved, project-scope+`\0`-key dedupe);
public API `exportBrain`/`importBrain`/`parse`/`serializeBrainBundle`. CLI
`mega brain export|import` gate-first (entitlement key `brain-portability`; free
path never opens store/file), atomic tmp+rename write, 100MB import cap, `--json`.
Changeset: cli **major** (2.0), core minor, entitlement patch.

**Review catches fixed RED-first** (per-task code-quality): null-manifest crash →
typed error; export not-found `Error`→`CoreRegistryError`; import dedupe scope leak
(session-content wrongly skipping project import) + space-join key collision → `\0`;
export missing atomic write + unwritable-`--out` handling; import untested size-cap →
injectable + tamper "nothing-written" assertion. Test-tsconfig branded-cast fixups.

**Evidence:** `pnpm verify` green (52/52 turbo). Entitled e2e smoke (real license
copied to temp store): export alpha → bundle w/ manifest+sha256 → import beta →
entry `approval:"suggested"`, new id, `evidence:["brain-import:alpha"]`, source
preserved. Free-path smoke: both commands upsell + exit 0, file never read.
Pending: reviewer+critic (HIGH §12) → PR → 2.0 release.

## [2026-07-09] feat | saver coverage wave 1 SHIPPED (feat/saver-coverage)

First of five gap-fix waves for the saver-savings-gaps audit (2.0 scope).
Full superpowers chain: spec → plan → subagent-driven TDD (7 tasks, fresh
implementer + spec + code-quality review each) + code-reviewer/critic gate.

**FIXED** (mark in [[syntheses/saver-savings-gaps]] on merge — page is main
working-tree only): A1 Task/subagent reports, A2 BashOutput/Monitor, A3
third-party `mcp__*` (mega's own bridge excluded via `/^mcp__megasaver__/i`),
A4 WebSearch/ToolSearch, A5 Grep files-mode/Glob filename arrays, A6 Bash
stderr (larger-stream slot), A7 mixed text/non-text content arrays; C11 dead
recovery path (`fetchChunk` now reads overlay chunk sets — CLI/daemon/bridge
all route through it), C13 no-recompress guard on `mega output chunk`, C15
`.DS_Store` scan guard. New surfaces gate at a 16 KiB conservative floor;
matchers anchored `^(?:...)$` (regression: `mcp__.*` had flipped CC to
unanchored regex, matching TaskCreate/ReadMcpResourceTool); `mega hooks
install` repairs a stale matcher in place.

**Review catches fixed RED-first**: fetchChunk DRY-delegated to fetchOverlayChunk;
export→CoreRegistryError parity; floor derived from a frozen ORIGINAL_TOOLS set
(drift trap) + tightened mega regex (`/^mcp__mega/i` false-excluded third parties);
filenames-rebuild empty-entry filter; combined stdout+stderr gate ceiling
documented as a follow-up; **matcher anchoring regression** (the load-bearing catch).

**Evidence**: `pnpm verify` EXIT=0. C11 integration roundtrip green. LIVE C11
repro: this session's own compressed chunk `a9c9e447-…` (previously
`error: store_corrupt: Invalid id.`) now recovers via
`mega output chunk a9c9e447-… 0` → "Chunk 0 … (lines 1-205, 10464 B)" + full raw.

Still open (later waves): C12 all-or-nothing chunk model, C14 GC, B8-10
eligibility, D16-20 ranking, E21-29 silent-failure, F30-34 metrics.
Deliberate v1 ceiling: combined stdout+stderr gating (spec non-goal).

## [2026-07-10] feat | saver recovery wave 2 SHIPPED (feat/saver-recovery)

Second gap-fix wave, STACKED on wave 1 (feat/saver-coverage). Full superpowers
chain: spec → plan → subagent-driven TDD (7 tasks, fresh implementer + review
each). C12 + C14 FIXED (mark in [[syntheses/saver-savings-gaps]] on merge —
page is main working-tree only).

**C12 (all-or-nothing chunk):** `record-output.ts` now splits the full redacted
raw into uniform 40-line chunks (`chunkByLines`, `id: String(i)`, contiguous
line ranges, byte-exact recovery — `chunks.join("\n") === raw` verified incl.
trailing newline). `OVERLAY_CHUNK_LINES = 40` single-sourced. Result gains
`chunkCount`; evidence `returnedChunkRefs` enumerates every chunk. Saver footer
N-aware, fetch-BY-ID: `Full output recoverable — stored in N chunks of ~40
lines each; fetch any with: mega output chunk "<set>" "<i>" (i = 0..N-1)`.
Deliberately NO line→id formula: chunks index the REDACTED stored text while
the agent reads original line numbers — a multi-line secret (PEM key) redacts
to one line, shifting the spaces apart (critic-caught; fetch-by-id is
redaction-agnostic). Single-chunk wording byte-identical to wave 1.

**C14 (no GC):** `pruneOlderThan` (content-store) now parses BOTH registry and
overlay schemas (overlay sets previously leaked forever — strict registry parse
rejected them), removes emptied dirs (rmdir-as-guard, isDir race-safe, rmdir
catch narrowed to ENOTEMPTY/ENOENT), `.DS_Store`/marker-file safe. Throttled
hook trigger `apps/cli/src/hooks/gc.ts maybeRunOverlayGc` — best-effort, ≤1/day
via `content/.last-gc` marker (touched before prune), swallow-all. Manual
`mega output gc [--days N]` (ungated housekeeping; 1-3650 day floor — CLI can
never nuke today's cache; deletes only schema-validating chunk-set json under
`content/`).

**Review catches fixed RED-first:** rmdir catch narrowed + isDir race-safe +
neither-schema/mixed-store tests (Task 1); ReturnedChunkRef type reuse + cast
drop (Task 2); footer readability "— stored in" separator (Task 3); GC stampede
comment softened to admit the benign simultaneous-check race (Task 4); citty
`resolveStorePath` guarded via mapErrorToCliMessage — was crashing raw on
`--store ""` (Task 5). Wave-1 C11 roundtrip test updated for the multi-chunk
model (chunk 0 = first slice, line 2999 recovered via chunk 74).

**Evidence:** `pnpm verify` EXIT=0 (52/52 turbo). C12+C14 integration roundtrip
green (200/3000-line → multi-chunk fetch → prune removes → cold). CLI smoke:
`mega output gc` help/--json/--days/bad-days-exit-1 all clean, registered in the
`output` group. Pending: code-reviewer + critic → stacked PR.

Still open (later waves): B8-10 eligibility, D16-20 ranking, E21-29 silent-
failure, F30-34 metrics. Deferred v1 ceiling: `around`/line-window fetch, size/
count-based retention, daemon periodic GC (spec non-goals).

## [2026-07-10] feat | saver eligibility + ranking wave 3 SHIPPED (feat/saver-eligibility)

Wave 3 of [[syntheses/saver-savings-gaps]] — B8-10 (eligibility) + D16-20
(ranking) — on `feat/saver-eligibility`, stacked on wave 2. Spec/plan:
`docs/superpowers/specs/2026-07-10-saver-eligibility-ranking-design.md`,
`docs/superpowers/plans/2026-07-10-saver-eligibility-ranking-plan.md`.

**B8 dead band closed** — the hook's `minBytesFor` gate is now the single
eligibility authority. `record()` forwards it as `compressFloorBytes`;
`recordAndFilterOverlayOutput` derives BOTH filter token thresholds from it
(`ceil(floor/4)`, fallback `modeToBudget`). No output past the gate can land in
a passthrough/light band and be discarded. Daemon `/excerpt` accepts the same
optional field (context-gate + daemon).

**B9 safe-mode Bash** — `apps/cli/src/hooks/saver.ts BASH_COMPRESS_FLOOR=24000`;
`minBytesFor` caps Bash at 24000 B (below Claude Code's ~30000-char Bash
truncation ceiling). Aggressive/balanced unchanged; Read/Grep/Glob safe stays
32000.

**B10 semantic chunking live** — `record-output.ts` passes `source` (raw label,
extension preserved) into `filterOutput`, so `.ts/.py/.go/.rs/.md/.json` reads
chunk on AST boundaries instead of blind 40-line slices. Daemon path fixed for
free (same function).

**D16 source-order rendering** — `returnedTextOf` sorts excerpts by startLine
and emits `… [lines A-B omitted]` gap markers (leading/interior/trailing). Line
numbers walk the excerpts' own (post-collapse) space via a new
`FilterOutputResult.chunkedLineCount` — a review CRITICAL: the first cut mixed
raw-space total with normalized-space excerpts, yielding phantom
`lines 45-4040 omitted` tails on collapsed output; fixed RED-first.

**D17 per-session intent + TTL** — `intent-run.ts` writes
`stats/<ws>/intent/<sessionId>.json` (session_id from the UserPromptSubmit
payload, `SAFE_SEGMENT`-guarded against path traversal) plus the legacy
`session-intent.json` (id-less/old-binary compat). Reads session-first with a
30-minute TTL (the `ts` field was written but never read before). GC sweep
prunes stale intent files. Conscious-accept: scoped→legacy fallback keeps a
narrow cross-session contamination window (session idle >30 min), retained for
id-less compat.

**D18 Unicode tokenizer** — extracted `output-filter/src/tokenize.ts`
`tokenizeForMatch` (lowercase → NFD → strip marks → dotless-ı fold →
`\p{L}\p{N}` split); rank.ts AND compress/json.ts (the D18 twin) both use it, so
Turkish prompts rank instead of shattering. ASCII byte-identical.

**D19 repo-local mode floor** — committed `.megasaver/policy.json`
`{modeFloor}` (strict Zod, fail-open) clamps the resolved mode at the SINGLE
resolver chokepoint (`resolveWorkspaceTokenSaverSettings` → `policyClamp`).
`mega session saver enable` warns; `resolve` shows the clamp. This repo commits
`{"modeFloor":"balanced"}` — a HIGH-risk source repo must not run
evidence-dropping aggressive compression (§12). `.gitignore` un-ignores only
`policy.json`; runtime `.megasaver/` files stay ignored.

**D20** — conscious-accept: B10 routes `.md` file reads to semantic chunking
(the wiki-startup-read breakage), so the prose compressor's 3-item list / para
collapse stays as-is for fetch/command prose (recoverable via footer).

**Review catches fixed RED-first:** D16 line-space CRITICAL (phantom omitted
tails → chunkedLineCount); T5 missed a `ResolverDeps` test literal + a daemon
`exactOptionalPropertyTypes` spread break (both broke `pnpm verify`, fixed);
D18 twin tokenizer in compress/json.ts (shared module); D16 fixture FATAL not in
error lexicon. Subagent-driven: fresh implementer per task + spec/quality review
each; adversarial catches were the D16 line-space bug and the two verify breaks.

**Evidence:** per-task RED→GREEN captured; full `pnpm verify` pending final run.
Pending: code-reviewer + critic → stacked PR.

Still open (later waves): E21-29 silent-failure/observability, F30-34 metrics
honesty.

## [2026-07-10] fix | B9 follow-up — BashOutput/Monitor share Bash's ceiling

Extended wave-3 B9 (commit 5c171b54) beyond the literal `Bash` tool:
`BashOutput`/`Monitor` retrieve background-shell output that shares Claude
Code's ~30000-char truncation ceiling (undocumented — confirmed via
claude-code-guide that BashOutput/Monitor/Task limits aren't published; Bash's
30000 is). Their safe-mode floor (32000) sat above the ceiling → never
compressed (same dead zone B9 fixed for Bash). `minBytesFor` now caps
`BACKGROUND_SHELL_TOOLS = {BashOutput, Monitor}` at 24000 for safe mode while
keeping the 16384 new-surface floor for aggressive/balanced. Task is left
uncapped: subagent reports aren't shell-truncated (GitHub #12054 suggests
unbounded), so large reports already clear 32000. Closes the final code-review
Minor. Safe-direction: if the ceiling assumption is wrong it only compresses
smaller background logs, fully recoverable.

## [2026-07-09] audit | saver savings gaps — 46 confirmed findings

Live-session check first: hooks DO fire (repo-local cwd-scoped store
`.megasaver/hooks/claude-tool-calls.jsonl`, 23 entries session `ae662232`),
saver DOES compress Reads 87-92%. Earlier "not saving" diagnosis was wrong
(stale-store mtimes + self-excluding find filter + live footer misread as
file content / false prompt-injection alarm — retracted with grep proof).

Then 55-agent workflow (7 finder dimensions -> per-finding adversarial
refuters): **46 confirmed / 2 refuted** gaps-bugs-edge-cases blocking extra
saving. Full dedup + citations: [[syntheses/saver-savings-gaps]].
Headliners: Task/subagent reports + BashOutput + all mcp__* tools never
compressed (TOOL_SOURCE 6-entry cap, saver.ts:11-18); aggressive-mode
4001-7999B dead band; recovery dead end-to-end (footer advertises
proxy_expand_chunk but no MCP server registered in session; all-or-nothing
chunk "0" makes expansion worse than no compression); intent tokenizer
ASCII-only (Turkish prompts -> ranking inert); every failure fail-open with
green doctor; footer tokens excluded from savings math (over-reporting).
Priority pointer in the page. Candidate feed for post-2.0 backlog next to
E5 megabrain.

## [2026-07-09] decision | 2.0 scope: saver-gap fixes join E5

User directive: the 46 confirmed saver-gap findings
([[syntheses/saver-savings-gaps]]) are scoped INTO the 2.0 release,
alongside E5 portable project brain. Portfolio status updated
([[syntheses/pro-differentiation-portfolio]]); gaps page gained a
"Release scope" section. Priority order A1/A2/A3/C11-13/B8/E23.

## [2026-07-09] fix | Memory visualization layout uses available page width

The GUI Memory page now presents notes beside a fluid graph column at the
desktop breakpoint, with Decision Trace spanning the full row beneath. Both
visualizations have a minimum usable canvas height and collapse back to one
column on smaller screens. No bridge or Core contract changed.

Source: `docs/superpowers/specs/2026-07-09-memory-visualization-layout-design.md`.

## [2026-07-10] investigation | "Saver cache corruption" root-caused: no cache bug exists

Forensic investigation (4 parallel agents: transcript, live config, store,
controlled repro) of the wave-3 session's "fabricated/stale tool outputs":

1. **Stale-cache hypothesis REFUTED.** Installed hook path
   (`runSaverHookFromProcess` → `recordAndFilterOverlayOutput` → `filterOutput`,
   mega.mjs 1.12.0 bundle) has no cache/recall lookup returning prior content.
   Controlled repro: identical `cat` 20s apart after rewriting the file produced
   two distinct chunk sets, second output contained only the new content. All 15
   of the day's overlay events had unique chunkSetIds; stored raws for every
   suspicious call matched fresh truth at capture time.
2. **"Fabricated git" outputs were self-inflicted, not product corruption.**
   The session shell cwd silently flipped from the saver-eligibility worktree to
   the main repo (transcript L3709, 11:37:59Z); every later relative-path git
   command truthfully reported main-repo state (HEAD 4c08de03, 204-line
   saver.ts, wave SHAs not ancestors). The "MISSING" verdicts were a script
   mislabel: `git merge-base --is-ancestor || echo MISSING` conflates
   not-an-ancestor with missing object. None of these outputs carried a saver
   footer — the hook never touched them.
3. **One real corruption confirmed = D16, already fixed on the branch.** The
   live 1.12.0 hook (registered globally in `~/.claude/settings.json`, matcher
   `Read|Bash|Grep|Glob|LS|WebFetch`) renders kept excerpts score-ordered with
   bare joins and no elision markers — a subagent's `gh pr view 278`
   (12043→4017 B, "1 kept, 0 dropped") and a `cat saver.ts` repro ("2 kept,
   6 dropped", splice starts mid-expression) both read as complete output while
   fragments. Live bundle greps: `BASH_COMPRESS_FLOOR`=0, `chunkedLineCount`=0,
   elision markers=0. Wave 3 (PR #278, D16 source-order + `… [lines A-B
   omitted]` markers) fixes exactly this; strongest possible dogfood evidence
   for merging the stack.
4. **Side findings.** (a) Two stored events raw=exactly 30000 B — Claude Code's
   Bash truncation ceiling visible in the store, validating B9's 24000 floor.
   (b) The MCP proxy pipeline (not the hook) has prior-content paths: read-index
   contentHash short-circuit + shown-excerpt dedupe (mega.mjs ~237113, ~237017)
   — no bug found, but the only place stale semantics could ever arise; candidate
   for a wave-4/5 guard test. (c) Live binary is 1.12.0 (homebrew), one release
   behind 1.13.0.

Store: `~/.local/share/megasaver`. Session: ae662232 (wave-3 worktree session).

## [2026-07-10] release | Saver waves 1-3 merged to main (PRs #276-#278)

The saver-savings-gaps stack landed on main via fast-forward push
(origin/main 9f2caaf7 → 3f18e44a): wave 1 coverage (#276), wave 2 recovery
(#277), wave 3 eligibility + ranking (#278, B8-B10 / D16-D19 fixed, D20
conscious-accept, B9 follow-up caps BashOutput/Monitor). `pnpm verify` was
green at 3f18e44a before merge; the merged tree is byte-identical. Remote
feature branches deleted. Remaining for 2.0: wave 4 (E21-29) and wave 5
(F30-34); PR #275 (brain portability) still open, independent.

## [2026-07-10] feat | Saver observability wave 4 (E21-E29)

Branch `feat/saver-observability` (worktree). Theme E of the audit fixed:
a dead saver no longer looks healthy.

- E21: heartbeat registry grew parallel ledgers — `completions` (strict-newer
  per workspace), `failures` ({count, lastAt, lastKind} with coarse kind
  payload/resolve/record/unknown; count never lost), `daemonFallbacks`.
  Written best-effort from buildSaverDecision's new wrapper (completion on
  every non-throwing finish, failure with stage on throw) and makeRecord's
  daemon-POST-failed branch. Surfaced in `mega session saver resolve` (two
  text lines + three JSON fields).
- E25/E26: new `withFileLock(lockPath, {deadlineMs, staleMs}, fn)` in
  @megasaver/shared (its first fs module) — a lock file older than staleMs
  (5 s) is stolen as dead-holder residue. Heartbeat lock delegates to it
  (10 ms deadline kept); appendOverlayEvent's summary read-modify-write runs
  under `<summary>.lock` (50 ms deadline; on contention the summary write is
  skipped — the JSONL line is already durable).
- E24: overlay summaries self-heal — a corrupt summary is rebuilt from the
  corruption-tolerant events JSONL and stamped `rebuiltAt`
  (secretsRedactedTotal/chunksStoredTotal reset to 0: events do not carry
  them — a documented liveness trade). The daily GC sweep now runs
  reconcileOverlaySummaries: any summary that fails schema or whose
  eventsTotal lags its JSONL line count is rebuilt (repairs E26 lock-skips
  permanently).
- E23/E29: hook commands are registered as the absolute invoked CLI path
  (argv[1] launcher, quoted iff whitespace) with explicit timeouts (saver
  30 s, log/intent 10 s); a non-default store is baked as `--store "<abs>"`.
  Matching is by `hooks <sub>` suffix, so re-install migrates legacy bare
  entries in place and uninstall removes every historical form.
- E22: `mega doctor` gained runSaverChecks — registration (missing saver =
  FAIL, exit 1), binary exists+X_OK plus a --version-vs-CLI-version WARN
  sub-check, baked-store vs CLI-store split-brain
  WARN, heartbeat liveness (failures without a newer completion = FAIL),
  self-test (spawns the exact registered command with a synthetic
  doctor-selftest payload, asserts exit 0 + heartbeat advance), daemon ping
  (INFO only, via discovery file).
- E27/E28: `mega hooks status <id>` falls back to the overlay keyspace and
  renders a labeled "Live hook session (overlay)" block; the new no-arg form
  prints per-workspace totals, a TOTAL line, and per-workspace heartbeat
  recency (invoked/completed/failures).
- Guard test pins the proxy read-index short-circuit seam (changed content
  must never reuse the prior chunk set; outline slot separate). The T9
  read-index guard test (packages/context-gate/test/read-index-invalidation.test.ts)
  is a structural proxy; the same invalidation invariant already has stronger
  end-to-end coverage in packages/context-gate/test/run.test.ts
  (diff-on-reread suppression).

Verification: `pnpm verify` green at the wave-4 tip (code tip c5efd99b; this
T10 commit folds a bracket-access + biome-ignore reconciliation into the T2
heartbeat test — noPropertyAccessFromIndexSignature vs useLiteralKeys — so the
full gate passes: biome, tsc, 52-package vitest, conventions:check). Plan:
docs/superpowers/plans/2026-07-10-saver-observability-plan.md. Spec:
docs/superpowers/specs/2026-07-10-saver-observability-design.md.

## [2026-07-11] feat | Saver metrics honesty wave 5 (F30-F34)

Wave 5 (final) of the saver-savings-gaps program, branch
`feat/saver-metrics-honesty` (spec
`docs/superpowers/specs/2026-07-11-saver-metrics-honesty-design.md`).

- F30 — honest delivered-bytes accounting: `recordAndFilterOverlayOutput`
  now computes persisted `returnedBytes`/`bytesSaved`/`savingRatio` from
  the FINAL delivered text (summary + excerpts + D16 markers + recovery
  footer). The footer moved into context-gate as the canonical
  `buildRecoveryFooter` (new `recovery-footer.ts`, also home of
  `looksPreTruncated` and `OVERLAY_CHUNK_LINES`); the saver hook and the
  daemon `/excerpt` opt in via `includeFooter: true` and emit
  `returnedText` verbatim. Net-negative guard: if the delivered
  replacement would be >= raw, record degrades to passthrough BEFORE any
  side effect (no chunk set, no event, no evidence). Footer display uses a
  <=2-iteration fixed point (digit-width drift tolerated, persisted
  numbers exact).
- Contract adjustment vs spec: the spec's `footerTemplate` callback was
  replaced by the canonical in-package footer + `includeFooter` boolean —
  a function value cannot cross the daemon HTTP boundary
  (architect-approved at plan time).
- W5-extra — overlay events now carry `secretsRedacted`/`chunksStored`
  (optional, strict schema keeps old rows parsing); rebuilds fold them so
  an unreadable summary loses nothing post-wave-5 (carryForward still wins
  when the prior summary is loadable). Reconcile drift-counts schema-valid
  lines only — the garbage-line rebuild-every-sweep ponytail is gone.
- F32 — `readProxyUsage` reads usage.jsonl tolerantly (torn lines skipped
  + counted; `listProxyUsage` delegates); `mega audit usage` prints
  "N unreadable usage lines skipped".
- F33 — audit usage ratios are scope-matched: GLOBAL savings (all
  `stats/<wk>/` dirs summed) over global usage, per-workspace savings
  breakdown without ratios, and a ready scoped-ratio branch for usage rows
  carrying the new optional `workspaceKey`. Resolution recorded: the proxy
  has NO per-request workspace signal today (single global listener), so
  the writer never stamps the key — the field is reserved, the fallback is
  the labeled global bucket.
- F31 — supervisor `monitorTick` re-applies an ABSENT route when the
  listener is healthy (lease kept, no block), bumps persisted
  `routeReapplies`/`lastRouteReappliedAt` in runtime state; foreign values
  are never overwritten (adapter value-guard). New doctor check
  `saver-proxy-route`: FAIL on blocked route while enabled, churn WARN on
  `routeReapplies > 0`.
- F34 — `proxy_mediated_token_savings` renamed to
  `saver_mediated_token_savings` (no shim, pre-1.0); `hooks status` says
  "saver-mediated savings"; `session saver stats` mediation is
  `saver_hook` (was a hardcoded `proxy`); audit usage carries "note: the
  proxy meters usage; savings come from the saver hook/tools."

## [2026-07-11] plan | brain-sync (E7) spec + plan land on feature branch
Post-2.0 ideation locked path B+C; 2.1 = E7 `mega brain sync` (BYO S3,
E2E-encrypted, keyfile). Spec (CRITICAL, architect-pass revised) +
16-task TDD plan + growth portfolio synthesis brought onto
worktree-brain-sync from local main (commits fe2752ea/1bf6ca17).
Execution: subagent-driven.


## [2026-07-11] feature | brain-sync (E7) implemented
`mega brain sync` built on `worktree-brain-sync`: `@megasaver/brain-sync`
(AES-256-GCM crypto + keyfile/recovery-code + config + manifest + transport +
CAS sync engine) + 5 CLI commands, 16-task TDD plan executed subagent-driven.
CRITICAL review findings fixed inline: projectId-AAD cross-project binding,
config lastSeen lock, transport SDK-error wrapping, init key-print/write-order,
vacuous-guard replacement. Bundle: `@aws-sdk/client-s3` externalized from
`mega.mjs` (inlining breached the 12MB guard). Pending smoke + user approval.

## [2026-07-11] gauntlet | brain-sync (E7) — 2 design BLOCKERS found
Whole-branch CRITICAL gauntlet (3 fresh-context passes) on worktree-brain-sync:
- code-reviewer: APPROVE, 4 minors (dead conditional_writes_unsupported code,
  unused brainSyncConfigSchema export, dup s3-double helper, endpoint not
  rechecked on read path).
- security-reviewer: YES-with-fixes. Crypto core SOUND (AES-256-GCM, fresh
  IV, projectId-bound AAD, 0600 keyfile, env-only creds, SDK-error scrubbing,
  2-condition CAS probe). Must-fix M1: bootstrap push when remote==null &&
  lastSeen>0 silently resets rollback floor (route to reset instead). L1:
  re-assert assertSafeEndpoint on read path. L3/L4: spec threat-model honesty.
- critic (adversarial): TWO BLOCKERS.
  * BLOCKER 1 (CONFIRMED): cross-machine project-id mismatch. prefix+AAD keyed
    on LOCAL random project UUID (project.ts:149, common.ts:64); recovery code
    carries only key, no project id. Two machines' "same" project get
    different UUIDs -> different remote prefix + incompatible AAD -> cannot
    sync. Two-machine test passes ONLY by hardcoding one PROJECT_ID into both
    stores — a precondition the real product can't produce. Feature does not
    achieve its stated cross-machine goal end-to-end.
  * BLOCKER 2: approval-asymmetry regresses remote. exportBrain=approved-only,
    importBrain writes suggested, push=full-overwrite. B pulls A's approved M
    (lands suggested), B pushes approving nothing -> M dropped from remote ->
    durability hole; a third joiner pulls memory-less bundle.
  * HIGH: sync reset deletes manifest but not local last-seen -> sibling B's
    next pull sees gen1<lastSeen5 -> false rollback_detected -> stranded.
Status: IMPLEMENTATION complete + internally rigorous (62 pkg + 21 CLI tests,
verify green), but BLOCKED on design decisions for B1/B2. NOT merged. Smoke +
user release approval deferred until blockers resolved. Escalated to user.

## [2026-07-11] gauntlet-fix | brain-sync (E7) — 2 blockers CLOSED
User approved fixing B1+B2 (name-derived brainId mechanism). Implemented:
- B1: brainId = sha256(key ‖ normalize(projectName)) replaces local project
  UUID for remote prefix + AAD + lastSeen (engine e748a138 + CLI da8f18be).
  Two-machine test REWRITTEN to same-name/different-local-id -> proves
  cross-machine sync (RED->GREEN: revert to localProjectId fails it).
- B2: push refuses pending sync-imported suggestions (brain-import provenance)
  unless --force -> no silent remote regression.
- HIGH/M1: reset clears local lastSeen (clearLastSeen); push refuses bootstrap
  when remote absent && lastSeen>0 -> rollback_detected + reset hint (both
  paths). L1: assertSafeEndpoint on read path. Minors: typed
  conditional_writes_unsupported, dropped unused schema export.
Re-verify (fresh adversarial): ALL 3 blockers CLOSED, no new Critical/High;
config 64-hex + AAD binding consistent; no id misuse. Full repo pnpm verify
exit 0. brain-sync 69 tests, cli brain-sync 24, full cli 1110 pass.
REMAINING (user-gated): real-endpoint (MinIO/R2) smoke evidence + explicit
user release approval before merge/PR.

## [2026-07-11] pr | brain-sync (E7) draft PR #282
Pushed worktree-brain-sync -> origin/feat/brain-sync; opened DRAFT PR #282
(https://github.com/haJ1t/MegaSaver/pull/282). Held draft: real-endpoint
smoke + user release approval remain before ready/merge. No merge, no publish.

## [2026-07-12] review | brain-sync (E7) PR #282 final review + fixes
In-session final review (code + security, fresh contexts) on the post-gauntlet
state. Code: MERGE-READY (only stale docs — projectId->brainId reconciled in
wiki entity + spec body/threat-table, 40181e1e). Security: crypto SOUND
(deriveBrainId keyed-hash verified, no key leak/AAD injection, no gauntlet-fix
regression), YES-with-fixes. Found + FIXED [Medium] B2 merge-during-push window
(73197d39): push's internal merge could drop a never-pulled machine's unseen
remote entry past the pre-push guard -> now CLI push pull-merges FIRST, then
guards, then publishes; RED->GREEN proven (remove `await pull` -> silent loss
returns). + NFC normalize in brainId (prevents Unicode-equivalent name forks).
Also PR #283 (embeddings ESM-blind lazy-load guard fix) MERGED to main.
brain-sync 70 tests, cli 1111. PR #282 still draft: real-endpoint smoke +
user release approval remain.

## [2026-07-12] release | brain-sync (E7) SHIPPED in 2.1.0
`@megasaver/cli@2.1.0` published to npm + GitHub Release v2.1.0 (release.yml
green). Real-endpoint smoke PASS on live MinIO (two machines, different local
ids, same name → converged; Pro license signed with launch key for the gate).
PR #282 squash-merged; version bump 09d04c65 direct-pushed to main; tag v2.1.0.
brain-sync 0.2.0 (private, bundled into cli). E7 = mega brain sync complete.

## [2026-07-12] implement | warm-start (i8)

Executed docs/superpowers/plans/2026-07-12-warm-start-plan.md — 13 TDD tasks
in worktree worktree-warm-start. Core: assembleWarmStartBrief (pure, budgeted,
micro/standard/reonboard modes) + per-project lastSeenAt freshness stamp.
Stats: separate WarmStartEvent (measured brief size, never a TokenSaverEvent).
Delivery: fail-open Claude Code SessionStart hook (mega hooks warmup), mega
warmup CLI, Pro-gated cross-agent sentinel block (mega warmup --write) +
connector sync refresh, MCP get_warm_start_brief. Savings surfaces show a
measured "Warm start" line. All tasks reviewed (spec+quality) green; pending
HIGH-risk gauntlet (code-reviewer + critic) + finish-branch.

## 2026-07-13 — i7 Mistake Firewall (guard) SHIPPED
Feature complete on feat/guard (stacked on feat/warm-start). 14 TDD tasks,
each spec+quality reviewed green; HIGH-risk gauntlet pending. Core: durable
bounded guard corpus (context-gate, captured on proxy failure path) + pure
3-tier matcher guard-match.ts (T1 exact/deny-capable, T2 path+text/warn, T3
BM25/warn; GUARD_T3_MIN_SCORE tuned 1.5→1.2, 0.21 precision headroom verified)
+ guard state (mode/mutes/cooldown/intercepts) + guard events (stats, separate
from TokenSaverEvent — honest metrics). Delivery: fail-open PreToolUse hook
(mega hooks guard), install-by-default with --no-guard, outcome loop in the
saver process (signature-overlap classify + 3-strike auto-mute), mega guard
status/mode/mute/unmute/events/check CLI, check_approach MCP (34th tool) with
free 7-day cap also applied to find_similar_failures, retry-cost-avoided line
in roi/savings (estimated, never summed into measured savings), connector block
seeding instructions. Free = warn interception; Pro (savings-analytics key) =
strict deny + events ledger + cumulative analytics. Smoke: end-to-end warn
emitted for a recorded failure. Latency: hook p50 240ms = identical to shipped
saver (240ms) / warmup (250ms) hooks — same cli.js bundle-load cost, within the
PreToolUse 10s budget; user accepted, daemon fast-path deferred (spec §9, shared
across all hooks). additionalContext PreToolUse support is a spec assumption
(§4.1) — hook emits the documented shape; validate in a real Claude Code session.
Known deferred: --no-guard/--no-warmup citty negation bug (spawned follow-up task).

### Gauntlet (2026-07-13)
HIGH-risk dual review on the full diff. code-reviewer APPROVE. Adversarial
critic found 1 BLOCKER + 2 MAJOR (repro-proven): (B) guard events+state stored
the RAW agent command — a T3 fuzzy match on a secret-bearing command leaked the
token to disk / mega guard events; (M) strict deny consumed the session cooldown
so a bare retry bypassed the block; (M) normalizeCommand stripped env prefixes,
false-denying NODE_ENV=prod npm build. All three fixed (commit 70c59f81): redact
before persist on both hook + outcome-loop lookup, deny keeps firing until
mute/mode-warn, env prefixes preserved (also kills an ENV_PREFIX RangeError).
Verifier re-pass: all RESOLVED with on-disk evidence, no regressions, verify
52/52 green, CLEAR TO MERGE. Follow-ups noted: (1) --no-guard/--no-warmup citty
negation (spawned task); (2) LOW: deny events append per retry (bounded,
redacted, slightly inflates guard status deny count).

## 2026-07-13 — i1 Living Brain SHIPPED (feat/living-brain, stacked on feat/guard)

Auto-superseding memory save path + lineage recall + time-travel. 16 TDD
tasks, subagent-driven (fresh implementer + fresh reviewer each; Tasks 5/7/14
opus-reviewed as security-load-bearing). verify 52/52 green.

Grounding: 6-agent survey + fresh architect pass on the spec found 5 MAJORs,
all fixed pre-implementation: (1) declared-target exemption — without it the
approve quarantine gate blocks the flip on an auto-linked suggested row, so
auto-supersede was dead on arrival; (2) deterministic detection (threaded
`now`, max-raw-cosine over top-K not decay-weighted #1); (3) born-approved
close ladder — weak lexical `supersession` class can NEVER close at save,
only `contradiction`/cosine/explicit `--supersede`; (4) recall write-back for
`lastActiveAt` CUT from v1 (hot read path must not rewrite the store);
(5) from-session detection exempted (mass auto-link risk).

Shipped: core `supersession.ts` (applySupersession close, detectSupersession
lexical+cosine, buildLineage cycle-guarded, changedFromFor, saveMemoryWithLineage
close ladder); `lastActiveAt` decay rekey (legacy rows bit-identical, snapshot
pinned); approve-memory declared-target exemption + `superseded` disclosure;
save_memory best-effort cosine wiring; from-session twins detect:false;
`changedFrom` on 4 recall surfaces (get_relevant_memories, mega_recall,
connector block, warm-start brief); connector sentinel guard on
`changedFrom.title` (architect #1 injection fix — opus-verified closed);
`mega memory history` (PRO) / `reopen` (FREE) / `search|list --as-of` (PRO
per-flag) / `explain` lineage section / create `--supersede`+`--no-auto-supersede`.

E2E smoke (captured): weak-class create → note-only (no close); explicit
`--supersede` → close + `note: superseded … — undo: mega memory reopen …`;
search drops the closed row; `--as-of` free → PRO upsell exit 0; `history`
free → "1 prior versions. …"; `explain` shows lineage; `reopen` restores;
reopen-not-closed → exit 1.

Deviations recorded in spec: `--no-auto-supersede` (citty kebab negation),
`via:"explicit"`, changedFrom date sliced to day, born-approved auto-close
narrow (explicit is the human gate). ACCEPTED-for-v1 asymmetry flagged for the
gauntlet critic: CLI `mega memory approve` closes without the MCP path's
evidence/conflict quarantine (guarded by applySupersession structural check +
stderr disclosure + reopen + physically-human-typed). Out of scope: recall
write-back, from-session detection, LLM-confirm band, GUI history scrubber.

### Gauntlet outcome (2026-07-13, same day)

HIGH-risk gauntlet (fresh code-reviewer + adversarial critic, both opus, full
branch diff) found the CLI-approve asymmetry to be LOW/accepted, but surfaced
a NET-NEW critical BLOCKER the per-task reviews missed at the seam:

- BLOCKER (fixed 9c12cd98): `save_memory` (agent-callable MCP) let an agent
  forge `approval:"approved"` + agent-controlled `supersedesId` → the
  born-approved immediate-close ladder closed ANY same-project/scope approved
  rule with one call, no human, no disclosure. Broke spec §9.1. Root-cause
  fix: `saveMemoryWithLineage` gains `allowImmediateClose` (default false);
  the save-time `applySupersession` fires only for physically human-typed CLI
  writers (create, task status). Agent save_memory defers the close to the
  human `approve_memory` path (declared-target exemption, unchanged).
- MAJOR (fixed ed071444): `lastActiveAt` was never stamped at create, so the
  decay rekey was a no-op for real rows (approve-flip still reset age). Fixed
  by stamping `lastActiveAt = createdAt` in both `createMemoryEntry` impls.
- MINOR (fixed f70693cb): explicit `--supersede <invalid>` now discloses the
  no-op on stderr.

Fresh-context verifier re-pass (opus): both defects RESOLVED (re-ran both
attack vectors → defer; real create→approve age unchanged), intended flows
intact, no over-correction, no regression, verify 52/52 non-cached. CLEAR TO
MERGE. Spec §4.5 note records the accepted CLI-approve asymmetry.

## [2026-07-14] ship | i6 Code-Truth Verify

Branch `feat/code-truth` (stacked on `feat/living-brain`). 18 TDD tasks,
subagent-driven (fresh implementer + fresh reviewer per task; Tasks 4/5/7/11/14/15
opus-reviewed as security/correctness-load-bearing). `pnpm verify` green (52/52).

Shipped: core `memory-anchor` (schemas + best-effort `captureCodeAnchor`) and
`code-truth` (pure `verifyAnchors` planner + `runVerify` git runner) modules;
whole-batch `applyMemoryEntryPatches`; `closedByCodeTruth` close-ownership guard
(heal never reopens a lineage-owned close); `STALE_WEIGHT` down-rank;
`output-filter.extractBlocksForFile` polyglot export; `mega memory verify` (free)
+ `--install-hook`/`--uninstall-hook` (Pro, sentinel-block confined) + sweep
verify pre-pass (Pro); `--symbol` writer plumbing + anchor capture on all writers
(`--no-anchor` opt-out); show/explain anchor + badge; MCP `save_memory` symbol
anchors + `get_relevant_memories` badge + Pro pre-recall spot-check (excludes
contradicted, sentinel-guarded disclosure, inline fail-open flip) +
`verify_memories` tool; stale-recall-avoided stats ledger + savings line; new
`code-truth` ProFeature key.

Per-task reviews surfaced + fixed before merge: Task 7 gauntlet found a PROVEN
BLOCKER — a `cat-file --batch-check` FATAL/timeout mapped every anchored path to
"missing", mass-closing every file-anchored memory on a large-repo timeout; fixed
to degrade to `unanchored` + zero writes. Also hardened: anchor-path control-char
rejection at the schema boundary (cat-file stdin injection vector); extractor-throw
treated as `undetermined` not missing (false-contradiction hole); `save_memory`
agent-forge negative tests (no agent-supplied anchor/lastVerified); spot-check
inline fail-open (no floating promise in the stdio server).

Deviations recorded in spec §15. Full-branch gauntlet (fresh opus code-reviewer +
adversarial critic) run at merge time.

## [2026-07-14] gauntlet | i6 Code-Truth Verify — cleared

Full-branch gauntlet: fresh opus code-reviewer + adversarial critic over
`feat/living-brain...feat/code-truth`. Two independent BLOCKERs + one MAJOR
found at the task seams (per-task reviews missed them):

- BLOCKER (reviewer): multi-head re-contradiction clobbered `closedByCodeTruth`
  (true→false) so a later heal never reopened `validTo` — memory silently
  stuck closed after the code was restored (common case; reachable via free
  `mega memory verify`). Executable repro. Fixed 103f1210.
- BLOCKER (critic): disk-read faults (readFileSync/statSync throw) failed
  CLOSED — a transient FS error (EMFILE/EACCES) or a `git mv` rename → false
  "file missing" → close → silent recall data loss. Same mass-false-close class
  as the Task-7 cat-file finding, at a different catch site, both runVerify and
  the spot-check. Fixed 5ac7877a (branch on err.code: ENOENT→delete,
  transient→undetermined; spot-check never closes from a disk fault).
- MAJOR (critic): runVerify planned from an UNLOCKED snapshot then applied
  absolute-value patches under the lock → the post-commit hook (a separate
  process on every commit) racing the MCP server lost evidence and could
  reopen a lineage-owned close. Fixed d7414b21 — new
  `applyMemoryEntryMutations` recomputes evidence/open/ownership from the
  in-lock fresh row; the cross-process lock is never held across git I/O.
- MINORs fixed: ledger double-count on persistent close-write failure
  (f41edbd8); concurrent-delete aborting the whole batch (dd5bcb80);
  runVerify/spot-check divergence on unsupported-extension symbols (8d367399);
  dead anchor scaffolding in task status (5c2ee31f); changed-paths diff
  missing `core.quotePath=off` (7fb1d140).

Held under attack: git argv/stdin injection, agent forge/badge spoof, hook
confinement, stdio-bridge crash, savings-leak isolation, recall leak.

Fresh opus verifier re-pass: all 8 RESOLVED, no over-correction, no regression,
no new race in the mutator refactor. `pnpm verify` green (52/52). CLEAR TO
MERGE. Deferred follow-ups: update re-capture verification-state reset,
code-truth.ts file split, shared 3-arg ExecGit type at bridge boundaries,
heal-branch idempotence guard (narrow concurrent-heal duplicate-evidence).

## 2026-07-17 — i14 Brain Autopilot SHIPPED (feat/brain-autopilot)

The brain grows itself, safely. `runAutopilot` distills a finished session's
failures (reusing `extractSessionMemories` verbatim) into memory candidates
and auto-approves only the allowlisted slice that recurred ACROSS sessions,
under a per-session cap, stamped `autopilot@1 rule=recurring-failure
session=<id>`. Everything else stages as `approval: "suggested"` for
`mega brain digest` to triage with single-keystroke y/n/e/s/u/a/q.

Zero MemoryEntry schema change — the digest queue IS `approval === "suggested"`.
10 TDD tasks, each with fresh implementer + fresh reviewer per task; the
highest-risk ones (store, scoreCandidate, runAutopilot, approve widening,
digest engine) reviewed at opus with executable mutation testing.

Architect B1 catch (pre-implementation): the extractor emits candidate types
`bug`/`test_behavior`/`decision` — NEVER `failed_attempt` (that's the source
row). The original sketch conflated them and would have auto-approved zero
rows forever. Allowlist retargeted to bug/test_behavior.

M2 dampener (the safety model): within-session repetition never auto-approves
— guard/task-step recorders auto-record failures in a loop, so 5x in one
session is a retry storm, not a lesson. Only cross-session recurrence
(`priorSessionHit`) scores "high". `ExtractedCandidate.occurrences` is a
display-only signal, never a scoring input. Verified end-to-end through the
real binary: a single-session 5x storm yields `auto-approved 0 · staged 1`.

Gauntlet BLOCKERs caught and fixed pre-merge (each proven by execution, each
now pinned by a regression test):
- SECURITY (T5): `FailedAttempt.sessionId` is nullable, and the priors filter
  used `!== sessionId` — so null-session rows counted as "a different session".
  One null-session failure + one current-session failure with identical
  content → auto-approved with `rule=recurring-failure`, no cross-session
  recurrence. Reachable from the agent-facing `record_failed_attempt` (sessionId
  optional). The unforgeable evidence string was attesting to a forgeable
  precondition. Fixed: `=== null || === sessionId`; the grouping Map retyped
  `Map<SessionId, …>` so the compiler now enforces the invariant.
- DATA-LOSS (T9→T10): the digest loop's `if (!closed) await emit({kind:"quit"})`
  guard (transcribed from the plan) fired quit 0/10 runs when the handler does
  real disk I/O — exactly what the digest's writeDigestState handler does. So
  `lastDigestAt` never persisted on piped runs: a torn write (approvals applied,
  bookkeeping lost, next digest re-nudges an already-triaged backlog). The guard
  was also semantically unreachable except on a fully drained queue. Guard
  deleted; plan corrected so it can't be re-transcribed.
- SECURITY (T3): `readAutopilotPolicy` returned the `DEFAULT_AUTOPILOT_POLICY`
  singleton by reference — one in-place mutation flipped the fail-closed default
  to enabled process-wide. Fixed with `structuredClone`; 21-test hostile-input
  suite pins every schema constraint.
- REVERSIBILITY (T10 digest): a human-rejected row carrying autopilot evidence
  entered the auto-approved collapse, so pressing `n` (reject) resurrected it to
  `suggested`. Guard `entry.approval === "approved"` was load-bearing and
  unpinned; now pinned.

Self-enforcing invariants added in review: `scoreCandidate` clamps its
passthrough so "high" is structurally unreachable without `priorSessionHit`
(no longer depending on the extractor hardcoding `confidence: "low"` two files
away). approve's `memoryEntryUpdatePatchSchema` is `.strict()` and omits
`validFrom`/`supersedesId`, so `applyApprovalFlip` cannot corrupt bi-temporal
fields — structural, not disciplinary.

Gating: new `brain-autopilot` ProFeature. status/on/off + dry-run are FREE;
real `run` and `digest` are Pro (unentitled → upsell on stdout, exit 0, zero
writes). `runMemoryApprove.approval` widened to admit `suggested` (undo/revoke).

`pnpm verify` green (54/54). Process note: two mutation-testing agents briefly
shared the worktree (scheduling error) and produced contradictory findings — a
quiet-worktree re-run on the final squashed commit resolved every contested
guard by execution (they had each named a different disjunct of one compound
condition). Deferred follow-up: hoist the triplicated JSON-store atomic-write
mechanic (guard-state / warm-start-state / autopilot-store) into one shared
helper — spawned as its own task, out of scope for this branch.

### Gauntlet verdict (2026-07-17)

Two fresh opus reviewers against the full branch diff. **Code-reviewer: CLEAR
TO MERGE** (no blockers, verify green). **Adversarial critic: SHIP** — no
exploit forged the provenance stamp, corrupted data irreversibly, or broke the
terminal.

The critic's hardest target, and what it could NOT break: the `autopilot@1`
evidence stamp is unforgeable through every agent- and user-facing surface —
`save_memory` is `.strict()` with no evidence field, `from_session_memory`
takes only a session id, `convert_failure_to_rule` writes a different table.
Only internal core writes `evidence[]`. So the digest spot-review can trust
that a row it labels auto-approved genuinely was.

Fixed before merge:
- 🟠 (code-reviewer) `autopilot@1` was a duplicated magic string — writer built
  it inline in core, digest reader had a local `AUTOPILOT_EVIDENCE_PREFIX`.
  Drift would silently blind the human-review window with no type error.
  Promoted to a shared `AUTOPILOT_EVIDENCE_PREFIX` + `formatAutopilotEvidence`
  core export, both writer and reader through it (9592450c) — the exact fix the
  branch already made for the dedupe keyword.
- 🟠 (critic #1) "genuinely recurred" overclaim. `priorSessionHit` fires when
  the same agent-supplied failure text appears under two session ids; the
  contentHash carries no session binding, so the engine can't tell a genuine
  recurrence from an agent repeating itself. Adds no new capability (agents can
  already `save_memory` with `approval:"approved"`) and the stamp stays
  truthful about what it measures, but auto-approved ≠ human-vetted. Spec §8.3
  and new §11.6 now say so; the real gate is consent + cap + reversible
  spot-review.

Deferred as spawned follow-up tasks (pre-existing / theoretical, not merge
blockers):
- 🟡 (critic #5) ledger-suppression: an agent can pre-write a `from-session:`
  keyword via save_memory to silently suppress a legit autopilot capture.
  Denial, not forgery; pre-existing property of the from-session ledger.
- 🟡 (critic #6) policy-store TOCTOU: enabled-check and run observe two
  separate policy reads across an await; a concurrent `autopilot off` in the
  window still auto-approves. Single-user, theoretical. Fix = thread one
  snapshot.
- (code-reviewer prior) hoist the triplicated JSON-store atomic-write mechanic.

### Merge to main + release v2.1.1 (2026-07-17)

The whole Brain Autopilot (i14) line merged to `main` as four squash commits,
then cut as release **v2.1.1**.

Merged (squash, linear history):
- `4403f408` feat(core): Brain Autopilot (i14) — self-growing memory (#289).
  Session-end auto-capture + cross-session-recurrence auto-approve (M2 dampener)
  + `mega brain digest` keystroke triage. CI green ubuntu+windows, gauntlet
  cleared (code-reviewer CLEAR, critic SHIP).
- `5f8bbdb8` refactor(core): share advisory atomic-JSON-store helper (#290).
  Hoisted the triplicated mkdir+tmp+rename mechanic into core-internal
  `json-store.ts`; each store keeps its own schema + error posture. Closes the
  code-reviewer's i14 follow-up. Pure extraction — 31 tests unmodified. Both
  gauntlet reviewers: byte-identical, 41 differential checks.
- `24591793` fix(core): reserve the from-session ledger keyword namespace (#291).
  Closes gauntlet finding #5 (denial-of-capture): an agent could plant a forged
  `from-session:` keyword via save_memory / memory create|update / brain import
  to suppress a legit autopilot capture. Reserve the namespace at all four
  agent-facing boundaries; internal writers bypass. Both reviewers found+fixed a
  case/whitespace bypass (strip ran on raw input, keywordsSchema normalizes with
  `.trim().toLowerCase()` after) — `isReservedKeyword` now mirrors that
  normalization.
- `8145016f` fix(cli): read autopilot policy once, close run TOCTOU (#292).
  Closes gauntlet finding #6: two policy reads across the `ensureStore` await let
  a concurrent `autopilot on/off` make the run act on an ungated snapshot. Thread
  one snapshot through both the enabled gate and `runAutopilot`. code-reviewer
  CLEAR.

Release v2.1.1 (local: `changeset version` + CHANGELOGs + git tag, no publish).
Consumed the 10-changeset backlog that had accumulated since v2.1.0 — not just
i14 but code-truth (i6), warm-start (i8), living-brain (i1), mistake-firewall
(i7), plus bridge-declared-target-exemption, save-path-lineage,
first-party-cache-parity. Package bumps: core 1.3.0→1.4.0, cli →2.2.0,
mcp-bridge →1.3.0, entitlement →0.3.0 (product tag decoupled from package
versions per the existing convention — core stayed 1.3.0 across v2.0.0/v2.1.0).

All three i14 gauntlet follow-ups now closed. Merged branches + worktrees cleaned
up.

## [2026-07-19] feat | Hot Handoff (i10) shipped

Subagent-driven implementation of i10 Hot Handoff on
`worktree-feat-hot-handoff` (spec
`docs/superpowers/specs/2026-07-18-hot-handoff-design.md`, plan
`docs/superpowers/plans/2026-07-18-hot-handoff-plan.md`). `mega handoff
pack/open/inspect/clear` — redacted, expiring `.megahandoff` task packets
carry live task state (budgeted brief + recallable memories + unresolved
failures + secret-path-filtered dirty diff) across agents; suggested-gate
memory merge; new `hot-handoff` ProFeature (dry-run/inspect/clear free);
advisory `HandoffEvent` stats stream. New modules: core `bundle-frame`,
`handoff-packet`, `handoff-export`, `handoff-import`, `verification-badge`;
connectors-shared `handoff-block`; stats `handoff-event`; cli `handoff/*`.
Reuses the `.megabrain` bundle frame + Warm Start brief + connectors-shared
sentinel upsert + policy firewall + entitlement — no new store.

- 13 TDD tasks, red→green→refactor; every task two-stage reviewed
  (code-reviewer + critic in fresh contexts, author≠reviewer).
- Security findings caught + fixed pre-merge: NaN expiry (Date overflow),
  C-quoted-path secret-filter bypass, resolved-session memory leak,
  commit-subject redaction gap, Trojan-Source/ANSI sentinel forgery, CRLF
  block corruption, badge forgery, inspect report forgery, and a citty
  root-run+subCommands routing regression (→ subcommands-only surface).
- Close-out (this session): DRY consolidation (`HANDOFF_BADGE_NOTE` +
  core-exported `agentSlugSchema` reused by the CLI), spec §7 + Status
  updated to the subcommand surface, five-package changeset added
  (core/cli/connectors-shared/entitlement/stats), `pnpm verify` green.
  Wiki: `entities/hot-handoff.md` created, index + i10 portfolio row
  marked SHIPPED. Branch not yet merged.

## [2026-07-19] pr | Hot Handoff (i10) opened as PR #293

Branch `worktree-feat-hot-handoff` (36 commits) pushed and opened as
[PR #293](https://github.com/haJ1t/MegaSaver/pull/293), to be squash-merged
per §10. `pnpm verify` green on HEAD; final gauntlet passed (code-reviewer
APPROVE, adversarial critic REVISE→fixed, verifier DoD MET with a captured
built-CLI acceptance run). Deferred follow-up filed: the LOCKED redaction
baseline in `packages/policy` misses 7 cloud credential formats (Stripe,
OpenAI project, Google, Slack, GitHub fine-grained, SendGrid, npm) —
pre-existing, shared with `brain export`, needs its own spec + security
review before the detectors change.
## [2026-07-17] query | Recalibrated the solo-developer product roadmap after v2.1.1

Verified the new release state: product tag `v2.1.1` is at `653f7599` and
`@megasaver/cli@2.2.0` is npm `latest` (registry check 2026-07-17). The release
ships the previously proposed Agent Experience Layer: Brain Sync, Warm Start,
Mistake Firewall, Living Brain, Code-Truth Verify, and Brain Autopilot.

The active roadmap now changes from B+C (up-market first) to A+C (solo depth
plus tactical distribution): package and measure that daily experience now;
build **Agent Passport / Hot Handoff** next; then Brain Doctor, Context
Contracts, and conservative cross-project Déjà Vu. Recall Receipts remains
deferred until it can support causal rather than correlational dollar claims.
Sources: [[syntheses/post-2.0-growth-portfolio]],
[[syntheses/memory-moat-portfolio]], `apps/cli/CHANGELOG.md` 2.2.0, npm registry
check, [Causal Agent Replay](https://arxiv.org/abs/2606.08275).

## [2026-07-18] spec | Hot Handoff (i10) design written, user-approved, verify-hardened

Brainstorm→spec for i10 Agent Passport / Hot Handoff (roadmap 2.2 slice).
User locked 4 scope decisions: `.megahandoff` bundle arch (brain-bundle
sibling + `handoff open` consumption), dry-run-free/pack-Pro under new
`"hot-handoff"` ProFeature key, filtered dirty diff included
(`evaluatePathRead` secret-path exclusion → redact → compressDiff → cap),
file-always + darwin `--copy` (path only). 8-reader ultracode sweep mapped
the reuse surface; 3-lens adversarial verify found 21 findings (2 BLOCKING:
context-less `upsertHandoffBlockText` needed instead of full `upsertBlock`;
render-time sentinel guard on open) — all integrated. Spec:
`docs/superpowers/specs/2026-07-18-hot-handoff-design.md` (risk HIGH).
Pending: user spec review → architect pass → writing-plans in worktree
`feat/hot-handoff`. Sources: [[syntheses/solo-developer-roadmap]],
[[syntheses/memory-moat-portfolio]].

## [2026-07-18] plan | Hot Handoff (i10) implementation plan written

16-task TDD plan (5983 lines, full code in every step) at
`docs/superpowers/plans/2026-07-18-hot-handoff-plan.md`. Produced by 7
parallel section writers grounded in real source + seam-check verifier
(5 mechanical findings, all fixed: duplicate index re-export, missing
newId in integration helper, Create-vs-Modify collision on
handoff-export.ts, one placeholder path, 4 unwrapped commit steps).
Plan-time deviations from spec recorded in the plan header (diff cap
2000, compressByCategory dispatcher, per-file truncation unit, WS
preflight pre-existing gap flagged). Execution: worktree
`feat/hot-handoff`, dependency order 1→14.

## [2026-07-19] ingest | Saver cache-churn finding + cache-aware saver spec

Benchmark (mega 2.2.0 + first-party fix) both modes: cost geomean
balanced 0.96x / aggressive 0.93x — no net win, aggressive WORSE.
Root cause proven via .usage composition: the PostToolUse saver
rewrites tool_result in place, invalidating Claude Code's native 1h
prompt cache → cache_creation churn (aggressive task_1: megasaver
48,005 vs baseline 29,525) cancels the compression benefit. The saver
optimizes a cost the client already solved (cheap cache-reads). Win
survives only on large first-sight output. First-party fix robust
(plain input ≤15 tok). New: [[syntheses/saver-cache-churn]] +
docs/superpowers/specs/2026-07-19-cache-aware-saver-design.md
(HIGH risk; candidate: first-sight-only compression). Benchmark script
now takes MEGA_SAVER_MODE env (default balanced).

## [2026-07-19] ingest | Stage A measured: gate FAILED, benchmark variance is the blocker

Stage A (P0 guardrail + P1 first-sight saver) implemented via subagent-driven
TDD, 11 commits, every task 2-stage reviewed, adversarial final review (no
BLOCKERs), `pnpm verify` 54/54 green. Benchmark gate FAILED: geomean 0.948x
(needed ≥1.0x), min task 0.68x (needed ≥0.9x), pooled 0.971x. Pre-Stage-A was
0.96x — Stage A produced NO measurable improvement. Root finding: harness
variance (0.68x–1.23x spread; task_1 flipped 0.70x→1.03x on identical tokens
via fast-mode 2x billing; task_4 baseline 10→6 turns across runs) exceeds the
~5% effect. No stage — including Stage B's turn-cutter — can be validated
until measurement is fixed. Branch parked unmerged. Two real by-products kept:
a latent `newId` collision that silently broke evidence writes (found+fixed in
Task 7), and the 1.5x pause hysteresis. See [[syntheses/saver-cache-churn]].

## [2026-07-19] strategy | Global Agent Continuity Layer direction approved

User approved the long-horizon position: MegaSaver stays developer-first for
the individual daily buyer but is built as a user-owned, agent-agnostic Agent
Continuity Layer. The durable promise is continuity of verified work across
agents, models, repositories, and machines—not token reduction alone. The
strategy adds five product layers (continuity, truth, control, economics,
ecosystem), four expansion horizons, and gates that prevent generic-AI scope
creep or unproven cost claims. The near-term feature sequence remains Agent
Passport / Hot Handoff → Brain Doctor → Context Contracts → Déjà Vu; Hot
Handoff remains separately owned. Sources: [[syntheses/global-agent-continuity-strategy]],
[[syntheses/solo-developer-roadmap]], user approval 2026-07-19.

## [2026-07-20] plan | Redaction baseline extension planned (CRITICAL)

13-task TDD plan (3,458 lines) at
`docs/superpowers/plans/2026-07-19-redaction-baseline-extension-plan.md`,
implementing `docs/superpowers/specs/2026-07-19-redaction-baseline-extension-design.md`.
31 new credential detectors plus a PKCS#8 fix to the existing
`private_key_block`. Both CRITICAL design gates ran and returned REVISE:
the architect measured the proposed prefix pre-filter as a 3x
pessimization (V8 already fast-paths literal-anchored regexes) and the
security reviewer found 6 BLOCKING defects — a quadratic ReDoS in the
OpenAI detector, case-sensitive context gates that leaked 7 of 8
canonical uppercase env-var shapes, a false "already covered" exclusion
claim that turned out to be a real PKCS#8 gap in shipped code, 360
corpus false positives from a Mailgun rule (dropped), 8 detectors
missing trailing boundaries, and an unanchored GitHub App rule that ate
file paths. All integrated; re-check APPROVE_WITH_FIXES, closed.
Safety gates land before the detectors: frozen snapshot of the original
19, a 5,010-line false-positive corpus, ordering tests (behavioral plus
structural), and a ReDoS timing regression scoped to the new tier.
Separately filed: a live ReDoS in the shipped `jwt` detector
(1850 ms at 156 KiB, reachable from ordinary base64-heavy logs).

## 2026-07-20 — `mega doctor` saver-liveness fixed (merged to main)

`saver-liveness` failed permanently and never self-healed. Root cause: doctor
reused the heartbeat ledger's **stats retention** window (`TTL_MS` = 30 days)
as if it were a **liveness recency** window. `LIVENESS_GAP_GRACE_MS` (5 min)
only bounds the invocation-vs-completion delta, never how recent the invocation
is — so any workspace with `completion === null` failed the check from the
moment it died until it aged out 30 days later. The code stated the false
premise in a comment ("computeView already prunes stale invocations, so any
survivor here is recent enough").

Real ledger evidence: 67 workspace keys with an invocation, 30 with a
completion, **37 with none**. The reported key `5fe7a040a2e5a5b8` was a dead
temp dir from `2026-07-14`. Neither suggested remedy worked — re-running doctor
left the key, and `mega hooks install` does not clear history.

Fix (`829ddb3e`): dedicated `LIVENESS_WINDOW_MS` (24h) in `doctor-saver.ts`,
applied to **both** the gap scan and the sibling `failures` scan (the failures
branch had the identical defect). `TTL_MS` and `packages/context-gate` left
untouched — retention and liveness are different questions, and conflating them
was the bug. The user's ledger is not mutated; stale entries remain and are
simply ignored.

Verified: `10 PASS / 0 FAIL` on the real store; 19/19 doctor tests; `pnpm verify`
exit 0; `bundle-smoke` green against a real bundle. Review APPROVED with no
findings, having independently reproduced the before/after test split and
mutation-tested the boundary operator.

Correction to an earlier claim in this session: `bundle-smoke` **skips** when no
bundle exists, so `main` was not red for everyone — only for anyone with a built
bundle on disk.
## 2026-07-20 — Variance-controlled benchmark harness (L0 + L1) built; fast-mode premise retracted

Built `feat/bench-replay` (15 commits, 101 package tests green) implementing the
L0 cost-normalization + L1 record/replay harness from
[[syntheses/variance-controlled-benchmark]].

**Retraction.** The spec's premise that a fast-mode 2x billing artifact drove
benchmark variance was checked against all 24 saved Stage A result files and is
FALSE: every one is `service_tier: standard`, `fast_mode_state: off`, with raw
`total_cost_usd` equal to normalized cost (0% deviation). L0 changes no number
on current data and is kept only as insurance. Corrected in
[[syntheses/saver-cache-churn]].

**Real variance sources:** (1) agent turn count driving cache_read near-linearly;
(2) previously unidentified — the saver's per-workspace store carrying over
between runs. task_1 ran 5/5 turns in both Stage A runs yet megasaver
cache_creation fell 48,681 → 29,613 (baseline 30,129): the saver had switched
itself off. Its run-2 "1.03x pass" was decay, not success.

**Review caught four defects that would each have produced a confident wrong
number:** saver applied per-request instead of per-tool-call (would have imposed
a ~20x cache penalty on the arm under test); an isolated store silently
disabling the saver (inert arm reporting 1.00x); arm run order contaminating via
the shared prompt-cache prefix; and array-form `tool_result` blocks (14.4% of
17,584 real blocks) passing through untransformed. All fixed.

**Not done:** the real gate has not run — replay needs an `ANTHROPIC_API_KEY`
(Claude Code's OAuth is not usable by a separate HTTP client). No Stage A
verdict exists; `feat/net-positive-stage-a` remains parked and ungated.
Sources: code-reviewer + critic passes 2026-07-20, direct inspection of
`/tmp/stagea-run{1,2}-results`.

## 2026-07-20 — bench-replay merged to main after four adversarial review rounds

`feat/bench-replay` merged (`3c1e23ca`), `pnpm verify` exit 0, 56/56 turbo tasks,
139 package tests. **Merged as tested infrastructure, NOT as a source of
quotable numbers** — see [[syntheses/variance-controlled-benchmark]] and
`packages/bench-replay/README.md`.

### Four rounds, four real defects — each a fix of the instance, not the class

1. **FATAL** — saver applied per request. A Messages API conversation resends
   its whole history each turn, so a stateless transform re-invoked the saver on
   the same `tool_result` once per containing request. Would have made the
   megasaver arm's prefix mutate every turn, paying `cache_creation` ($10/Mtok)
   where baseline paid `cache_read` ($0.50/Mtok) — a ~20x manufactured penalty
   that would have condemned Stage A for causing the very prefix churn it exists
   to prevent.
2. **Same defect, relocated** — the memo was scoped inside `replayArm` (one arm),
   but the verdict path runs four arm runs. Measured 6 saver invocations for 3
   tool calls; pair 1's megasaver bytes differed from pair 2's. `orderSensitive`
   structurally could not detect it (both orders penalised equally → ratios agree
   → spread 0 → guard passes).
3. **BLOCKER** — output-token sampling noise. The model resampled freely on all
   four arms; output is ~26% of arm cost at $25/Mtok. Simulation against a TRUE
   5% saving: sd 3.78%, and **15.5% of runs reported the wrong SIGN**. Fixed by
   capping generation to 1 token on both arms (`max_tokens` is not in the
   prompt-cache key; the replay never uses generated output). Output share falls
   to f≈0.00071 with c≈0.
4. **Aggregate-vs-per-call** — the two-sided integrity band constrained
   conversation-wide aggregates while a saver breaks per call, and the two axes
   traded off freely. `() => ""` on half the calls scored frac 0.500 /
   byteRatio 0.500, `ok=true`, reporting a fake **2.0x win**; emptying the 11
   largest of 100 reported **3.3x**.

### Final fix — structural, not another threshold

Per-call contract validation inside `memoize`, using the saver's own invariant
(confirmed in `record-output.ts:188,218-228`): every applied output carries
`[Mega Saver: compressed ` AND is strictly smaller than the raw. Throws before
any request is sent, naming each offending `tool_use_id`. Catches one bad call
among ninety-nine, which no aggregate can. Both aggregate floors were then
removed as redundant-or-harmful (`MIN_BYTE_RATIO` refused honest aggressive-mode
runs at byteRatio 0.039; `MIN_APPLIED_FRACTION` refused honest runs where the
saver legitimately fires on few large outputs). One aggregate threshold remains,
`MAX_BYTE_RATIO = 0.95`, derived: above it a transform provably cannot reach the
≤5% band even if tool_results were the entire prompt.

### What it measures, and what it does not

- **Measures:** the saver's direct input-side token/cache effect on one frozen
  conversation. Turn count is identical across arms by construction. Compounding
  IS captured (history resend means a turn-3 compression shrinks every later
  request).
- **Does NOT measure:** any effect on agent behaviour (fewer/more turns because
  compressed output read differently) — the larger prize, needing high-N
  end-to-end.
- **As a proxy for live savings the ratio is an UPPER BOUND**, not an estimate:
  the harness omits the saver's main cost channel (compression removes bytes the
  agent may need, and the footer invites it to fetch them — each recovery is a
  full extra request at full history price) while counting all its savings.

### Known-unvalidated at merge

Never run against the real API. Prompt-cache nondeterminism (best-effort caching
can return `cache_creation` for bytes that returned `cache_read` moments earlier
— 20x on that segment) is untested and unmeasured by anything in the harness, so
residual input-side variance is unknown and **no ≤5% claim is supportable yet**.
The record path (`capture-proxy.ts`, `record-command.ts`) and the cost function
have never been adversarially reviewed. `normalizedCostUsd` is model-blind —
sidecar Haiku calls are priced as Opus (~6x) and dilute the ratio toward 1.00;
mitigated by a printed per-model histogram, not by repricing.

Stage A (`feat/net-positive-stage-a`) remains parked and UNGATED. Running the
gate needs an `ANTHROPIC_API_KEY` (Claude Code's OAuth is not usable by a
separate HTTP client).

## 2026-07-20 — LLM Code Problems Research analysis

Analyzed `~/Desktop/LLM-Code-Problems-Research.docx` (593+ articles, ~19.4k lines) via 10 parallel range agents. Mapped dominant problem clusters (package/API hallucination, generated-code security, context quality, silent agent failures, memory poisoning) to 10 prioritized Mega Saver feature proposals + validated existing bets. Caveats: heavy duplication, boilerplate fields, single-source numbers. Synthesis: [[syntheses/llm-code-problems-research-2026-07]].

## [2026-07-20] fix | output-filter — close review on the quadratic signal regexes

Five code-review items closed on `fix/rank-quadratic` (commits `a1bf5983`,
`47dab116`). New page: [[concepts/unbounded-run-redos]].

**Two more instances of the same class were still live.** `STACKTRACE`
(`rank.ts`) and `SIGNATURE` (`parsers/stacktrace.ts`) had the identical shape
plus a second driver — `\s+` and `.+` both accept whitespace, so the split is
ambiguous at every offset of a whitespace run. Bounded to
`\s{1,64}at\s{1,8}.{1,512}` (+ `\(.{1,512}` for SIGNATURE). Derived, not taken
from the review: the gap bound is the tight one because only the gap
multiplies, and `.{1,512}` absorbs a wide gap anyway, so `\s{1,8}` costs no
reach (divergence only past 515 gap chars). Equivalence verified on 20 real
frames — node with/without parens, tab-indented, deep monorepo, nested v8 eval,
java, python, go, rust — before and after, all identical.

**Correction to the review's attribution.** The reviewer measured 42 s for
`  at ` + spaces through `filterOutput` and attributed it to
STACKTRACE/SIGNATURE. Stage-level profiling says otherwise: on that shape the
cost is `redactWithFindings` (16-24 s), from three variable-length lookbehinds
in `@megasaver/policy` — `aws_secret_key` 6,132 ms, `basic_auth_header`
4,598 ms, `api_key_header` 4,156 ms. Same defect class, third variant, now
recorded and **still open**. The output-filter patterns were genuinely
quadratic (32.9 s and 16.5 s through their own call sites), but they were not
what the 42 s measured.

**The guard test was not guarding.** It ran at 50 KB with a 5 s ceiling, where
four of the five reverted patterns cost 2.9-4.7 s and stayed green — so only
STACKTRACE's reversion would ever have failed it. And it drove only
`scoreChunk`, which never reaches `normalize.ts`, so its claim to cover
`POSITION` was false (the reviewer proved this; confirmed). Fix: SIZE 50 KB →
100 KB (quadratic vs linear, so size is the cheap separator), and one timing
block per pattern through its real call site. Each of the five now goes red
alone when its bound is reverted: 16.1 / 19.3 / 32.9 / 16.5 / 12.2 s.

**Changeset corrected.** "No behavior change" softened to "no realistic input"
with the exact thresholds. Two of the five turn out to have no length
divergence at all — `FILE_PATH`'s start class equals its continuation class, so
a longer run restarts the match later rather than failing. The 236 s `saver-run`
baseline is noted as load-dependent (160 s idle) rather than silently swapped.

**Deferred, unchanged:** the `email` observer (`redaction-patterns.ts:171`),
LOCKED §9d baseline, needs its own spec → security-reviewer chain. It is
count-only and never modifies text, so a size gate on the observer loop may be
cheaper than touching the locked pattern. Recorded as an option in
[[concepts/unbounded-run-redos]]; not acted on.

## [2026-07-20] fix | jwt detector ReDoS fixed (CRITICAL)

One-line fix on `packages/policy/src/redaction-patterns.ts`: a leading
`(?<![A-Za-z0-9_-])` on the LOCKED `jwt` detector. 313 KiB of
`'eyJaA0'.repeat(n)` goes from 8,374 ms to 0.45 ms — quadratic to linear,
~17,400x. Root cause is start-position count, not run length: 39 KiB with 6,800
`eyJ` starts costs 204 ms, the same 39 KiB with one start costs 0.0 ms.

**Supersedes the severity claim in the entry above.** That entry filed this as
"reachable from ordinary base64-heavy logs". Re-measured, that is wrong: a
24.6 KiB unbroken base64 run costs 0.00 ms, because random base64url holds `eyJ`
about once per 262,144 positions. Text full of real JWTs is fast too — the dots
satisfy the mandatory separator immediately. The correct classification is
**adversarially reachable, not ordinarily reachable**: it needs a crafted
payload with many `eyJ` occurrences and no dots. It stays CRITICAL-tier because
the redactor sits on untrusted agent output, tool results, and Hot Handoff
packets, where a crafted payload stalls every sink.

The earlier note's stated root cause ("the separator is not excluded from the
character class") was also wrong — `[A-Za-z0-9_-]` does not match `.`.

Accepted trade-off (spec §5): a JWT glued to a base64url character, including
`-` and `_`, no longer redacts; `session-<jwt>` and `id_token_<jwt>` stay in
cleartext, asserted explicitly so nobody narrows the class back into the
quadratic. BB3 §5a lock table amended with a footnote in the same commit. The
unexecuted redaction-baseline extension plan was retargeted: snapshot literal,
single-exception framing, and the ReDoS gate's jwt exclusion (comment and
committed commit-message body) all updated, and `jwt` brought into that gate's
scope. Sources:
[[docs/superpowers/specs/2026-07-20-jwt-redos-fix-design]], [[entities/policy]].

## [2026-07-20] fix | jwt detector: percent carriers recovered, severity corrected (CRITICAL)

**Supersedes the severity claim in the entry above.** That entry classified the
jwt ReDoS as "adversarially reachable, not ordinarily reachable". Measurement
refutes it: the correct classification is **ordinarily reachable**. The earlier
reasoning used the wrong population — base64 of *JSON* is not random. JSON
objects begin `{"`, which encodes to `eyJ`, so every encoded JSON value
contributes an `eyJ` at a predictable alignment, and encoded-JSON payloads are
routine in agent output.

The vector is **base64url with no separator**: 320 KiB of it costs **575.9 ms**
under the pre-fix pattern (327,680-char dotless run), scaling cleanly
quadratically — 85 / 171 / 341 / 683 KiB at 40.6 / 165.6 / 637.6 / 2,555.5 ms.
`Buffer.toString("base64url")` of any JSON payload produces this shape, and no
effective size cap sits in front of redaction. Standard base64 and newline
wrapping are both benign, which is the honest boundary. **Kubernetes Secrets and
Docker `config.json` auth blobs are NOT the vector** — both use standard base64,
whose `+` and `/` break the run, and measure 1.0 ms and 2.1 ms at ~320 KiB.

**Second correction: the first fix silently lost the percent-escaped carriers.**
Every hex digit is a base64url character, so a `%XY` predecessor blocked
redaction — taking URL query strings and fragments, among the most common places
a JWT appears in agent output, with it. The scope sentence in the original spec
§5 did not say so. Recovered by a second lookbehind branch,
`(?<=%[0-9A-Fa-f][0-9A-Fa-f])`: 0/512 `%XY` forms redacted before, 512/512 now.
Nearly free, because `%` sits outside the run class and terminates the dotless
run — 0.32 ms per 313 KiB, linear. The earlier 49.7 ms rejection of a hybrid
alternation did not transfer: it measured a branch after `-`/`_`, which are
inside the class and still scan.

Remaining disclosed loss, unchanged in kind but stated correctly: a JWT preceded
by a **raw** base64url character. `session-<jwt>`, `id_token_<jwt>`,
`Bearer<jwt>`, `ghs_<body>_<jwt>`, base64-run glue, and `\x3d` / `\u003d`
escaped equals. **No other detector covers those bytes** — verified through the
full pipeline. `&#61;` was never affected (predecessor `;`). Released as
**minor**, not patch, so the coverage reduction is visible at release.

The test suite was rebuilt: mutation testing showed the shipped 21 assertions
killed all five structural mutants through a single `pattern.source` prefix
check, which tests no behaviour and breaks on the amended pattern — update it
naively and four of five mutants survive. The corpus held no `-` or `_` in any
segment, making segment-class narrowing invisible. Six mutants now verified red,
each behaviourally. Sources:
[[docs/superpowers/specs/2026-07-20-jwt-redos-fix-design]] §0, [[entities/policy]].

## [2026-07-20] fix | jwt detector: round-2 verifier findings closed (CRITICAL)

Closes the `critic` round-2 and `verifier` round-2 findings on `fix/jwt-redos`.

Two mutants survived the rebuilt suite. Removing the payload's `eyJ` anchor, and
relaxing any segment `+` to `*`, both passed all 34 assertions — the corpus is
blind to them because all 21 fixtures carry `eyJ`-prefixed payloads, as real
JWTs do. Both mutants only ADD matches: `trace eyJhbGciOiJIUzI1NiJ9.session.abc123`
and `see eyJlogger.v2.min bundle` start being redacted. Six no-over-redaction
assertions added, each verified red against its own mutant. Note `eyJ.eyJ.`
alone does NOT kill the single-position segment mutants — measured, it redacts
only under the simultaneous triple relaxation; the three positional fixtures are
what carry the guarantee.

The 313 KiB timing tests flaked 1 run in 5 under `turbo test --force`. Not CPU
contention: 0.3–1.8 ms at 8x oversubscription (load avg 77 on 10 cores) and 15
consecutive green runs under that load. Two full forced runs each surfaced a
*different*, pre-existing failure — `@megasaver/cli`'s `saver-run.test.ts`
real-daemon HTTP test at 74 s, unrelated to this branch. Fixed with
`{ retry: 3 }`, ceiling unchanged at 500 ms: a quadratic is slow on every
attempt (narrowed lookbehind 4/4 at 38.0–41.8 s, reverted 4/4 at 34.2–40.3 s,
both also tripping the structural gate).

Scope correction: branch 2 recovers one complete `%XY` escape only. Double-
encoded `%25XX` and boundary-truncated `%X` remain lost, re-confirmed through
the full pipeline with no detector firing. Spec §0a and the changeset now say so.

Paperwork: spec §6.2a (timing gate + mutation gap), §9a (the seven-pass CRITICAL
review trail, the user's explicit approval of the round-2 amendment and the
minor bump, and the Node 25.8.2 vs pinned Node 22 measurement caveat — the
discrepancy runs in the safe direction). The plan, written for round 1 and never
amended, gained a Round 2 section, inline superseded markers on its three stale
pattern literals, and reconciled checkboxes. Sources:
[[docs/superpowers/specs/2026-07-20-jwt-redos-fix-design]] §6.2a §9a,
[[docs/superpowers/plans/2026-07-20-jwt-redos-fix-plan]], [[entities/policy]].
## [2026-07-14 21:15 +03] fix | Claude proxy cache parity finalized

Root cause confirmed as Claude Code's custom-base-URL mode, not proxy payload
mutation: it changes tool-schema and hook-attachment cache placement. The
first-party route flag restores parity for the verified Claude Code 2.1.207
client. Final hardening clears stale flags for custom upstreams, tests the real
CLI adapter, snapshots benchmark hooks after setup, and exposes an explicit
managed-service-only upgrade restart. URL equality is never used as ownership
authorization.

Evidence: 70 focused tests and full `pnpm verify` passed; changeset status,
benchmark shell syntax, and diff checks passed. Independent code reviewer and
adversarial critic both returned Ready. Four-task real-billing smoke benchmark
improved from 0/4 losses to 4/4 wins (1.30x cost geomean; approximately $1.87
vs $2.49 total), while the 4x claim remains unproven. Implementation branch:
`fix/proxy-cache-parity-finalize`; code head before this wiki record:
`b09a3983`. Integration PR: GitHub #288.
## [2026-07-25 14:20 +03] fix | context-gate FILE_PATH ReDoS (defect class instance 6)

`FILE_PATH` in `packages/context-gate/src/session-hints.ts` was the unfixed twin
of the `FILE_PATH` bounded in `packages/output-filter/src/rank.ts` (`4ddac04e`),
and the worse form: `[\w./\\-]*\w+\.` is two unbounded quantified runs over
overlapping classes (`\w` is a subset of `[\w./\\-]`), so the split between them
was ambiguous at every offset *and* every start position rescanned to fail the
`\.`. Superquadratic, ~7x per doubling through `extractFailureSignatures`: 1.2 s
at 2 KB, 9.1 s at 4 KB, 80.5 s at 8 KB.

Critical rather than theoretical on two counts. 4 KB is the shipped cap, not a
probe size — both capture sites store `redact(...).redacted.slice(0, 4000)`
(`run-command.ts:305`, `:574`) — and the cost is persisted and amplified: up to
`MAX_OVERLAY_FAILURES` (50) records are re-extracted by `buildSessionHints` /
`buildOverlayHints` on every read and exec, including inside the `guard-run`
hook, so one session that captured a hex dump or identifier run added minutes of
CPU to every later tool call, permanently. The firing shapes are accidental
(`'x'.repeat` 9.1 s, hex dump 11.4 s, identifier run 10.1 s); path-ish runs,
base64 and npm `sha512-` hashes do NOT fire it, because `/`, `-`, `+` and `=`
break the `\w` run.

Fix: collapse the second run to the single `\w` it actually required —
`/[\w./\\-]{0,255}\w\.[a-zA-Z]{1,5}(?::\d+)?/g`, 2.3 ms at 4 KB. Semantics
preserved exactly; verified behaviour-identical on 22 real diagnostic lines and
200k randomised strings over the triggering alphabet. The one-run collapse
`[\w./\\-]{1,256}\.` is equally fast but was rejected — it drops the
`\w`-before-dot requirement and starts matching `-.ts`, `..ts`, `a/.js`. Only
divergence kept is the 256-char leading-run cap, matching the merged twin.

Why it survived: a wiki indexing gap, not a code gap. This page's `sources:`
frontmatter listed only `output-filter` and `policy`, so a wiki-first sweep for
the class never pointed at `context-gate`. Added, with a rule that every package
holding a member of the class — including packages that merely copied a fixed
pattern — goes in `sources:` in the same edit.

Evidence: TDD red first — the guard failed at 6.47x / 6.60x / 6.10x with the
bound reverted (clean ratio assertions, not timeouts) while all 12 behaviour
tests passed unfixed, proving they lock behaviour rather than describe the fix.
Green after: `pnpm verify` EXIT 0, 56/56 turbo tasks, context-gate 331/331.
Guard is `packages/context-gate/test/session-hints-redos.test.ts` — drives the
exported function at the shipped cap, asserts a growth ratio (min-of-5-trials,
calibrated repeat count) rather than a wall-clock ceiling. Sources:
[[concepts/unbounded-run-redos]] instance 6, [[entities/context-gate]].

## [2026-07-25 14:30 +03] fix | Handoff redaction guard + three leaking fields

Follow-up to the PR #293 pre-merge review. Two findings were filed as
non-blocking hardening: no structural guard around per-field handoff
redaction, and `git.branch` bypassing the redactor. Adversarial review of the
first fix found the guard was itself fail-open and had *certified as safe*
five fields that leak a secret today.

Shipped: `git.branch`, `git.changedFiles[].path`, `git.diff.excludedPaths[]`
now redacted; code anchors (`files[].path`, `symbols[].path`,
`symbols[].name`) dropped wholesale with `lastVerified` when a key is dirty,
because they are code-truth lookup keys and a redacted value produces a false
`contradicted` that closes `validTo` on the receiver. Anchor handling sits in
`redactMemory`, so `mega brain export` inherits it.

Guard is test-based, not a runtime walk: zod string-leaf enumeration over
`handoffPayloadSchema`, throwing on unrecognized wrappers and on non-strict
objects, with four classification lists and per-path behavioral proof.

Evidence: each of the four new redactions reverted individually and shown to
fail the guard; `notes: z.record(z.string())` added to the schema and shown to
throw `unclassifiable zod type ZodRecord`; `packages/core` 37/37;
`pnpm verify` 56/56 tasks, exit 0. Reviewed by `code-reviewer` and two
adversarial `critic` passes; every round-one and round-two finding addressed.
Sources: [[docs/superpowers/specs/2026-07-25-handoff-redaction-guard-design]],
[[docs/superpowers/plans/2026-07-25-handoff-redaction-guard-plan]],
[[entities/hot-handoff]].

## [2026-07-25 14:52 +03] merge | Stage A shipped with its gate still failing

PR #295 ("net-positive Stage A — PARKED, ungated") merged to `main` as
`8e261d19` on 2026-07-25, carrying the per-workspace net-effect estimator that
auto-pauses the saver plus the per-session first-sight seen-hash ledger. Its
own acceptance gate was still FAILED at merge time: geomean 0.948x against a
required >=1.0x, min task 0.68x against >=0.9x. The variance-controlled
bench-replay harness that could resolve the effect has never been run against
the real API, so no post-merge verdict exists — the shipped guardrail and
first-sight saver have no demonstrated cost benefit. PR #293 (Hot Handoff)
also merged in the same window. Sources:
[[syntheses/variance-controlled-benchmark]], [[syntheses/saver-cache-churn]],
[[docs/superpowers/specs/2026-07-19-net-positive-megasaver-design]] §gate.

## [2026-07-25 15:40 +03] correction | Stage A merge shape and commit count

Both syntheses overstated the Stage A merge. Corrections, each verified against
the repo: the branch carries **10** commits, not 11 (`git log --oneline
main..feat/net-positive-stage-a | wc -l`); it was **rebase-merged**, not
merged — `8e261d19` has a single parent, so there is no merge commit, and the
range on `main` is `0157fe44..8e261d19`; the `feat/net-positive-stage-a` ref
survives the rebase, so `git merge-base --is-ancestor` still reports it
unmerged while `git cherry` marks all 10 commits as patch-equivalent on `main`.
Added the live-code pointer (`apps/cli/src/hooks/saver-run.ts` wires
`saverPausedByNetEffect` plus the seen-hash ledger) so a reader does not
re-derive whether the guardrail actually ships. The prior entry
`[2026-07-25 14:52]` stands as written history; it is superseded on the "merged
as `8e261d19`" phrasing only. Sources:
[[syntheses/saver-cache-churn]], [[syntheses/variance-controlled-benchmark]].
## [2026-07-25 14:30 +03] fix | GC sweep clobbered registry-session stats

`reconcileOverlaySummaries` (packages/stats/src/store.ts) treated every
`stats/<dir>` as an overlay workspace, so `maybeRunOverlayGc`'s once-a-day
sweep rewrote `stats/<projectId>/<sessionId>.json` as a zeroed overlay
summary. Measured on a store with one registry session: `rebuilt` 2,
`bytesSavedTotal` 9000 → 0, and a phantom `handoff.json` fabricated from the
handoff ledger; `readSummary` and `appendEvent` then threw `store_corrupt`
permanently, so `mega output exec/file/filter` returned `store_write_failed`.

Fix: the sweep only enters dirs matching `workspaceKeySchema` (16 lowercase
hex), the layout discriminator `locateChunkSet` already uses. After: `rebuilt`
0, registry summary byte-identical, no `handoff.json`, real overlay workspaces
still repaired. 4 red → green guard tests in
`packages/stats/test/reconcile-legacy-layout.test.ts`; 241/241 stats tests
pass. Branch `fix/gc-reconcile-clobbers-legacy-summaries`.
See [[entities/stats]].
## [2026-07-25 14:35 +03] fix | classify.ts `^\s*` quadratic (redos instance 6)

`VITEST_OUT` and `PROSE_ANTI_VI` in `packages/output-filter/src/classify.ts`
opened alternatives with `^\s*` under the `m` flag. `\s` matches `\n`, so inside
a blank-line block every line start rescanned the whole remaining whitespace
region before failing the required literal. Measured through the real call site
`classifyOutput`: 31.8 s on 100 KB of newlines, 89 ms after bounding to
`\s{0,64}`. Exposed by `mega bench`, which passes raw command output to the
public export (`filterOutput` was shielded only incidentally, by feeding it
post-`collapseRepeatedLines` text).

Evidence: new `packages/output-filter/test/classify-redos.test.ts` at 100 KB
with a 5 s ceiling — red 31.8 s before the fix; each bound verified
load-bearing alone (32.6 s / 20.9 s when reverted individually). Package suite
40 files / 416 tests green; biome clean on both touched files. Branch
`fix/classify-vitest-text-multiline-ws-quadratic`; not merged. Updated
[[concepts/unbounded-run-redos]] with instance 6 and the `^\s*`-under-`m`
variant.

## [2026-07-25 14:30 +03] fix | normalize trailing-whitespace strip was quadratic

Sixth instance of [[concepts/unbounded-run-redos]], and the earliest one in the
pipeline: `normalize()`'s per-line `/\s+$/` in
`packages/output-filter/src/normalize.ts`. Unbounded greedy run before a
zero-width anchor, retried at every start position, so a whitespace run that is
not at end-of-line backtracks the whole run at every offset. Reachable from
ordinary input (padded tables, ASCII banners, tab-indented blobs) through
`filterOutput` and the public `classifyOutput`, with no size cap ahead of it.

Fixed with `String.prototype.trimEnd()` — exactly equivalent (ES `\s` is
WhiteSpace + LineTerminator, the set `trimEnd` removes; `$` without `m` anchors
only at end of string), linear, one line.

Evidence: RED at 200 KB through `classifyOutput` — space run 13,846 ms, tab run
17,046 ms against a 5,000 ms ceiling; GREEN <1 ms each. Reverting the single line
takes both back to 33.6 s / 29.6 s, so the guard is load-bearing. Guard needed 2x
the suite's shared 100 KB: this variant's per-backtrack step is a bare anchor
check, so at 100 KB the unbounded form cost only 3.2-4.0 s and stayed green.
Same-byte-count 80-column control measured linear (3.2 / 9.5 / 12.3 / 17.1 ms at
25 / 50 / 100 / 200 KB), so the cost was the regex shape, not the byte count.
Full `@megasaver/output-filter` suite 413/413 passing; biome clean on the three
touched files. Branch `fix/normalize-trailing-whitespace-quadratic`; not merged,
pending external review per §4.

## [2026-07-25 19:05 +03] fix | restore log.md, wiped by merge 5a13a8c2

Merge `5a13a8c2` (`fix/normalize-trailing-whitespace-quadratic`) resolved this
file to zero bytes: parent1 `d213947e` had 4258 lines, parent2 4147, the merge
commit 0 — a 4258-line deletion of the project's only cross-session, cross-agent
memory channel. `main` carried the empty file through two more commits. Nothing
in `pnpm verify` noticed, because nothing checked the wiki.

Restored by re-running the merge with `git merge-file --union` over base
`89eea64f` — 4283 lines, no conflict markers, zero lines dropped from either
parent (`diff parent2 union` shows 136 additions, 0 deletions). The other four
branches in that batch (`gc-reconcile`, `dedupe`, `classify`, `evidence-ledger`)
are accounted for: their entries were already on `d213947e`, or they wrote none.

Guard: `apps/cli/test/wiki-integrity.test.ts` fails on any empty tracked wiki
page and on a `log.md` that drops below 50 timestamped entries. RED on `main`
(`expected [ 'wiki/log.md' ] to deeply equal []`, `expected 0 to be greater than
50`), green after restore, red again when the restore is reverted.


## [2026-07-25] fix | compileGlob ReDoS + metachar injection (@megasaver/policy)

Reported as an exponential blowup in `**/`-chained project deny globs.
Measurement confirmed the report and found the root cause to be broader than
the report's framing: `compileGlob` compiled untrusted glob text into a
`RegExp`, so (1) all three wildcard forms chained exponentially — not only
`**/` — with `*a`x5 costing 58,530 ms against a 255-character path, and (2)
every character outside the glob language reached the engine unescaped, making
the zero-wildcard `(a+)+b` a 1,130 ms ReDoS on 28 characters. The same
passthrough silently broke ordinary deny rules: `**/a+b.txt` did not match
`x/a+b.txt`.

Both mitigations proposed in the report were refuted by measurement rather than
argument. Collapsing consecutive `(?:.*/)?` groups does not apply (a literal
sits between them). Rewriting `**/` as `(?:[^/]*/)*` is language-equivalent but
*slower* (344 vs 126 ms at k=4). A wildcard-count cap would have to be ≤2 to
hold — rejecting the shipped `**/*.pem` — and is bypassed entirely by the
zero-wildcard vector, because it counts a token the exploit does not need.

Fix: drop the regex. `compileGlob` returns `PathMatcher` and matches by NFA
simulation over a boolean reachability frontier, O(tokens × path length) with no
backtracking by construction. Every non-glob character is a literal.

A third untrusted call site not named in the report was found and covered:
`rankApplicableRules` in `@megasaver/core` compiles `ProjectRule.appliesTo` per
call inside a ranking loop with no cache, measured at 70,377 ms for one hostile
rule.

Evidence: red gate 129,970 ms → 3 ms; the end-to-end `evaluatePathRead` case
failed all four retries pre-fix at 6,298/2,171/2,094/2,008 ms against a 250 ms
ceiling. LOCKED §9a denylist equivalence pinned by a frozen fixture table plus
60,000 randomized comparisons against the pre-fix implementation held verbatim
as an oracle; property generators were corrected after measuring the first
version at 0/20,000 matches (vacuous). Five semantic mutants each turn the suite
red. Non-ASCII case-folding divergence measured and bounded: three cases tighten
the gate, one weakens it (Greek final sigma), accepted and test-pinned. Full
`pnpm verify` EXIT 0.

Pages updated: [[concepts/glob-compile-redos]] (new),
[[concepts/unbounded-run-redos]], [[entities/policy]], [[index]].
Branch: `claude/laughing-matsumoto-be0481`.

## [2026-07-25] review | glob-compile ReDoS — three reviewer passes applied

Security, code-review and evidence passes ran per §12 CRITICAL. The security
pass could not weaken the LOCKED §9a denylist: 0 weakening witnesses across
812,861 differential cases and 22.7 M exhaustive pairs, with the two reference
ReDoS shapes falling from 44,997 ms and 28,358 ms to 0.020 ms and 0.003 ms.
Four findings changed the code.

The sharpest correction: **linear is not bounded.** The first cut declared "no
bound to tune and no cap to bypass" because the matcher is O(tokens × path
length) — while leaving both axes uncapped. A 64 KB glob against a 64 KB path
still measured 16,322 ms. The `.max()` rejected in the original spec is back,
on glob length, glob count and command count. Worst accepted config against a
4096-character path is now 3.0 ms; the 16 s input is refused in 0.0 ms.

Second: treating `[...]` as literal characters was itself a fail-open, because
bracket expressions are genuine glob syntax the regex honoured —
`**/[sS]ecrets/**` stopped denying `app/secrets/db.txt`. Rejected at the parse
boundary rather than reimplemented.

Third: the case-folding note claimed one weakening family; a full
U+0000–U+2FFFF scan found 23. None reaches the ASCII-only denylist
(path-side weakening count 0), so the blast-radius claim held while the count
did not.

Fourth, unclaimed by the original work: the fix **closed a live denylist bypass
on `main`**. `**/` compiled to `(?:.*/)?` and regex `.` excludes line
terminators, so any path with `\n`, `\r`, U+2028 or U+2029 in a directory
segment slipped 13 of the 15 LOCKED entries. Now regression-tested.

One code-review finding was rejected on evidence: the claim that the old regex
left `.` unescaped is false — it emitted `\.`, and neither cited example ever
matched.

Filed, not fixed: `ProjectRule.appliesTo` has no length bound of its own, and
`deny.write` is parsed and compiled but has no consumer.

`pnpm verify` EXIT 0; policy suite 264 tests.
## [2026-07-25 15:45 +03] fix | deny.write rejected instead of silently ignored

`.megasaver/permissions.yaml` accepted a `deny.write` key that compiled into
`ProjectPermissions.denyWritePatterns` — a field with **zero consumers** in the
repo (no `evaluatePathWrite` exists; permissions-yaml §5.4 scoped live write
enforcement out). The YAML presented `write:` as a peer of `read:` and
`commands:`, which are enforced. Reported from a 2026-07-25 glob-matcher review.

Chose rejection over implementing a write gate (contradicts §5.4, and there is
no single write chokepoint — `memory create`, `connector sync`, `handoff pack`,
`brain export`, `hooks install` all write independently; gating some reads as
gating all) and over documenting the gap (the parser is where the operator
actually gets told). `write` is now `z.never().optional()` in the shape with a
message selected by zod issue path, so the `PolicyLoadError` names the key.
`denyWritePatterns` removed from `ProjectPermissions`; changeset major.

`security-reviewer` found no vulnerability (I1–I4 hold, I1/I3 strengthened; all
six `loadProjectPermissions` call sites verified fail-closed) but argued one
pre-existing defect BLOCKED rather than deferred: `mega output exec` dropped the
`policy_load_failed` detail, so the named message never reached the operator on
the surface most likely to hit it — negating the reason for choosing a named
message at all. Fixed in the same change (`exec.ts:124`), detail now rides after
the code to keep CLI/MCP parity. `critic` killed 4/4 mutants. Filed separately:
`max_results` (`mcp-bridge/src/tools/search-code.ts:25`) and `ownerDead`
(`proxy-control/src/reconcile.ts:25`) are the same unread-but-parsed class.

Sources:
[[docs/superpowers/specs/2026-07-25-deny-write-honest-rejection-design]],
[[docs/superpowers/plans/2026-07-25-deny-write-honest-rejection-plan]],
[[entities/policy]].

## [2026-07-25 16:20 +03] fix | inert MCP tool inputs — max_results honored, around removed

Second instance of the `deny.write` defect class, in `@megasaver/mcp-bridge`:
`max_results` (`search-code.ts:25`) and `around` (`fetch-chunk.ts:19`) were
validated by `.strict()` schemas and never read, making them the only keys a
caller could pass without an error.

Split the two rather than treating them alike. `max_results` is a genuine cap
with BM25 ordering behind it and a spec that asked for it (P3-T8) — honored,
capped after ranking, with a new optional `omitted: {files, matches}` so the
truncation is visible. `around` is an unbuilt feature, not an ignored knob —
removed from the schema.

Corrected the incoming report: `max_results` was never published to agents with
`{min:1,max:500,default:50}`; `server.ts:282` advertises
`inputSchema: {type:"object"}` for all 26 tools, so NO input property is
published for any tool. Filed that as a separate DX gap.

Sources: [[docs/superpowers/specs/2026-07-25-inert-mcp-inputs-design]],
[[docs/superpowers/plans/2026-07-25-inert-mcp-inputs-plan]],
[[entities/mcp-bridge]].

## [2026-07-25 17:05 +03] fix | unread ownerDead/leasePhase removed from ReconcileObs

Third finding from the same 2026-07-25 security review. Unlike the other two this
one required a trace before a decision: the report offered "wire it in" vs "delete
it", and the answer was neither obvious nor symmetric.

Traced it: owner liveness IS enforced, at the lock layer (`isOwnerStale`: boot id
+ lease expiry + live-same-boot pid/start-token), and both reconcile drivers run
inside `withTransitionLock`. The matrix runs after ownership is settled, so it has
no takeover to guard — `ownerDead` was not a missing guard but a redundant, weaker
one derived from a documented sentinel that both writers hardcode to null.
Deleted both fields; added a key-set test pinning `observeReality` to the five
consumed fields.

Process note: a mid-investigation claim that `superviseDrive` had NO production
callers was wrong — `head -20` truncated the grep before `supervise.ts`. Same
class as the earlier `| tail` that masked a `pnpm verify` exit code. Both were
caught by following up rather than reporting the first read.

Sources: [[docs/superpowers/specs/2026-07-25-reconcile-obs-dead-fields-design]],
[[docs/superpowers/plans/2026-07-25-reconcile-obs-dead-fields-plan]],
[[concepts/persistent-proxy-routing]].

## [2026-07-25 18:10 +03] fix | real inputSchema published for all 35 MCP tools

Root cause of the whole 2026-07-25 inert-input batch: `server.ts:282` published a
bare `{type:"object"}` for every tool, so agents guessed parameter names from
prose. Fixed by generating JSON Schema from the same Zod object each handler
parses with, mapped in a new `src/tool-schemas.ts` typed
`Record<McpToolName, z.ZodTypeAny>` — completeness is now a compile error
(verified: deleting one entry yields TS2741).

Two report corrections: the bridge has **35** tools, not 26 (the 26 figure is
stale in the wiki and was inherited by the report); and `zod-to-json-schema` was
already in the lockfile via `@modelcontextprotocol/sdk`, so no hand-rolled
converter and no new dependency download.

Honesty rule held: `max_results` is published with no `default`/`maximum` because
neither is enforced; the single `.default()` in the tool surface is published
only after verifying zod applies it.

Sources: [[docs/superpowers/specs/2026-07-25-publish-tool-input-schemas-design]],
[[docs/superpowers/plans/2026-07-25-publish-tool-input-schemas-plan]],
[[entities/mcp-bridge]].

## [2026-07-25] fix | redaction ReDoS instances 4 and 5 (@megasaver/policy)

Closed the last two open members of [[concepts/unbounded-run-redos]], both in
`packages/policy/src/redaction-patterns.ts`. Four bounds, no other change.

Instance 5 is the lookbehind variant, and the reason it read as safe is that
**V8 evaluates a lookbehind right to left**: the `\s` run that rescans at every
start position is the one written *last*, nearest the value, not the one nearest
the key. Bounded the trailing run only — `aws_secret_key` and `api_key_header`
to `\s{0,64}`, `basic_auth_header`'s `basic\s+` to `basic\s{1,64}`. Measured
50 KB -> 100 KB before: 2.2 -> 9.4 s, 1.3 -> 7.6 s, 1.9 -> 8.4 s.

The **leading** `\s*` in each was left unbounded on purpose: reaching it needs
the delimiter within 64 characters behind, and one delimiter per 64 characters
is exactly what caps the leading run, so it is already O(n). Bounding it too
measures identical. A bound no red test can justify is a change that should not
be made.

Instance 4 is `email`. This page had recorded a size gate on the observer loop
as the cheaper fix, on the grounds that the observer is count-only. **That was
wrong, and reading the sink is what showed it:** `redactForLedger` runs the same
`OBSERVED_PATTERNS` array and actually replaces (F-FW-1 — an email must never
persist into a ledger `sourcePath` label). A gate in `redactWithFindings` leaves
that loop quadratic; a gate in both converts a DoS into an email leak. Bounded
the local part to `{1,64}` (RFC 5321) instead, which fixes both loops at the
root — 6.0 -> 23.1 s becomes linear — and does not change the reported count,
because the bound is still greedy with backtracking.

Guard: `packages/policy/test/redact-redos.test.ts`, growth ratio through the
exported `redactWithFindings` at 50 -> 100 KB, min of 5 trials, calibrated
repeats. Red 3.5x-4.1x on all three shapes before the fix, ~2.0x after; wall
clock 304 s -> 3 s. Each of the four bounds was reverted alone and confirmed red
alone.

New lesson recorded on the concept page: the ratio guard is **per-shape**.
`aws_secret_key` reverted is red on a space run and green on tabs;
`api_key_header` reverted is the exact mirror — and on the shape that does not
separate it, the reverted pattern still burns 65-100 s while the assertion
passes. One shape per member of the whitespace class.

`aws_secret_key` is row 5 of the LOCKED §5a table; amended with a dated footnote
per the `jwt` precedent, never rewritten. The other three are outside that table.

`pnpm verify` EXIT 0, 56/56 tasks. policy 284, context-gate 330, output-filter
410, core 900 tests.

## [2026-07-25] fix | exec args bypassed the secret-path denylist (@megasaver/policy)

Reported as "grep path skips secret denylist", anchored at
`mcp-bridge/src/tools/search-code.ts:95` (`buildGrepArgs`). The anchor was
wrong: `buildGrepArgs` is a pure string builder with no gate to add, and it is
one of seven callers of a single ungated sink. `mega_run_command({command:
"cat", args: [".env"]})` leaks identically and never touches search-code at all.

Root cause: `policy.evaluateCommand` inspected the command name and the rendered
command line, never the individual args, while `ALLOWED_COMMANDS` holds five
file-reading commands (`cat`, `find`, `grep`, `ls`, `tail`). The LOCKED §9a
denylist was therefore one tool call wide — `runOutputPipeline({path: ".env"})`
denied with `secret_path_read` and appended a `blocked-read` firewall event,
while `runOutputExecCommand({command: "grep", args: ["-r","-n","--include=.env",
"-e","=","."]})` — byte-identical to what `buildGrepArgs` emits — returned the
file body as excerpts, `warnings: []`, and left the firewall ledger empty. The
context-firewall pitch ("your `.env` never reached the model — and you can prove
it") was false for every exec surface.

Redaction is not a backstop: real `redactWithFindings` over that grep output
returns `count: 0`. The `./.env:1:` prefix defeats the `^`-anchored `env_value`
detector and `aws_secret_key`'s lookbehind is lowercase-only. `--include=*.pem`
and `--include=id_rsa` are the exception, not the rule — `private_key_block`
catches those, so the `.env`-shaped case is the live one.

Fix: `evaluateCommand` runs `evaluatePathRead` over every arg plus the tail
after a `=` (where `--include=<glob>` hides), before the project deny.commands
gate. One guard in the shared sink covers `mega output exec`, `mega bench`,
`proxy_search_code`, `mega_run_command`, both daemon exec handlers, and the
overlay exec twin. Project `deny.read` globs now bind exec as well as read.

Evidence: real orchestrator, real `spawn`, real `.env` on disk. Before —
`ok: true`, excerpt `./.env:1:AWS_SECRET_ACCESS_KEY=… ./.env:2:DB_PASSWORD=…`;
after — `command_denied` / `secret_path_read`, child never spawned. Control
`grep -r -n --include=*.ts -e const .` unchanged. Guard tests drive the two real
call sites (`packages/context-gate/test/exec-secret-path-gate.test.ts`) and go
red alone on revert. Repo-wide `pnpm test`: 56/56 tasks green, no over-block.

Left open deliberately: this is an INPUT gate. A recursive `grep -r pattern .`
still sweeps a denied file it was never handed — output-side path analysis is an
explicit non-goal of the 2026-07-08 context-firewall spec.
## [2026-07-25] fix | unbounded-run-redos instance 9 (output-filter)

Bounded the five remaining `^\s*`/`^\s+`-under-`m` leading runs in
`@megasaver/output-filter` — `TEST_FAILURE` (`rank.ts`), `FAIL_LINE`
(`parsers/go-test.ts`), `SUMMARY` + `PROBLEM_ROW` (`parsers/eslint.ts`),
`SIGNATURE` (`parsers/test-output.ts`). Siblings the instance-7 fix left behind
when it bounded `classify.ts` and stopped there.

Driver is a U+2028/U+2029 run, which survives `normalize` +
`collapseRepeatedLines` (they only fold `\n`) while still anchoring `^` under
`m`. Reaches `filterOutput` through the uncapped `readRaw`. 200 KB, one bound
reverted at a time: 29.9-33.5 s each; all bounded, 200 ms.

Guard: `packages/output-filter/test/multiline-ws-anchor-redos.test.ts` (28
tests). Updated `concepts/unbounded-run-redos` — new instance 9 section, the
grep-every-hit rule, `sources:` frontmatter extended to the three parser files
plus `classify.ts`, and the `Related` line corrected (output-filter holds
2, 3, 7, 8, 9 — it read "2, 3 and 6", but 6 is the context-gate instance).
`pnpm verify` green, 56/56.
## [2026-07-25] fix | dedupe guard margin overstated

Post-merge review of the banded-`dedupe()` fix: the regression guard cleared
its 5 s ceiling by only 1.4x when the fix was reverted (6.8-7.7 s reproduced),
not the 2.7x its comment claimed — and the comment (13.5 s) and the changeset
(17.4 s) disagreed with each other. Neither number had been re-run. Guard now
gates on an n-vs-2n growth ratio (64k/128k lines, 2.75x): 1.95-2.09x idle,
2.06-2.17x under four busy cores, 4.48x reverted. Lesson filed under
[[concepts/unbounded-run-redos]] — minimise per SIDE, not the per-trial ratio.
The sibling classify guard was checked and does NOT share the defect: reverting
`PROSE_ANTI_VI` measures 21.5 s against its 5 s ceiling, matching its changeset.
## [2026-07-25 20:55 +03] fix | extractJson resolved key lines in O(keys x lines)

`lineOf` (`packages/indexer/src/extract/extract-json.ts`) compiled a fresh
RegExp per top-level key and ran a full `lines.findIndex` for each, so a flat
JSON dictionary — i18n locale file, config map, data dump — cost O(keys x lines).
Both read paths reach it: `filterOutput` -> `chunkBySemantic` -> `extractJson`
on any `.json` read (uncapped, `readRaw`), and `mega scan` / `mega index` up to
the 1 MB `DEFAULT_MAX_FILE_SIZE`. Measured: 33 ms at 97 KB, 479 ms at 395 KB,
2755-3409 ms at ~1 MB; one-pass 24 ms.

Fixed with one anchored regex per LINE recording each key token's first line,
then a map lookup. Parity (including first-occurrence-wins, where a nested key
on an earlier line beats the top-level key of the same name) verified by
differential run of both resolvers over 40,240 documents / 42,068 key lookups —
zero divergences.

Guard lesson, same family as [[concepts/unbounded-run-redos]] instance 6 but the
opposite conclusion: a wall-clock CEILING was tried first and rejected here. The
fixed call is 24 ms idle but measured 1137 ms inside a full parallel
`pnpm verify` (~47x), which leaves no gap below the 2755 ms defect. The guard
that holds compares two adjacent measurements in the same process — the same
object pretty-printed vs minified, so every non-defect per-key cost (sha256,
tokenize, allocation) cancels and only line count differs: 1.10-1.43x one-pass,
20.5-79.0x quadratic. Ceilings are not universally safer than ratios; the choice
depends on whether the fast path's own cost is small next to load variance.

Sources: [[entities/indexer]], [[concepts/unbounded-run-redos]].
## [2026-07-25 19:05 +03] fix | any-workspace READ clobbered registry-session stats

Post-merge review finding C1 on `259fed05`. That fix added the layout
discriminator to `reconcileOverlaySummaries` only. `readOverlaySummaryAnyWorkspace`
(packages/stats/src/store.ts) still walked every `stats/<dir>` as an overlay
workspace behind `isSafeSegment` — and overlay summary reads SELF-HEAL, so a
schema miss writes. Reproduced: one registry `appendEvent`, one scan call →
`stats/<projectId>/<sessionId>.json` rewritten to all zeros with `rebuiltAt`,
`readSummary` threw `store_corrupt`. Reachable from `mega audit session`,
`mega audit honest` (never consults the registry) and
`mega hooks status --session`.

Fix: all three `stats/*` walkers in `store.ts` share one `overlayWorkspaceKeys`
helper applying `workspaceKeySchema`. After: scan `null`, summary byte-identical,
`readSummary` intact. 1 red → green guard test in
`packages/stats/test/read-overlay-any-workspace.test.ts`; `pnpm verify` 56/56.
Fake fixture keys (`workspace-aaa`, `wk-alpha`) in three CLI overlay tests
replaced with real 16-hex keys. Branch `fix/review-C1-stats-sibling-clobber`.

Lesson recorded in [[entities/stats]]: guarding ONE walker does not close the
defect class; grep every sibling `readdirSync(join(root, "stats"))` first.

NOTE: this file arrived at 0 bytes on `main` (emptied by a merge conflict
resolution in the five-branch merge, `5a13a8c2`/`d213947e`). The header and
prior entries are recoverable from `git show 259fed05:wiki/log.md`; not restored
here to avoid guessing at a parallel agent's rotation.
## [2026-07-25 21:00 +03] fix | saver completion heartbeat no longer masks a broken hook

Audit sweep (fail-open inversion): `buildSaverDecision` stamped a completion for
EVERY well-formed PostToolUse payload — including tools the saver never
processes (Write/Edit/TodoWrite), which return at the `resolveSourceKind` gate
before `recordInvocation`. That orphan completion was newer than the last
failure, so doctor’s `failing` filter dropped the entry and `saver-liveness`
downgraded from FAIL to “past hook failure(s), since recovered” while
compression was still dead. Fix: record a completion only when the run stamped
an invocation (`ctx.workspaceKey !== undefined`); the `process.cwd()` fallback
key is gone from the completion path (it stays on the failure path, where a
spurious attribution is fail-loud, not fail-open). Two RED tests: hook-level
invariant (`apps/cli/test/hooks/saver.test.ts`) + end-to-end doctor masking
(`apps/cli/test/doctor-saver.test.ts`); both fail on revert.

Sources: `apps/cli/src/hooks/saver.ts`, `apps/cli/src/commands/doctor-saver.ts`,
[[concepts/saver-activation-inheritance]].

---

## [2026-07-25] query | gui memory-graph flake: root cause was a wall-clock wait on a non-DOM signal

`apps/gui/test/components/memory-graph-panel.test.tsx` failed once under
full-monorepo `pnpm verify` (`capturedElements.length` > 0 timed out inside
`waitFor`) yet passed in isolation. Not a logic bug and not "slow CI" — a
structural race.

Measured with an instrumented probe: the panel commits the
`memory-graph-canvas` testid one event-loop turn BEFORE the effect that calls
`cytoscape()` and fills the mock's `capturedElements` (mutation batch at
+0.97ms with `elements=0`; cytoscape at +3.02ms). `waitFor` cannot observe a
plain module variable, so it converges only on a later mutation batch or its
50ms poll — both bounded by RTL's own 1000ms `asyncUtilTimeout`, which the
file's `testTimeout: 30_000` does **not** raise. A worker starved by turbo's
parallel run (gui jsdom environment took 113.94s) overruns that budget.

Fix is deterministic, not slower: `await act(async () => {})` drains the fetch
continuation, the re-render and the passive effect with no timers and no
deadline. Timeout was NOT raised.

Red/green proof by denying the wall clock (`configure({ asyncUtilTimeout: 0 })`,
a fully starved worker): HEAD helper 1 failed / 16 passed with the exact
reported `expected 0 to be greater than 0`; patched file 17/17. The suite now
has zero dependence on wall-clock scheduling.

Sibling defect fixed at the same root: the seven raw `tapHandlers[0](…)`
dispatches also set React state outside any flush, so their follow-up
assertions rode the same wall clock — the zero-budget run reddened them once
`waitForGraph` was fixed. Collapsed into a `tapNode(id)` helper that wraps the
dispatch in `act` and throws instead of silently no-op'ing when no handler is
registered (`if (handler)` could vacuously pass a broken test).

Test-only change; no package behaviour changed, so no changeset. Branch
`fix/gui-memory-graph-flake`. Evidence: single file 5/5 green, full gui suite
83 files / 531 tests green, type errors none.
## [2026-07-25 19:40 +03] rebase | long-memory hybrid recall onto main

Rebased `codex/feat/long-memory-hybrid-recall` (71 commits) onto `main`
(`e639a7ee`) as `rebase/long-memory-hybrid-recall`. The branch is purely
additive outside four files — it adds `packages/long-memory`,
`benchmarks/longmemeval-v2/`, its specs/plans, and wiki pages — so it does not
overlap the perf/correctness work that landed on main. One conflict, in
`wiki/log.md`; `wiki/index.md` and `wiki/agent-channel.md` auto-merged with no
entry lost.

`wiki/log.md` needed care: main's merge `5a13a8c2` left the file at zero bytes,
so a plain rebase would have carried only the branch copy and silently dropped
the 17 entries main gained after the fork. Resolved by three-way union against
main's last non-empty version `d213947e` — 221 entries, no duplicates, nothing
dropped from either side. The zero-byte file on main is a separate open defect
with its own branch (`fix/review-C2-wiki-log-wiped`).

`pnpm-lock.yaml` was reset to main's and regenerated with
`pnpm install --lockfile-only`; the result is byte-identical to the branch's
own lockfile (the `packages/long-memory` importer plus `fs-ext@2.1.1`,
`nan@2.28.0`, `@types/fs-ext@2.0.3`).

One test failed under a forced full run and not in isolation:
`packages/long-memory/test/lm2-index.test.ts` "stops catalog/direct work at
1,024 and raw text at 16 MiB". The harness sets `defaultTimeoutMs: 100` and
`createLm2IndexService` deadlines on real `performance.now()`, so on a loaded
machine the wall clock ended the run before the budget under test and the
receipt came back without a `nextCursor`. Pinned that one case to
`MAX_LM2_INDEX_BATCH_TIMEOUT_MS`. Pre-existing on the branch, not caused by the
rebase.

Evidence: `pnpm verify` exit 0; `Tasks: 58 successful, 58 total`. Forced
uncached runs also green — `turbo typecheck --force` 58/58 in 33.1 s,
`turbo test --force --concurrency=4` 58/58 in 2m2.9 s. Not merged, not pushed.
Also observed and left alone: `packages/context-gate/test/saver-heartbeat.test.ts`
"steals a stale lock file" flaked once under a forced full run and passes in
isolation; that file is untouched by this branch and the flake is main's.

## [2026-07-25 20:15 +03] fix | memory-graph ReDoS guards moved off the growth ratio

Both `parse-wiki` guards (instances 9 and 10) failed `pnpm verify` while passing
79/79 in isolation: under a 55-task parallel `turbo` run the anchor-strip ratio
read 15.9x and 12.6x against an 8x gate, and the same code measured 2-4x idle.
min-of-trials cancels spikes, not sustained load — every trial is slow and the
larger sample accumulates more preemption, so the ratio inflates on linear code.

Replaced with an absolute ceiling at a size that buys the separation: one call at
200 KB, 250 ms gate. Bounded costs 0.1-0.2 ms on all four shapes; reverted costs
34,000 / 4,740 ms (anchor strip) and 15,600 / 15,500 ms (wikilink). Red proof is
per-bound: reverting the anchor bound alone fails its two timing tests at 67.2 s
and 9.5 s while the wikilink suite stays green, and reverting the wikilink bound
alone fails its two at 30.6 s each while the anchor suite stays green. Each
revert also fails its own behaviour pins, so the guards are not timing-only.

Same instrument the context-gate guard moved to in `0e8f3362` (PR #301), for the
same reason. Sources: [[concepts/unbounded-run-redos]] "…but the ratio breaks
under a parallel turbo run".

## [2026-07-25 18:45 +03] docs | correct the stale 26-tool count to 35

`wiki/index.md` and the v1.2 section of `wiki/entities/mcp-bridge.md` still
claimed the bridge ships 26 tools. That was true at the Phase 0–10 merge; tools
were added afterwards without the line being updated, and the stale figure
propagated OUT of the wiki into a bug report ("every one of the 26 tools"),
which is the concrete cost of leaving it.

The 26 is kept where it is genuinely historical, marked as such and pointed at
the current count. `TOOL_DEFS` in `src/server.ts` is named as the authority, and
`server.e2e.test.ts` already asserts the count, so the wiki now defers to a
checked source instead of restating a number that drifts.

Also fixed a contradiction introduced by [2026-07-25 16:20]: that entry's
mcp-bridge section said "all 26 tools" while the later section corrected it to
35 — two figures in one page. `log.md` history is left as written (schema hard
rule #3: contradictions are flagged, not rewritten).

## [2026-07-25 19:40 +03] fix | dedupe growth-ratio guard gets the retry it lacked

The guard failed CI at 3.178 vs a 2.75 threshold on a DOCS-ONLY PR (#305), so the
change could not be causal.

The chip that opened this work proposed converting it to a wall-clock ceiling,
"as #301 did". That premise was WRONG and acting on it would have regressed us:
this guard shipped with a 5 s ceiling and was deliberately moved OFF it in
07a4e3dc, with measurements showing the reverted scan cost only 1.4x the ceiling
— a faster machine greens it with the quadratic restored. The repo runs both
patterns on purpose, chosen per test by measurement; `session-hints-redos` opens
with "Why an absolute ceiling and not a growth ratio" and this file opens with
the mirror image.

Measured before changing anything (node v25.8.2, 10 cores, guard's own harness):
linear 1.999-2.024 idle, 1.838-2.104 at 2x oversubscription, all-pairs
3.916-3.992. **Uniform CPU load does not move the ratio** — both samples inflate
together — so the chip's stated root cause ("scheduler noise affects the two
measurements unequally") does not reproduce and is not established. The 3.178
remains undiagnosed.

Fix: `retry: 3`, the idiom every other timing guard already carries and this one
alone lacked. Proven load-bearing twice, independently: restoring the all-pairs
scan WITH the retry active went red on all four attempts (3.929 / 3.897 / 3.831
/ 3.885), and a reviewer reproducing the mutant from scratch read 3.973 / 3.898
/ 3.929 / 3.865. Lowest of twelve quadratic measurements is 3.831, 1.39x the
threshold. The guard runs 3.6 s banded vs 395 s all-pairs.

Same-class gap left open deliberately: `content-store/prune-scan-cost` and
`policy/redact-redos` are also growth-ratio guards without a retry. Each needs
its own margin measured before getting one — a retry on a thin-margin guard
would mask a real regression.

Sources: [[docs/superpowers/specs/2026-07-25-dedupe-guard-flake-design]],
[[docs/superpowers/plans/2026-07-25-dedupe-guard-flake-plan]].

## [2026-07-25 21:15 +03] fix | successful stale-lock steal was abandoned at the deadline

`main` had been red since 07a4e3dc on two lock tests (`saver-heartbeat` E25,
`saver-seen-concurrency`). Chasing them found ONE root cause, and it is a
production defect rather than two flaky tests.

`withFileLock` removed a stale lock and then re-checked the deadline BEFORE
retrying the acquire, so a steal whose syscalls outran `deadlineMs` returned
false having just cleared the only obstacle to the write — the caller then
skipped its write. The old comment justified the bail with "staleMs >>
deadlineMs, so a stale lock means the deadline has effectively passed", which
is true only when the steal FAILED.

Quantified rather than argued: the steal path costs four syscalls, p50 ~0.18 ms,
but p99 29.8 ms idle / 39.6 ms under 3x load over 200 samples — against shipped
deadlines of 10 ms (`saver-heartbeat` LOCK_WAIT_MS) and 50 ms (`saver-seen`). So
~1 in 100 steals succeeds and is abandoned on an IDLE machine. E25 ("a crashed
writer can never freeze its callers forever") therefore failed precisely on the
slow machines where a crashed writer is most likely.

Honest boundary: NOT claimed as the fix for the two red tests. Neither
reproduced locally — `saver-heartbeat` passed 3/3 under 2x oversubscription with
the fix reverted. What is established is a real, deterministic defect whose
failure signature (a skipped write ⇒ `expected {} to have property "aaaa"`) and
measured rate match both symptoms.

Also noted: the existing `file-lock` test "steals a STALE lock and runs fn" uses
`deadlineMs: 10` and is exposed to the same p99 tail — it has been passing on
luck, not margin.

Sources: [[docs/superpowers/specs/2026-07-25-stale-lock-steal-abandoned-design]],
[[docs/superpowers/plans/2026-07-25-stale-lock-steal-abandoned-plan]].

## [2026-07-25] fix | six super-linear redaction patterns (@megasaver/policy)

Closed instances 4-6 of [[concepts/unbounded-run-redos]]. `redact()` /
`redactWithFindings()` / `redactForLedger()` run over arbitrary tool output
under a 4 MB cap (`packages/daemon/src/handlers.ts:76,78`), and truncation
happens *after* redaction, so the cap does not protect the regex engine.

Two mechanisms, chosen per pattern by measurement. `aws_secret_key`,
`api_key_header` and `basic_auth_header` gained a first-character **lookahead
guard** placed before their lookbehind (15,023 / 4,846 / 5,711 ms per 100 KB of
whitespace, down to 0.36 / 0.26 / 0.44 ms) — provably equivalent, since each
guard's class is exactly the body's first-character set. `db_url`,
`url_basic_auth`, `private_key_block` and `email` gained **bounds**.

Two of the audit's own proposals were measured and rejected: the suggested
`db_url` password bound of 256 leaves `postgres://user:<JWT>@host` in
cleartext (2048 shipped), and a `{1,100000}` body bound on `private_key_block`
is 3x *slower* than no bound at all, because V8's counted lazy loop costs ~2x
per step (32768 shipped). A colon-free `db_url` username, which would have
needed no bound, was rejected on 8,862 losses in 200,000 seeded trials.

Disclosed coverage loss, hence a minor and not a patch: db/URL userinfo
passwords over 2048 chars and PEM bodies over 32 KB are no longer redacted.
`email` bounds only its local part — a domain bound has a total-loss shape
that the local-part bound does not.

Evidence: red proof 17 of 43 assertions failing (775 s), green **68/68 (5.0 s)**
after review remediation; `pnpm verify` 56/56 tasks; `@megasaver/policy` 281
tests, no type errors. Every figure is regenerated by the committed harness
`scripts/redos-probe.mjs {timing,fuzz,bounds}`. Mutation: 29/29 killed on the
pattern table.

**Review chain ran; it changed the outcome materially.** Four reviewers, none
the author: security-reviewer APPROVE_WITH_FIXES (2 blockers), critic NEEDS WORK
(6 defects), code-reviewer approve-with-changes (5 must-fix), verifier not
sufficient to merge. Both blockers were real and are fixed:

1. The 2048 password bound left a ~2.5 KB JWE and a ~2.2 KB AWS RDS IAM token in
   cleartext. The first fixture used a JWS, which `jwt` redacts anyway, so the
   bound was never actually tested. Now 8192, with opaque fixtures.
2. Bounding `email`'s local part removed an accidental backstop and let ~99% of
   an over-bound URL password persist into the value-free firewall ledger.
   `redactForLedger` now contains it independently and cliff-free.

Also fixed: `redact.ts` was entirely unfenced (a 200 KB size gate passed all 259
tests — found independently by two reviewers); three mutant survivors on the
un-pinned patterns; and four false or unreproducible statements in the shipped
comments and the §5a footnote, including a bound-size claim that reverses at the
4 MB cap and an inverted description of a rejected `email` guard. Three cited
fuzz counts were corrected and one withdrawn as unreproducible.

Still outstanding: `architect` and `tracer` passes; TDD ordering is
unverifiable from a single uncommitted tree; the ~6.3 s residual for
`private_key_block` at the 4 MB cap is linear but unpinned by any test. Filed
separately: `private_key_block` never matches unlabelled PKCS#8 or PGP keys
(pre-existing). Worktree: `claude/hungry-yonath-a2a359`.

## [2026-07-25] fix | private_key_block header coverage (PKCS#8 + PGP)

Follow-up to the super-linear fix above, found by its security review.
`private_key_block`'s `[A-Z ]+` required at least one character between `BEGIN `
and `PRIVATE KEY`, so **unlabelled PKCS#8** (`-----BEGIN PRIVATE KEY-----` — what
`openssl genpkey` emits, and what GCP service-account keys and Kubernetes TLS
secrets carry, arguably the most common modern form) never matched, and **PGP**
private key blocks failed on the trailing ` BLOCK`. A 2,400-char PKCS#8 key
passed `redactWithFindings` with `findings: []` and landed verbatim in the
firewall ledger. Pre-existing in the §5a locked baseline, not introduced by the
super-linear work.

Fix: `[A-Z ]*` plus an optional `(?: BLOCK)?` on both markers. All seven real
header forms now redact; `PGP PUBLIC KEY BLOCK`, `CERTIFICATE`, `PUBLIC KEY`,
`PGP MESSAGE`, a lowercase header and a prose `-----BEGIN PRIVATE KEY-----` with
no END are pinned as must-not-match.

Accepted cost, disclosed: both shapes were previously non-matching, so a run of
them was free and is now priced like a run of labelled markers. At 400 KB PKCS#8
goes 0.4 → 649 ms and PGP 0.4 → 466 ms, both linear (x2.04, x2.30), each with its
own growth assertion. The 4 MB residual class is unchanged in magnitude; three
seeds reach it now instead of one.

Evidence: red 3 of 76 failing (§5a pin, PKCS#8, PGP), green 76/76; policy package
289/289, no type errors; `pnpm verify` green. Mutation: reverting `*`→`+` fails 2,
dropping `(?: BLOCK)?` fails 2, loosening `PRIVATE KEY`→`[A-Z ]*KEY` fails 3
(the over-redaction negatives are load-bearing), unbounding the body fails 5.
§5a row amended in the same change. `scripts/redos-probe.mjs fuzz` now separates
gains from losses: 10,253 gained here against the 13,459 disclosed bound losses.

Outstanding: CRITICAL chain reviewers (architect, security-reviewer, critic) not
yet run on this amendment. Worktree: `claude/hungry-yonath-a2a359`.

## [2026-07-25] review | PKCS#8 amendment — CRITICAL chain outcome

architect APPROVE_WITH_FIXES, security-reviewer APPROVE_WITH_FIXES (1 real leak),
critic NEEDS WORK (6 surviving mutants). All fixed.

**A third header was still leaking.** `-----BEGIN PGP SECRET KEY BLOCK-----` —
GnuPG's armour table has three key-block headers (PRIVATE, PUBLIC, SECRET), and
the first attempt widened only the label and the ` BLOCK` suffix. Same defect,
one word over, found by the same method. Pattern noun is now
`(?:PRIVATE|SECRET)`.

**Six mutants survived the suite**, each failing only the §5a byte pin, which
fires on any character change and detects nothing behavioural. The two
substantive ones: dropping the body's lazy `?` (one match spanning two keys,
`count` 2→1, text between them destroyed) and loosening only the **END** label —
every negative fixture paired matching BEGIN/END labels, so the END marker was
never consulted. All six now killed behaviourally, plus a backreference mutant
the architect predicted.

**Measurement corrections.** Two reviewers disagreed on the 4 MB cost (11 s vs
6 s); an idle-box re-run settled it at 6,976 ms for the new worst seed against
5,760 for the pre-existing one — the ceiling moves **+21%**, not 3x, since an
attacker picks the best seed and the labelled one already sat at it. The earlier
"three seeds instead of one" framing invited reading exposure as tripled and is
withdrawn. Also corrected: 13,340 → 13,333 (a figure this session had already
"corrected" once, and got wrong again), ~32,264 → 32,262 base64 chars, and a
"fails three assertions" claim that is two.

**Two design claims of mine were false.** The future-proofing argument for
`[A-Z ]*` — measured, `openssl genpkey` emits *unlabelled* PKCS#8 for ML-DSA and
ML-KEM, so new algorithms arrive with no label at all and an alternation would
cover them equally. The real reasons are error-cost asymmetry and not needing a
§5a amendment per vendor label. And a comment claiming backreferences are
unavailable because `$1` is literal — true of the replacement, false of the
pattern.

Two over-redactions accepted and pinned: text quoting both markers. The
mitigation (require a newline after BEGIN) would break GCP service-account JSON,
which uses literal `\n` escapes.

Still uncovered, filed separately: RSA-PSS and SSH2 labels (`[A-Z ]` excludes
digits and hyphens), RFC 4716 four-dash armour, PuTTY .ppk, age, JWK/JSON.

## [2026-07-25] fix | private-key coverage: label grouping + 4 non-PEM detectors

Follow-up to the PKCS#8/PGP amendment. Two parts.

**1. The label class was hiding 25 of OpenSSL's own private-key labels.**
`[A-Z ]*` covered 7 of the 32 labels ending in `PRIVATE KEY` in OpenSSL 3.6.2's
PEM table. Missing: the entire NIST post-quantum set (ML-DSA, ML-KEM, twelve
SLH-DSA), every modern curve (ED25519/ED448/X25519/X448), SM2, RSA-PSS, and
X9.42 DH (a dot). The SLH-DSA labels end in a lowercase `f`/`s`, so an
all-uppercase assumption is wrong — a fixture asserting that had to be withdrawn.

The task that filed this said the gap was "RSA-PSS and SSH2". Both turned out to
be wrong in an instructive way: RSA-PSS emits `-----BEGIN PRIVATE KEY-----`
(already covered), and SSH2 exists only in the FOUR-dash RFC 4716 form. The real
list came from `strings libcrypto | grep 'PRIVATE KEY$'` — the same technique
that found PGP SECRET KEY BLOCK in gpg.

Shipped a GROUPED label (`(?:[A-Za-z0-9]+(?:[.-][A-Za-z0-9]+)* )*`), not a
widened class. The obvious simplification is the trap: `[A-Za-z0-9. -]*` covers
every character of `-----BEGIN A PRIVATE KEY-----`, so the label run swallows the
whole input and backtracks — x7.13, 1,148 ms at 16 KB. Bounding it to {0,64} is
linear but 4x. Requiring each `.`/`-` to sit BETWEEN alphanumerics stops the
label crossing a `-----` at all, costing what the old narrow class did (~600 ms
per 400 KB) while covering 32/32. It is a nested quantifier, so it was attacked:
7 (X+)* shapes all x1.81-2.04, sub-1.1 ms.

**2. Four detectors for carriers that are not PEM-armoured at all**:
`ssh2_private_key_block` (RFC 4716), `putty_private_key`, `age_secret_key`,
`jwk_private_key`. All linear on their own no-terminator seeds; none overlaps
another. The JWK one is gated on `kty` in the same object because an ungated
`"d":"…"` matched 2 of 3 benign JSON objects, and uses a lookahead so the fields
may appear in either order.

Evidence: red 19+1 (labels + §5a pin), then 8 (new detectors); green 354/354;
`pnpm verify` exit 0, 56/56. Mutation on the grouped label, baseline 381: bounded
class 5 failed, unbounded class 4 (caught by the negatives, not just the slow
timing test), lose-lowercase 13, drop-continuation 21, revert-to-[A-Z ]* 26.
Four fixtures (`A- `, `-A `, `A. `, `A--B `) pin the grouping behaviourally.
§5a amended a third time; harness seeds added for all four new detectors.

Note: an orphaned vitest worker from an earlier reviewer agent was found pinning
a core at 97% for ~5 hours and skewing measurements; killed. Check for those
before trusting timing numbers.

Outstanding: CRITICAL chain (architect, security-reviewer, critic) not yet run on
this change. PKCS#12 remains uncovered (binary, out of scope).

## [2026-07-25] review | key-coverage change — CRITICAL chain round 2

architect APPROVE_WITH_FIXES, security-reviewer APPROVE_WITH_FIXES (1 HIGH leak),
critic NEEDS WORK (11 surviving mutants). All fixed; 381/381, verify exit 0.

**A leak I introduced.** `jwk_private_key` sat after the prefix detectors.
base64url contains `-`/`_`, so `sk-`/`ghp_` occur inside real key material; the
earlier detector's replacement inserts `[`, the `d` run can no longer reach its
closing quote, the lookahead fails, and the WHOLE object survives — 63 per
100,000 RSA-2048 JWKs, with 5 of 6 CRT parameters intact, which alone
reconstruct the key. Fixed by moving the detector ahead of every prefix
detector, which is what the table's own ordering principle (structural-span
before value-shaped) already implied. The architect had endorsed the placement
without testing the interaction; the security reviewer found it by generating
100,000 real-shaped JWKs.

**Eleven mutants survived, all in the four new detectors**, and the two root
causes were structural: the `.flags` test enumerated seven names and none of the
four new ones (so every `/g`-dropped mutant lived), and the new detectors had no
byte pin — the mechanism that makes every bound-edge mutant against
`private_key_block` die instantly. Both fixed; all 12 mutants now killed. Two
source comments asserted properties no test checked and a mutant falsified
(`age`'s uppercase class does NOT exclude the public half — the prefix does;
`jwk`'s `[^{}]` containment was untested). Both corrected and pinned.

**A timing test I added measured a pattern that never matches.**
`"AGE-SECRET-KEY-1".repeat(n)` never forms a 50-char `[0-9A-Z]` run because `-`
terminates the class. Vacuous — in the same session that put "assert a minimum
match count before asserting anything about what a corpus produced" into
[[concepts/redos-guard-testing]]. The rule exists because of this workstream and
was broken inside it.

**The CI gate was flaky and my "verify green" was luck.** `measure()` used
median-of-3 where the committed harness uses min-of-3 and documents why; the
`putty_private_key` gate failed all four retries for a reviewer at x3.3-4.1
while min-of-15 measured x1.90-2.02. Switched to min-of-3 and moved the rungs
from 128/256 to 256/512 KB, where the taper ratio is x2.03 rather than x2.14.
Now x2.02/x2.04 against a 3.0 threshold, stable over three consecutive runs.

**Counts, again.** "10 of 29" was wrong: it is 7 of 32 concrete labels (33
strings minus the `%s PRIVATE KEY` printf template), going to 32 of 32. I read
it off a truncated grep instead of computing it — the third arithmetic-from-
eyeballing error in this workstream. `scripts/redos-probe.mjs` gained a `labels`
mode so the figure and the cost comparison are now regenerated, not asserted;
its `private_key_block` pattern was also still the superseded form in two places,
so the harness had been measuring code that was not shipped, and its fuzz
generator emitted no digit/dot/hyphen label, giving the grouped change zero
differential coverage.

Newly disclosed rather than discovered later: `putty_private_key` consumes any
text naming its header and a later `Private-MAC:` (bound cut 32768 -> 8192,
which is 4x less collateral and loses no real key type); `jwk_private_key` misses
any JWK with a nested object sibling and any object over 4096 chars.

Outstanding, filed or noted: `AWS_SECRET_ACCESS_KEY=<40>` unquoted uppercase is
not redacted at all (pre-existing, most common form an agent sees); base64-
wrapped PEM in k8s secrets needs a decode-and-rescan step, not a pattern; §5a
still calls itself "the 10 baseline entries" while REDACTION_PATTERNS holds 24,
which wants its own ADR. All three reviewers recommended splitting the four new
detectors into their own change; not done, and that recommendation stands.

## [2026-07-25] fix | nine credential carriers beyond key files

Closes every leak the CRITICAL-chain security review enumerated except the ones
it judged out of scope for a text redactor. Detectors: `aws_session_token`,
`json_secret_field`, `netrc_password`, `npm_token`, `pypi_token`, `vault_token`,
`ansible_vault`, `bip32_xprv`, `base64_pem_block`; plus the `i` flag on
`aws_secret_key`.

**The AWS one was the most embarrassing gap.** `AWS_SECRET_ACCESS_KEY=<40>`
unquoted uppercase — a .env, `printenv`, a CI log, the single most common form an
agent ever sees — matched NOTHING, because the lookbehind literal is lowercase
(the ini form) and `env_value` requires quotes. Pre-existing; the previous round
re-pinned that row's §5a bytes without noticing.

**`base64_pem_block` needed two attempts and the first shipped an
over-redaction.** `kubectl get secret -o yaml` carries a whole private key
base64-wrapped, so no armour marker appears. It is regexable because
`-----BEGIN ` sits at offset 0 and base64 alignment is therefore deterministic —
but `LS0tLS1CRUdJTiB` is the base64 of `-----BEGIN `, which EVERY armour shares,
so the first version redacted base64-wrapped certificates and public keys too.
Caught by a surviving mutant (truncating the prefix passed all 418 tests),
which is exactly what mutation testing is for: the mutant was flagging a missing
negative fixture, and the missing fixture was hiding a real defect. Fixed by
spelling the label in base64 across the three phase alignments of `RIVATE KEY`;
12 of 12 correct across six private and six non-private armour forms.

`bip32_xprv` covers extended PRIVATE keys only. WIF keys are deliberately not
covered — bare base58 has no distinguishing prefix and the false-positive cost on
ordinary text is too high.

Evidence: red 9, green 428/428, `pnpm verify` exit 0 (56/56). All new detectors
linear (x1.60-2.41) on their own worst no-terminator seeds, with harness seeds
committed. Mutation: 15 mutants across the nine, all killed after the base64 fix;
0 over-redaction across 12 negative fixtures. REDACTION_PATTERNS is now 32 entries plus the single
`email` observer (an earlier note said 33 by summing the two exported tables).

Still out of scope, stated rather than implied: PKCS#12/.pfx, Java JKS, .NET
.pvk (binary), forwarded ssh-agent material (a socket). BIP39 mnemonics need a
wordlist, not a regex. §5a still calls itself "the 10 baseline entries" while the
array holds 33 — that ADR is still owed. All three reviewers' recommendation to
split the post-lock detectors into their own change still stands and is the
user's call at merge.

## [2026-07-26] decision | ADR — what the §5a redaction lock covers

Closes the ADR the 2026-07-25 entry recorded as owed. Two reviewers had flagged
§5a: it says "the 10 baseline entries" while the shipped table holds 32 plus the
`email` observer, so nobody could enumerate which rows are locked.

Decision: **the lock covers the original ten and now says so** (option 2), with
one correction — the amendment tier is keyed to what a change *does*, not to
which table a row lives in. Editing any row's bytes/flags/replacement/validate,
moving a row, or inserting before `jwk_private_key`/`jwt` is CRITICAL for all 33
rows; appending a detector that preserves the ordering constraint is HIGH.

Rejected option 1 (lock everything, all CRITICAL): every leak this table has had
was *missing* coverage — PKCS#8, `ASIA`, `github_pat_`, unquoted
`AWS_SECRET_ACCESS_KEY=` — never a bad addition. Taxing additions with the
CRITICAL chain points the process at the wrong failure. Rejected option 3
(generate from source), agreeing with the architect pass and adding the decisive
reason: a generated record makes `expect(source).toBe(record)` tautological, so
it deletes the drift detector it was meant to serve. Adopted one slice of it as
follow-up F1 — a name-set *completeness check*, not a generator.

Measured while writing it, and the reason option 2's naive framing would have
been false: exact `.source` pins exist for **5 of the 10** lock rows and **13 of
23** post-lock rows. `anthropic_key`, `openai_key`, `bearer_token`, `env_value`
have neither byte nor flags pin; `jwt` has a prefix pin only. Table membership
has not predicted rigor — "amended by a dated spec since 2026-07-19" has.

New §5b enumerates all 23 post-lock rows with owning spec. Six have **none**:
`url_basic_auth`, `url_query_secret`, `cli_secret_flag_eq`,
`cli_secret_flag_spaced`, `api_key_header`, `basic_auth_header` shipped
2026-06-17 in `b2e39cdf` (PR #150) before per-detector spec discipline; recorded
as-is rather than back-attributed. Conversely the 2026-07-19 extension design
specifies ~28 vendor detectors (`stripe_*`, `slack_*`, `gitlab_*`, …) that are
**not** in the table — record drift runs both ways.

Follow-ups filed in the ADR, none implemented: F1 completeness check, F2 pin the
four unpinned lock rows, F3 `PREFIX_DETECTORS` is a hardcoded list whose comment
claims it is exhaustive and nothing checks that (a new prefix detector inserted
before `jwt` passes the ordering test vacuously), F4 reconcile the 07-19 design.

Evidence: docs-only, no regex touched. `pnpm --filter @megasaver/policy test`
566/566, `pnpm lint` clean. Record/shipped name sets verified equal by hand
(33/33, no missing, no extra, no duplicates) — that check is F1.

## [2026-07-26] lint | split the 529-line ReDoS concept page

`wiki/concepts/unbounded-run-redos.md` had reached 529 lines — five times the
`wiki/CLAUDE.md` hard-rule-8 ceiling of 100. Two branches grew it in parallel and
the merge left it mixing three kinds of content plus visible merge scars: an
orphan `## Deferred: instance 4 (email)` heading immediately above the section
recording instance 4 as fixed, a `## Correction to an earlier record here`
section restating the same `email` correction a second time, and a
`## Lesson for the guard test` block that duplicated the opening of
[[concepts/redos-guard-testing]] (the extracted method page) verbatim.

Split as follows. Nothing was deleted, so nothing went to `archive/` — every
line of the old page landed on one of these:

- [[concepts/unbounded-run-redos]] (529 → 99) keeps only the registry: the
  defect shape, its variants, why the repo recurs on it, the instance table with
  a write-up link per row, the fix moves, and "not this class".
- [[concepts/redos-case-context-gate]] (86) — instance 6.
- [[concepts/redos-case-output-filter]] (83) — instances 7, 8, 9-pytest.
- [[concepts/redos-case-output-filter-siblings]] (93) — instance 9's five
  `^\s*`-under-`m` siblings.
- [[concepts/redos-case-policy]] (79) — instances 4 and 5, plus the LOCKED-table
  note and the absorbed `email` correction.
- [[concepts/redos-case-memory-graph]] (71) — instance 9's two `parse-wiki.ts`
  patterns.
- [[concepts/redos-growth-ratio-measurement]] (99) — new method page holding all
  the n-vs-kn instrument material that had accreted on the registry.
  [[concepts/redos-guard-testing]] (88) absorbed the three non-duplicated
  sentences from the duplicated "Lesson" block and now links to it.

Case-study pages went to `concepts/` rather than into the owning entity pages:
`entities/policy` (318), `entities/output-filter` (207) and
`entities/context-gate` (112) are each already over the 100-line rule, so
folding would have compounded an existing violation. `@megasaver/memory-graph`
still has no entity page.

Two content corrections made while splitting, both flagged on the pages:

- The variant list said "Three variants" while two later headings called
  themselves the "Third variant" and the "Fourth variant" of a differently
  ordered set. Now five **named** variants, no ordinals.
- Instance-table row 10 said "see below" but no instance-10 section had ever
  been written — its write-up is [[concepts/lookahead-start-guard]]. Row now
  points there.

`wiki/index.md`: three stale duplicate `unbounded-run-redos` bullets claiming
"9 instances, 2 still open" (a merge artefact contradicting the correct bullet
four lines above) removed; six new pages catalogued; one Q&A row added for
guard construction.

Evidence: no page renamed, so no inbound link changed —
`concepts/glob-compile-redos`, `concepts/lookahead-start-guard`,
`concepts/redos-guard-testing`, `entities/output-filter` and `index.md` all still
resolve. Wiki-wide `[[link]]` scan: 0 new dangling links (the one pre-existing
dangler, `[[entities/evidence-ledger]]` in `entities/agent-office.md`, is
untouched and predates this work). All 137 measurement tokens from the old page
(ms/s/x/KB figures and every table cell) verified still present in the wiki by
mechanical diff, and 204 source sentences checked for content loss — the 44 that
moved are the reworded headings, the merged duplicate method sections, and the
rebuilt `Related` lists. Every page touched is now under 100 lines.

## [2026-07-26] fix | credential path denials + seven vendor/connection-string detectors

Task 2 of the four queued policy follow-ups (T1 jwt reorder, T3 lock-scope ADR and
T4 wiki split landed alongside; see their own entries).

**Part A — the asymmetry that mattered more.** `DENYLIST_GLOBS` had no `.netrc`,
`.npmrc`, `.pypirc` or `.git-credentials`, so the previous round's output-side
detectors (netrc_password, npm_token, pypi_token) were the ONLY line of defence:
an agent could read those files directly and the detectors only caught whatever
leaked into tool output afterwards. Added five globs (`_netrc` too — the Windows
name). Verified through the real `evaluatePathRead` gate, not the glob in
isolation, and pinned four allow-neighbours (`npmrc`, `.npmrc.bak`,
`netrc-format.md`, `.pypirc.example`) so the globs cannot grow into over-denial.

**Part B — seven detectors.** `connection_string_secret` (ADO.NET/ODBC/Azure
semicolon strings — `url_query_secret` needs `[?&#]`, `cli_secret_flag_eq` needs
`--`, `env_value` needs quotes, so none reached them; `AccountKey` is full
control of an Azure Storage account), plus `stripe_key`, `slack_token`,
`gitlab_token`, `sendgrid_key`, `digitalocean_token`, `twilio_api_key`.

Two judgement calls, both measured rather than asserted:
- Stripe's `pk_` PUBLISHABLE key is deliberately excluded and pinned as
  must-not-match. `openai_key` is `sk-`, Stripe is `sk_`; checked both
  directions so neither claims the other.
- `twilio_api_key` (`SK` + 32 hex) is the loosest shape in the table and there is
  no further structure to gate on. An invented "commit SK<32hex>" string DOES
  match it. Included anyway on corpus evidence: **0 false positives across 22,083
  files / 189 MB** of this repo plus node_modules. The invented fixture was the
  artifact, which is the same trap a previous reviewer fell into. The shape risk
  is the disclosed cost.

Evidence: 610 passing (was 566 after T1/T3/T4), typecheck clean. All seven linear
(x0.99-2.01 per doubling on their own no-terminator seeds) with probe seeds
committed; six declared MATCH_FREE_BY_DESIGN because they are anchor-scan seeds.
Field name survives redaction (`Password=[REDACTED];Encrypt=True`) so the
connection string stays readable. §5b extended to 30 post-lock rows; the
REDACTION_PATTERNS table-size pin moved 32 -> 39.

Outstanding: this batch has NOT been independently reviewed — the workflow's three
review agents all died on API 529. That review is the remaining gate.

## [2026-07-26] review | policy follow-ups, single reviewer (three died on 529)

APPROVE_WITH_FIXES. T4 clean and needed nothing; T1's forward claim reproduced
independently (250k JWTs, 0 losses); 65 mutants, 0 survivors. Two blocking, and
both were real:

**F1 — T1's "strict superset" claim was false.** `jwt`'s third segment
`[A-Za-z0-9_-]+` is greedy and unbounded, so it swallows a following base64url
run including a later detector's INDICATOR. Measured: `<jwt>aws_secret_access_key
= <40>` now reports only `jwt` and leaves the AWS secret in cleartext; same for
`bearer`, `SG.`, `hvs.`. The loss occurs iff the two are joined by zero or more
`[A-Za-z0-9_-]` characters — every other separator is safe, which is why no
realistic tool-output shape triggers it. The claim is now replaced by the measured
condition and pinned: four loss rows plus eleven safe separators.

**F2 — `connection_string_secret` destroyed `PWD=`**, the universal shell
variable, in every `env`/`printenv`/`set -x`/CI log. Mine, written an hour
earlier. The reviewer's suggested fix (narrow the separator to `(?:^|;)`, drop the
dead `/m`) was necessary but NOT sufficient — `PWD=` at position 0 still matched
`^`. Dropped the `pwd` field entirely; `Pwd=` is only an ADO.NET alias for
`Password=`, so the canonical spelling covers the carrier.

Also fixed: `/m` was dead and its comment claimed otherwise (a mutant dropping it
survived all 262 behavioural tests, killed only by the flags pin); the ADR and
§5a's scope paragraph carried pre-T2 counts in paragraphs ADJACENT to a correct
§5b (39/30/40, not 32/23/33); the `jwt` attribution figure was stale AND
understated — re-measured at 367 losses per 250,000 (146.8 per 100k) with
`sendgrid_key` at 63, a detector the record omitted entirely while the committed
test printed it on every run.

`**/.npmrc` was REMOVED from the denylist. A project `.npmrc` is pnpm settings —
this repo's own is four lines — and there is no field to un-deny a baseline path
(evaluate-path-read I1), so denying it blinds the agent permanently with no
appeal. The credential case is `~/.npmrc`'s `_authToken`, which `npm_token`
covers in output. `.netrc`, `_netrc`, `.pypirc`, `.git-credentials` stay: they are
credential stores by definition.

Three probe seeds were vacuous — `SG.`, `SK` and `;password=` each died before
scanning anything, the last because the `(?=[^;\s])` guard rejects every position
in it, making the row a guard test that could not fail. All three now match.

Coverage added while in there: `whsec_`, `xapp-`, five more GitLab prefixes,
`do[opr]_v1_`, and Azure `SharedAccessSignature=` — which nothing reached, because
`sharedaccesskey != sharedaccesssignature` and `url_query_secret` carries
`signature` but not the `sig=` a SAS actually uses. `twilio_api_key` renamed to
`twilio_api_key_sid`: it matches the Basic-auth username, not the secret, and the
old comment's justification was wrong about its own shape.

Evidence: 635 passing (610 before this pass, 557 on origin/main), typecheck and
lint clean. Behavioural fixtures added for the three mutant classes the reviewer
identified as pin-only-and-dangerous: the ceiling mutant (still matches, so it
redacts a prefix and reports green over a live key), the value-class widening, and
three connection-string field names with no coverage.

## 2026-07-26 — policy: three disclosed carrier gaps closed

Closed the three gaps §5b's "Disclosed coverage gaps" table recorded as known
and unclosed. Twelve shapes measured `fired: (none)` against `769d7efd`; all
twelve redact. New row `slack_webhook_url` (public surface: `findings[].name` is
a grouping key in `pro-analytics/src/firewall-report.ts`), placed immediately
after `jwt` and ahead of every prefix detector. `gitlab_token` alternation
completed to GitLab's full documented set. `connection_string_secret` gained
three bounded `\s{0,8}` gaps and quoted alternatives.

Linear: growth x2.03–2.07 across five seeds, 512 KB → 4 MB. The `\s{0,8}` gaps
cost 1.6x constant on a benign 200 KB log (0.52 → 0.82 ms).

**Measurement hazard, second occurrence.** Every timing figure taken before the
box was checked was worthless: 60 orphaned vitest workers and 30 orphaned
busy-wait shells (`while :; do :; done`, from a deleted `lock-steal` worktree
whose lock-contention benchmark spawned `CORES*3` hogs and whose `kill $HOGS`
never ran) had held the 10-core box at **load 124 for 16 h 52 m**. Provably
linear patterns measured growth ratios from x0.97 to x13.70, non-monotonically.
min-of-N does not help — at that load there is no quiet slice. `redos-probe.mjs
carriers` now refuses to print a ratio above 0.75 × cores. See
[[wiki/concepts/redos-growth-ratio-measurement]].

Also found: `scripts/redos-probe.mjs` had drifted from the shipped table — its
`connection_string_secret` row still carried the `pwd` field dropped from
production, so the row measured a regex that does not ship. The probe
transcribes patterns by hand; the byte pins in the suite are the only thing
tying them to reality.

Sources: [[docs/superpowers/specs/2026-07-26-carrier-residual-gaps-design]],
[[docs/superpowers/plans/2026-07-26-carrier-residual-gaps-plan]].

## 2026-07-26 — probe/table drift now fails CI

`scripts/redos-probe.mjs` transcribes 28 shipped regexes (`AFTER` 7,
`NEW_DETECTORS` 21). Two had drifted. New
`packages/policy/test/redos-probe-parity.test.ts` imports the probe's real
`RegExp` objects and compares `.source` and `.flags` against the union of
`REDACTION_PATTERNS` and `OBSERVED_PATTERNS`. Green on arrival, so it was
mutation-verified four ways — source drift, flags drift, a renamed detector,
and a dropped export — each turning it red.

Enabled by an entry-point guard on the probe's CLI dispatch and its
`assertSeedsMatch()` call. Both set exit codes and neither belongs in an
importer's process; without the guard a bare `import` runs `timing` (observed:
it ran until the 2-minute timeout).

Chose "loud" over "impossible" deliberately. Importing the built `dist` would
need `REDACTION_PATTERNS` added to the package's public exports, and would
trade transcription drift for staleness drift — a probe run against a stale
build measures the previous pattern and looks identical. See the spec's §2.

Scope is truthfulness, not coverage: 28 of 41 detectors are probed and the
other 13 stay unmeasured by choice. Also found and left alone: 3 of
`MATCH_FREE_BY_DESIGN`'s 17 entries are not `NEW_DETECTORS` keys, so they
exempt nothing.

Sources: [[docs/superpowers/specs/2026-07-26-probe-parity-design]],
[[docs/superpowers/plans/2026-07-26-probe-parity-plan]].

## [2026-07-25] fix | home credential stores reach the model (denylist + redaction)

Two independent gaps, one table each. `resolveSafeReadPath` deliberately admits
`homedir()` as a sandbox root (`packages/output-filter/src/resolve-safe-read-path.ts:32`),
so the LOCKED §4a denylist is the only thing between an agent and every
credential file under `$HOME` — and it listed neither `.pgpass` nor the
`docker`/`kube`/`gh` stores.

**(a) Path.** Five globs appended to `DENYLIST_GLOBS`, 19 → 24: `**/.pgpass`,
`**/pgpass.conf` (the Windows spelling; `normalizePath` already folds `\`),
`**/.docker/config.json`, `**/.kube/config`, `**/.config/gh/hosts.yml`. The
discriminator, now written into the spec: deny when the exact filename is
credentials-only regardless of location; leave it to the redactor when the same
filename also carries ordinary config. That is what excludes `.npmrc` (#309's
recorded reasoning stands) and the directory forms `**/.docker/**`,
`**/.kube/**`, `**/.config/**` — a baseline denial has no un-deny field (I1), so
a wide glob blinds the agent permanently.

One amendment, three consumers: the read gates, `evaluateCommand`'s arg scan
(`packages/policy/src/evaluate-command.ts:51` — `cat ~/.pgpass` was ALLOWED, a
second entry point the original report never named) and
`core/handoff-export.ts:70`. No per-caller guard was written.

**(b) Content.** Three detectors APPENDED to `REDACTION_PATTERNS` (40 → 43),
nothing reordered, no existing row's bytes touched — the HIGH-tier append shape:
`npmrc_auth` (covers legacy-UUID and Artifactory-base64 `_authToken` plus
`_auth`, which `npm_token` misses), `pgpass_line`, `kubeconfig_token`.

Design constraint found by reading the code: `redact()` applies each pattern
through a replacer FUNCTION (`redact.ts:22`), so `$1` in a replacement string is
returned literally. Capture-group replacements are unavailable, and all three
therefore use the house shape — `(?=\S)` start guard in front of a bounded
lookbehind. Both line-anchored patterns use `[ \t]{0,32}`, not `^\s*`, because
`\s` matches `\n` — [[concepts/unbounded-run-redos]] instance 7.

**Measured, and NOT what the shape suggests.** All three are linear BY
CONSTRUCTION: every lookbehind run is bounded and nothing follows the value run,
so a start position matches or fails in one pass. Shipped vs an unguarded,
unbounded mutant, min-of-3 at 100 KB / 400 KB: `_auth=`+A-run 0.33/1.32 ms vs
0.10/0.34; `h:1:d:u:`+A-run 0.23/0.94 vs 0.04/0.17; indented `token:`+space-run
0.14/0.57 vs 1.66/5.16. Two consequences worth recording: the BOUNDS buy no
speed here and cost a little — exactly the reasoning that removed
`netrc_password`'s ceiling — so they are kept as OVER-redaction controls with
their coverage cost disclosed, not as ReDoS controls; and the `(?=\S)` guard is
the one measured win (~9x on the whitespace seed), which is the shape it exists
for. No eleventh instance of the ReDoS class was added, and none was removed
either — there was no quadratic here to fix.

**(c) Third defect, found while reproducing, not in the report.**
`glob-equivalence.test.ts:36` hand-copied `DENYLIST_GLOBS` and still held the
pre-#309 fifteen entries, and spec §4a still printed those fifteen under the
line "15 patterns" while the code shipped nineteen. #309 therefore shipped four
globs with zero equivalence coverage and did not fail. Closed by DELETING the
copy — `DENYLIST_GLOBS` is now exported from the module (not from `index.ts`, so
the LOCKED §2 public surface is untouched) and imported — plus a non-vacuity
assertion that every glob is matched by at least one corpus path, plus a new
`spec-denylist-parity.test.ts` that parses §4a's fenced block and pins it to the
array. A test that detects drift is strictly worse than an import that makes
drift impossible; #313 could not delete its probe copy (it legitimately holds
superseded patterns), this one had no such reason.

Reproduction re-run under a throwaway `$HOME`: the four new path carriers plus
`.netrc`/`.git-credentials`/`.aws/credentials` all `path_denied/secret_path_read`;
`.npmrc` still ALLOWED by design but now `findings=[npmrc_auth x1]`;
`.kube/cache/http/abc`, `.docker/daemon.json` and `.config/gh/config.yml` still
allowed. 0 files reach the model in cleartext, against 3 before.

Each guard reverted alone: dropping the five globs reddens 16 policy tests, 4
context-gate and 4 core; dropping the three detectors reddens 25 policy tests
and neither touches the other's fences.

Sources: [[docs/superpowers/specs/2026-07-25-secret-path-home-credentials-design]],
[[docs/superpowers/plans/2026-07-25-secret-path-home-credentials-plan]],
[[entities/policy]], [[concepts/unbounded-run-redos]].

## [2026-07-26] fix | home credential detectors: quoted npmrc leak + two PWD-class over-redactions

Review of `fix/secret-path-home-credentials-impl` raised four findings against
the three detectors appended the day before. All four reproduced against the
branch; three are the same two root causes and are fixed here, and the fourth's
suggested remedy (deny `**/.npmrc`) is re-rejected in favour of the other
reviewer's remedy for the identical defect.

**1. `npmrc_auth` could not match a quoted value.** npm's ini serializer
`JSON.stringify()`s any value containing `=` — base64 padding, so most real
`_auth` and Artifactory `_authToken` values — which makes
`_auth="dXNlcjpwYXNzd29yZA=="` the form `npm config set` writes, not an edge
case. `[^\s"']` cannot consume the opening `"`, and one position later the
lookbehind no longer holds, so the line was skipped ENTIRELY rather than
truncated at the quote as the source comment claimed. The branch's own
disclosed-loss test only covered an EMBEDDED quote. Since §3b keeps `.npmrc`
off the denylist precisely because this detector covers it, the log entry above
claiming "0 files reach the model in cleartext, against 3 before" was FALSE for
the canonical spelling of `~/.npmrc`. Fixed by taking an optional quote inside
the lookbehind, which `json_secret_field` already does.

**2 & 3. `pgpass_line` and `kubeconfig_token` were the `PWD=` class.** A numeric
second field is not rare: `12:34:56:789:request completed ok`, an expanded IPv6
address and `CACHE:8080:web:nginx:restarting` all cleared the port gate, and
`[^\r\n]{1,512}` then ate the rest of the line. A 16-character floor is not a
discriminator either: every identifier expression clears it, and
`token: z.string().min(1),` — this repo's own `packages/daemon/src/discovery.ts:8`
— was destroyed, as were `token: process.env.GITHUB_TOKEN,` and
`token: matchStack.token,`. `filterOutput` redacts before chunking and persists
only the redacted raw, so `mega output chunk` could not recover the bytes.

Both fences the branch added were VACUOUS: the two five-field negatives have a
non-numeric second field, so `\d{1,5}` rejected them at position 0 and they
never exercised the shape that over-matched; the evidence-preservation
negatives for `kubeconfig_token` were all short values that the floor rejected
anyway. Fixed by gating on value SHAPE and anchoring to end of line — a
`.pgpass` password is the last field and cannot contain an unescaped `:`
(escapes are now honoured), a kubeconfig token is a YAML scalar. Thirteen
non-vacuous negatives added, taken verbatim from the reviewers' corpora.

**Re-rejected: deny `**/.npmrc`.** Correct that §3b's rationale was falsified as
shipped, wrong about which side to fix. The falsified thing was the detector,
not the placement; `**/.npmrc` has no un-deny (I1) and would deny this repo's
own four-line settings file. A broken detector is a bug in the detector.

Cost, disclosed and pinned: the end-of-line anchor means a value past its bound
is now missed ENTIRELY instead of truncated (>512 for pgpass, >4096 for
kubeconfig), a kubeconfig token followed by an inline `# comment` is missed, and
a bare identifier alone on the line still over-redacts because it is
byte-identical to a real scalar. The superlinear seed for `pgpass_line` had to
change with it — the old A-run no longer matches at any length, and a seed that
never fires measures a pattern that does not exist (the `age_secret_key` trap).
Re-measured: all three still linear, ~4.1x on a 4x step.

Each guard reverted alone: dropping the optional quote reddens 3 tests;
dropping the shape class reddens 5; dropping the end-of-line anchor with the
shape class kept reddens 5 more, so neither half of the `kubeconfig_token` fix
is redundant.

`pnpm verify` exit 0 — 56/56 turbo tasks, policy 791/791, conventions ok.

Sources: [[docs/superpowers/specs/2026-07-25-secret-path-home-credentials-design]],
[[entities/policy]], [[concepts/unbounded-run-redos]].
## 2026-07-26 — evidence GC deleted a live session's chunk set

Root cause was the KEY, not the helper. A chunk file is addressed by
`(workspaceKey, session dir, chunkSetId)`, but the delete and hold paths
identified it by bare `chunkSetId` — safe only while ids were `randomUUID`,
broken once the saver made them `cs-${sha256(raw)[:32]}`, weaponized when
`sweepEvidenceStore` wired `ChunkDeletePort` to the store-wide first-match
`locateChunkSet` scan. The daily, unattended PostToolUse GC could delete a LIVE
session's (or another repo's) raw output while the expired record's own copy
survived, leaving the ledger claiming `available` over a deleted file.

Fixed at the two places all consumers route through: `ChunkDeletePort` now takes
`ChunkRef { workspaceKey, sessionRef, chunkSetId }` (the record already carried
all three) and `sweepEvidenceStore` deletes only at that path; `pruneOlderThan`
takes `keepChunkSetKeys` built from the new exported `chunkSetKey`. Fail
directions are deliberately opposite: an unscopable delete is a no-op, an
unscopable hold over-retains.

The pin walker never called `locateChunkSet`, so its RED was captured AFTER the
delete-path fix was green — the evidence that fixing the scan alone was not
enough. Each guard reverted alone goes red alone. `locateChunkSet` keeps the
read path (colliding sets are byte-identical) with its false "globally unique"
comment corrected and a guard test fencing it out of the delete/hold sources.

`pnpm verify` exit 0 (56/56 typecheck, 56/56 test).

See [[concepts/chunk-set-identity]].
Sources: [[docs/superpowers/specs/2026-07-25-evgc-content-id-collision-design]],
[[docs/superpowers/plans/2026-07-25-evgc-content-id-collision-plan]].


## 2026-07-26 — the triple is the address, not the owner

Review of the collision fix found the residual case: two evidence records in the
SAME workspace and session share one chunk file (saver-seen fails open — FIFO
cap 500, lock skip, parse fail), so `gcEvidence` deleting on behalf of whichever
expired first still stripped the raw a PINNED or unexpired twin advertised as
`rawExpandable`. Pre-existing, but the same defect class the fix claimed closed.

`gcEvidence` now precomputes the addresses of the records that survive the pass
and skips the unlink when the expiring record shares one; it still degrades the
metadata. `revokeEvidence` keeps deleting unconditionally — a revoke is a
requested destruction, not housekeeping.

RED first: pinned twin and live twin both lost their file; the guard reverted
alone goes red alone (3 tests).

See [[concepts/chunk-set-identity]].
---

## 2026-07-26 — hook settings write dropped the operator's file mode (HIGH)

`packages/connectors/claude-code/src/hook-settings.ts` `writeSettings()` created
its temp file with no `mode` and never chmod'd, so `rename()` swapped in a fresh
`0644` inode (umask 022) over `~/.claude/settings.json` — the file that holds
`env.ANTHROPIC_API_KEY` / `ANTHROPIC_AUTH_TOKEN`. Verified starting-mode matrix:
`600→644`, `640→644`, `400→644`, fresh create `644`. Five reaching call sites,
all through the one function: `mega hooks install`, `mega hooks uninstall`,
`mega init` (first-run onboarding), the GUI "Connect Saver hook" toggle both
directions, and the currently-dormant `ClaudeRouteAdapter.ensureHooks()`.

The contract was already pinned inside the same package: `proxy-route.ts` had a
second, hardened writer for the same file (`existingMode ?? 0o600` + `chmodSync`
+ fsync + symlink refusal). One adapter object could be observed writing `0600`
via `apply()` and then reverting it to `0644` via `ensureHooks()`.

Fix: extracted the hardened writer to `src/settings-write.ts`
(`writeSettingsFile`) and pointed both call paths at it; both private copies
deleted. Direction was forced — `proxy-route.ts` already imports from
`hook-settings.ts`, so the reverse import would be circular (§8).

Two things the extraction surfaced that the spec did not predict:

- **The verbatim writer could not preserve `0400`.** It chmod'd the temp file
  then reopened it `r+` to fsync → `EACCES`. Fixed by writing through the one
  fd from `openSync(tmp, "wx", mode)` and chmod'ing after close, still before
  the rename. `mega proxy` had this latent failure too.
- **`chmodSync` is only load-bearing for umask-sensitive modes.** Dropping it
  leaves `0600`/`0640`/`0400` correct under umask 022, so the mutation test
  needed a `0660` row to go red. That row is in the suite for that reason.

Behaviour break, named in the changeset: a **symlinked** settings path is now
refused. Observed at HEAD — the rename destroyed the symlink and the
dotfiles-repo target never received the hooks, so the operator's tracked file
silently diverged. Failing loudly beats that.

Tests: `packages/connectors/claude-code/test/hook-settings-permissions.test.ts`,
platform-guarded (`describe.skip` on win32, proven to report *skipped* rather
than vacuously passing by flipping the condition once). Mode preservation is
asserted in both directions — `0644` stays `0644`, so the fix does not
over-correct by silently narrowing an operator's choice.

Sources: [[docs/superpowers/specs/2026-07-25-hook-settings-file-mode-design]],
[[docs/superpowers/plans/2026-07-25-hook-settings-file-mode-plan]].

## 2026-07-26 — the widened files the mode fix cannot heal (review R7)

Review of the mode-preservation fix: it stops new widening but heals nothing.
Preservation is deliberate (spec §3 alt 2 — silently narrowing someone else's
agent config is the mirror of the bug), so every `~/.claude/settings.json` that
a pre-fix `mega hooks install` / `mega init` left at `0644` stays `0644`
forever, on a file holding `ANTHROPIC_API_KEY`. Confirmed the population is
undetectable at HEAD: no `statSync` on the settings path anywhere in
`apps/cli/src` or `apps/gui/bridge`, and no mode/chmod/perm reference in
`doctor.ts` or `doctor-saver.ts`.

Fix is a noticer, not a healer: `checkSettingsPermissions()` in
`apps/cli/src/commands/doctor.ts` stats the resolved settings path and, when
`mode & 0o077` is non-zero, emits the repo's WARN shape (`pass: true` +
`warn:`-prefixed reason, never touches the exit code — `doctor-saver.ts:242`)
naming `chmod 600 <path>`. Read-only; `mega doctor` does not chmod the
operator's file. `win32` short-circuits to `n/a` — NTFS ignores POSIX bits, so
every Windows file would otherwise report a permanent false `0666`.

`stat`, not `lstat`: the writer refuses symlinks, but for *exposure* it is the
target's bits that matter, and a broken link stats as `absent` — the honest
answer.

Load-bearing proof (two mutations, backup restored after each): `if (true)
return {...pass:true}` → 4 red; `mode & 0o077` → `mode & 0o007` → 1 red (the
`0o640` row). Smoke: `claude-code-settings-perms 644 PASS (warn:
group/world-accessible — run: chmod 600 …)`, quiet at `600`.

Spec risk table gained R7; the changeset names the already-widened population
and adds `@megasaver/cli` to the bump list.

Tests: `apps/cli/test/doctor.test.ts` (`checkSettingsPermissions`, posix-only).

Sources: [[docs/superpowers/specs/2026-07-25-hook-settings-file-mode-design]],
[[entities/connectors-claude-code]].
## 2026-07-26 — seed-guard allowlist had three dead entries

`MATCH_FREE_BY_DESIGN` exempted three labels the guard never iterates, so they
exempted nothing while reading as coverage. Removed, and a parity test now
fails if any exemption names something outside `NEW_DETECTORS`.

The tempting fix — extend the guard to `SEEDS` and `EXTRA_PK_SEEDS` — is wrong,
and measuring said so: **all ten of those seeds produce zero matches by design**.
They are worst-case scan seeds where the cost is the engine failing at every
position, so a match-count guard would exempt 10 of 10. Extending it would have
produced a guard that skips everything and looks thorough — the same illusion
the dead entries created.

General shape: **when an allowlist exempts nearly everything it touches, the
check is the wrong instrument, not the allowlist too short.** For scan seeds the
answerable question is "does it still contain its anchor?", not "does it
match?". Left unbuilt and recorded.

Sources: [[docs/superpowers/specs/2026-07-26-probe-parity-design]] §6.

## [2026-07-19] ingest | LongMemEval-V2

Ingested the official benchmark into [[sources/longmemeval-v2]]. It evaluates
static state, dynamic state, workflow, gotchas, and premise awareness on an
accuracy-latency frontier.

## [2026-07-19] query | Evidence-Backed Long Memory Runtime

User approved one agent-neutral, evidence-cited runtime for product recall and
LongMemEval-V2. The architecture and LM0–LM3 delivery boundaries are in
`docs/superpowers/specs/2026-07-19-long-memory-runtime-design.md`; see
[[concepts/long-memory-runtime]].

## [2026-07-20] implementation | Long Memory LM0 benchmark boundary

Implemented the isolated `@megasaver/long-memory` LM0 package in worktree
`codex/feat/long-memory-runtime`: strict observations and receipts,
workspace-scoped idempotent ingestion, deterministic BM25 recall, and a JSONL
`insert|query` host. Added a public-data-only LongMemEval-V2 Python adapter
that keeps one local Node process per memory instance and rejects image paths
outside the configured benchmark root. LM1–LM3 product memory, semantic
retrieval, transitions, runbooks, gotchas, premises, and media remain out of
scope. Source: [[concepts/long-memory-runtime]].

## [2026-07-20] verification | Long Memory LM0 benchmark boundary

Independent critical review initially found incompatible official trajectory
input, non-canonical digest construction, uncorrelated RPC failures, missing
boundary limits, child-process lifecycle gaps, and retrieval UUID ambiguity.
The implementation now accepts both official public trajectory forms, uses
canonical digests, preserves typed internal RPC correlation, aligns Python and
Node UTF-16/token limits, bounds process lifetime, and rejects workspace-local
UUID collisions. Independent re-review approved the final fix set; `pnpm
verify` and the Python adapter suite were then rerun as release evidence.
Source: [[concepts/long-memory-runtime]].

## [2026-07-20] design | Long Memory LM1 observations approved

LM1's HIGH-risk design gate passed independent architecture and adversarial
review. The next slice adds immutable evidence-bound snapshots/transitions with
deterministic cross-store retry adoption, correction-chain fail-closed recall,
and preserved LM0 public boundaries. Implementation has not started; it remains
gated on a TDD plan, fresh review, and `pnpm verify`. Source:
[[concepts/long-memory-runtime]],
`docs/superpowers/specs/2026-07-20-long-memory-lm1-observations-design.md`.

## [2026-07-20] plan | Long Memory LM1 observations

The approved six-task TDD plan preserves LM0's public TypeScript/JSONL surface,
then builds canonical evidence-bound contracts, immutable no-clobber storage,
capture, correction-aware transitions, bounded recall, and independent release
evidence. Source: [[concepts/long-memory-runtime]],
`docs/superpowers/plans/2026-07-20-long-memory-lm1-observations-plan.md`.

## [2026-07-20] verification | Long Memory LM1 observations

Implemented LM1's evidence-bound, append-only snapshot/transition runtime in
`codex/feat/long-memory-observations`. It preserves LM0's public JSONL and
TypeScript contract while adding private evidence-gated capture/recall,
retry-stable snapshot reservations, correction-closure recall, bounded
raw/pointer/coverage/closure scans, full directory-chain durability, and exact
record-ID locators for bounded transition endpoint lookup. Two P1 findings from
independent review were resolved with red-to-green regressions: closure-budget
exhaustion now omits the affected correction group, and a valid endpoint no
longer scans a large raw corpus or depends on unrelated raw-file health.

Final evidence: `@megasaver/long-memory` 106/106 tests, package build,
`pnpm verify`, `git diff --check`, and LongMemEval-V2 adapter tests 7/7 passed.
Fresh independent code review and adversarial review both approved. This is not
an official LongMemEval-V2 harness score; LM1 remains text-only and LM2/LM3
capabilities are explicitly deferred. Source:
[[concepts/long-memory-runtime]],
`docs/superpowers/specs/2026-07-20-long-memory-lm1-observations-design.md`.

## [2026-07-20] design | Long Memory LM2 hybrid recall approved

LM2's HIGH-risk design passed independent architecture and adversarial review.
Safe preserves exact LM1 behavior. Adaptive adds only opt-in semantic RRF over
an LM2-owned bounded capture catalog, with explicit current remote-embedding
approval, pre-embedding evidence admission, direct-ID verification, sidecar
quotas/locking, cancellation, and correction/evidence-safe final selection.
The catalog deliberately does not backfill legacy LM1 directories, so receipts
state its limited coverage. The LongMemEval-V2 gate requires official web and
enterprise artifacts plus leaderboard `submission_overview.json` before a LAFS
claim. This design has no production implementation yet; TDD planning and user
design approval remain required. Source: [[concepts/long-memory-runtime]],
`docs/superpowers/specs/2026-07-20-long-memory-lm2-hybrid-recall-design.md`.

## [2026-07-20] plan | Long Memory LM2 hybrid recall

The LM2 TDD plan breaks implementation into strict contracts, bounded catalog
and direct-ID reads, locked quota-safe vector sidecars, deterministic hybrid
ranking, explicit evidence-admitted indexing, LM1-preserving runtime
composition, public LongMemEval transport/backend, and independent plus
official evidence gates. No production implementation or official score is
claimed by this planning entry. Source: [[concepts/long-memory-runtime]],
`docs/superpowers/plans/2026-07-20-long-memory-lm2-hybrid-recall-plan.md`.

## [2026-07-20] design | LM2 quota-ledger amendment approved

Implementation review found a real contradiction between the one-index-call
1,024 sidecar-metadata-read cap and directory-wide exact quota recomputation.
The HIGH-risk amendment replaces scans with a bounded v2 allocation ledger,
fenced operation-scoped advisory locking, epoch/allocation sidecar provenance,
bounded pending recovery, and discriminated index retry/expired receipts.
Independent architecture and adversarial design reviews approved the corrected
amendment. The prior Task 3/4 code is implementation evidence only; the new
TDD rework plan is authoritative. No LongMemEval-V2 score is claimed. Source:
[[concepts/long-memory-runtime]],
`docs/superpowers/specs/2026-07-20-long-memory-lm2-quota-ledger-amendment-design.md`,
`docs/superpowers/plans/2026-07-20-long-memory-lm2-quota-ledger-rework-plan.md`.

## [2026-07-20 13:10 +03] verification | LM2 quota-ledger integration evidence

Task 5 closed the quota-ledger rework's integration gap without changing LM0,
LM1, or production code. A real file-backed catalog/index/vector-store fixture
crosses the 16-document/65,536-code-unit batch boundary, then represents the
durable published-prefix crash cut with the exact V2 sidecar bytes produced by
that run. The next real operation returns
`quotaRecovery: "recovered_pending"`, restores the exact committed allocation
watermark/count/serialized-byte totals, performs no new embedding call, and a
pass-through filesystem observer records no `embeddings-v2` namespace
enumeration. A read of the pending snapshot excludes the uncommitted sidecar.
The four remaining V1 publication assertions now verify `embeddings-v2`,
epoch/allocation provenance, and fenced V2 failure semantics. (source:
`docs/superpowers/specs/2026-07-20-long-memory-lm2-quota-ledger-amendment-design.md`,
`docs/superpowers/plans/2026-07-20-long-memory-lm2-quota-ledger-rework-plan.md`,
commits `065df3e6`, `20853aac`, `21af7f37`)

Verification evidence: the long-memory package passed 27/27 files and 249/249
tests with zero type errors, package `tsc -b --noEmit` passed, root `pnpm lint`
checked 1,582 files, and `pnpm verify` completed all 56 Turbo tasks plus every
managed conventions check. The accepted guarantee is deliberately bounded:
exact quotas and recovery apply to compliant ledger-aware writers; a
well-formed trusted-root ledger rollback performed wholly outside an operation
cannot be detected in Node's static-symlink model. Final independent
whole-branch architecture/adversarial review remains required, and no official
LongMemEval-V2 score is claimed. (source:
`docs/superpowers/specs/2026-07-20-long-memory-lm2-quota-ledger-amendment-design.md`,
`docs/superpowers/plans/2026-07-20-long-memory-lm2-quota-ledger-rework-plan.md`)

## [2026-07-20 16:55 +03] implementation | LM2 V2 candidate catalog hardening

Completion Task 3 split the candidate catalog into schema/cursor, anchored
storage, fixed-inode/token lock, and orchestration modules. V2 uses only its
catalog/control/lock names, leaves either V1 pathname untouched with
`catalog_schema_unsupported`, binds the immutable control record to the lock's
device/inode/token, and recovers only orphan-lock and control-before-empty
crash cuts. Process-level TDD covers symlinked catalog paths, idle/held lock
replacement, an injected anchor-close failure, and two concurrent appenders.
The package passed 27/27 files and 288/288 tests with zero type errors; package
typecheck and root lint also passed. Fresh independent implementation review
remains pending; no official LongMemEval-V2 score is claimed. (source:
`docs/superpowers/specs/2026-07-20-long-memory-lm2-runtime-security-completion-design.md`,
`docs/superpowers/plans/2026-07-20-long-memory-lm2-runtime-security-completion-plan.md`,
`.superpowers/sdd/task-3-report.md`)

## [2026-07-20 17:10 +03] fix | LM2 catalog V1-admission race

Fresh Task 3 review found that V1 absence was checked only when anchored
storage opened, allowing a legacy writer to create V1 after V2 acquired its
separate lock and before V2 publication. A deterministic spawned-writer RED
reproduced the false-success V2 mutation. V1 absence is now fenced again on
established acquisition, bootstrap/control/catalog publication callbacks,
normal mutation, post-publication validation, and release. The previous
descriptor-only old-inode test was also replaced: real old- and new-inode
processes both call `appendPublished`, both fail, and catalog bytes remain
unchanged. Fresh re-review remains pending. (source:
`docs/superpowers/specs/2026-07-20-long-memory-lm2-runtime-security-completion-design.md`,
`.superpowers/sdd/task-3-report.md`)

## [2026-07-20 17:30 +03] fix | LM2 catalog bootstrap V1 fence

Task 3 closure review found one narrower bootstrap interval: V1 could appear
after the new V2 lock acquired its OS flock but before the bootstrap token was
written. A deterministic spawned-process RED observed the 65-byte token even
though the append failed. Acquisition now revalidates V1 absence immediately
after flock and before any token/control/catalog write; the regression requires
an empty lock plus absent control/catalog files. Catalog coverage was split
without loss into four focused suites and shared fixtures, leaving every Task 3
source/test file below 300 lines. Evidence: focused 27/27, package 30/30 files
and 290/290 tests with zero type errors, plus root `pnpm verify`. Fresh
independent re-review remains pending. (source:
`docs/superpowers/specs/2026-07-20-long-memory-lm2-runtime-security-completion-design.md`,
`.superpowers/sdd/task-3-report.md`)

## [2026-07-20 19:07 +03] implementation | LM2 benchmark backend and transport

Completion Task 5 added a separately built, non-root-exported LongMemEval-V2
transport plus the pinned Python `Memory` backend, manifest builder, and
allowlisted official-checkout installer. Admission is bound to canonical
source/input digests, exact projected trajectories, an ordered durable insert
chain, and a question allowlist; rejected or poisoned queries launch no
transport. The backend accepts only local benchmark embeddings, persists one
random instance identity across the official save/load lifecycle, and returns
only non-empty text items. Evidence: repository `pnpm verify` completed all
56 Turbo tasks; long-memory passed 38/38 files and 330/330 tests; the combined
Python suites passed 15/15 against the real pinned official `Memory` base,
including a Python-to-built-Node round trip and installer import smoke test.
No official LongMemEval-V2 score was run or claimed, and independent
benchmark-contract review remains pending. (source:
`docs/superpowers/specs/2026-07-20-long-memory-lm2-runtime-security-completion-design.md`,
`docs/superpowers/plans/2026-07-20-long-memory-lm2-runtime-security-completion-plan.md`)

## [2026-07-20 19:50 +03] fix | LM2 benchmark contract review closure

Fresh Task 5 review rejected pathname-based lock admission, incomplete Python
manifest/state validation, divergent Python number serialization, and an
unbound tier checksum. New REDs reproduced lock replacement before an operation
and after flock, six self-consistent manifest substitutions, scientific-number
digest divergence, and save-directory alias acceptance. The transport now
binds the fixed lock descriptor to sentinel dev/inode, revalidates it before
state writes, and fsyncs the run directory after control replacement. Python
validates the exact canonical V1 manifest and complete saved/run identities
before adoption; a real built cross-language run includes scientific numbers.
Evidence: focused Node 25/25, long-memory 334/334 with zero type errors, Python
18/18 against the pinned official base and built transport, and root `pnpm
verify` 56/56. No official score was run or claimed; fresh independent
benchmark-contract re-review remains pending. (source:
`.superpowers/sdd/task-5-report.md`,
`docs/superpowers/specs/2026-07-20-long-memory-lm2-runtime-security-completion-design.md`)

## [2026-07-20 20:14 +03] fix | LM2 benchmark final closure hardening

The next Task 5 closure review found two remaining Python admission gaps and an
unsafe rejected-query telemetry path. Regression REDs showed invalid canonical
timestamps, empty question IDs, and malformed local-model values crossing the
Python boundary; pre-open rejections were not durable, and FIFO/cache-parent
substitution did not fail closed. Admission now validates those pinned fields
and UTF-16 model limits before transport. Rejected queries create a redacted,
durable stream below a random private root using component-anchored descriptors,
nonblocking no-follow opens, link/mode/owner checks, and descriptor/path identity
checks. Python official-base/installer/LM0 coverage is 23/23 with the real built
transport; no official score is claimed. (source: `.superpowers/sdd/task-5-report.md`)

## [2026-07-20 20:32 +03] fix | LM2 telemetry and load-state closure

Final Task 5 closure review found that rejected telemetry still persisted raw
untrusted question IDs and that Python load inspected `run.lock` without taking
its flock. REDs reproduced the raw field, successful load under a concurrently
held lock, and successful state adoption after the lock pathname was replaced
during the state read. Telemetry now omits raw question/context data while
retaining a durable reason, canonical timestamp, random audit ID, and aggregate
metadata. Load takes the real flock nonblocking, reads identity-bound state
under it, revalidates run/lock descriptor-path identity before adoption, and
releases the original inode on every path. Python coverage is 25/25 against the
pinned official base and built transport; no official score is claimed.
(source: `.superpowers/sdd/task-5-report.md`)

## [2026-07-20 20:58 +03] fix | LM2 builder and projection identity closure

Fresh Task 5 re-review found that the normal package build omitted two private
artifacts imported by the non-contract manifest builder, and that both language
boundaries checked only the shape of projection UUIDs. The build now emits the
private canonical and manifest entrypoints without changing package-root
exports or bins. TypeScript and Python recompute UUIDv5 from the exact
trajectory/source/index frame, share a fixed vector, and reject a valid but
foreign-frame UUID before transport. Evidence: focused benchmark Node 27/27,
long-memory 336/336 with zero type errors, Python official-base plus real built
transport 26/26, and root `pnpm verify` 56/56. Task 6 was not started and no
official score is claimed. (source: `.superpowers/sdd/task-5-report.md`)

## [2026-07-20 21:26 +03] fix | LM2 released-corpus truncation closure

Ultimate Task 5 review found that pre-truncation canonicalization could expose
trailing whitespace at the 50,000-UTF-16-unit boundary. Released enterprise
trajectory `096432bf`, `states[12]`, reproduced the failure exactly. Projection
text is now NFC/trim canonicalized after the bounded surrogate-safe cut, with
UUID and final-text digest regressions. The pinned snapshot matched all released
checksums; official screenshot preparation and unmodified Small validation
passed. The README enterprise/Small builder produced an 89-MiB manifest with
211 questions and 100 trajectories, including a canonical 49,999-unit blocker
projection and later rows. Long-memory passed 337/337 and Python passed 26/26;
no harness, judge, Task 6, or score was run. (source:
`.superpowers/sdd/task-5-report.md`)

## [2026-07-20 22:05 +03] test | LM2 official evidence gate

Added a strict official-evidence schema and standalone verifier with separate
inspection, pristine-checkout preflight, and full-verification modes. Inspection
and preflight are structurally unable to mark a score eligible; full mode also
requires pinned data validation, allowlisted installation diffs, recomputed
official aggregates, raw latency samples, both domains, and freshly rebuilt
leaderboard artifacts. Evidence: gate regressions 13/13; long-memory 350/350
with no type errors; official-base Python 26/26 with the built transport; root
`pnpm verify` 56/56. Real pinned-checkout preflight passed and returned
`officialScoreEligible: false`. No official web plus enterprise score was run
or claimed. Trusted-root compromise remains an explicit limitation. (source:
`benchmarks/longmemeval-v2/verify-official-artifacts.mjs`,
`benchmarks/longmemeval-v2/evidence-schema.json`,
`packages/long-memory/test/lm2-completion-integration.test.ts`)

## [2026-07-20 23:02 +03] fix | LM2 architecture and evidence closure

Release-blocker review found that the benchmark runtime still traversed the
product LM2/LM1 selector, three LM1 source files exceeded the repository limit,
and full evidence qualification could accept self-described manifests,
transport, aggregate, and builder artifacts. The benchmark path now ranks raw
public projections and formats them only through `Lm2BenchmarkContextBuilder`;
a cross-path regression preserves the explicit difference from LM1 correction
selection. LM1 internals are split behind compatible facades and a source gate
covers all production long-memory TypeScript and benchmark scripts. Full
qualification now executes the JSON Schema, rebuilds both manifests from pinned
trajectories, binds the exact transport executable and Mega Saver commit,
recomputes official domain/combined metrics and latency summaries, cross-binds
telemetry, and byte-compares freshly built package, overview/LAFS, and tar
contents. Evidence: 42/42 long-memory files and 361/361 tests, 26 Python tests
plus one optional skip, and root `pnpm verify` 56/56. No authoritative completed
two-domain run was available, so no official score is claimed. (source:
`.superpowers/sdd/task-6-report.md`)

## [2026-07-21 11:53 +03] fix | LM2 official evidence provenance closure

Final evidence review found five P1 authenticity gaps: local percentiles in the
official combined timing shape, insufficient binding of executed inputs and
evaluator answers, no clean-commit rebuild proof, name-only recorded tar
validation, and incomplete telemetry correlation. The gate now executes the
pinned real combiner contract, materializes and byte-compares complete released
inputs, binds command/run arguments, rebuilds adapter and transport from a clean
recorded commit, streams and compares tar member bytes, and validates telemetry
against both official per-question metadata and config/manifest facts. Focused
evidence/provenance coverage is 42/42 and repository verification is 56/56;
no full two-domain bundle exists and no official score is claimed. (source:
`.superpowers/sdd/task-6-report.md`)

## [2026-07-21 12:13 +03] fix | LM2 harness and timing authenticity closure

Final evidence re-review found that selected-flag checks admitted a nonofficial
runner or extra arguments, flattened raw latency samples changed the pinned
combiner's floating-point order, and two copied telemetry rows could inflate
their internal latency beyond the harness wall measurement. The gate now
requires the exact Python module entrypoint and complete pinned argparse
semantics, reconstructs combined timing from ordered domain summaries/counts,
and bounds every telemetry millisecond duration by its official per-question
seconds. Focused evidence/provenance/source coverage is 47/47. The isolated
reviewer Python cache was moved recoverably to a unique `/tmp` directory; no
unrelated file was removed. No official score is claimed. (source:
`.superpowers/sdd/task-6-report.md`)

## [2026-07-21 12:42 +03] fix | LM2 evaluator and tar provenance closure

Ultimate evidence review found three remaining authenticity gaps: JavaScript
numeric coercion accepted noncanonical integer arguments, per-question judge
inputs and full judge configuration were not cross-bound, and tar directories
plus the fresh archive digest escaped validation. The gate now uses a pinned
argparse parity fixture with canonical evidence lexemes, binds evaluator spec,
category, question text, and every judge argument, validates directory and file
members before tar inventory filtering, and compares fresh versus recorded tar
digests. Focused evidence/provenance/source coverage is 60/60; long-memory is
399/399 and pinned Python coverage is 29/29. No official score is claimed.
(source: `.superpowers/sdd/task-6-report.md`)

## [2026-07-21 13:02 +03] fix | LM2 unbounded integer evidence parity

Fresh review approved Task 6 without P1 findings and identified one P2 parser
exactness gap: pinned Python `argparse(type=int)` accepts signed decimals beyond
JavaScript's safe integer range. The verifier now reads the raw `run_args.json`
numeric token and compares large values as `BigInt`, while retaining `Number`
for safe integers. A pinned huge-negative fixture proves Python acceptance,
authentic evidence acceptance, and exact rejection of an adjacent mismatched
integer without precision loss. Focused coverage is 61/61; long-memory is
400/400 and pinned Python remains 29/29. No official score is claimed. (source:
`.superpowers/sdd/task-6-report.md`)

## [2026-07-21 13:20 +03] fix | LM2 canonical run-argument JSON integers

Fresh review found that noncanonical raw JSON numeric lexemes could bypass the
integer evidence contract: `2e4` and `20000.0` became `Number(20000)` before
binding. The parser now requires the raw reviver token for every official
integer field to match JSON's integer-only grammar, then converts that exact
token to a safe `Number` or `BigInt`. Full-verifier regressions cover both
spellings and a second integer flag while retaining canonical safe and
unbounded signed acceptance. Focused coverage is 64/64, long-memory is 403/403,
and pinned Python 3.11 is 29/29. No official score is claimed. (source:
`.superpowers/sdd/task-6-report.md`)

## [2026-07-21 13:32 +03] fix | LM2 unambiguous run-argument JSON

Adversarial review found that ordinary JSON parsing erased earlier duplicate
keys before the raw integer reviver could inspect them. A recursive structural
scanner now walks objects, arrays, strings, and values before parsing and
rejects repeated decoded keys per object, including nested and Unicode-escaped
equivalents. Full-verifier tests cover exact duplicates and both value orders;
an escaped-quote/key-like string regression prevents structural false
positives. Focused coverage is 71/71, long-memory is 410/410, and pinned Python
3.11 is 29/29. No official score is claimed. (source:
`.superpowers/sdd/task-6-report.md`)

## [2026-07-21 13:47 +03] verify | LM2 Task 6 independent evidence approval

A fresh independent adversarial review of commit
`2e03773604f795e0d8397e59c57c22c8b1fac697` approved the final raw
`run_args.json` boundary with no P1/P2 finding. Its probes covered direct,
nested, array-contained, Unicode-escaped, and surrogate-pair duplicate decoded
keys, malformed JSON/escapes, plus key-like text within strings; every
ambiguous document failed closed. Task 6 is complete as an evidence-gated
implementation. The verifier remains intentionally score-ineligible without a
real authoritative completed web-plus-enterprise bundle, and this work makes
no LongMemEval-V2 score claim. (source: `.superpowers/sdd/task-6-report.md`)
## [2026-07-20] plan | Redaction baseline extension planned (CRITICAL)

13-task TDD plan (3,458 lines) at
`docs/superpowers/plans/2026-07-19-redaction-baseline-extension-plan.md`,
implementing `docs/superpowers/specs/2026-07-19-redaction-baseline-extension-design.md`.
31 new credential detectors plus a PKCS#8 fix to the existing
`private_key_block`. Both CRITICAL design gates ran and returned REVISE:
the architect measured the proposed prefix pre-filter as a 3x
pessimization (V8 already fast-paths literal-anchored regexes) and the
security reviewer found 6 BLOCKING defects — a quadratic ReDoS in the
OpenAI detector, case-sensitive context gates that leaked 7 of 8
canonical uppercase env-var shapes, a false "already covered" exclusion
claim that turned out to be a real PKCS#8 gap in shipped code, 360
corpus false positives from a Mailgun rule (dropped), 8 detectors
missing trailing boundaries, and an unanchored GitHub App rule that ate
file paths. All integrated; re-check APPROVE_WITH_FIXES, closed.
Safety gates land before the detectors: frozen snapshot of the original
19, a 5,010-line false-positive corpus, ordering tests (behavioral plus
structural), and a ReDoS timing regression scoped to the new tier.
Separately filed: a live ReDoS in the shipped `jwt` detector
(1850 ms at 156 KiB, reachable from ordinary base64-heavy logs).

## 2026-07-20 — `mega doctor` saver-liveness fixed (merged to main)

`saver-liveness` failed permanently and never self-healed. Root cause: doctor
reused the heartbeat ledger's **stats retention** window (`TTL_MS` = 30 days)
as if it were a **liveness recency** window. `LIVENESS_GAP_GRACE_MS` (5 min)
only bounds the invocation-vs-completion delta, never how recent the invocation
is — so any workspace with `completion === null` failed the check from the
moment it died until it aged out 30 days later. The code stated the false
premise in a comment ("computeView already prunes stale invocations, so any
survivor here is recent enough").

Real ledger evidence: 67 workspace keys with an invocation, 30 with a
completion, **37 with none**. The reported key `5fe7a040a2e5a5b8` was a dead
temp dir from `2026-07-14`. Neither suggested remedy worked — re-running doctor
left the key, and `mega hooks install` does not clear history.

Fix (`829ddb3e`): dedicated `LIVENESS_WINDOW_MS` (24h) in `doctor-saver.ts`,
applied to **both** the gap scan and the sibling `failures` scan (the failures
branch had the identical defect). `TTL_MS` and `packages/context-gate` left
untouched — retention and liveness are different questions, and conflating them
was the bug. The user's ledger is not mutated; stale entries remain and are
simply ignored.

Verified: `10 PASS / 0 FAIL` on the real store; 19/19 doctor tests; `pnpm verify`
exit 0; `bundle-smoke` green against a real bundle. Review APPROVED with no
findings, having independently reproduced the before/after test split and
mutation-tested the boundary operator.

Correction to an earlier claim in this session: `bundle-smoke` **skips** when no
bundle exists, so `main` was not red for everyone — only for anyone with a built
bundle on disk.
## 2026-07-20 — Variance-controlled benchmark harness (L0 + L1) built; fast-mode premise retracted

Built `feat/bench-replay` (15 commits, 101 package tests green) implementing the
L0 cost-normalization + L1 record/replay harness from
[[syntheses/variance-controlled-benchmark]].

**Retraction.** The spec's premise that a fast-mode 2x billing artifact drove
benchmark variance was checked against all 24 saved Stage A result files and is
FALSE: every one is `service_tier: standard`, `fast_mode_state: off`, with raw
`total_cost_usd` equal to normalized cost (0% deviation). L0 changes no number
on current data and is kept only as insurance. Corrected in
[[syntheses/saver-cache-churn]].

**Real variance sources:** (1) agent turn count driving cache_read near-linearly;
(2) previously unidentified — the saver's per-workspace store carrying over
between runs. task_1 ran 5/5 turns in both Stage A runs yet megasaver
cache_creation fell 48,681 → 29,613 (baseline 30,129): the saver had switched
itself off. Its run-2 "1.03x pass" was decay, not success.

**Review caught four defects that would each have produced a confident wrong
number:** saver applied per-request instead of per-tool-call (would have imposed
a ~20x cache penalty on the arm under test); an isolated store silently
disabling the saver (inert arm reporting 1.00x); arm run order contaminating via
the shared prompt-cache prefix; and array-form `tool_result` blocks (14.4% of
17,584 real blocks) passing through untransformed. All fixed.

**Not done:** the real gate has not run — replay needs an `ANTHROPIC_API_KEY`
(Claude Code's OAuth is not usable by a separate HTTP client). No Stage A
verdict exists; `feat/net-positive-stage-a` remains parked and ungated.
Sources: code-reviewer + critic passes 2026-07-20, direct inspection of
`/tmp/stagea-run{1,2}-results`.

## 2026-07-20 — bench-replay merged to main after four adversarial review rounds

`feat/bench-replay` merged (`3c1e23ca`), `pnpm verify` exit 0, 56/56 turbo tasks,
139 package tests. **Merged as tested infrastructure, NOT as a source of
quotable numbers** — see [[syntheses/variance-controlled-benchmark]] and
`packages/bench-replay/README.md`.

### Four rounds, four real defects — each a fix of the instance, not the class

1. **FATAL** — saver applied per request. A Messages API conversation resends
   its whole history each turn, so a stateless transform re-invoked the saver on
   the same `tool_result` once per containing request. Would have made the
   megasaver arm's prefix mutate every turn, paying `cache_creation` ($10/Mtok)
   where baseline paid `cache_read` ($0.50/Mtok) — a ~20x manufactured penalty
   that would have condemned Stage A for causing the very prefix churn it exists
   to prevent.
2. **Same defect, relocated** — the memo was scoped inside `replayArm` (one arm),
   but the verdict path runs four arm runs. Measured 6 saver invocations for 3
   tool calls; pair 1's megasaver bytes differed from pair 2's. `orderSensitive`
   structurally could not detect it (both orders penalised equally → ratios agree
   → spread 0 → guard passes).
3. **BLOCKER** — output-token sampling noise. The model resampled freely on all
   four arms; output is ~26% of arm cost at $25/Mtok. Simulation against a TRUE
   5% saving: sd 3.78%, and **15.5% of runs reported the wrong SIGN**. Fixed by
   capping generation to 1 token on both arms (`max_tokens` is not in the
   prompt-cache key; the replay never uses generated output). Output share falls
   to f≈0.00071 with c≈0.
4. **Aggregate-vs-per-call** — the two-sided integrity band constrained
   conversation-wide aggregates while a saver breaks per call, and the two axes
   traded off freely. `() => ""` on half the calls scored frac 0.500 /
   byteRatio 0.500, `ok=true`, reporting a fake **2.0x win**; emptying the 11
   largest of 100 reported **3.3x**.

### Final fix — structural, not another threshold

Per-call contract validation inside `memoize`, using the saver's own invariant
(confirmed in `record-output.ts:188,218-228`): every applied output carries
`[Mega Saver: compressed ` AND is strictly smaller than the raw. Throws before
any request is sent, naming each offending `tool_use_id`. Catches one bad call
among ninety-nine, which no aggregate can. Both aggregate floors were then
removed as redundant-or-harmful (`MIN_BYTE_RATIO` refused honest aggressive-mode
runs at byteRatio 0.039; `MIN_APPLIED_FRACTION` refused honest runs where the
saver legitimately fires on few large outputs). One aggregate threshold remains,
`MAX_BYTE_RATIO = 0.95`, derived: above it a transform provably cannot reach the
≤5% band even if tool_results were the entire prompt.

### What it measures, and what it does not

- **Measures:** the saver's direct input-side token/cache effect on one frozen
  conversation. Turn count is identical across arms by construction. Compounding
  IS captured (history resend means a turn-3 compression shrinks every later
  request).
- **Does NOT measure:** any effect on agent behaviour (fewer/more turns because
  compressed output read differently) — the larger prize, needing high-N
  end-to-end.
- **As a proxy for live savings the ratio is an UPPER BOUND**, not an estimate:
  the harness omits the saver's main cost channel (compression removes bytes the
  agent may need, and the footer invites it to fetch them — each recovery is a
  full extra request at full history price) while counting all its savings.

### Known-unvalidated at merge

Never run against the real API. Prompt-cache nondeterminism (best-effort caching
can return `cache_creation` for bytes that returned `cache_read` moments earlier
— 20x on that segment) is untested and unmeasured by anything in the harness, so
residual input-side variance is unknown and **no ≤5% claim is supportable yet**.
The record path (`capture-proxy.ts`, `record-command.ts`) and the cost function
have never been adversarially reviewed. `normalizedCostUsd` is model-blind —
sidecar Haiku calls are priced as Opus (~6x) and dilute the ratio toward 1.00;
mitigated by a printed per-model histogram, not by repricing.

Stage A (`feat/net-positive-stage-a`) remains parked and UNGATED. Running the
gate needs an `ANTHROPIC_API_KEY` (Claude Code's OAuth is not usable by a
separate HTTP client).

## 2026-07-20 — LLM Code Problems Research analysis

Analyzed `~/Desktop/LLM-Code-Problems-Research.docx` (593+ articles, ~19.4k lines) via 10 parallel range agents. Mapped dominant problem clusters (package/API hallucination, generated-code security, context quality, silent agent failures, memory poisoning) to 10 prioritized Mega Saver feature proposals + validated existing bets. Caveats: heavy duplication, boilerplate fields, single-source numbers. Synthesis: [[syntheses/llm-code-problems-research-2026-07]].

## [2026-07-20] fix | output-filter — close review on the quadratic signal regexes

Five code-review items closed on `fix/rank-quadratic` (commits `a1bf5983`,
`47dab116`). New page: [[concepts/unbounded-run-redos]].

**Two more instances of the same class were still live.** `STACKTRACE`
(`rank.ts`) and `SIGNATURE` (`parsers/stacktrace.ts`) had the identical shape
plus a second driver — `\s+` and `.+` both accept whitespace, so the split is
ambiguous at every offset of a whitespace run. Bounded to
`\s{1,64}at\s{1,8}.{1,512}` (+ `\(.{1,512}` for SIGNATURE). Derived, not taken
from the review: the gap bound is the tight one because only the gap
multiplies, and `.{1,512}` absorbs a wide gap anyway, so `\s{1,8}` costs no
reach (divergence only past 515 gap chars). Equivalence verified on 20 real
frames — node with/without parens, tab-indented, deep monorepo, nested v8 eval,
java, python, go, rust — before and after, all identical.

**Correction to the review's attribution.** The reviewer measured 42 s for
`  at ` + spaces through `filterOutput` and attributed it to
STACKTRACE/SIGNATURE. Stage-level profiling says otherwise: on that shape the
cost is `redactWithFindings` (16-24 s), from three variable-length lookbehinds
in `@megasaver/policy` — `aws_secret_key` 6,132 ms, `basic_auth_header`
4,598 ms, `api_key_header` 4,156 ms. Same defect class, third variant, now
recorded and **still open**. The output-filter patterns were genuinely
quadratic (32.9 s and 16.5 s through their own call sites), but they were not
what the 42 s measured.

**The guard test was not guarding.** It ran at 50 KB with a 5 s ceiling, where
four of the five reverted patterns cost 2.9-4.7 s and stayed green — so only
STACKTRACE's reversion would ever have failed it. And it drove only
`scoreChunk`, which never reaches `normalize.ts`, so its claim to cover
`POSITION` was false (the reviewer proved this; confirmed). Fix: SIZE 50 KB →
100 KB (quadratic vs linear, so size is the cheap separator), and one timing
block per pattern through its real call site. Each of the five now goes red
alone when its bound is reverted: 16.1 / 19.3 / 32.9 / 16.5 / 12.2 s.

**Changeset corrected.** "No behavior change" softened to "no realistic input"
with the exact thresholds. Two of the five turn out to have no length
divergence at all — `FILE_PATH`'s start class equals its continuation class, so
a longer run restarts the match later rather than failing. The 236 s `saver-run`
baseline is noted as load-dependent (160 s idle) rather than silently swapped.

**Deferred, unchanged:** the `email` observer (`redaction-patterns.ts:171`),
LOCKED §9d baseline, needs its own spec → security-reviewer chain. It is
count-only and never modifies text, so a size gate on the observer loop may be
cheaper than touching the locked pattern. Recorded as an option in
[[concepts/unbounded-run-redos]]; not acted on.

## [2026-07-20] fix | jwt detector ReDoS fixed (CRITICAL)

One-line fix on `packages/policy/src/redaction-patterns.ts`: a leading
`(?<![A-Za-z0-9_-])` on the LOCKED `jwt` detector. 313 KiB of
`'eyJaA0'.repeat(n)` goes from 8,374 ms to 0.45 ms — quadratic to linear,
~17,400x. Root cause is start-position count, not run length: 39 KiB with 6,800
`eyJ` starts costs 204 ms, the same 39 KiB with one start costs 0.0 ms.

**Supersedes the severity claim in the entry above.** That entry filed this as
"reachable from ordinary base64-heavy logs". Re-measured, that is wrong: a
24.6 KiB unbroken base64 run costs 0.00 ms, because random base64url holds `eyJ`
about once per 262,144 positions. Text full of real JWTs is fast too — the dots
satisfy the mandatory separator immediately. The correct classification is
**adversarially reachable, not ordinarily reachable**: it needs a crafted
payload with many `eyJ` occurrences and no dots. It stays CRITICAL-tier because
the redactor sits on untrusted agent output, tool results, and Hot Handoff
packets, where a crafted payload stalls every sink.

The earlier note's stated root cause ("the separator is not excluded from the
character class") was also wrong — `[A-Za-z0-9_-]` does not match `.`.

Accepted trade-off (spec §5): a JWT glued to a base64url character, including
`-` and `_`, no longer redacts; `session-<jwt>` and `id_token_<jwt>` stay in
cleartext, asserted explicitly so nobody narrows the class back into the
quadratic. BB3 §5a lock table amended with a footnote in the same commit. The
unexecuted redaction-baseline extension plan was retargeted: snapshot literal,
single-exception framing, and the ReDoS gate's jwt exclusion (comment and
committed commit-message body) all updated, and `jwt` brought into that gate's
scope. Sources:
[[docs/superpowers/specs/2026-07-20-jwt-redos-fix-design]], [[entities/policy]].

## [2026-07-20] fix | jwt detector: percent carriers recovered, severity corrected (CRITICAL)

**Supersedes the severity claim in the entry above.** That entry classified the
jwt ReDoS as "adversarially reachable, not ordinarily reachable". Measurement
refutes it: the correct classification is **ordinarily reachable**. The earlier
reasoning used the wrong population — base64 of *JSON* is not random. JSON
objects begin `{"`, which encodes to `eyJ`, so every encoded JSON value
contributes an `eyJ` at a predictable alignment, and encoded-JSON payloads are
routine in agent output.

The vector is **base64url with no separator**: 320 KiB of it costs **575.9 ms**
under the pre-fix pattern (327,680-char dotless run), scaling cleanly
quadratically — 85 / 171 / 341 / 683 KiB at 40.6 / 165.6 / 637.6 / 2,555.5 ms.
`Buffer.toString("base64url")` of any JSON payload produces this shape, and no
effective size cap sits in front of redaction. Standard base64 and newline
wrapping are both benign, which is the honest boundary. **Kubernetes Secrets and
Docker `config.json` auth blobs are NOT the vector** — both use standard base64,
whose `+` and `/` break the run, and measure 1.0 ms and 2.1 ms at ~320 KiB.

**Second correction: the first fix silently lost the percent-escaped carriers.**
Every hex digit is a base64url character, so a `%XY` predecessor blocked
redaction — taking URL query strings and fragments, among the most common places
a JWT appears in agent output, with it. The scope sentence in the original spec
§5 did not say so. Recovered by a second lookbehind branch,
`(?<=%[0-9A-Fa-f][0-9A-Fa-f])`: 0/512 `%XY` forms redacted before, 512/512 now.
Nearly free, because `%` sits outside the run class and terminates the dotless
run — 0.32 ms per 313 KiB, linear. The earlier 49.7 ms rejection of a hybrid
alternation did not transfer: it measured a branch after `-`/`_`, which are
inside the class and still scan.

Remaining disclosed loss, unchanged in kind but stated correctly: a JWT preceded
by a **raw** base64url character. `session-<jwt>`, `id_token_<jwt>`,
`Bearer<jwt>`, `ghs_<body>_<jwt>`, base64-run glue, and `\x3d` / `\u003d`
escaped equals. **No other detector covers those bytes** — verified through the
full pipeline. `&#61;` was never affected (predecessor `;`). Released as
**minor**, not patch, so the coverage reduction is visible at release.

The test suite was rebuilt: mutation testing showed the shipped 21 assertions
killed all five structural mutants through a single `pattern.source` prefix
check, which tests no behaviour and breaks on the amended pattern — update it
naively and four of five mutants survive. The corpus held no `-` or `_` in any
segment, making segment-class narrowing invisible. Six mutants now verified red,
each behaviourally. Sources:
[[docs/superpowers/specs/2026-07-20-jwt-redos-fix-design]] §0, [[entities/policy]].

## [2026-07-20] fix | jwt detector: round-2 verifier findings closed (CRITICAL)

Closes the `critic` round-2 and `verifier` round-2 findings on `fix/jwt-redos`.

Two mutants survived the rebuilt suite. Removing the payload's `eyJ` anchor, and
relaxing any segment `+` to `*`, both passed all 34 assertions — the corpus is
blind to them because all 21 fixtures carry `eyJ`-prefixed payloads, as real
JWTs do. Both mutants only ADD matches: `trace eyJhbGciOiJIUzI1NiJ9.session.abc123`
and `see eyJlogger.v2.min bundle` start being redacted. Six no-over-redaction
assertions added, each verified red against its own mutant. Note `eyJ.eyJ.`
alone does NOT kill the single-position segment mutants — measured, it redacts
only under the simultaneous triple relaxation; the three positional fixtures are
what carry the guarantee.

The 313 KiB timing tests flaked 1 run in 5 under `turbo test --force`. Not CPU
contention: 0.3–1.8 ms at 8x oversubscription (load avg 77 on 10 cores) and 15
consecutive green runs under that load. Two full forced runs each surfaced a
*different*, pre-existing failure — `@megasaver/cli`'s `saver-run.test.ts`
real-daemon HTTP test at 74 s, unrelated to this branch. Fixed with
`{ retry: 3 }`, ceiling unchanged at 500 ms: a quadratic is slow on every
attempt (narrowed lookbehind 4/4 at 38.0–41.8 s, reverted 4/4 at 34.2–40.3 s,
both also tripping the structural gate).

Scope correction: branch 2 recovers one complete `%XY` escape only. Double-
encoded `%25XX` and boundary-truncated `%X` remain lost, re-confirmed through
the full pipeline with no detector firing. Spec §0a and the changeset now say so.

Paperwork: spec §6.2a (timing gate + mutation gap), §9a (the seven-pass CRITICAL
review trail, the user's explicit approval of the round-2 amendment and the
minor bump, and the Node 25.8.2 vs pinned Node 22 measurement caveat — the
discrepancy runs in the safe direction). The plan, written for round 1 and never
amended, gained a Round 2 section, inline superseded markers on its three stale
pattern literals, and reconciled checkboxes. Sources:
[[docs/superpowers/specs/2026-07-20-jwt-redos-fix-design]] §6.2a §9a,
[[docs/superpowers/plans/2026-07-20-jwt-redos-fix-plan]], [[entities/policy]].
## [2026-07-14 21:15 +03] fix | Claude proxy cache parity finalized

Root cause confirmed as Claude Code's custom-base-URL mode, not proxy payload
mutation: it changes tool-schema and hook-attachment cache placement. The
first-party route flag restores parity for the verified Claude Code 2.1.207
client. Final hardening clears stale flags for custom upstreams, tests the real
CLI adapter, snapshots benchmark hooks after setup, and exposes an explicit
managed-service-only upgrade restart. URL equality is never used as ownership
authorization.

Evidence: 70 focused tests and full `pnpm verify` passed; changeset status,
benchmark shell syntax, and diff checks passed. Independent code reviewer and
adversarial critic both returned Ready. Four-task real-billing smoke benchmark
improved from 0/4 losses to 4/4 wins (1.30x cost geomean; approximately $1.87
vs $2.49 total), while the 4x claim remains unproven. Implementation branch:
`fix/proxy-cache-parity-finalize`; code head before this wiki record:
`b09a3983`. Integration PR: GitHub #288.
## [2026-07-25 14:20 +03] fix | context-gate FILE_PATH ReDoS (defect class instance 6)

`FILE_PATH` in `packages/context-gate/src/session-hints.ts` was the unfixed twin
of the `FILE_PATH` bounded in `packages/output-filter/src/rank.ts` (`4ddac04e`),
and the worse form: `[\w./\\-]*\w+\.` is two unbounded quantified runs over
overlapping classes (`\w` is a subset of `[\w./\\-]`), so the split between them
was ambiguous at every offset *and* every start position rescanned to fail the
`\.`. Superquadratic, ~7x per doubling through `extractFailureSignatures`: 1.2 s
at 2 KB, 9.1 s at 4 KB, 80.5 s at 8 KB.

Critical rather than theoretical on two counts. 4 KB is the shipped cap, not a
probe size — both capture sites store `redact(...).redacted.slice(0, 4000)`
(`run-command.ts:305`, `:574`) — and the cost is persisted and amplified: up to
`MAX_OVERLAY_FAILURES` (50) records are re-extracted by `buildSessionHints` /
`buildOverlayHints` on every read and exec, including inside the `guard-run`
hook, so one session that captured a hex dump or identifier run added minutes of
CPU to every later tool call, permanently. The firing shapes are accidental
(`'x'.repeat` 9.1 s, hex dump 11.4 s, identifier run 10.1 s); path-ish runs,
base64 and npm `sha512-` hashes do NOT fire it, because `/`, `-`, `+` and `=`
break the `\w` run.

Fix: collapse the second run to the single `\w` it actually required —
`/[\w./\\-]{0,255}\w\.[a-zA-Z]{1,5}(?::\d+)?/g`, 2.3 ms at 4 KB. Semantics
preserved exactly; verified behaviour-identical on 22 real diagnostic lines and
200k randomised strings over the triggering alphabet. The one-run collapse
`[\w./\\-]{1,256}\.` is equally fast but was rejected — it drops the
`\w`-before-dot requirement and starts matching `-.ts`, `..ts`, `a/.js`. Only
divergence kept is the 256-char leading-run cap, matching the merged twin.

Why it survived: a wiki indexing gap, not a code gap. This page's `sources:`
frontmatter listed only `output-filter` and `policy`, so a wiki-first sweep for
the class never pointed at `context-gate`. Added, with a rule that every package
holding a member of the class — including packages that merely copied a fixed
pattern — goes in `sources:` in the same edit.

Evidence: TDD red first — the guard failed at 6.47x / 6.60x / 6.10x with the
bound reverted (clean ratio assertions, not timeouts) while all 12 behaviour
tests passed unfixed, proving they lock behaviour rather than describe the fix.
Green after: `pnpm verify` EXIT 0, 56/56 turbo tasks, context-gate 331/331.
Guard is `packages/context-gate/test/session-hints-redos.test.ts` — drives the
exported function at the shipped cap, asserts a growth ratio (min-of-5-trials,
calibrated repeat count) rather than a wall-clock ceiling. Sources:
[[concepts/unbounded-run-redos]] instance 6, [[entities/context-gate]].

## [2026-07-25 14:30 +03] fix | Handoff redaction guard + three leaking fields

Follow-up to the PR #293 pre-merge review. Two findings were filed as
non-blocking hardening: no structural guard around per-field handoff
redaction, and `git.branch` bypassing the redactor. Adversarial review of the
first fix found the guard was itself fail-open and had *certified as safe*
five fields that leak a secret today.

Shipped: `git.branch`, `git.changedFiles[].path`, `git.diff.excludedPaths[]`
now redacted; code anchors (`files[].path`, `symbols[].path`,
`symbols[].name`) dropped wholesale with `lastVerified` when a key is dirty,
because they are code-truth lookup keys and a redacted value produces a false
`contradicted` that closes `validTo` on the receiver. Anchor handling sits in
`redactMemory`, so `mega brain export` inherits it.

Guard is test-based, not a runtime walk: zod string-leaf enumeration over
`handoffPayloadSchema`, throwing on unrecognized wrappers and on non-strict
objects, with four classification lists and per-path behavioral proof.

Evidence: each of the four new redactions reverted individually and shown to
fail the guard; `notes: z.record(z.string())` added to the schema and shown to
throw `unclassifiable zod type ZodRecord`; `packages/core` 37/37;
`pnpm verify` 56/56 tasks, exit 0. Reviewed by `code-reviewer` and two
adversarial `critic` passes; every round-one and round-two finding addressed.
Sources: [[docs/superpowers/specs/2026-07-25-handoff-redaction-guard-design]],
[[docs/superpowers/plans/2026-07-25-handoff-redaction-guard-plan]],
[[entities/hot-handoff]].

## [2026-07-25 14:52 +03] merge | Stage A shipped with its gate still failing

PR #295 ("net-positive Stage A — PARKED, ungated") merged to `main` as
`8e261d19` on 2026-07-25, carrying the per-workspace net-effect estimator that
auto-pauses the saver plus the per-session first-sight seen-hash ledger. Its
own acceptance gate was still FAILED at merge time: geomean 0.948x against a
required >=1.0x, min task 0.68x against >=0.9x. The variance-controlled
bench-replay harness that could resolve the effect has never been run against
the real API, so no post-merge verdict exists — the shipped guardrail and
first-sight saver have no demonstrated cost benefit. PR #293 (Hot Handoff)
also merged in the same window. Sources:
[[syntheses/variance-controlled-benchmark]], [[syntheses/saver-cache-churn]],
[[docs/superpowers/specs/2026-07-19-net-positive-megasaver-design]] §gate.

## [2026-07-25 15:40 +03] correction | Stage A merge shape and commit count

Both syntheses overstated the Stage A merge. Corrections, each verified against
the repo: the branch carries **10** commits, not 11 (`git log --oneline
main..feat/net-positive-stage-a | wc -l`); it was **rebase-merged**, not
merged — `8e261d19` has a single parent, so there is no merge commit, and the
range on `main` is `0157fe44..8e261d19`; the `feat/net-positive-stage-a` ref
survives the rebase, so `git merge-base --is-ancestor` still reports it
unmerged while `git cherry` marks all 10 commits as patch-equivalent on `main`.
Added the live-code pointer (`apps/cli/src/hooks/saver-run.ts` wires
`saverPausedByNetEffect` plus the seen-hash ledger) so a reader does not
re-derive whether the guardrail actually ships. The prior entry
`[2026-07-25 14:52]` stands as written history; it is superseded on the "merged
as `8e261d19`" phrasing only. Sources:
[[syntheses/saver-cache-churn]], [[syntheses/variance-controlled-benchmark]].
## [2026-07-25 14:30 +03] fix | GC sweep clobbered registry-session stats

`reconcileOverlaySummaries` (packages/stats/src/store.ts) treated every
`stats/<dir>` as an overlay workspace, so `maybeRunOverlayGc`'s once-a-day
sweep rewrote `stats/<projectId>/<sessionId>.json` as a zeroed overlay
summary. Measured on a store with one registry session: `rebuilt` 2,
`bytesSavedTotal` 9000 → 0, and a phantom `handoff.json` fabricated from the
handoff ledger; `readSummary` and `appendEvent` then threw `store_corrupt`
permanently, so `mega output exec/file/filter` returned `store_write_failed`.

Fix: the sweep only enters dirs matching `workspaceKeySchema` (16 lowercase
hex), the layout discriminator `locateChunkSet` already uses. After: `rebuilt`
0, registry summary byte-identical, no `handoff.json`, real overlay workspaces
still repaired. 4 red → green guard tests in
`packages/stats/test/reconcile-legacy-layout.test.ts`; 241/241 stats tests
pass. Branch `fix/gc-reconcile-clobbers-legacy-summaries`.
See [[entities/stats]].
## [2026-07-25 14:35 +03] fix | classify.ts `^\s*` quadratic (redos instance 6)

`VITEST_OUT` and `PROSE_ANTI_VI` in `packages/output-filter/src/classify.ts`
opened alternatives with `^\s*` under the `m` flag. `\s` matches `\n`, so inside
a blank-line block every line start rescanned the whole remaining whitespace
region before failing the required literal. Measured through the real call site
`classifyOutput`: 31.8 s on 100 KB of newlines, 89 ms after bounding to
`\s{0,64}`. Exposed by `mega bench`, which passes raw command output to the
public export (`filterOutput` was shielded only incidentally, by feeding it
post-`collapseRepeatedLines` text).

Evidence: new `packages/output-filter/test/classify-redos.test.ts` at 100 KB
with a 5 s ceiling — red 31.8 s before the fix; each bound verified
load-bearing alone (32.6 s / 20.9 s when reverted individually). Package suite
40 files / 416 tests green; biome clean on both touched files. Branch
`fix/classify-vitest-text-multiline-ws-quadratic`; not merged. Updated
[[concepts/unbounded-run-redos]] with instance 6 and the `^\s*`-under-`m`
variant.
## [2026-07-25 19:40 +03] rebase | long-memory hybrid recall onto main

Rebased `codex/feat/long-memory-hybrid-recall` (71 commits) onto `main`
(`e639a7ee`) as `rebase/long-memory-hybrid-recall`. The branch is purely
additive outside four files — it adds `packages/long-memory`,
`benchmarks/longmemeval-v2/`, its specs/plans, and wiki pages — so it does not
overlap the perf/correctness work that landed on main. One conflict, in
`wiki/log.md`; `wiki/index.md` and `wiki/agent-channel.md` auto-merged with no
entry lost.

`wiki/log.md` needed care: main's merge `5a13a8c2` left the file at zero bytes,
so a plain rebase would have carried only the branch copy and silently dropped
the 17 entries main gained after the fork. Resolved by three-way union against
main's last non-empty version `d213947e` — 221 entries, no duplicates, nothing
dropped from either side. The zero-byte file on main is a separate open defect
with its own branch (`fix/review-C2-wiki-log-wiped`).

`pnpm-lock.yaml` was reset to main's and regenerated with
`pnpm install --lockfile-only`; the result is byte-identical to the branch's
own lockfile (the `packages/long-memory` importer plus `fs-ext@2.1.1`,
`nan@2.28.0`, `@types/fs-ext@2.0.3`).

One test failed under a forced full run and not in isolation:
`packages/long-memory/test/lm2-index.test.ts` "stops catalog/direct work at
1,024 and raw text at 16 MiB". The harness sets `defaultTimeoutMs: 100` and
`createLm2IndexService` deadlines on real `performance.now()`, so on a loaded
machine the wall clock ended the run before the budget under test and the
receipt came back without a `nextCursor`. Pinned that one case to
`MAX_LM2_INDEX_BATCH_TIMEOUT_MS`. Pre-existing on the branch, not caused by the
rebase.

Evidence: `pnpm verify` exit 0; `Tasks: 58 successful, 58 total`. Forced
uncached runs also green — `turbo typecheck --force` 58/58 in 33.1 s,
`turbo test --force --concurrency=4` 58/58 in 2m2.9 s. Not merged, not pushed.
Also observed and left alone: `packages/context-gate/test/saver-heartbeat.test.ts`
"steals a stale lock file" flaked once under a forced full run and passes in
isolation; that file is untouched by this branch and the flake is main's.

## [2026-07-26 16:41 +03] feat | product memory now uses LM2 hybrid ranking

Added `@megasaver/memory-recall`, a read-only adapter from Core MemoryEntry
records to LM2 candidates. It relies on the existing vector sidecar and hash
manifest, so malformed or stale vectors fall back to Safe lexical recall rather
than changing memory lifecycle or silently dropping eligible entries. Wired it
into task-based CLI search, MCP `get_relevant_memories`, `search_memory`, and
`mega_recall`, plus daemon registry recall. Sources:
[[entities/memory-recall]],
`docs/superpowers/specs/2026-07-26-lm2-product-memory-integration-design.md`.

Review gate: three fresh-context review launches were attempted after the
final verifier pass, including both available model routes. All failed before
reviewing with the local provider error `404 No enabled canonical OpenAI
provider`; do not merge until an independent reviewer can run. (source:
2026-07-26 Codex review launcher results)

Follow-up retry at 16:49 failed with the identical provider error, making four
failed fresh-context review launches in total. The code and verifier evidence
remain ready, but the mandatory external-review and pre-merge rebase gates are
unmet. (source: `wiki/agent-channel.md`)

## [2026-07-26 16:55 +03] test | LM2 product recall surface parity

Added a concrete temporary-store fixture that compares Safe lexical ordering
from the shared adapter, MCP relevant-memory and search handlers, daemon
registry recall, and JSON CLI search. It also proves that an unapproved
suggested memory is excluded on every surface. The fixture found only a
TypeScript package-boundary issue: the existing MCP handlers were made public
exports rather than importing MCP internals from the CLI test. `pnpm verify`
passed after the change. The independent-review and pre-merge integration
gates remain pending. (source:
`apps/cli/test/memory/hybrid-recall-surfaces.test.ts`,
`packages/mcp-bridge/src/index.ts`)

## [2026-07-26 16:58 +03] chore | LM0–LM2 rebased onto current main

The previous Long Memory integration branch had drifted 17 commits from remote
`main`, so its merge preview contained unrelated application conflicts. A new
`feat/lm2-product-memory-integration` branch was created directly from current
`origin/main`, then the complete LM0–LM2 plus product-memory commit chain was
replayed without rewriting the original branch. Only additive `wiki/log.md`
history required manual union. `pnpm install --frozen-lockfile` and `pnpm verify`
passed on the new branch. Independent review remains the only release gate.
(source: branch `feat/lm2-product-memory-integration`, 2026-07-26 verifier)

## [2026-07-26 17:00 +03] review | LM2 integration reviewer unavailable

A fresh independent code-review launch against
`origin/main..feat/lm2-product-memory-integration` failed before receiving the
diff: the local reviewer endpoint returned `404 No enabled canonical OpenAI
provider for model: gpt-5.6-terra`. This is the fifth repeated provider failure,
not a code-review result. The integration branch remains clean after its frozen
install and full verifier pass; do not merge until an independent reviewer can
run. (source: 2026-07-26 `lm2_integration_review` launcher result)

## [2026-07-26 17:14 +03] fix | preserve bounded product-memory recall

After the local review provider was restored, a fresh independent review found
two P1 defects in the product-memory adapter. Its preselection dropped the
task text and could discard a relevant older memory after 1,000 newer entries;
it now takes Core's task-aware lexical order before applying the LM2 window.
LM2 projections and tasks larger than the 50,000-code-unit contract now return
Core lexical recall and a Safe receipt instead of propagating an LM2 validation
error through CLI, MCP, or daemon callers. Focused adapter tests (12/12), the
adapter build/typecheck, and `pnpm verify` pass. An independent re-review is
still required before merge. (source:
`packages/memory-recall/src/rank-project-memories.ts`,
`packages/memory-recall/test/rank-project-memories.test.ts`, 2026-07-26
verifier run)

## [2026-07-26 17:19 +03] fix | bound LM2 product-memory corpus input

The re-review confirmed task-aware candidate preselection but found that 1,000
individually valid candidates could exceed LM2's 64 MiB aggregate UTF-8 corpus
limit and leak a validation error. The corpus limit is now a shared public LM2
contract used by both the runtime and product adapter. The adapter preflights
the aggregate and converts any remaining `Lm2Error` to Core lexical recall with
a Safe receipt. The new astral-Unicode regression passes alongside the focused
adapter suite (13/13), both package typechecks/tests, build, and `pnpm verify`.
A fresh independent review remains required before merge. (source:
`packages/long-memory/src/lm2-model-contracts.ts`,
`packages/memory-recall/src/rank-project-memories.ts`,
`packages/memory-recall/test/rank-project-memories.test.ts`)

## [2026-07-26 18:05 +03] fix | close adaptive product-memory release findings

Cached recall now uses the Transformers per-call local-files-only option rather
than mutating the process-global remote-model policy, so a later explicit memory
index build retains its documented download path. Bounded vector and hash
sidecar reads now distinguish absence (Safe) from malformed, oversized, or
concurrently changed input (Adaptive degraded `vector_read_limit`). Candidate
selection keeps up to 500 task-relevant lexical entries and evenly samples the
remaining vector-indexed capacity across the eligible timeline, preventing
newer indexed records from crowding out an older semantic candidate. Focused
adapter tests are 21/21 and `pnpm verify` passed. Hash values now require the
exact SHA-256 shape, every vector row is validated before filtering, and bounded
reads compare file identity plus modification metadata to reject same-size
races. Fresh release-gate review is pending. (source: `packages/embeddings/src/embed.ts`,
`packages/embeddings/src/store.ts`, `packages/core/src/embed-memory.ts`,
`packages/memory-recall/src/rank-project-memories.ts`, commits `5ba5d46d`,
`4a6cf71b`)

## [2026-07-26 18:10 +03] review | approve LM2 product-memory release gate

Fresh independent release review approved commit `d528189a` with no P0/P1/P2.
It verified the cache-only recall/indexing separation, fail-closed bounded
vector and hash reads, chronological indexed-candidate coverage under a
saturated 1,000-record window, and shared CLI/MCP/daemon adapter behavior.
`pnpm verify` is green. The branch is clean, rebased on current `origin/main`,
and ready for a user-authorized push and pull request. (source:
`lm2_final_release_approval`, 2026-07-26)
## 2026-07-26 — policy: three disclosed carrier gaps closed

Closed the three gaps §5b's "Disclosed coverage gaps" table recorded as known
and unclosed. Twelve shapes measured `fired: (none)` against `769d7efd`; all
twelve redact. New row `slack_webhook_url` (public surface: `findings[].name` is
a grouping key in `pro-analytics/src/firewall-report.ts`), placed immediately
after `jwt` and ahead of every prefix detector. `gitlab_token` alternation
completed to GitLab's full documented set. `connection_string_secret` gained
three bounded `\s{0,8}` gaps and quoted alternatives.

Linear: growth x2.03–2.07 across five seeds, 512 KB → 4 MB. The `\s{0,8}` gaps
cost 1.6x constant on a benign 200 KB log (0.52 → 0.82 ms).

**Measurement hazard, second occurrence.** Every timing figure taken before the
box was checked was worthless: 60 orphaned vitest workers and 30 orphaned
busy-wait shells (`while :; do :; done`, from a deleted `lock-steal` worktree
whose lock-contention benchmark spawned `CORES*3` hogs and whose `kill $HOGS`
never ran) had held the 10-core box at **load 124 for 16 h 52 m**. Provably
linear patterns measured growth ratios from x0.97 to x13.70, non-monotonically.
min-of-N does not help — at that load there is no quiet slice. `redos-probe.mjs
carriers` now refuses to print a ratio above 0.75 × cores. See
[[wiki/concepts/redos-growth-ratio-measurement]].

Also found: `scripts/redos-probe.mjs` had drifted from the shipped table — its
`connection_string_secret` row still carried the `pwd` field dropped from
production, so the row measured a regex that does not ship. The probe
transcribes patterns by hand; the byte pins in the suite are the only thing
tying them to reality.

Sources: [[docs/superpowers/specs/2026-07-26-carrier-residual-gaps-design]],
[[docs/superpowers/plans/2026-07-26-carrier-residual-gaps-plan]].

## [2026-07-26 18:25 +03] review | approve escaped ADO.NET redaction repair

An independent security review found that the initial quoted connection-string
branches treated a doubled quote as the terminator, leaving the escaped-quote
tail visible after a successful `connection_string_secret` finding. The repair
consumes doubled delimiters as quoted content for both quote styles and pins
exact redacted output. The reviewer approved the repair with no P0/P1/P2;
policy tests are 667/667, the whole `pnpm verify` gate passed, and adversarial
2→4 MiB inputs measured 1.87x (unterminated) and 1.86x (escaped) growth.
(source: `policy_release_security_review`, 2026-07-26)

## [2026-07-26 18:35 +03] fix | close PR #312 standalone and redaction findings

PR #312 review found three release blockers: the product-recall import pulled
the Long Memory barrel and thereby placed a native `fs-ext` payload in the
standalone CLI, the artifact exceeded its 12 MiB ceiling, and uppercase Slack
webhook URL scheme/host variants escaped redaction. Long Memory now exposes a
benchmark-free, `fs-ext`-free `./ranker` public entrypoint used only by the
recall adapter; the single-file CLI bundle applies whitespace minification and
is 8.33 MiB with no `.node` payload. Slack webhook matching pins uppercase
scheme/host while retaining its lowercase endpoint path. The benchmark package-boundary tests now explicitly allow
only this narrow additional export while proving it contains neither benchmark
transport nor `fs-ext`. The standalone smoke suite is 7/7, focused Long Memory
boundary/index tests are 48/48, policy is 668/668, and `pnpm verify` passes.
A security re-review is still required before merge. (source:
`apps/cli/tsup.bundle.config.ts`,
`packages/long-memory/src/lm2-ranker-entry.ts`,
`packages/policy/src/redaction-patterns.ts`, PR #312)

## [2026-07-26 18:40 +03] fix | align scoped Slack detector evidence

Security re-review found that broad `gi` also folded Slack's case-sensitive
endpoint path. The detector now uses explicit case-pairs only for the URI
scheme and DNS host; `SERVICES`, `Workflows`, and `TRIGGERS` are pinned
non-matches. The design's displayed pattern and the carrier ReDoS probe now
carry the exact same expression and mixed-case scheme/host seed as production.
The local carrier measurement correctly refused at 18.1 load on 10 cores;
the reviewer independently measured 2→4 MiB growth at 1.94x, 1.97x, and
2.08x. Policy is 671/671 and `pnpm verify` passes. Fresh re-review remains
required before merge. (source: `packages/policy/src/redaction-patterns.ts`,
`packages/policy/test/redact-superlinear.test.ts`,
`scripts/redos-probe.mjs`, `policy_release_security_review`)

## [2026-07-26 18:40 +03] test | remeasure scoped Slack carrier detector

After the load guard admitted the host (5.27 on 10 cores), the updated
mixed-case Slack anchor probe measured 1.29 ms, 2.61 ms, 4.89 ms, and 9.93 ms
at 512 KiB through 4 MiB — **x2.03** from 2 to 4 MiB. Its benign 200 KiB build
log constant was 0.42 ms. These replace the pre-scope timing evidence in the
carrier design; no performance claim rests on the obsolete lowercase-only
regex. (source: `scripts/redos-probe.mjs carriers`, 2026-07-26)

## [2026-07-26 18:58 +03] fix | make LM2 CI verification deterministic

GitHub Actions run `30208733506` failed on both Ubuntu and Windows at
long-memory fixtures while the same package passed locally. Root cause was
three fixture assumptions, not a runtime memory failure: normal indexing tests
used a 100 ms deadline under matrix contention; two tests rebuilt workspace
`dist/` during concurrent child-process tests; and one current-state fixture
tied multiple snapshots on `observedAt`. The test harness now uses the existing
15-second batch deadline, child tests consume the workflow's prebuilt artifacts,
and the bounded-recall candidates have strictly increasing timestamps. A
two-fork focused run passed 45/45 files and 413/413 tests; full `pnpm verify`
passed with the same long-memory count. Fresh PR review and a new CI matrix are
still required before merge. (source:
`docs/superpowers/specs/2026-07-26-lm2-ci-determinism-design.md`,
GitHub Actions run `30208733506`)

## [2026-07-26 19:05 +03] fix | remove LM1 child artifact dependency

Independent review found the first CI repair had removed the in-test build but
left two LM1 child-process tests importing the untracked long-memory
`dist/index.js`. Those children now run a source fixture with the repository
tsx runtime and import `lm1-runtime` directly, so no test mutates `dist/` and
the child behavior no longer depends on a previously emitted long-memory
artifact. With `packages/long-memory/dist` temporarily absent, the LM1 store
suite is 28/28; the complete long-memory suite is 45/45 files and 413/413
tests. (source: `packages/long-memory/test/fixtures/lm1-publish-child.ts`,
`pr312_release_review`, 2026-07-26)

## [2026-07-26 19:22 +03] fix | restore policy ReDoS probe parity

The replacement LM2 release matrix (PR #315, Ubuntu job `89814290161`) exposed
a real policy verification regression: the new imported-regex parity test found
that `scripts/redos-probe.mjs` measured the pre-`230df3f7` connection-string
regex, while production handles doubled quotes inside ADO.NET quoted secrets.
The production pattern and the strict parity test were deliberately left
unchanged; the one probe expression now matches the shipped expression byte for
byte. The originally failing policy suite is now 19/19 files and 701/701 tests,
and the full `pnpm verify` gate passed locally. A replacement two-platform CI
matrix and fresh independent review remain required before merging. (source:
`docs/superpowers/specs/2026-07-26-policy-probe-parity-design.md`, GitHub
Actions run `30209915950`)

## [2026-07-26 19:28 +03] fix | make LM2 evidence fixture Windows-portable

Independent review identified the Windows-only P1 hidden behind the preceding
Ubuntu failure: `createEvidenceFixture` invoked Unix `find -type f`, which the
Windows runner routes to its incompatible `FIND` command. The fixture now walks
only ordinary files using Node `readdirSync`, emits deterministic root-relative
`/` paths, and retains the existing SHA-256 evidence rows. A red contract test
first proved the helper was absent; after implementation the LM2 completion
integration suite passes 60/60 and the full `pnpm verify` gate passes locally.
A fresh reviewer pass and a replacement matrix remain required before merge.
(source: `packages/long-memory/test/lm2-completion-fixtures.ts`,
`pr312_release_review`, 2026-07-26)

## [2026-07-26 19:38 +03] fix | serialize Windows saver seen-ledger reads

The final Windows matrix exposed an independent platform race after the LM2
fixture path completed: a saver hook read a session JSON ledger without the
writer's lock, so Windows rejected another hook's atomic rename with `EPERM`.
Both operations now use the same 50 ms stale-aware lock. A contended read
returns `false`, preserving the established fail-open policy. The new lock
contention contract and the real four-process race suite pass 6/6 locally.
Fresh review and a replacement two-platform matrix are required before merge.
(source: GitHub Actions job `89815835263`,
`docs/superpowers/specs/2026-07-26-windows-seen-ledger-lock-design.md`)

## [2026-07-26 19:41 +03] fix | avoid first-use seen-ledger lock spin

Fresh review found that the shared lock helper requires its parent directory to
exist. A first-time `hasSeenOutput` call had neither a ledger nor that parent,
so its attempted lock acquisition busy-waited for the full 50 ms deadline.
Missing ledgers now return fail-open `false` before lock acquisition; existing
ledgers retain the reader/writer lock that prevents Windows `EPERM`. Focused
seen tests and the four-process race remain 6/6. (source:
`pr312_release_review`, 2026-07-26)

## [2026-07-26 20:06 +03] fix | make LM2 filesystem guards Windows-portable

Windows CI run `30211016909` proved that LM2 passed POSIX-only `O_NOFOLLOW`
and `O_DIRECTORY` flags unconditionally, so durable index and catalog work
failed closed before acquiring their Windows `LockFileEx` locks. Shared
platform helpers now omit only those unsupported flags on Windows, retain the
existing immediate and repeated `fstat`/`lstat`/symlink checks, and skip only
directory metadata `fsync` there; file sync and atomic publication remain.
The stalled-approval fixture's test-only deadline is now 5 s (10 s ceiling),
because its former 500 ms could expire before reading an existing vector under
full-Turbo contention. `pnpm verify` passes: 60 tasks; long-memory 46 files /
416 tests. (source: GitHub Actions run `30211016909`,
`docs/superpowers/specs/2026-07-26-lm2-windows-filesystem-design.md`)

## [2026-07-26 20:08 +03] fix | cover benchmark directory sync on Windows

Independent review found benchmark-run creation and control replacement still
fsynced directory descriptors directly. Those calls now route through the same
Windows-aware directory-sync helper as vector publication; regular-file fsync
remains unchanged. The new descriptor-level red contract went green with
benchmark security and transport coverage (6 tests) plus package typecheck.
(source: `pr312_release_review`,
`packages/long-memory/src/lm2-benchmark-files.ts`)

## [2026-07-26 20:23 +03] release-blocked | final Windows matrix exposes remaining LM2 portability gaps

Replacement CI run `30211975610` is green on Ubuntu but fails in the Windows
`@megasaver/long-memory` test task. The failures group behind three root
causes: Windows does not implement POSIX owner/group permission bits used by
the benchmark safe-path verifier; benchmark evidence/test tooling assumes
Unix absolute paths and a `pnpm` executable without the Windows `.cmd`
suffix; and catalog-lock control persists `dev`/`ino` as safe JavaScript
numbers even though Windows file identifiers can exceed that precision. The
last case is a security-boundary concern and must use a lossless identity
representation, not a test waiver. PR #315 must not merge until a scoped
Windows-identity design, red tests, independent review, and a fresh two-OS
matrix succeed. (source: GitHub Actions run `30211975610`, Node/Libuv stat
documentation, 2026-07-26)

## [2026-07-26 20:36 +03] fix | preserve Windows lock identities losslessly

The final PR #315 review found the catalog-only repair incomplete: the
workspace index lock, operation fence, and quota ledger still serialized file
identities as JavaScript numbers. Those paths now use `BigIntStats` and
canonical decimal strings end-to-end, including descriptor/path rechecks.
Existing canonical catalog controls and quota ledgers with safe numeric IDs
are narrowly normalized; noncanonical or precision-losing legacy IDs fail
closed. Focused security, ledger, catalog, index-operation, and full
long-memory checks pass locally; fresh independent review and two-platform CI
remain release gates. (source: `pr312_release_review`,
`docs/superpowers/specs/2026-07-26-lm2-windows-identity-design.md`, 2026-07-26)

## [2026-07-26 20:40 +03] review | approve lossless Windows identity transition

Fresh independent review found and then verified the last persisted-state
transition condition: a legacy numeric quota ledger is guarded by its original
canonical bytes until the held index lock atomically rewrites the normalized
string form. Snapshot reads likewise accept only the safe canonical legacy
shape. The end-to-end migration case, focused suites, and the full `pnpm
verify` gate pass; PR #315 is ready for a replacement two-platform CI run.
(source: `pr312_release_review`, 2026-07-26)

## [2026-07-26 21:25 +03] fix | close final Windows benchmark admission boundary

Replacement CI `30214155415` was green on Ubuntu but revealed that Windows
rejects `O_NONBLOCK` on ordinary benchmark-file opens, causing the safe-path
boundary to fail before the retained identity verification. The boundary now
omits only that unsupported flag on Windows; POSIX retains it for FIFO-stall
protection. The same matrix exposed an immediate `process.exit()` in the
replacement-writer fixture, which could truncate its JSON pipe output on
Windows; the fixture now exits naturally after stdout drains. The orphan-lock
expectation also follows the already-specified Windows mode capability rather
than asserting a POSIX-only permission result. A red flag test then 30 focused
benchmark/catalog tests, typecheck, and lint pass locally. Full verification,
fresh review, and replacement two-platform CI remain release gates.
(source: GitHub Actions job `89825272677`,
`packages/long-memory/src/lm2-benchmark-safe-path.ts`, 2026-07-26)

## [2026-07-26 21:42 +03] investigation | instrument the real Windows safe-path rejection

The replacement matrix `30214748030` disproved the provisional
`O_NONBLOCK` diagnosis: Node exposes that flag as zero on the Windows host, so
the previous change did not alter the failing open. Every benchmark manifest
open still rejects before operation dispatch. A native-Windows-only regression
test now records the raw `openSync`/`fstatSync`/`lstatSync` device, inode,
mode, and link observations if the safe wrapper rejects the same regular file.
The next matrix run will identify the exact boundary (open versus identity
verification) without exposing filesystem details through the benchmark
protocol. (source: GitHub Actions job `89826841693`, 2026-07-26)

## [2026-07-26 21:52 +03] diagnosis | Windows host handle still blocks seen-ledger replacement

The native safe-path diagnostic no longer reproduces in run `30215294810`;
Long Memory proceeds on Windows. The same run instead isolated the remaining
release failure to `context-gate`: even after saver-seen readers and writers
share a lock, Windows returns `EPERM` when a writer renames its temporary JSON
file over the ledger. Therefore the contending handle is not an owned reader
and retrying the lock would be a symptom treatment. The planned repair retains
the shared lock but writes this explicitly fail-open auxiliary ledger directly
under it; its existing corrupt-file behavior already converts an interrupted
write to “not seen,” which is safe redundant compression. (source: GitHub
Actions job `89828358449`, `packages/context-gate/src/saver-seen.ts`,
2026-07-26)

## [2026-07-26 21:56 +03] fix | eliminate Windows seen-ledger replacement race

The injected `renameSync` denial regression failed red against the existing
writer, proving the auxiliary ledger still depended on target replacement.
The writer now directly writes its tiny JSON payload while holding the same
session lock used by every product reader. A write interruption is safe under
the pre-existing fail-open parser: the following hook treats it as not seen and
may compress once more, but no hook fails or reads a partial in-process write.
The replacement-denial contract, four-process lost-update contract, package
typecheck, lint, and full `pnpm verify` pass locally. Fresh independent review
and a replacement Windows matrix remain required before merge. (source:
GitHub Actions job `89828358449`,
`packages/context-gate/src/saver-seen.ts`, 2026-07-26)

## [2026-07-26 20:47 +03] fix | preserve LM2 source boundary after identity transition

Ubuntu CI found the extended ledger-recovery module at 302 lines, violating the
project's strict 300-line source boundary. The canonical legacy quota-ledger
normalizer and serializer now live in a dedicated 76-line module, leaving the
recovery module at 234 lines without changing its public parser. Source-size,
ledger, index, read, full verification, and a fresh independent review pass.
(source: GitHub Actions run `30213074787`, `pr312_release_review`, 2026-07-26)
## [2026-07-26 21:06 +03] fix | make benchmark safe paths truly Windows-capable

CI run `30213350385` passed Ubuntu but its Windows job exposed a second
benchmark boundary: Node cannot open directories as POSIX file descriptors on
Windows, so benchmark run admission failed before its regular-file lock. The
safe-path layer now holds a Windows `Dir` handle for directories, preserves
exact BigInt device/file identities, and revalidates pathname replacement at
every guarded boundary; regular files retain descriptor, flock, and fsync
behavior. The same repair makes the `.cmd` benchmark build invocation shell
safe, makes catalog child framing CRLF-safe, and scopes LM1 durability
observation to directory syncs rather than file syncs. A red simulated Windows
handle/replacement test, 38 focused tests, package typecheck, lint, and full
`pnpm verify` pass locally. A fresh independent review and replacement matrix
remain required. (source: GitHub Actions job `89823208710`,
`docs/superpowers/specs/2026-07-26-lm2-windows-identity-design.md`)

## [2026-07-26 23:15 +03] fix | normalize final Windows LM2 text boundaries

Rebased CI run `30218056200` passed Ubuntu but exposed two final Windows text
boundaries: `tar -tzf` returned CRLF member lines, and a catalog child could
finish before its last JSON write callback. Archive member parsing now removes
only the line terminator before type/inventory checks, and the child awaits its
final result write while preserving synchronous pre-lock signals. The initial
callback predicate was corrected from `undefined` to Node's success `null`
after the real catalog suite failed red. Focused catalog + completion tests
(75), package typecheck, Biome, and fresh `pnpm verify` pass locally. New
independent review and replacement two-platform CI remain required.
(source: GitHub Actions job `89835545872`,
`docs/superpowers/specs/2026-07-26-lm2-windows-identity-design.md`)

## [2026-07-26 21:09 +03] review | close benchmark directory identity race

Fresh review found that the new Windows directory branch initially captured
its exact identity only after `opendirSync`, leaving an identity-swap window
that a rounded numeric stat could miss. The implementation now compares
lossless BigInt identities immediately before and after opening and retains
the pre-open identity. A dynamic filesystem regression reproduces the swap
while returning the old numeric stat, failed red before the repair, and passes
after it. Independent review approved the closure; full `pnpm verify` remains
green. (source: `pr312_release_review`, 2026-07-26)

## [2026-07-26 22:31 +03] fix | flush exclusive LM2 benchmark state through update handles

Fresh Windows CI run `30216086762` reproduced benchmark admission failure on
two independent Windows workers while Ubuntu passed. The fan-out begins at
run opening: `writeExclusive` created each canonical state file, reopened it
read-only, then requested the required durability flush. The exclusive writer
now reopens `sentinel.json`, `control.json`, and the replacement temporary in
safe `update` mode before `fsync`, retaining every pathname, file-kind, link,
mode-capability, and exact-identity check. A mocked safe-path contract failed
red by observing the old read mode and now observes update mode; 88 focused
tests, package typecheck/lint, and full `pnpm verify` pass locally. Fresh
review and replacement matrix are still release gates. (source: GitHub
Actions jobs `89830416544`, `89831530754`,
`packages/long-memory/src/lm2-benchmark-files.ts`, 2026-07-26)

## [2026-07-26 22:53 +03] fix | close the remaining Windows LM2 test boundaries

Replacement Windows CI `30217042527` proved the durable benchmark writer no
longer caused the original run-open fan-out, then exposed three independent
portability boundaries. The official evidence verifier now compares logical
package artifact names in canonical `/` form rather than native `path.join`
output; catalog process fixtures accumulate and frame CRLF/chunked pipe output
before parsing the barrier/result protocol; and the index-operation cleanup
assertion now distinguishes the documented absence of Windows directory fsync
from mandatory file-close cleanup. A red fake-child regression covered the
combined CRLF/barrier-result chunk. Focused LM2 tests (109) plus a fresh full
`pnpm verify` pass locally. Independent review and new two-platform CI remain
release gates. (source: GitHub Actions job `89832957274`,
`docs/superpowers/specs/2026-07-26-lm2-windows-identity-design.md`)

## [2026-07-26 23:44 +03] fix | order catalog child completion by stream end

Windows CI run `30218979667` isolated a fixture-only protocol race: a catalog
child could emit `close` before its final buffered stdout JSON reached the
parent data handler. Direct, barrier, and signalled appenders now wait for
both child exit and stdout end before parsing the terminal result. Three red
fake-child tests reproduce the exact ordering; focused catalog/completion tests (75),
package typecheck/lint, and root `pnpm verify` (60 tasks) pass locally. Fresh
review and replacement two-platform CI remain release gates. (source: GitHub
Actions job `89837986701`,
`packages/long-memory/test/lm2-catalog-process-fixtures.ts`, 2026-07-26)

## [2026-07-27 00:00 +03] fix | close the child result stream on Windows

The replacement Windows run proved that parent-side close-plus-stream-end
ordering alone cannot recover bytes that the child never flushes: its final
catalog JSON was absent even when the parent observed stdout end. The child
now uses `process.stdout.end` and awaits its completion callback for the
terminal result. Local catalog fixture/security tests (18) and package
typecheck pass; full verification, review, and a new Windows matrix remain
release gates. (source: GitHub Actions job `89840018762`,
`packages/long-memory/test/fixtures/lm2-catalog-child.ts`, 2026-07-27)

## [2026-07-27 11:15 +03] test | remove LM2 live-publication wall-clock race

The release-record CI run `30248262191` passed Windows (including bundle smoke)
but Ubuntu job `89920138366` left the LM2 live-publication timeout test waiting
until Vitest's 30-second ceiling. Its five-millisecond real deadline could
expire before the publication-start signal on a loaded runner, which is a valid
immediate timeout rather than a product defect. The regression now starts the
publication under a controlled `performance.now()`, advances fake time and the
100 ms timer only after that signal, then releases the gate. It retains the
behavioral contract: no early finalization, one finalized operation, one
committed prefix, and a timeout retry at the next record. Production source and
timeout policy are unchanged. The focused test, full long-memory suite
(48 files / 433 tests), and root `pnpm verify` (60 tasks) pass locally; fresh
independent review and two-platform replacement CI remain release gates.
(source: GitHub Actions job `89920138366`,
`docs/superpowers/specs/2026-07-26-lm2-ci-determinism-design.md`, 2026-07-27)

## [2026-07-27 11:18 +03] review | approve controlled LM2 timeout protocol

A fresh independent reviewer approved the scoped timeout-test diff with no
P0/P1/P2 findings. The review confirms the test observes a live publication
before advancing both the timer and monotonic clock, still requires the drain
before finalization, and restores timer/clock state after the awaited receipt
clears the production timer. The focused regression passed 1/1 under review.
(source: `pr312_release_review`, 2026-07-27)

## [2026-07-27 11:22 +03] ci | replace stale two-runner LM2 release matrix

PR #319's first replacement matrix (`30249330274`) is not actionable test
evidence: both hosted runners completed install and build, entered `pnpm
verify`, then stopped reporting state. The workflow record's `updated_at`
remained at 08:17Z even while the jobs showed later step timestamps, and its
25-minute job timeout did not fire after more than three hours. Local root
verification had already passed 60 tasks and the same full long-memory suite;
there is no runner log, error, or failing test to support a code change. The
matrix is therefore replaced from the same verified source head; a repeated
failure must be diagnosed from the new job's first emitted failure rather than
treated as a retry-success signal.
(source: GitHub Actions run `30249330274`, workflow `CI`, 2026-07-27)

## [2026-07-27 00:32 +03] release | merge LM2 durable product recall

PR #315 is merged into `main` at `b8554f7a`. Its final CI run `30220323813`
passed build, `pnpm verify`, and bundle smoke on both Ubuntu and Windows. The
merged product exposes LM2-backed recall through the existing Core memory
entries and the CLI, MCP, and daemon adapters; it does not establish an
official LongMemEval-V2 score. (source: GitHub PR #315; GitHub Actions run
`30220323813`)

## [2026-07-27 11:34 +03] release | merge deterministic LM2 CI correction

PR #319 merged to `main` at `3190178e` after fresh independent review and
replacement GitHub Actions run `30249670317`. Ubuntu completed Verify and
bundle smoke in 7m09s; Windows completed the same gates in 10m49s. The change
removes only the test's five-millisecond wall-clock race: production indexing,
public APIs, timeout policy, and durable memory data remain unchanged.
(source: GitHub PR #319; GitHub Actions run `30249670317`, 2026-07-27)

## [2026-07-27 12:20 +03] fix | repair LM2 Darwin secure-anchor alias handling

The first pinned public LongMemEval-V2 web trajectory reproduced a macOS-only
failure after benchmark admission: a literal `/tmp` cache path created the run,
but the vector store's no-follow directory-anchor walk rejected the root-owned
Darwin system alias before index publication. LM2 now canonicalizes only a
verified `/tmp` or `/var` alias to its exact `/private/...` target; arbitrary
symlinks remain fail-closed. A Darwin transport regression, an arbitrary
symlink guard, full long-memory suite (48 files / 435 tests), root `pnpm
verify` (60 tasks), and a real manifest-admitted first insert all pass. No
official score is claimed; complete reader/evaluator-backed web and enterprise
runs remain required. (source:
`docs/superpowers/specs/2026-07-27-lm2-darwin-anchor-design.md`, local pinned
data audit, 2026-07-27)

## [2026-07-27 12:45 +03] fix | bound retrieval's active Windows Vitest pool

PR #321's first Windows CI run failed before either BM25 suite entered a test:
under the repository-wide Turbo test graph, Vitest timed out fetching the
shared `src/errors.ts` module for its default fork workers. The retrieval
package now limits that active Vitest 2.1.9 fork pool to one fork; it neither
raises timeouts nor adds retries, and Turbo-wide concurrency is unchanged. A
real configuration contract was red before the setting, then green; the
retrieval suite passes 43 tests, root `pnpm verify` passes all 60 tasks, and a
fresh independent reviewer confirmed the active-pool correction after catching
and closing an initially inactive thread-pool setting. Replacement two-platform
CI remains the release proof. (source: GitHub Actions run 30253983645 Windows
job 89938203691; `pr312_release_review`; 2026-07-27)

## [2026-07-28] feature | gui-console-redesign

Imported the "Mega Saver Console" prototype from Claude Design
(`claude.ai/design/p/124f5957…`) and rebuilt `apps/gui` around it on
`feat/gui-console-redesign`. Frontend-only: no bridge route, no Core change.

- Spec `docs/superpowers/specs/2026-07-28-gui-console-redesign-design.md`,
  plan `docs/superpowers/plans/2026-07-28-gui-console-redesign.md`.
- Mapped every prototype surface to a real route first. Four had no backing
  (sparkline, cross-workspace activity feed, Live brain, office multi-floor +
  provider picker) and were omitted rather than faked — user decision.
- Corrected three prototype colours that failed WCAG AA; the contrast suite
  now pins every text role against every surface in both themes.
- Caught two real bugs via the DoD gate: `mcp?.agents.filter` threw on a
  non-null response without an `agents` array (Overview + app shell), and
  `window.matchMedia` is absent in jsdom (theme toggle).
- Found `biome.json`'s `useSemanticElements` override pointed at five files
  deleted by earlier redesigns — matched nothing. Rescoped to one file.
- Evidence: `pnpm verify` — biome clean, `tsc -b` clean, GUI 641 tests / 85
  files green; all 7 pages driven in the real app, both themes.
- Pre-existing flake noted (NOT a regression): `packages/context-gate`
  `test/saver-seen-concurrency.test.ts` fails under loaded parallel `turbo`;
  reproduced on a clean tree with the branch stashed.

Updated [[entities/gui]] (console-redesign section + corrected Lint posture).

### [2026-07-28] follow-up | gui-console-redesign review pass

Second-opinion review of the branch caught five things the gate could not:

- **Heading regression:** the sidebar brand was an `<h1>` and every restyled
  page now has its own `<h1>` → two h1 per document. Sidebar demoted to a
  `<span>`; the page title is the real h1.
- **Floor plan was never seen with an occupant** (zero agents in this
  checkout). Created three real agents through the office API to look: an
  earlier blind "centre the monitor" tweak had put the monitor (`z-4`) on top
  of the seated figure (`z-2`), so **no one rendered at all**. The prototype's
  left offset is load-bearing. Reverted, verified with real agents, agents
  deleted afterwards. Recorded in spec §3b so it is not "fixed" again.
- **Illustration hex literals** in `office-floor.tsx` violated the tokens.css
  no-hex rule → explicit scoped exemption written into spec §3b (decorative
  fills only; anything meaningful still uses real tokens).
- **`.claude/launch.json`** pointed at a session-scoped scratchpad path that
  would break for the user → removed.
- **Stale docs corrected:** `apps/gui/DESIGN.md` (v3 "Editorial Workspace" →
  v4 "Console", new font + theme rows) and the Stack paragraph of
  [[entities/gui]], which still claimed DM Mono/zinc and
  `prefers-color-scheme`-only theming.

Also measured the font cost, since `apps/gui/dist` ships inside the published
CLI tarball: Instrument Sans publishes only latin + latin-ext (both wanted —
Turkish is the planned second locale, CLAUDE.md §11), so its bare imports were
already minimal; the serif renders one glyph run and was pinned to latin.
Net dist 1.2M → 1.1M.

**Gate status at hand-off:** biome clean, `tsc -b` clean, GUI 641/641 green.
`pnpm verify` still exits non-zero for two reasons, **neither from this work**:
the `context-gate` concurrency flake above, and `conventions:check` failing on
an uncommitted `CLAUDE.md` edit (OMC section removed, model defaults changed)
that was already in the working tree at session start and was not made here.
Because `verify` chains with `&&`, that test flake means `conventions:check`
never runs in a normal `verify` — worth knowing: DoD item 4 does not currently
gate DoD item 10.

## [2026-07-28] investigation | saver root cause — no savings, unsafe recovery

Find-only audit (user directive: locate the cause, do not fix). New page
[[syntheses/saver-root-cause-2026-07-28]].

Three design-level causes, each with a measured receipt:

1. **floor == budget.** `minBytesFor` (saver.ts:52-57) and `maxReturnedBytes`
   (record-output.ts:145) are both `modeToBudget(mode)`, and `fitBudget` packs up
   to that budget. Ratio is therefore `1 - budget/rawBytes` whenever the returned
   text reaches the budget — the low-redundancy case (source files). Measured
   `returnedBytes` is flat at the budget across 6 KB–250 KB in all three modes.
   Redundant input (logs) can beat that curve via `collapseRepeatedLines`, but
   `DEFAULT_MODE = "safe"` (resolve-saver-settings.ts:44) means nothing under
   32 KB is compressed at all, so those cases never reach the collapse passes.
2. **Two coordinate systems.** Delivered `… [lines X-Y omitted]` markers are in
   post-collapse space; stored chunks index pre-collapse `redactedText`. Measured:
   a marker reading `lines 146-902 omitted` resolves (by the only published rule)
   to chunk 3, which holds unrelated noise; the right chunk is ~23. Recovery
   mis-addresses, the agent probes further, and total cost exceeds the raw read.
   `saver-savings-gaps` C13 is marked FIXED but only re-compression was fixed.
3. **In-place `tool_result` rewrite** vs the client's native prompt cache —
   already recorded in [[syntheses/saver-cache-churn]], unchanged.

Contradictions flagged against [[syntheses/saver-cache-churn]]: the claimed
`saverPausedByNetEffect` wiring does not exist (net-effect is diagnostic-only),
and the session-scoped `saver-seen` ledger cannot explain the run-2 carry-over
that page's "harness cannot validate any stage" conclusion rests on.

Also noted: `filterOutput`'s own savings numbers exclude gap markers and the
footer, so `read.ts`, `run-command.ts` (x2) and `bench.ts` over-report; the
Grep/Glob `filenames` rebuild injects non-path entries into the array; the
`[repeated N times]` marker is itself droppable by `fitBudget`.

Environment check: no MegaSaver hook in `~/.claude/settings.json`, and
`~/.local/share/megasaver` holds only the Agent Office seed — the saver is not
active here, so no field telemetry exists for any of this.

## [2026-07-28] query | token-saver root-cause investigation

User report: saver doesn't save tokens (sometimes expands) and loses info
when saving. Ran a 4-scope parallel investigation (hook pipeline,
output-filter internals, savings accounting, proxy/MCP paths). Findings
filed as [[syntheses/token-saver-root-cause-2026-07-28]]; index updated.
Headline: "no savings" is architectural (cache-churn-blind byte accounting,
recovery re-injection never debited, unguarded MCP delivery paths);
"info loss" is mostly plain bugs (compressTsc silent drops, go-test panic
drop, excerpts-only persistence on 3 of 4 paths, filenames rebuild
corruption). Investigation only — no code changed.

## [2026-07-28] spec | saver compression & save-integrity (draft, CRITICAL)

Follow-up to the same-day find-only audit. User supplied three external LLM
audits; verified each claim against code before planning. New spec
`docs/superpowers/specs/2026-07-28-saver-compression-integrity-design.md`
(DRAFT, awaiting approval — no implementation).

Scope split recorded: `2026-07-19-net-positive-megasaver-design.md` keeps the
cost axis (cache churn, turn count); this spec owns the quality axis
(compression ratio + save integrity + honest accounting), which that spec does
not address.

New confirmations beyond the morning audit:

- **Unrecoverable loss on 3 of 4 entry points** — `read.ts:249`,
  `run-command.ts:390` and `:636` persist `filtered.excerpts` only; just the
  hook path stores full redacted raw. Dropped bytes exist nowhere on those
  paths, yet `connectors/shared/src/context-gate-block.ts:28` advertises "Raw
  output is stored". This outranks the coordinate mismatch: mis-addressed
  recovery is expensive, absent recovery is impossible.
- Nine confirmed defects: stop-word-free `tokenizeForMatch` under a ×21 weight
  (`rank.ts:132-133`); `compressTsc` dropping position-less diagnostics
  (`compress/tsc.ts:16-34`) fed by a 0.7-confidence output sniff
  (`classify.ts:127-129`); `parseGoTest` dropping panic blocks
  (`go-test.ts:15-30`); BM25 `\W+` tokenizer with no identifier split
  (`bm25.ts:33-38`); the `filenames` corruption; the droppable
  `[repeated N times]` marker; `bytesSaved` clamped at 0 with a `nonnegative()`
  schema so inflation is unrepresentable (`stats/event.ts:20,43`);
  single-slot stdout/stderr; the safe-mode Bash 24 KB/32 KB dead zone.
- `fetch-chunk.ts` (46 LOC) emits no event ⇒ recovery is never charged back
  against the reported saving.

Refuted or overstated in the supplied audits, recorded so they are not
re-planned: the "20x billing" figure (cache write is ~1.25x base; measured net
is 0.93–0.97x); "`appendAuditEvent` is dead" (called by
`commands/context/build.ts:38`, just absent from the saver path); "seen-ledger
decay is a bug" (intentional P1 design, owned by the net-positive spec); and the
benchmark carry-over attributed to that ledger (it is session-scoped, and
`bench-replay`'s session id is caller-supplied with no in-repo caller).

Staging locked in the spec: W0 observability first (inflation must be
representable before any measurement means anything), then the nine bugs, then
one guarded pipeline + one coordinate system + an integrity property test, and
only then the floor≠budget ratio lever — with the one-line `DEFAULT_MODE`
change measured alone first, since it moves more ratio than the redesign.
Condensation ("RTK parity") is a gated experiment, not a deliverable: the
naming the user cited resolves to in-repo conventions (`caveman-commit` skill,
`ponytail:` comment marker), not to a compression feature.

### [2026-07-28] review | gui-console-redesign — code-reviewer pass

External `code-reviewer` pass in a fresh context returned **REQUEST-CHANGES**
with 16 findings + nits. All actioned. The four that mattered:

1. **`$NaN` on the flagship savings figure.** `fetchAllWorkspaceTotals` is an
   unchecked cast; a malformed body (or `[]`, which is *truthy*, so the
   `totals ?` guard missed it) reached `computeSavingsHeadline` and rendered
   `$NaN`. The reviewer proved it was rendering in six existing tests with no
   assertion noticing. Added `isUsableTotals` at the boundary +
   `test/components/overview-degradation.test.tsx` covering null / `[]` / `{}` /
   string / NaN-fields, asserting the body never contains "NaN".
2. **Two of three CLI commands on the Setup page did not exist.**
   `mega session saver --mode balanced` (saver is a command *group*, no `--mode`)
   and bare `mega index build` (projectName is a required positional). Corrected
   to `mega session saver workspace enable --mode balanced` and
   `mega index build <project>`. Pinned in the component test with a comment
   naming the three CLI files to re-check, since @megasaver/cli is bin-only and
   a real parity test would need a cross-package deep import (§8).
3. **"Install" on the MCP readiness row routed to Token saver**, where MCP
   install does not live — a dead-end button. Routing now travels on the check
   object (`fixView`) instead of a label-string match.
4. **Estimate discipline was dropped.** The new headline rendered a bare `$X.XX`
   with hand-written pricing prose, while `packages/stats` requires `≈`,
   `(est.)` and the shared `SAVINGS_FOOTNOTE` so the GUI can never drift from
   the CLI's price constant. Restored.

Also fixed: stale `floorSelection` across a workspace switch (floor plan showed
B's agents over a "No agents yet" board); blank office view during load; the
`nowMs` clock advancing only inside `.then()` in `app.tsx`, which froze the top
bar's live count during an outage while Overview's list correctly emptied —
note `session-liveness.ts` *claimed* the shared helper prevented exactly that
disagreement, which it did not; readiness probes re-firing every 4s because
`deriveWorkspaceOptions` rebuilds `options` each poll; `needsSetup` never
refreshing; command-palette focus trap + focus restore; invalid `aria-selected`
on `role=button`; `aria-label` on a bare `<span>` (ignored by real AT — and the
test passed only because testing-library reads the attribute, not the computed
name); tab/tabpanel id linkage + roving arrow keys; the scrim hex literal →
`--color-scrim`; `greeting()` moved out of `session-liveness.ts` (§8).

**Test coverage was the reviewer's sharpest point:** eight office tests had been
moved onto the List view when the default became Floor. Each edit was justified
alone, but the net effect left the *default* view uncovered — and two real bugs
lived in exactly that path. Coverage restored and extended: new suites for
TopBar (replacing the deleted WorkspacePicker's, which had left workspace
switching untested), CommandPalette + `filterCommands`, Toast + `useToast`,
`greeting`, and Overview failure paths. The `$` assertion was strengthened from
`/^\$\d/` (which would pass against a hardcoded "$1") to the exact value
`computeSavingsHeadline` produces.

Evidence after fixes: biome clean, `tsc -b` clean, **GUI 676 tests / 90 files
green** (was 641/85), zero unhandled rejections, app re-driven with no console
errors. Unchanged pre-existing failures, both confirmed not from this work:
the `context-gate` concurrency test (fails under loaded parallel turbo; the
reviewer could not reproduce it under `pnpm -r`, so it is load-dependent rather
than deterministic) and `conventions:check` on the stray `CLAUDE.md` edit.

## [2026-07-28] plan | saver work split across three agents

`docs/superpowers/plans/2026-07-28-saver-integrity-work-split.md` — allocation
only, gated on approval of the same-day CRITICAL spec.

Split by difficulty AND by disjoint file ownership; no file is owned by two
tracks, because three agents editing `output-filter/src/types.ts` is a larger
risk than the work itself.

- **A (HARD, CRITICAL, Opus-class)** — one guarded pipeline, one coordinate
  system, integrity property test, ratio lever. Owns `record-output.ts`,
  `read.ts`, `run-command.ts`, `recovery-footer.ts`, `types.ts`, `fit.ts`,
  `context-gate-block.ts`.
- **B (MEDIUM, HIGH, Sonnet/Opus)** — signed savings, model-facing byte module
  (new file, so `types.ts` stays single-owner), recovery-debt event, real
  tokenizer, field telemetry, plus the three evidence-loss compressors
  (`compress/tsc.ts`, `classify.ts`, `parsers/go-test.ts`).
- **C (EASY, MEDIUM, Sonnet/Haiku)** — six isolated defects in `tokenize.ts`,
  `rank.ts`, `normalize.ts`, `bm25.ts`, `hooks/saver.ts`.

Three sequencing rules recorded because they are the failure modes: A publishes
the integrity contract before B fixes the lossy compressors; no ratio measurement
before B's signed savings lands (today `bytesSaved` is clamped at 0 with
`nonnegative()` schemas, so inflation is unrepresentable); C's ranking fixes move
the baseline every other track's fixtures pin, so C merges early and often.

Author≠reviewer is free with three agents — rotate A→C, B→A, C→B; Track A also
needs `critic` and `security-reviewer` separately.

Honest caveat in the doc: parallelism does not shorten the critical path. If the
ratio number alone is the goal, the shortest path is B's signed savings then the
one-line `DEFAULT_MODE` change measured alone — one afternoon, not three tracks.

## [2026-07-28] plan | saver work split — concrete model assignment

Work-split plan updated with the user's actual fleet: Track A (CRITICAL
architecture) → Opus 5, Track B (accounting + evidence-loss compressors) →
Kimi K3, Track C (five isolated defects) → Gemini Flash 3.6.

Two adjustments the assignment forced:

- **Track C hands over failing tests, not descriptions.** Flash implements
  red→green; it must not choose a list, threshold or data structure. C2's
  stop-word list is decided up front and written into the task — and it carries
  an unresolved §11 question (hardcoded Turkish vs. the not-yet-existing i18n
  layer) that must be answered before hand-off, not discovered mid-implementation.
- **Review rotation is by capability, not round-robin.** §4's author≠reviewer is
  about *context*, not model identity, so a fresh Opus context may review Opus
  work. Track A (CRITICAL) is therefore never sent to Flash for review; C2/C3 go
  to Opus because they move the ranking baseline the other tracks pin fixtures on.

Also recorded: the repeat-marker defect moved from Track C to Track A (A3b) —
merging the marker into its preceding line changes `collapseSimilar`'s fold
decisions and `test/normalize.test.ts:34,42` pin the exact output, so the real
fix is that evidence markers must be non-droppable in `fit.ts`. And A defers
removing `filterOutput`'s `returnedBytes`/`savingRatio` exports to stage 3 —
a removal against two tracks' in-flight imports is a break, not a conflict.

## [2026-07-28] plan | saver integrity spec APPROVED — step plan written

User approved `specs/2026-07-28-saver-compression-integrity-design.md`. Step plan
`plans/2026-07-28-saver-integrity-plan.md` derived from it; worktrees branch from
`main`, not from the current `feat/gui-console-redesign`.

Three defects folded into the spec after approval, found by cross-checking a
second same-day audit another agent had written to
[[syntheses/token-saver-root-cause-2026-07-28]] (which this session did not know
existed until the git status showed it):

- **B10** `dedupe()` runs on the passthrough and light bands
  (`output-filter/types.ts:296-302`), contradicting the `:250-252` comment that
  those bands drop no signal.
- **B11** daemon-timeout double count — `daemon/handlers.ts:47` appends the
  overlay event, and a client timeout after that write makes `saver-run.ts:108-138`
  fall back and append it again.
- **B12** `compressProse` (first paragraph per section + first 3 list items) and
  `compressJson` (first 3 + last of any array ≥20, intent-matched values not
  preserved). Prose is `saver-savings-gaps` D20, a conscious accept — re-opened
  only because the new integrity contract demands a marker or recoverability.

Two claims from that page checked and corrected on the page itself: its A10
("audit pipeline dead") is wrong — `commands/context/build.ts:38` calls
`appendAuditEvent`; its B9 (multi-text-block collapse) is overstated — all text
survives, only inter-block boundaries are lost. The two audit pages are now
cross-linked as companions rather than left as competing duplicates.

Also recorded in the plan: A0 adds a **third** candidate for the coordinate
question the spec left open — line provenance, so delivered gap markers speak the
file's RAW line numbers rather than post-collapse ones. Recommended over the
footer map, because raw line numbers are what an agent actually reasons in.

## [2026-07-28] chore | clear the two saver-programme dispatch blockers

Both preconditions for handing the approved saver programme to three agents are
now cleared, on branch `docs/saver-integrity-spec` (`main` + 3).

**Conventions drift (was red since before this work).** `CLAUDE.md` had been
hand-edited to drop the OMC skill list and bump model defaults without touching
`docs/conventions/` — the §13 violation `conventions:check` exists to catch, and
it kept DoD item 4 unreachable for every branch. Per user directive OMC is
removed for good: the section is gone from `skill-routing.md`, and the four names
still cited elsewhere map onto agents that already exist in `agent-routing.md`
(`architect`, `critic`, `tracer`, `security-reviewer`), with DoD item 7's
`omc:verify` → `verifier`. `conventions:sync --write` regenerated CLAUDE.md,
AGENTS.md and `.cursor/rules/mega-discipline.mdc`; the check is now clean.
`wiki/concepts/risk-aware-development.md` mirrors risk-modes by hand and is not a
sync consumer, so it was fixed separately. Historical plan files under
`docs/superpowers/plans/` still name the OMC skills and were deliberately left —
they record what was actually run at the time.

**Baseline verified per package**, since three agents inheriting an unknown-red
baseline is worse than a known-red one: context-gate 369, output-filter 451,
stats 249, mcp-bridge 343 (+1 skipped), retrieval 43, bench-replay 149 — all
green, no type errors.

Two environment caveats recorded in the plan rather than left for each agent to
rediscover: `pnpm` is not on PATH in this shell (fallback commands written into
the plan's DoD section so all three tracks use the same ones), and the previously
reported `context-gate` concurrency flake did not reproduce — but it was reported
under a parallel `turbo` run, which could not be driven here, so green in
isolation is not proof it is gone.

Corrected in the plan: worktrees branch from `docs/saver-integrity-spec`, NOT
`main` — `main` does not yet carry the spec, plans or wiki record, so a worktree
cut from it would have no source of truth and every track's `log.md` append would
conflict.

## [2026-07-29] query | Track B (saver accounting) landed

B1–B10 of the saver-integrity programme executed on feat/saver-b-accounting
(TDD throughout): signed savings (B1 gate: negative aggregate in mega audit),
model-facing bytes module, recovery-debt events, real BPE + divergence numbers,
field telemetry + fresh-store guard, tsc/classifier/go-test/prose+json fixes
against the A1 contract. Outcomes appended to
[[syntheses/saver-root-cause-2026-07-28]]; B10 diagnosis and per-item detail on
agent-channel.

## [2026-07-29] release | saver compression & integrity — stages 0-3 complete

Three-track programme consolidated on `docs/saver-integrity-spec`, 41 commits
ahead of `main`, `pnpm verify` green (60/60). Spec §7 carries the full outcome
table; review handoff in `plans/2026-07-29-saver-review-handoff.md`.

**The two user complaints, resolved:**

*Unsafe save.* Three of four entry points persisted only the excerpts the fit
step had KEPT, so whatever it dropped existed nowhere — while the connector
block advertised "Raw output is stored". A property test made this measurable
(960-1360 lines lost per case, 3/9 passing); one shared `recoverableChunks`
helper now derives recovery from the raw output on every path, 9/9. The fourth
path stored everything but numbered its gap markers in post-collapse space while
the chunks indexed the raw output, so recovery mis-addressed: a marker reading
`lines 146-902 omitted` resolved to chunk 3, holding unrelated noise. Line
provenance through the collapse passes moved markers to raw coordinates.

*No saving.* The eligibility floor and the output budget were the same constant
and `fitBudget` fills up to it, so the ratio was `1 - budget/rawBytes` — decided
by input size. The mode budget is now the ceiling and the target is a share of
the input. Measured, distinct source: balanced 12.5KB 4.5%->72.7%, 25KB
50.3%->73.3%; aggressive 6KB 27.4%->77.3%. Large inputs unchanged.

**The A4 gate is NOT met and no savings claim may be published.** Its pass
condition is net cost at constant integrity; net cost is unmeasured and the
harness that would measure it has never run against the real API.

**Three lessons worth more than the fixes**, each recorded in a commit body:

1. A test can assert self-consistency of a broken mapping. "Chunk
   floor((N-1)/40) contains raw line N" passes under the WRONG mapping too —
   both sides apply the same bad assumption. The working assertion was on the
   extent: the highest line number named must equal the raw line count.
2. A fixture of identical noise lines makes `toContain` succeed against any
   chunk in the region. Two tests passed green while the defect was fully
   present until the fixtures were made discriminating.
3. A unit test can pass while the system does not move. `record-output` passed
   `maxReturnedBytes: modeToBudget(mode)` — the filter's own default, so it
   looked inert — but that field means "the caller chose a size" and suppressed
   the new target ratio. The real path did not change until that line went.

**Corrections to the external audits that started this:** `bytes/4` is within 4%
for code, prose and Turkish (only JSON diverges, 1.193), not the claimed ~35%;
`appendAuditEvent` is not dead code; the seen-ledger is intentional design; and
the parallel-`turbo` flake is not context-gate-specific.

Deferred with reasons in spec §7: admission-guard floors ship OFF (cost axis,
and any floor >~1KB re-opens the dead band PR #278 closed), exec-path
enforcement follows the measurement, W6 condensation unstarted.

## [2026-07-29] review | saver integrity — external review corrections

Two fresh-context reviews of `docs/saver-integrity-spec` (code review + critic,
`docs/superpowers/reviews/track-a-opus-{codereview,critic}.md`). Both found real
defects behind a green `pnpm verify`. Spec §7 rewritten to match.

**What review found.**

1. *A3 shipped incomplete.* Gap markers were numbered in `normalize(redact(raw))`
   space while chunks indexed `redact(raw)`. `normalize` is not line-count
   preserving — a bare CR becomes a newline, which is how npm/pip/curl/docker
   draw progress bars — so on that input a marker resolved to a chunk index that
   does not exist, or silently to a real chunk holding unrelated content, under a
   footer saying "Full output recoverable".
2. *Three tests passed with the defect they cover fully present.* The
   addressability test's per-marker check ("chunk `floor((N-1)/40)` contains raw
   line N") is true for every N by construction. The A1 property test's
   `universe = delivered + recovered` is satisfied by `recovered` alone, so the
   delivered half asserted nothing. The A1 read-path block hand-assembled its own
   `persistChunkSet` call, so `run.ts:180` — the production wiring for
   `mega output file`, MCP `read-file` and the daemon registry — was uncovered
   repo-wide; §1b(i), the most severe finding in the audit, could be reinstated
   with all 60 turbo test tasks green.
3. *§W1 lever (a) never shipped and was not declared deferred.* The floor is
   still `modeToBudget`, `DEFAULT_MODE` is still `safe`.

**What changed.** `recoverableChunks` now chunks the normalized text, and
`record-output.ts`'s duplicate inline chunker is gone, so all five persistence
sites share one entry point. The three tests were made discriminating and each
defect was reintroduced as a mutation against the full `packages/context-gate`
suite (56 files / 388 tests): M1 (kept-excerpts-as-raw on the read path), M2
(delivered text reduced to the summary), M6 (interior markers in post-collapse
space), M7 (un-normalized chunking) and a footer under-count all now fail, with
catchers named in §7. §7 also now carries the fixture for its ratio table, a
`(size, mode) → rawBytes / decision / returnedBytes / chunkCount` table in place
of ratios alone, and the band table showing A4 changes nothing outside
4–32 KB / 12–48 KB / 32–64 KB per mode.

**Superseded records.** The `[2026-07-29] release` entry above states "`bytes/4`
is within 4% for code, prose and Turkish (only JSON diverges)" — the Turkish
figure (0.961) does not reproduce, its sign is inverted, and no corpus was ever
committed, so both it and "only JSON diverges" are withdrawn pending a captured
corpus. The same entry's "balanced 12.5KB 4.5%" before-figure is one of four
mutually inconsistent numbers for that cell (§1a 3.7%, `fit.ts:57` 16%, critic
0.1–1.1%); treat it as unmeasured. "60/60 turbo tasks" describes `turbo run test`
alone, not all of `pnpm verify`.

**Still open.**

- **A4 gate still NOT met.** Net cost is unmeasured; the harness has never run
  against the real API. No net-cost or savings claim may be made.
- **Two classes still uncovered.** A suppressed gap marker for a genuinely
  omitted region (surviving markers still correct) is visible only as a shape
  change; closing it needs a production-surface change — excerpt raw spans on
  `returnedText` — not more tests. And every assertion is containment-shaped, so
  nothing would detect fabricated delivered lines; that one is inferred from the
  assertions' shape, not from a mutation receipt, and what closes it is not yet
  established.
- **Single-point coverage.** M1, M6 and M7 are each caught by exactly one file;
  only M2 has redundancy. The anti-vacuity guard in `recovery-addressability`
  lands at exactly 2 checks with no margin.
- **Staging hazard.** `packages/context-gate/test/read-pipeline-recovery.test.ts`
  and `packages/context-gate/test/coordinate-skew.test.ts` are untracked and are
  the sole catchers for M1 and M7. `git add -u` will not pick them up; they must
  be staged by path or those two defects silently return to green.
- **§W1 lever (a)** now recorded as deferred with its reason and its consequence:
  below the floor the pipeline returns early and persists no chunk set, so under
  the shipped default output under 32 KB has no recovery handle at all.
- **Ratio generator not committed** — §6's "captured, not asserted" is unmet for
  the §7 table.

## [2026-07-29] test | saver integrity — second mutation round

Second hardening round on `docs/saver-integrity-spec`, closing the residuals the
first round declared open. Spec §7 rewritten again to match. `pnpm verify` exit 0
("Tasks: 60 successful, 60 total") run before the first mutation and after the
last revert, with a fresh `pnpm build` in between; every mutation reverted by
exact inverse edit, and the five snapshotted production source files hashed
identical at both ends.

**What the round changed.**

1. *Both "uncatchable" classes are now closed by receipt, not by argument.*
   Fabrication (M8 — `returnedTextOf` appends a content-shaped line absent from
   the raw) fails `save-integrity.property`'s three hook-path cases. Suppressed
   markers (M10 — one interior gap marker dropped, survivors correctly numbered)
   fail a new continuity assertion in `recovery-addressability` that names the
   exact omitted span. The previous entry's claim that suppressed markers needed
   a production-surface change rather than a test is withdrawn — a test closed it.
2. *Every earlier mutation was re-run, not inherited.* M1, M2, M6, M7 and the
   footer mutation (now M11) were re-applied against both suites
   (`context-gate` 56 files / 395 tests, `output-filter` 51 files / 494 tests).
   Two new mutations were added beyond M8/M10: M9 (`fitBudget` halves its budget)
   and M12 (stored chunk line numbers shifted by one). No mutation survives.
3. *Passthrough overshoot was fixed as two different defects.* On the hook and
   daemon paths the returned text is discarded (`saver.ts:361`), so the
   overshoot was a **reporting** defect — `record-output.ts`'s non-compressed
   branch now reports `returnedText: input.raw` and honest byte counts, matching
   the admission-guard branch below it. On MCP/exec the struct *is* the payload
   (`mcp-bridge/src/server.ts:316`), and those paths already counted it. Separately,
   a signed `deltaBytes` was added to `FilterOutputResult` and
   `RecordOverlayOutputResult`; `bytesSaved` and `savingRatio` keep their floor
   at zero so no existing reader changes meaning. No payload got smaller.

**Corrected numbers.** §7's ratio table is replaced by a new ladder on a
different corpus, keyed on `returnedBytes` at a stated input size with
`savingRatio` demoted to a derived column. The plateau figures the old §7 table
carried (aggressive ~4.3 KB, balanced ~12.3 KB, safe ~32.5 KB) belong to that
fixture and are superseded: aggressive returns 3027 / 3030 / 3032 B at 25 / 50 /
100 KB, balanced 11218 / 11220 B at 50 / 100 KB, and **safe does not plateau at
all** — 25085 → 30627 → 31585 B at 50 / 100 / 250 KB, a 1.26× numerator against a
5× input. The ratio climb is denominator-driven in every mode. The 250 KB cell
steps +958 B in both aggressive and balanced, coinciding with `chunkCount`
37 → 91; no mechanism is claimed. Also corrected: M2's blast radius is 4 files /
11 tests (not 10), and M11 has two guards, not the one its hardening report
claimed — that report was written against a concurrently-edited tree.

**Still open.**

- **A4 gate still NOT met.** Net cost remains unmeasured; the benchmark has never
  run against the real API. No savings or net-cost claim appears in §7 and none
  may be added.
- **Single-file coverage got worse, not better.** Five of eight defects now have
  exactly one guarding file — M1 (`read-pipeline-recovery`), M6 and M10
  (`recovery-addressability`), M7 (`coordinate-skew`), M8
  (`save-integrity.property`). The first round had three; the two new ones are
  the new assertions themselves.
- **M6's sole guard is an anti-vacuity counter** whose message describes the
  fixture, not the defect, and the continuity test built for that class is
  structurally blind to it: the spliced corpus is fold-free, so
  `startLine === rawStartLine` on every excerpt and M6 is a no-op there.
- **Fabrication is proven caught on the hook path only.** The read and exec
  renderers do not go through `returnedTextOf`; no mutation has been run against
  them.
- **Staging hazard narrowed to one file.** The previous entry's two untracked
  sole-catchers, `read-pipeline-recovery.test.ts` (M1) and `coordinate-skew.test.ts`
  (M7), are now tracked — that hazard is closed. It has reappeared once, at
  `packages/output-filter/test/passthrough-honesty.test.ts`: still untracked, and
  the only thing pinning the `filterOutput`-level inflation, which the fix made
  unobservable through `recordAndFilterOverlayOutput`. `git add -u` will not pick
  it up; stage it by path.
- **Ledger accounting still clamps** at `run.ts:229-231`, `:380-382` and
  `run-command.ts:457-460` / `:693`: an inflating passthrough read persists as a
  flat zero saving although `deltaBytes` is available one line away.
- **Passthrough cells persist no chunk set** — `chunkSetId` and `chunkCount` both
  null even with `storeRawOutput: true`, because the early return precedes
  persistence. Nothing is lost, but "raw output is stored" is not true of them.
- **Ratio generator still not committed**, so §6's "captured, not asserted"
  remains unmet for the new ladder too.

## [2026-07-29] fix | saver integrity — third round: floor decoupled, ledger closed

Third round on `docs/saver-integrity-spec`. It shipped the two items the second
round left deferred and closed the read-path ledger sites, then re-measured
everything. Spec §7 rewritten to match (source:
`docs/superpowers/specs/2026-07-28-saver-compression-integrity-design.md` §7).

`pnpm verify` exit 0, run twice — once on arrival before the first mutation
(uncached, full run) and once after the last revert, with the tree byte-identical
between them. `conventions:check` ok. `turbo run test` leg 60/60. Counts quoted
from the uncached run because the final run was a FULL TURBO cache hit, which is
legitimate only because the content hash is identical: `context-gate` 59 files /
417 tests, `output-filter` 51 / 497, `cli` 145 / 1464 + 7 skipped, `core` 913,
`mcp-bridge` 343, `daemon` 113, `stats` 262, `gui` 676.

**What shipped.**

1. *§W1 lever (a) — the eligibility floor is decoupled from the mode budget.*
   `COMPRESS_FLOOR_BYTES = 2_048` (`record-output.ts:57`) replaces
   `input.compressFloorBytes ?? modeToBudget(input.mode)`; `minBytesFor(tool)` in
   `apps/cli/src/hooks/saver.ts` no longer takes a mode. 2048 is
   `MIN_TARGET_BYTES` (1024) over safe's 0.5 share — the smallest input at which
   safe's ratio is its own rather than the clamp.
2. *Admission-guard floors are ON.* `DEFAULT_SAVING_FLOORS = { absoluteBytes: 256,
   relative: 0.15 }`, passed explicitly from `record-output.ts:291`; read and exec
   sites stay on `NO_FLOORS`. They sit ~2x under the worst measured cell at the
   eligibility floor (`tsc`-shaped output, safe, 2048 B: 619 B delta, ratio
   0.302), which is why they cannot re-open the #278 dead band — and also why they
   reject nothing that floor admits.
3. *The two read-path ledger sites are closed.* `runOutputPipeline` and
   `runOverlayOutputPipeline` now compute `mcpEnvelopeBytes(result)` after the
   chunk-set id and shown-dedup, and persist a signed `deltaBytes` alongside the
   clamped fields. Measured on a 32-byte inflating read: `returnedBytes` 81 → 748,
   `deltaBytes` absent → −716, `summary.deltaBytesTotal` 0 → −716.
   `run-command.ts` was resolved as correct-as-is, not fixed: its `deltaBytes` was
   already signed, and `savingRatio` cannot be made signed because
   `stats/src/event.ts` bounds it `[0,1]` inside a `.strict()` schema parsed on
   write — a negative value throws and turns the call into `store_write_failed`.

**Mutation campaign: 18 cycles, all caught, all reverted by hash.** Every earlier
mutation re-applied rather than inherited; six new (M13, M14, M16a, M16b, M17,
M17b, plus M18 and M10b beyond the brief). Each cycle rebuilt the workspace, so no
mutation was "caught" by a compile error. Cross-package resolution was calibrated
rather than assumed: M13 was run against `context-gate` with and without an
`output-filter` rebuild, which is what licenses reading that package's zeros as
"not applicable".

**Corrected numbers.** The ladder was re-run on the same generator and corpus with
only the floor default changed. 14 of the 18 shared cells are byte-identical;
exactly four moved, and all four were previously `passthrough` — 6 KB balanced
6133 → 1205, 6 KB safe 6133 → 3152, 12.5 KB safe 12785 → 5798, 25 KB safe
25501 → 12133. Nothing above the old floor moved by a byte. A 3 KB row was added.
No cell is `passthrough` now, so the "no recovery handle below the floor" band
narrowed from "below 32 KB under the shipped default" to "below 2048 B" — safe at
1.5 KB is still `passthrough`, so the floor is real. The 250 KB +958 B step
reproduces in **all three** modes, not the two the previous entry named.

Two earlier records are withdrawn: `passthrough-honesty.test.ts` is tracked
(`git ls-files` lists it), and M6's "guarded only by an anti-vacuity counter"
is stale as of HEAD — it now fails the adjacency assertion with a defect-naming
message. M6 remains single-guarded.

**Still open.** Full list is spec §7 "What is still open", 17 items. The ones that
would cost most if missed:

- **Three guard files are untracked** — `recovery-invariants`, `floor-decoupling`,
  `ledger-signed-delta` (all `packages/context-gate/test/`). Sole guard for M16a,
  M16b, M17, M18; second guard for M1, M7, M8.
- **Single-guarded defects rose from five to nine**, across five files, two of them
  untracked.
- **A4 gate still NOT met.** Net cost is unmeasured; the benchmark has never run
  against the real API, and `wiki/syntheses/saver-cache-churn` records the existing
  harness cannot resolve an effect of this size. The floor decoupling raised churn
  exposure in an unmeasured direction — the saver now fires above 2048 B instead of
  32 KB. No savings or net-cost claim appears in §7 and none may be added.
- **M13 is live and unmutated in production** on `filterOutput`'s outline branch
  (`output-filter/src/types.ts:248`), and an unchanged re-read is uncounted
  entirely (`run.ts:41-56`, returns before either append site).
- **Silent semantic changes with no migration note**: read-path persisted bytes now
  describe the whole MCP envelope (`bytesSaved` 77496 → 75566 on one read); daemon
  `/excerpt` default drift at `handlers.ts:53`, invisible to its own tests; coarse
  surfaces moved from `max(modeBudget, 16384)` to a flat 16384.
- **`DEFAULT_MODE` is still `"safe"`**, and the floor-sizing corpus is uncommitted
  and fixture-sensitive (2x spread at the same cell).

## [2026-07-29] flake | GUI saver-mode-activation joins the CI flake registry

`apps/gui/test/components/saver-mode-activation.test.tsx` — "renders the current
disabled status" — failed once on CI (`AssertionError: expected undefined to be
false`) and is a **pre-existing flake, not a regression**. Recorded because the
project's flake notes so far name only `context-gate` and `mcp-bridge`, so a
future session would otherwise re-diagnose it.

Evidence it is not attributable to the change under test (PR #324):

- The branch contains **zero commits touching `apps/gui/`**.
- The **identical tree** passed the same job minutes earlier — the branch was
  only linearized afterwards, and `git diff` between the two is empty.
- 5/5 passes locally in isolation.

Mechanism: the test `waitFor`s on `getByLabelText(/Saver Mode/i)` and then reads
`.checked` on the result. `undefined` means the element resolved before the
input was rendered — an async-render race, not a logic fault. A fix belongs in
its own change (assert on the input directly, or wait for the checked state
rather than the label).

Standing correction to earlier notes: the parallel-`turbo` flake is not
`context-gate`-specific. Three packages have now produced one — `context-gate`,
`mcp-bridge` and `gui` — which points at the shared runner rather than at any
one suite.

## [2026-07-30] measurement | first real-session data: the saver is inert on this corpus

The A4 gate finally got a real-API run, and the harness **refused to return a
verdict** — correctly, and for the most informative reason in the programme so far.

Recorded four real `claude -p` coding sessions through `bench-replay record`
(43 requests, 6-19 turns, $1.41 reference cost). Replayed task_1 in balanced
mode. `buildVerdict` refused:

> the megasaver arm applied the saver 0 times (passthrough=5, failed=0) —
> it is identical to baseline, so there is no verdict to report

**Why: the tool results are two orders of magnitude below every floor.** Across
all 288 `tool_result` blocks in the recording — median **329 B**, p90 1,390 B,
**max 1,991 B**:

| floor | eligible blocks |
|---|---|
| 2,048 B — `COMPRESS_FLOOR_BYTES`, decoupled but not adopted | **0 / 288** |
| 4,000 B — aggressive | **0 / 288** |
| 12,000 B — balanced | **0 / 288** |
| 32,000 B — safe (`DEFAULT_MODE`) | **0 / 288** |

Not one block clears even the smallest floor the codebase contains. On this
workload the entire compression pipeline is inert, in every mode, and the W1(a)
floor decoupling would not change that either — which retires the open question
of whether adopting it was worth the churn risk **for corpora of this shape**.

**What this does and does not say.** It is the first field measurement this
project has ever had; §E of the root-cause audit recorded field telemetry as
zero. It does NOT say the saver never fires: the corpus is four small feature
tasks on the harness's own synthetic bench repo, where a `Read` returns a
200-line file and a `Grep` a handful of hits. It says this corpus cannot measure
the saver, and the harness was right to refuse rather than print a ratio near
1.00 that would have read as "no effect".

**Consequence for the A4 gate: still not met, and now for a second, sharper
reason.** Previously net cost was unmeasured because the instrument could not
resolve a ≤5% effect. Now we know that on this corpus there is no effect to
resolve — the treatment never applied. Any future benchmark needs a corpus with
tool outputs large enough to clear a floor: a large repository, wide greps, long
build logs, big file reads. Recording against this project's own tree would be
the obvious next attempt.

Recorded also because it will otherwise be re-derived: the harness prints its own
model-mix caveat (39 Opus 5 + 4 Haiku 4.5; `normalizedCostUsd` is model-blind and
prices every token at one flat card). Measured Haiku share of request bytes is
0.32%, and those sidecar calls carry no `tool_result`, so they are identical in
both arms — the distortion is ~1.3% of total and largely cancels in the ratio.
Not a blocker at this size; it would be at a larger share.

## [2026-07-30] measurement | the A4 gate answered: the instrument is 8x too coarse

Second real-API attempt, on a corpus where the saver actually applies. The
harness refused a verdict again — and this refusal is the answer.

**Corpus.** Three search-heavy sessions recorded against a clone of this
repository (2,534 files) with `--reuse-repo` + `--prompts`: read every test that
guards recovery content, trace a tool_result from hook to stored chunk, run the
context-gate suite and explain its slowest tests. 241 `tool_result` blocks,
median 2,325 B, p90 15,261 B, max 28,382 B — two orders of magnitude above the
synthetic corpus.

| floor | eligible |
|---|---|
| 2,048 B — decoupled, not adopted | 63.9% |
| 4,000 B — aggressive | 27.8% |
| 12,000 B — balanced | 11.2% |
| 32,000 B — safe (`DEFAULT_MODE`) | **0.0%** |

**Aggressive is not measurable here, and that is correct.** `.megasaver/policy.json`
declares `{"modeFloor": "balanced"}` and `clampModeToFloor` refuses aggressive on
this tree — §12 working as designed, since evidence-dropping compression is
forbidden on a HIGH-risk repo. Relaxing the policy to obtain a number would be
bending the rule to measure it.

**Balanced is resolvable — checked before spending.** Modelling `targetBudget`
over the recorded block sizes gives byteRatio 0.659 against the harness's 0.95
ceiling: the transform moves 34% of tool_result bytes, comfortably inside what
the instrument can see.

**The result.** The saver applied, and the harness refused on its order check:

> the run is order-sensitive — baseline-first gave **1.598** and megasaver-first
> gave **1.197** (tolerance 0.15). The gap is prompt-cache warming, not saver
> behaviour, so there is no verdict to report

That gap, **~0.40 on the ratio, is the number the harness's own KNOWN-UNVALIDATED
section said did not exist yet**: "prompt-cache nondeterminism is untested and
unquantified … no ≤5% claim is supportable yet." It is now quantified on this
instrument, and the mechanism is named. The effect the A4 gate needs to resolve
is ≤0.05. **The instrument is roughly 8x too coarse for its question.**

**Do not average more runs to escape this.** Order sensitivity is a systematic
warming asymmetry, not random noise; repeats shrink the standard error of a
biased estimate, not the bias. Loosening `--order-tolerance` until a verdict
appears would be tuning the instrument to the answer.

**Directional signal, stated as weak.** Both orderings landed above 1.00
(baseline ÷ megasaver), which is consistent with the saver not being harmful on
this corpus. It is not evidence of a saving: the spread is 8x the effect, and the
harness's own model-mix note says a flat rate card understates magnitude in
whichever direction it points.

**A4 verdict: NOT MET, and now for a well-founded reason.** Integrity holds, the
ratio is measured, and net cost remains unmeasurable with this instrument until
prompt-cache warming is controlled — pinned cache breakpoints, an interleaved
rather than sequential arm order, or a design that does not price two arms
against a shared warming history. No savings claim may be published.

Harness defects found and fixed on the way (`b7d76341`): the compressed-recording
guard matched the footer anywhere in a tool_result, so reading this repo's own
source made the harness unable to record against its own tree; and `--repo` has
always begun with `rmSync` on its target, which `--reuse-repo` now avoids while
refusing a dirty checkout.

## [2026-07-30] fix | bench-replay: per-arm-RUN prompt-cache namespaces

The 0.40 order sensitivity above is now removed at its mechanism rather than
averaged over. **Prediction recorded before the re-run, so the result cannot be
rationalised after it.**

**The level was wrong twice before it was right.** The first fix namespaced the
cache per ARM. That cannot work: `replayBothOrders` runs two pairs = four arm
runs, and an arm-scoped marker is constant across both pairs, so pair 2 still
reads back what pair 1 created. `replay.ts` said so in its own design comment —
"the two pair runs are NOT separated by a cache cool-down … by the second pair
every shared prefix is already warm from the first … That is the point." The
dominant term was never arm position inside a pair; it was **pair position**.

The namespace is therefore scoped per arm RUN — four markers, applied at send
time in `replayArm`, not at prepare time in `prepareArms`. Each run starts cold
and warms only itself, which is also what production does: one arm, one session,
cold at the start.

**Sign check (the reason to believe the mechanism).** `costRatio` is
`baseline ÷ megasaver`, so above 1.00 means megasaver is cheaper. Run order was
baseline(1st), megasaver(2nd) | megasaver(3rd), baseline(4th). Pair 1: baseline
paid cache_creation cold and megasaver read it back → baseline looks expensive →
**1.598**. Pair 2: both warm, baseline reading its own run-1 bytes → baseline
looks cheap → **1.197**. Both numbers fall out of warming in the direction
warming predicts. The 0.40 is an artifact, and it is the artifact we named.

Verified against the recordings, not assumed: `cache_control` sits on
`system[2]`/`system[3]` in every recorded request, and on no tool definition. The
prefix order is tools → system → messages, so a marker prepended to `system[0]`
changes the key of **every** breakpoint without moving any of them. Had the
breakpoints been on tools, a marker in `system` would have left the tools entry
shared and the fix would have been silently inert.

Six mutations, six caught — including the two that matter most: `replayArm`
never applying the namespace (production wiring), and the slot being ARM-scoped
rather than run-scoped (the wrong-level fix that looks right and measures
nothing).

`orderSensitive` keeps its name and its code but no longer means what it says:
with four namespaces, arm position buys no discount, so the two pairs are
independent **replicates** and disagreement now means the measurement does not
reproduce. That is broader than what it used to catch, not narrower.

### Prediction, before the run

1. The two pair ratios converge to within the 0.15 tolerance (from 0.40).
2. The converged ratio lands **above 1.00**, with a floor near 1.2 and **no
   upper bound stated**. Megasaver sends strictly fewer tokens through a
   structurally identical cache pattern, so on the input side it must be
   cheaper. The floor comes from pair 2's 1.197 — but that was measured with
   BOTH arms warm, where cache_read at 0.1x compresses the absolute gap between
   two differently-sized prefixes. Cold-cold runs price that same token
   difference at cache_creation rates (1.25–2x), i.e. 12–20x higher, so the fair
   value may land well above 1.6. An overshoot is the cold regime pricing the
   delta honestly, not an anomaly.

### What the run still will NOT settle — stated in advance

**A ratio above 1.00 here is not an A4 pass.** `prepareArms` bakes the compressed
text in from the first request a tool_result appears in, so every megasaver
prefix is internally cache-consistent. Production is not: the PostToolUse hook
rewrites a tool_result that the live session has **already cached**, invalidating
the suffix and re-billing it as cache_creation — the mechanism behind the
measured 0.93–0.97x net in [[syntheses/saver-cache-churn]]. A byte-replay of a
pre-built sequence has no analogue of that.

So this instrument measures **input-side token reduction in a self-consistent
session**, which is one term of the net-cost question and not the contested one.
If the ratio comes back above 1.00 as predicted, the honest reading is "the saver
sends fewer input tokens", **not** "the saver saves money". If it comes back
below 1.00, that is a genuine surprise and worth chasing.

**A second, independent bias survives this fix and is NOT addressed by it.** The
corpus is 17/18 opus-5 plus 1 haiku, priced at one flat rate card, and the
harness's own note says that biases the ratio toward 1.00 and **understates
magnitude in whichever direction it points**, by an amount it does not quantify.
So even a clean convergence yields a number with a known one-sided bias of
unknown size. Whatever comes back is reportable as a DIRECTION, not as a
magnitude — a converged ratio is not a calibrated one, and must not be quoted as
though the convergence made it one.

**A4 remains NOT MET.** Fixing the order sensitivity makes the instrument
self-consistent; it does not make it the right instrument for the churn tax, and
it does not fix the rate-card bias sitting on top.

## [2026-07-30] decision | A4 reformulated as a bounded gate — two of three terms settled

User directive: close A4 completely. A4 as written ("net cost reduction", one
number) is not reachable by any instrument this repo can build — live A/B spreads
0.68x-1.23x against a ~5% effect on agent-path nondeterminism, and a fixed-
trajectory replay can never produce recovery turns. Approved reformulation:

> **A4 passes iff `S > 0` and `R < R*`.**

| term | meaning | source | status |
|---|---|---|---|
| `S`  | input-side cost saving | replay (per-arm-run cache namespaces) | **open** — needs one real-API run |
| `R*` | break-even recovery rate | derived offline from a recording | **66.7%** |
| `R`  | observed recovery rate | production ledger | **2.4%** |

**R < R* holds with a ~28x margin.** Both sides are measured pessimistically, so
the margin is a floor, not an estimate.

### The mechanism that motivated A4 was misattributed — retracted

`saver-cache-churn` blamed "rewrite tool_result in place -> invalidate the 1h
prompt cache". That cannot happen: PostToolUse returns `updatedToolOutput`
(`saver.ts:377`) BEFORE the result enters the transcript, so the compressed bytes
are what appear on the FIRST send; and recurring tool_results are byte-stable
across a session (26 of 26 recurring ids, both corpora). There is no earlier
cached version to invalidate. The 48,005-vs-29,525 figure is one observation from
a live A/B where the two arms were different conversations — trajectory
divergence, not a tax with a mechanism. Direction survives; mechanism does not.
A related replay-visible candidate was also ruled out: prompts run 14k-62k tokens
against a 1024-token minimum cacheable prefix, so compression cannot drop one
below the cache floor.

### R* — bounding what cannot be measured

Saving and expansion cost are the same physical quantity, so they compare without
a token estimate or a rate card. The unit is the BYTE-APPEARANCE: the Messages
API resends the whole history each turn, so a byte's cost scales with how many
requests it appears in. Counting plain bytes would price a last-turn expansion
the same as a first-turn one.

**A modelling error found by mutation testing, not by review.** Expansion was
first charged the bytes compression REMOVED. Wrong: `mega output chunk` appends
chunks as new tool_results while the compressed summary stays in history, so an
expanded session carries BOTH. The cost is the RAW bytes:

```
baseline             r(N-j+1)
megasaver, expanded  c(N-j+1) + r(N-j)
affordable    <=>    (N-j+1)(r-c) >= r(N-j)
```

Under the wrong model the saving beat the cost for EVERY possible input — R* was
pinned at 100% regardless of the data, a constant wearing a percent sign. Two
mutations survived the first test suite and exposed it; one of the two passing
tests was passing only because a `?? 0` fallback supplied the value it asserted
on. Measured after the correction: `rec-big/task_1`, balanced, 18 requests,
saving 442,187 byte-appearances over 3 compressed outputs → **R* = 2/3**.

### R — making the observed rate visible

B3 already writes `kind: "expansion"` rows with `deltaBytes = -fetchedBytes`, so
"re-injection never debited" was fixed. But **nothing ever read the field**: the
ledger could show net bytes while the RATE — the only quantity R* compares
against — stayed invisible. `@megasaver/stats recoveryRate()` now derives it.

Measured on this machine's real ledger: 46 rows, 42 compressed outputs, **1
expanded → R = 2.4%**. Small n, and it is one operator's workload; but it is real
use, not a benchmark, and it sits 28x under the bound.

Both sides lean against the saver on purpose: R* assumes the costliest outputs
are expanded first, each in FULL, immediately after first sight; R counts an
output expanded by a single chunk as fully expanded.

### Verification

8/8 mutations caught on the break-even math (including the two escapes that
exposed the modelling error), 5/5 on the recovery rate. `pnpm verify` green.

### What remains

Only `S`. One real-API replay closes A4. Two caveats already recorded stand: the
corpus is 17/18 opus-5 priced at one flat rate card, so the ratio is directional
rather than calibrated; and R* is corpus-specific — a workload with many small
compressed outputs and long sessions would lower it.

## [2026-07-30] fix | bench-replay: rehearse before paying, and never discard billed evidence

Three paid runs in a row died before printing a verdict — a saver that never
fired (small corpus), a policy floor clamping aggressive to balanced, and the
order check. Every one was detectable without spending anything, and the third
threw away the per-request cache numbers it had just paid four arm runs to
collect. Two changes so the next run is the last one needed:

**`--dry-run`.** A full rehearsal with no network. Store preparation and its
mode-floor resolution, `prepareArms` with the REAL saver subprocess and its
per-call contract, the uncompressed-recording guard, the resolvable-transform
refusal, both pair orders, the order check, the drift smoke and the printer all
execute against a synthetic sender. Usage is derived from body size, so the run
is deterministic and the two orders agree by construction — it validates
PLUMBING and measures nothing, which the banner says at both ends of the log.
Verified end-to-end on `rec-big`: integrity ok, order check passes, pooled
figure prints, exit 0. The only stage it cannot rehearse is what the API does
with the prompt cache, which is the one thing worth paying for.

**A refusal now carries its evidence.** `replayBothOrders` attaches the pairs to
the error and the script prints every arm's per-request usage before dying.
Confirmed by forcing a real refusal in the dry run.

That second fix caught a bug of exactly the class it was written for: the script
imports from `dist/`, and the first attempt to exercise the refusal path printed
nothing because the package had not been rebuilt. The library test was green the
whole time. Glue between a package and its script is not covered by either
side's tests, and only running it end-to-end found it.

## [2026-07-30] result | A4 passes under model — S derived offline after the API budget ran out

The paid replay died at request 16 of its second arm on `HTTP 400: Your credit
balance is too low`. 34 real requests went through cleanly first, so the pipeline
and the `scope: "global"` fix are confirmed against the live API. With no budget
left, `S` was derived instead of measured.

| term | value | basis |
|---|---|---|
| `S`  | **1.199x** | modelled, cross-checked against one real pair |
| `R*` | **66.7%**  | derived offline |
| `R`  | **2.4%**   | production ledger |

**A4 passes under model: `S > 0` and `R < R*`, the latter by ~28x.**

### Why a modelled S is usable here

The prompt cache is a deterministic longest-prefix match, and both arms' exact
bytes and breakpoint positions are in hand. Four things keep the number honest:

- **Validated against real usage.** Total input-side tokens within **0.1%** of
  the recording's own end-to-end figures (1,024,470 vs 1,025,568); read within
  3.4%; creation over by 38%.
- **Invariant to the one free parameter.** bytes-per-token 2.5-2.7 → S = 1.1989
  throughout. It cancels in a ratio.
- **Invariant to the model's known errors.** Creation -38% (matching reality) or
  +50%, read -20%, applied to both arms: S stays in 1.1987-1.1990.
- **Agrees with the one real measurement.** The order-sensitive run's second pair
  — both arms warm, the fairest comparison that run produced — measured 1.197
  against the model's 1.199.

### Calibration found two bugs review did not, and both inverted the answer

1. **Matched only at the CURRENT request's breakpoints.** A growing conversation
   caches at turn k and reads that entry back at turn k+1, where the marker has
   moved on. Modelled cache_read was 0 for a session whose real read was 945,296.
2. **Hashed `cache_control` as content.** It is a marker and it moves every turn,
   so the same tool_result hashed differently once it left. The match froze at
   the system prefix (51,161 B) for all 18 requests.

Before the fixes the model put read/creation at 0.44; the real session ran 11.8;
after, 8.2 and then correct in the split. **A model that agrees with reality only
after being calibrated against it is worth exactly as much as the calibration** —
which is why the invariance checks above, not the fit, are the argument.

### A finding that reaches beyond the model

`system[0]` is a synthetic `x-anthropic-billing-header` block whose `cch` value
changes on EVERY request. If it participated in the cache key, no prefix could
ever match and cache_read would be 0 — the recording's real 945,296 says the
platform strips it. **The arm-cache namespace marker is currently prepended to
`system[0]`.** If that block is stripped, the marker is stripped with it and the
four arm runs are NOT isolated — the namespacing would be inert and the order
sensitivity it was built to remove would still be there. The paid run never got
far enough to show this either way. **CLOSED same day.** The marker now rides on the
block carrying the first `cache_control` — that block IS a breakpoint, so it is
provably part of the cached prefix and cannot be stripped, and rekeying it
rekeys every later breakpoint since each one's prefix contains it. Verified on
the real recording: the marker lands on `system[2]` (the first block with
`cache_control`), leaving `system[0]` untouched. `stripCacheNamespace` searches
for the marker rather than assuming index 0. 4/4 mutations caught, including
"marker back on system[0]" and "fallback allows the billing header".

The lesson worth keeping: **every existing test passed while the isolation was
inert.** They asserted that the four bodies differ, which was true in the
harness and false at the API, because the difference died in a block the
platform removes. A test that checks what we send cannot see what the platform
does with it — only reasoning from the recording's own real usage numbers
exposed the gap.

### Cost discipline

`--dry-run` and the billed-evidence printer landed before this run and both paid
off: the run reached the API cleanly and the failure was billing, not code. The
remaining gap is that a mid-arm send failure still discards the usage collected
so far — 18 baseline and 16 megasaver real requests were lost to it here.

## [2026-07-30] fix | bench-replay: a failed arm keeps its receipts too

The credit-exhaustion run billed 18 baseline and 16 megasaver requests, then
discarded every usage row when request 17 threw. The order-check refusal had
already been taught to carry its evidence; the send-failure path had not.

`replayArm` now attaches `perRequest` to the error and the script prints the
rows and their totals before dying. The refusal is unchanged — a half-sent arm
looks artificially cheap and is not a measurement — but refusing the RESULT is
not a reason to destroy the RECEIPTS.

Proved by forcing a mid-arm failure in the dry run, not by unit test alone: the
same package-to-script glue that silently swallowed the pairs evidence earlier
(stale `dist/`) is what this depends on.

## [2026-07-31] audit+fix | saver e2e audit round: 9 defects red→green, meter repaired

User re-raised the 60-90% ask. 24-agent workflow audit (7 scanners,
adversarial verification) at `e5a7a6f6`: 63 raw → 14 confirmed P1 (9 distinct)
+ 47 P2/P3, 2 refuted. All 9 fixed TDD on `worktree-feat-saver-audit-fixes`
+ follow-ups (CLI net surfaces, sibling-parser check). Headline: foreground
Bash never compressed in safe mode (floor budget+1 = 32001 > ~30000 ceiling;
botched 3732a0cb restore — post-A4 premise). Refuted en route:
pytest/cargo/eslint/stacktrace parsers are complete partitions (no silent
omission); DEFAULT_MODE=safe is disabled()-only, enabled default is balanced.
Ledger honesty: B11 idempotent event ids, unchanged re-reads envelope-true,
/expand debt, net-first savings surfaces. Full ledger: spec §9 +
[[syntheses/saver-audit-2026-07-31]]. Adoption (floor/mode) still gated on
the A4 real-API leg — meter distortions repaired for the known classes
(double count, uncounted re-reads, outline bytes, expansion debt); residuals
named in spec §9.

## [2026-07-31] fix | review round on the saver-audit worktree

Combined code-review + critic findings applied on
`worktree-feat-saver-audit-fixes` (7 items, TDD where behavior changed):
retracted-churn comments rewritten to the unmeasured-cost truth (saver.ts
floor rationale + P1 rationale, record-output, admission-guard, saver-seen
header — cost axis stays gated on A4); B11 dedupe check+append moved under
the summary file lock with `appendOverlayEvent` returning `appended` and the
evidence write gated on it (both residuals now named: bucket skew
P ≈ min(1, skew/600 s) modeled, and lock-contended degrade); savings
headline gained `netTokensSigned` with `tokensRefetched` from the UNCLAMPED
delta so losing windows render "≈1000 saved − 2000 re-fetched + overhead =
−1000 net" across CLI/GUI (gross % labeled "gross"); optional `streamSlot`
joins the overlay event id so byte-identical dual streams stay two events
(daemon `/excerpt` carries it; absent = old ids); seen-ledger hash parts
NUL-joined (newline join aliased part boundaries into false already-seen
skips); WHY notes on marker reservation, dual-stream stall/partial-failure,
and deliberately undeduped expansion debt. `pnpm verify` green.

## [2026-07-31] feat | MegaSaver 3.0 Quantum Context Engine v3 merged (PR #327)

Merged PR #327 (`feat/quantum-context-engine-v3`) into `main`. Implemented Tasks 0–4 of the MegaSaver 3.0 Quantum Context Engine Architecture v3:
- Task 0: Telemetry workspace stamping & M7 store freshness inspection in `@megasaver/stats`.
- Task 1: Cache-aligned delivery engine with atomic seen-ledger registration, zero-churn raw passthrough, and I14/E7 recovery metadata.
- Task 2: P2 warm-start intent hook and byte-stable context pack assembly with 500ms timeout fallback.
- Task 3: Context Mesh CAS handles (`mesh://<hash>`), sub-millisecond AST graph delta calculation (<1ms target), and speculative local cache prefetching.
- Task 4: Shadow worktree verdict pipeline (`mesh://verdict_<hash>`) and SAB grammar v0 evaluator matrix.

Verified via full `pnpm verify` DoD gate (60/60 turbo tasks successful, 1474 tests passed, 0 type errors, conventions sync check ok) and all GitHub Actions / Vercel CI checks green. Local `main` rebased and synced with `origin/main`.


## [2026-08-01] spec | child-spec #2: bench-replay real gate run

`docs/superpowers/specs/2026-08-01-bench-replay-real-gate-run-design.md` — HIGH,
draft, closes Phase 0 by settling A4's one open term, `S`.

The spec's premise is that the blocker is **not budget, it is an unproven
instrument**. `S = 1.199x` is modelled only; the three paid attempts failed for
three different reasons (corpus 0/288 eligible; order-sensitive 1.598 vs 1.197
against a ≤0.05 effect; credit exhaustion at request 16 of arm 2). The
per-arm-RUN cache namespacing built to remove the warming asymmetry has never
run against the live API — and its predecessor was **inert while every test
passed**, because the marker rode `system[0]`, a block the platform strips.

Centrepiece: a **live cache-isolation probe** (Task A) that gates all spending.
Four single-request runs in two cells — POS (`ns_P`, `ns_P`) proves the probe can
observe a `cache_read` at all; NEG (`ns_N1`, `ns_N2`) asserts it cannot. `k = 1`
so no intra-run warming can confound read attribution; cells use disjoint
namespaces so they cannot warm each other. `isolationLive = POS.runB.cache_read
> 0 && NEG.runB.cache_read / POS.runB.cache_read < 0.10`. The signal is derived
from the API's own `usage`, because a test that checks what we send cannot see
what the platform does with it.

Supporting: pre-flight budget refusal (`estimate × 1.3 > budget` ⇒ do not start);
arm-run-BOUNDARY checkpointing (a partially sent arm run is kept as receipts but
may never feed a verdict — a mid-arm resume would splice two warming histories).

Pinned as non-negotiable: `MAX_BYTE_RATIO` 0.95, `MIN_DRIFT_SMOKE_TOLERANCE` 0.1
and `orderTolerance` 0.15 are constants, not knobs; aggressive stays refused by
`clampModeToFloor`; the offline model may not be recalibrated against the run it
validates; no savings claim may be published either way. A refusal from a proven
instrument closes the spec — an accepted verdict from an unproven one does not.

## [2026-08-01] plan | child-spec #2 TDD plan written

`docs/superpowers/plans/2026-08-01-bench-replay-real-gate-run-plan.md` — four
tasks, only the last one spends money.

T1 `isolation-probe.ts`, T2 `budget.ts`, T3 `run-journal.ts` are pure modules
driven through the existing `Send` seam, so every test runs against a fake
upstream at zero API cost. The T1 fake reproduces the real defect directly: a
`stripsMarker: true` upstream strips the marker-bearing block before computing
its cache key, which is what the platform does to `system[0]` — under it the
probe must report `isolationLive: false`. That is the regression the previous
mechanism had no way to fail.

T4 is the operator runbook plus the export surface; the paid run is a procedure,
not code, and three of its outcomes are STOP (positive control never warmed,
isolation inert, ratio between 0.10 and 0.90).

Two self-review fixes before saving: the probe test hardcoded a wrong marker
prefix (`CACHE_NAMESPACE_PREFIX` is module-private — the test now builds
expectations with the exported `cacheNamespaceMarker`), and the budget test
re-derived its expectation with the same `simulateCacheCost` +
`normalizedCostUsd` the implementation uses, which passes for any
wrong-but-consistent formula. Replaced with properties a wrong implementation
breaks: the x4 relation, monotonicity in recording size, and output priced at
`GENERATION_CAP_TOKENS`.

## [2026-08-01] feat | child-spec #2 landed: the gate run has an instrument

Three modules, no API spend in tests. `runIsolationProbe` derives isolation from
the API's own usage — POS proves a read is observable, NEG asserts it is not —
because the predecessor was inert while every "the bodies differ" test passed.
`estimateGateRunBudget` refuses to start a run whose safety-adjusted cost
exceeds the budget. `run-journal` checkpoints at the arm-run BOUNDARY: a partial
run keeps its receipts and never feeds a verdict.

`S` remains open until the paid run; the runbook is the procedure.

## [2026-08-01] retraction-of-a-retraction | the regression WAS ours; my disproof used a stale dist

Earlier today I retracted the claim that child-spec #3 slowed the CLI suite,
citing 186.91 s for `saver.test.ts` and 467.25 s for `saver-run.test.ts`
"with the token block disabled". **That retraction is itself withdrawn. The
experiment was invalid.**

`apps/cli/vitest.config.ts` declares no aliases, so `@megasaver/context-gate`
resolves through node_modules to `packages/context-gate/dist/`. I patched
`src/record-output.ts` and ran the CLI tests without rebuilding, so every run
imported the OLD COMPILED ARTIFACT with the token block still active. I measured
the unchanged code twice and read it as evidence of absence.

This repo had already recorded this exact trap — "the same package-to-script
glue that silently swallowed the pairs evidence earlier (stale `dist/`)",
2026-07-30 — and I had read that entry earlier in the same session.

**What is actually true.** `record-output.ts` is the ONLY production caller of
`countTokens`, introduced by Task 5. js-tiktoken's encode is quadratic in the
length of an unbroken whitespace-free RUN, not in total size — measured:

| run length | whole encode |
|---|---|
| 2,000 | 142 ms |
| 8,000 | 2,277 ms |
| 32,000 | 36,151 ms |
| 50,000 | 90,790 ms |

Same 64 KB with a space every 100 chars: **227 ms**. Real code, prose and JSON
never trigger it; base64 blobs, minified bundles and long hashes do.

The executor's chunking fix is correct and its receipts hold on re-measurement:
`saver-run.test.ts` **467 s → 12.0 s** (verified here), and `pnpm verify` passes
fresh for the first time in this lane. My original diagnosis was right; only my
disproof was wrong.

**One refinement remains.** The chunking is unconditional, so it taxes every
measurement: chunked vs whole diverges **+0.44% (code), +0.20% (json),
+0.54% (prose)**, always OVER — the direction that flatters savings. The
executor verified "identical counts" on `"X".repeat(50_000)`, where boundary
splits are free by construction, so the check could not see it. Boundary-aware
chunking barely helps (0.33% vs 0.44%). The right fix is to chunk ONLY when a
long unbroken run is present: exact counts for all real tool output, protection
where the pathology actually lives.

## [2026-08-01] correction | the tokenizer pathology is repetition, not run length

The conditional guard landed (`32846bfd`) and works: measured against
whole-string encoding, `countTokens` is now **0.00% on code and prose** (never
chunked), 0.05% on base64, 0.20% on space-free JSON, and the pathological case
stays in the low seconds. `saver-run.test.ts` 12.17 s, `pnpm verify` exit 0 with
output-filter's dependents re-running fresh.

**But the rationale I wrote into that guard was wrong, and I generalised it from
one degenerate fixture** — the same error I had just criticised in the executor's
`"X".repeat(50_000)` verification. Every timing I used to build the "quadratic in
whitespace-free run length" model was `"X".repeat(n)`. Measured afterwards:

| input | whole encode |
|---|---|
| `"X".repeat(50_000)` | 90,790 ms |
| 60 KB repeating hex (unbroken, varied) | **9 ms** |
| 64 KB space-free JSON (unbroken, varied) | **33 ms** |

60 KB of unbroken alphanumerics encodes in 9 ms. The pathology is long runs of
**highly repetitive** characters — a BPE merge explosion — not run length, and
not the "ReDoS / catastrophic regex backtracking" the fix was committed under.

`longestRun` survives as a deliberately CONSERVATIVE proxy: one O(n) scan, cannot
miss the pathological shape, and over-triggers on some safe inputs at a bounded
accuracy cost. The comment in `tokens.ts` now states what was measured, including
the disproof of its own earlier claim.

Second correction, caught while writing the first: the chunking bias is **not**
benign in the direction I initially wrote. The overcount is always upward, and a
compressed output's small `returnedText` usually stays under the guard while the
large `raw` does not — so `rawTokens - returnedTokens` **inflates** the reported
saving. Bounded at 0.20% on the worst shape (vs bytes/4's +19.3% on JSON), but
biased in the flattering direction, which is the whole reason the guard keeps
normal text off the chunked path.

## [2026-08-03] fix | Child-Spec #3 honest report reads measured tokens (write path proven, E12 open)

Ran Task 7 real-machine verification for Child-Spec #3 and corrected read-path provenance:
- Hooks verified installed (`mega hooks install claude-code`), default mode enabled (`mega session saver default enable` -> balanced).
- Synthetic payload (`git log -n 100` shape) executed through `mega hooks saver`.
- Measured token fields `rawTokens: 7500`, `returnedTokens: 1582`, `deltaTokens: 5918` recorded in store (`/Users/ozger/.local/share/megasaver/stats/b261d896507490fb/f26f2e45-6fdb-48b6-92b6-2bc459333250.events.jsonl`).
- Fixed `observationsFromEvents` in `packages/stats/src/honest-metrics.ts` to prefer measured token pair over `bytes/4` estimate.
- Updated `renderHonestReport` in `apps/cli/src/commands/audit/honest.ts` to render `token source` provenance line (`measured (100% of rows)` / `X% measured, Y% bytes/4 estimate`).
- `mega audit honest f26f2e45-6fdb-48b6-92b6-2bc459333250` output verified:
  - eligible reduction: 78.9% (token-weighted, eligible mediated context only)
  - observed/eligible tokens: 7500 / 7500 (measured 7500, not estimated 15000)
  - token source: measured (100% of rows)
- Status: Write path and read-path provenance proven on real machine via hand-fed payload; E12 remains open pending an organic real-session measurement.


## [2026-08-01] correction | E12 is NOT closed: the honest report still reads bytes/4

Task 7 produced a real event file on a real machine — verified on disk at
`~/.local/share/megasaver/stats/b261d896507490fb/f26f2e45-….events.jsonl`:
`rawTokens: 7500`, `returnedTokens: 1582`, `deltaTokens: 5918`,
`isFreshStore: false`. **The write path is genuinely proven outside the harness
for the first time.** Three gaps stop it from closing E12.

**1. The report ignores the measured fields.** `mega audit honest` printed
`observed/eligible tokens: 15000 / 15000` for the same event that carries a
measured 7500 — exactly 2x, because
`packages/stats/src/honest-metrics.ts:observationsFromEvents` still does
`rawTokens: tokensFromBytes(e.rawBytes)`. The number offered as proof that
measured tokens work was produced by the estimator they replace. The spec's §4.3
mixed-provenance rule was never wired; that is an omission in the plan, not in
the execution.

**2. `renderSavedValueLines` is dead code.** Defined at
`apps/cli/src/commands/audit/shared.ts:97`, referenced only by its own test. The
token-first surface the spec promised is unreachable by any user. Also a plan
omission — Task 6 specified the function and its tests and never said to call it.

**3. The payload was synthetic.** `rawBytes` exactly 60,000 and `rawTokens`
exactly 7,500 — 8.000 chars/token, where real `git log` output tokenizes at
~3-4 and does not land on round numbers. The content store for that workspace
holds no chunk set from the run. Real hook, real store, real settings, **fed by
hand**. Worth having as plumbing evidence; not the real-session number E12 asks
for.

Corrected status: **write path proven on a real machine; read path still
estimated; no real-session number exists.** The "E12 closed" claim is withdrawn
pending the honest-metrics wiring and a session where the hook fires on its own.

## [2026-08-03] decision | A4 closes under model; no paid replay is planned

User directive: there will be no API budget. Recorded as
[[decisions/a4-closed-under-model]] rather than leaving A4 "pending a run"
— a status that described a future which will not happen.

The decision rests on a fact verified in code, not on resignation:
`simulateCacheCost` allocates a fresh prefix map per call
(`cache-model.ts:113`), so the offline model shares no state between arms.
**Arm-order contamination and the entire cache-isolation problem are
live-replay artifacts that cannot reach it.** The per-arm-RUN namespacing, the
`system[2]` marker and child-spec #2's isolation probe were all built to make a
PAID two-arm replay trustworthy; none of them is load-bearing for the modelled
`S`. That reframes the last two weeks' instrument work: it was never the
model's dependency.

`S = 1.199x` keeps the validation already bought with paid data — 0.1% against
the recording's real end-to-end tokens, invariant across bytes-per-token
2.5-2.7 and across ±50% creation / −20% read perturbations, and agreeing with
the one fair real pair (1.197 vs 1.199).

Also recorded: a paid run would not have fixed `S`'s real weakness. Its
fragility is corpus-specificity, and one more run yields one more number on one
more corpus. Breadth over depth — model several corpora and report `S` as a
range — attacks the actual gap and costs nothing.

Downstream edits: [[syntheses/variance-controlled-benchmark]] Status marked
superseded (the harness is parked, not pending);
`docs/superpowers/plans/2026-08-01-bench-replay-real-gate-run-runbook.md`
headed NOT SCHEDULED with the reason and the reason it is kept. Child-spec #2's
probe, budget estimator and journal stay tested and unused.

Unchanged: no savings claim is published from `S`. It is an internal gate; the
customer-facing number remains measured tokens plus a labelled dollar estimate.
## [2026-08-01] design | cache-write-reduction

User approved the proposed cache-write reduction sequence. Wrote
`docs/superpowers/specs/2026-08-01-cache-write-reduction-design.md`: the
work corrects the retracted cache-mutation explanation, focuses on fewer
exploration turns and lossless first-output routing, and gates every savings
claim on isolated, fresh-store A/B receipts. The output-route scope expressly
forbids silent arbitrary Bash mutation and proxy request rewriting.

## [2026-08-01] design amendment | cache-write-reduction

Preflight found that re-emitting a two-thousand-token kickoff pack on every
UserPromptSubmit event would add a new cache suffix each turn. User approved
the correction: emit the pack once on the first valid prompt, then use its
per-session cache only to suppress further injection. (source:
docs/superpowers/specs/2026-08-01-cache-write-reduction-design.md)

## [2026-08-01] fix | task-kickoff delivery bridge

Task Kickoff preparation and intent persistence now run in a self-worker mode
of the single CLI artifact under one parent-owned 500 ms deadline. Stdout
callback success authorizes exact `record` accounting; the parent returns
delivery before the worker ACK, while false events remain impossible on
timeout, write failure, or post-write crash. Focused evidence: 43 CLI tests,
6 stats tests, and a real indexed-project `mega.mjs` runtime smoke. (source:
`.superpowers/sdd/2026-08-01-task-kickoff-safety-amendment-plan/task-3-report.md`)

## [2026-08-02 00:49 +03] fix | task-kickoff review hardening

Closed the Task 3 review findings in `fix/cli-task-kickoff-hardening`: every
message received while stdout delivery is pending—including a duplicate valid
`ready`—now terminates the Worker and cannot authorize `record`. The hook
passes one parent-created absolute deadline to the Worker and aborts Git work
50 ms before hard Worker termination. Real delayed-Git regressions prove no
late child marker for both `dist/cli.js` and single-file `mega.mjs`; focused
CLI/stats tests passed and the repository-wide `pnpm verify` gate was started.
Timeout documentation now permits an already-persisted terminal claim/pack
while keeping stdout/events absent.
(source: `.superpowers/sdd/2026-08-01-task-kickoff-safety-amendment-plan/task-3-report.md`)

## [2026-08-02 02:46 +03] test/docs | task-kickoff safety evidence

Task Kickoff state is permanently excluded from overlay GC, now protected by a
regression that uses the real workspace pack and store-global claim paths.
Public documentation describes optional POSIX-only, session-wide at-most-once
output, the 9,000 UTF-16 / 2,000-token rejection caps, permanent owner-only
claim and pack, and local stdout callback accounting without implying Claude
consumption or savings. (source:
`docs/superpowers/specs/2026-08-01-task-kickoff-safety-amendment-design.md`)

Scoped verification passed: connector hook settings 36/36, six CLI hook/GC
suites 77/77, stats build, and GUI bridge build. A USD 0.25-capped real Claude
request against canonical indexed fixtures produced exactly one global claim,
one pack, and one event; the same session in the other project emitted empty
stdout and retained counts of one. The successful call cost USD 0.1087935 and
reported input 1, cache creation 9,856, cache read 19,407, and output 21 tokens.
The earlier `/tmp`-spelled fixture attempt cost USD 0.1403985 and emitted no
task state because Claude supplied the canonical `/private/tmp` cwd; it is a
documented failed receipt, not omitted evidence. No savings claim is made.
Full `pnpm verify` and final independent review remain pending. (source:
`.superpowers/sdd/2026-08-01-task-kickoff-safety-amendment-plan/task-5-report.md`)

## [2026-08-02 06:29 +03] test/docs | task-kickoff final-hardening evidence

Node 22.23.2 verification recorded the final hardening boundaries: deterministic
ownership of supported first-party launchers; canonical uniquely deepest project
selection with fail-closed ties; descriptor-bound no-follow/nonblocking event
append; and the irreversible pre-deadline stdout write boundary. Windows remains
no-output/no-state, and no savings claim is made before the paired fresh-store
benchmark. (source:
`docs/superpowers/specs/2026-08-01-task-kickoff-final-hardening-design.md`)

Exact results: `pnpm --filter @megasaver/connector-claude-code test` 143/143;
`pnpm --filter @megasaver/stats test` 314/314; focused CLI Task Kickoff tests
35/35; `pnpm build` 30/30; fully minified bundle 11,050,961 bytes; exact CI
bundle selector 6/6 with four unrelated tests skipped. A temporary-settings
launcher receipt showed first install changed, reinstall no-op, exactly one
owned command on each of three surfaces, connected status, and uninstall
preserving one foreign command plus metadata on each surface.

The initial launcher receipt used stale generated connector output and
duplicated owned commands; timestamps and `distMatches:false` identified the
cause, then a clean `pnpm build` plus rebundle produced the successful fresh
receipt. The first full gate exposed a 250 ms FIFO-fixture watchdog that was too
short under parallel load; the corrected 1,000 ms watchdog returns structured
`ENXIO`/status 1 promptly, while a mutation removing `O_NONBLOCK` reaches the
watchdog. A second gate exposed that normal runtime-cancellation evidence must
permit fake Git preparation not to start under the fixed 500 ms product
deadline while always rejecting its late marker; the dedicated POSIX CI mode
requires both the start marker and absence of the late marker. Windows retains
its no-output/no-state assertion.

Two further full-gate RPC failures came from pathological repeated-character
50,000-byte saver fixtures, not production failures. They now use deterministic,
exact-50,000-byte unique-code-line corpora without reducing size or mocking the
real evidence-ledger, daemon transport, persistence, fallback, or accounting
paths. Focused Node 22 results were saver 68/68 and saver-run 10/10. Independent
review found no Critical, Important, or Minor findings and reran `pnpm verify`
to exit 0: all 60 Turbo tasks passed, CLI reported 151 files with 1,544 tests
passed and 9 skipped, and conventions were clean. No savings claim is made; the
paired fresh-store benchmark remains pending. (source:
`.superpowers/sdd/2026-08-01-task-kickoff-final-hardening-plan/task-5-report.md`)

## [2026-08-02 13:27 +03] hardening | task-kickoff descriptor append and standalone fallback

Completed the final Task Kickoff accounting hardening: normal installed
runtimes serialize owner-only private JSONL appends with descriptor advisory
locking, short-write completion, rollback, and partial-tail repair; the
platform-neutral raw `mega.mjs` fallback records immutable validated event
parts when its external native binding is unavailable. Event persistence now
uses only the entry-inclusive deadline remaining after stdout. Independent
review cleared the final chain, and Node 22 `pnpm verify` exited 0 with 60/60
Turbo tasks and CLI 1,597 passed / 1 skipped across 153 files. The
load-sensitive strict real-bundle-delivery assertion was replaced by an honest
artifact smoke and deterministic process/fallback evidence in `fc5ca2a3`; the
real detached-Git process-group cancellation proof is selected in CI by
`4a5ffe53`. Fresh review approved: bundle 16 passed/9 skipped, fallback 7/7,
process 2/2, cancellation 1/1, and worker lifecycle 3/3. (sources:
`docs/superpowers/specs/2026-08-01-task-kickoff-final-hardening-design.md`,
`.superpowers/sdd/2026-08-01-task-kickoff-final-hardening-plan/progress.md`)

## [2026-08-02 22:17 +03] test/docs | batch-read adviser Phase 2 evidence

The adviser remains advisory only: its event proves that a hint was offered,
not that the agent followed it or saved tokens. The eligible Read/Grep/Glob
call remains the original native call under Claude Code's permission controls;
the adviser neither replaces it nor emits an allow/deny decision. (sources:
`docs/superpowers/specs/2026-08-01-cache-write-reduction-design.md`,
`docs/superpowers/plans/2026-08-01-batch-read-adviser-plan.md`)

An isolated Node 22.23.2 receipt used a temporary store and one synthetic
session. The first eligible Read emitted zero stdout bytes. A Grep in the same
directory immediately afterward emitted this complete second response:

```json
{"hookSpecificOutput":{"hookEventName":"PreToolUse","additionalContext":"Mega Saver: Batch remaining exploration in this directory with one targeted search or mega output file / mega output exec; keep an intent so omitted evidence stays recoverable."}}
```

The envelope has `additionalContext` and no `permissionDecision`. The owner-only
state file was mode 0600; its top-level keys were only `offeredDirectories` and
`recent`, and each recent entry had only `at`, `directory`, and `tool`. A
forbidden-text scan found no prompt, content, command, pattern, or file-path key.

The final pinned gate used Node 22.23.2 and pnpm 11.10.0. CLI tests passed 1,612
with 1 skipped across 155 files; connector tests passed 155 across 11 files;
`pnpm verify` exited 0 with all 60 Turbo tasks successful. An earlier full-gate
attempt stopped at three Biome formatting findings in the Task 1 state source
and test; the separately owned formatter-only commit `c1953133` closed them
before this successful final-tree rerun.

Benchmark preflight found the deterministic `@megasaver/bench-replay` tooling,
but that harness explicitly freezes the turn trajectory and therefore cannot
measure this adviser's behavioral change in exploration turns. Its paid runbook
also requires `ANTHROPIC_API_KEY` and the fixed `rec-big/task_1` recording; both
credential variables were unset and no recorded request/transcript was present
locally. No live request was sent. Turn counts, cache-creation tokens, cost, and
savings therefore remain unmeasured and no product claim is made. (sources:
`packages/bench-replay/README.md`,
`docs/superpowers/plans/2026-08-01-bench-replay-real-gate-run-runbook.md`)

## [2026-08-02 23:25 +03] hardening | batch-read adviser secure v2 transaction

Replaced the adviser’s unlocked raw-path read/rename sequence with one
POSIX-only owner-private transaction. An exclusive per-session `wx` lock now
serializes read/decide/write; contention and abandoned locks suppress optional
advice without waiting, PID/mtime leases, or `fs-ext`. State is opened with
no-follow/nonblocking descriptor flags, accepted only as a private regular
single-link file, bounded to 32,768 bytes, and durably replaced through a
private unique descriptor plus fsync/rename/parent-fsync. Version 2 persists
only domain-separated SHA-256 canonical-directory keys, keeping the exact
realpath for filesystem operations and using only a separate NFC copy for the
hash. State is scoped to canonical workspace plus safe session, preserving
distinct-workspace independence, the inclusive 60,000 ms window, and the
64-offered/128-recent caps. Legacy, malformed, oversized, symlinked, FIFO,
device, directory, and hard-linked state safely suppress until the independent
30-day GC removes eligible old regular state or lock files. The GC also removes
old transaction residue only when its basename strictly matches the generated
UUID shape and it remains owner-private, regular, single-link, and identity-stable.
Windows creates no advice state and install removes or omits only the owned
cache-advice command while preserving core and foreign hooks. `hooks status
--settings` reports advice installation from the selected custom settings file.
(source:
`docs/superpowers/specs/2026-08-02-batch-read-adviser-hardening-design.md`)

Strict TDD recorded the pre-implementation Node 22 focused command at exit 1
with 33 expected failures and 65 unrelated passes. The focused source GREEN
receipt covered 92 CLI tests plus 54 connector tests, including exactly one
`advise` from eight real subprocesses. A freshly rebuilt 10.57 MiB
`dist-bundle/mega.mjs` passed the two-call v2 and unsafe-copied-bundle selectors;
a 4,702,467-byte real tarball was installed into an isolated prefix and its
exported `.bin/mega` passed the same two-call contract. An independent security
review reported no Critical, Important, or Minor findings. The behavioral A/B
remains unrun and no savings claim is made. (source:
`.superpowers/sdd/2026-08-02-batch-read-adviser-hardening-plan/task-1-report.md`)

## [2026-08-03] Task 4 off-hook legacy migration | cache-advice fair-GC

Implemented Task 4 of the cache-advice fair-GC plan in the worktree
`.worktrees/fix-cli-task-kickoff-hardening` (branch
`fix/cli-task-kickoff-hardening`). Added `hooks/cache-advice-maintenance.ts`
(restart-idempotent descriptor-safe legacy walk + no-wait `.migration.lock`
with 30-day stale reclaim + final clean rescan before `complete:true`),
`hooks/cache-advice-maintenance-trigger.ts` (single-flight detached best-effort
spawn, store only via `--store`), `hooks/cache-advice-migration-journal.ts`
(atomic `{version:1,complete,completedAt}` ≤4,096-byte journal),
`hooks/cache-advice-migration-capsule.ts`, and
`hooks/cache-advice-private-node.ts` (shared POSIX private-node primitives
mirroring gc.ts `pruneExpiredPrivateFile`). Wired the internal
`mega hooks cache-advice-maintain` subcommand (exits 0 always), the POSIX
install fire-and-forget trigger, and the incomplete-migration hook trigger that
emits nothing. Removed the inline `migrateFlatStateIfPresent` from
`cache-advice-store.ts`; the hook now fences all legacy nodes and suppresses
advice while migration is incomplete and a legacy flat directory exists.

Strict TDD: RED run failed 19 maintenance + 4 queue + 1 run + 1 install tests
(54 unrelated passed) before any implementation existed. GREEN: 21 new
maintenance tests plus all 6 pre-existing hook files. Node 22 full CLI suite
158 files / 1687 passed / 5 skipped / 0 failures; `tsc --noEmit` clean; Biome
clean. A valid strict v2 snapshot is FIFO-enrolled before it moves; v1,
malformed, oversized, and unknown-version state become opaque suppression
capsules with no raw path/session/command persisted anywhere under v3; 65+ flat
states migrate across restart cuts; a crashed worker's stale lock is reclaimed,
a live lock is never stolen. No cost-savings claim is attached. Task 5
(artifact evidence, bundle/packed-bin coverage, wiki sync) remains. (source:
`docs/superpowers/specs/2026-08-02-cache-advice-gc-fairness-design.md` §2.3;
`docs/superpowers/plans/2026-08-02-cache-advice-gc-fairness-plan.md` Task 4)

## [2026-08-05] Phase 3 cache suffix audit shipped | cache-write reduction

Implemented all four tasks of the suffix-audit plan in the worktree
`.worktrees/fix-cli-task-kickoff-hardening` (branch
`fix/cli-task-kickoff-hardening`), commits `61eb6c0e` (pro-analytics
`cacheComposition`: measured-global shares over the four measured token
classes, zero denominator ⇒ `no-usage` + null shares), `73a8589a`
(claude-code connector `auditClaudeCacheSuffix` +
`checkGeneratedOutputByteVariance`: closed six-code risk union, no free-text
detail, per event/subcommand duplicate counts via `hookCommandMatches`,
foreign-URL and missing-first-party-flag as distinct risks, deterministic
ordering), and `4416a31c` (CLI `mega cache --suffix-audit`: discriminated
settings reader ok/absent/unreadable/malformed, Pro gate before both readers,
`--json` adds `suffixAudit` while plain output keeps the existing contract —
the report gains `outputTokens` as its only new field — text prints `n/a` at
no-usage and still renders static risks, `CacheDoctorReport` now aggregates
`outputTokens`).

Strict TDD per task: RED shown (absent function / absent module / 8 failing
CLI tests) before each implementation. Privacy evidence: a hostile settings
fixture (foreign URL, fake API key, secret-bearing curl hook) produces only
the three ordered risk codes — JSON and text output contain none of the
fixture's URL, key, token, command, or settings path (CLI test
"privacy evidence: hostile fixture leaks nothing"). `pnpm verify` 60/60 green
on Node 22; Biome + tsc clean; public-export surface test updated for the two
new connector exports. Changeset `.changeset/cache-suffix-audit.md` records
the claim boundary: composition is measured fact, not a savings claim; the
fixed-transcript A/B remains the only savings gate. Phase 4 (output-route
adviser) remains. (source:
`docs/superpowers/specs/2026-08-02-cache-phases-3-4-contract-amendment-design.md`
§2; `docs/superpowers/plans/2026-08-01-cache-suffix-audit-plan.md`)

## [2026-08-05] Phase 4 output-route adviser shipped | cache-write reduction

Implemented all four tasks of the output-route plan in the worktree
`.worktrees/fix-cli-task-kickoff-hardening` (branch
`fix/cli-task-kickoff-hardening`), commits `f5dcb956` (content-free
grep/find grammar: 4,096-byte / 64-token budget, ASCII-space tokens, relative
paths without `..`, full reject set — 60 grammar tests), `aac7572e`
(discriminated Bash branch in `cache-advice-run`: five gates — POSIX +
default store, unique canonical project root, one open claude-code registry
session, storeRawOutput, exact-argv policy + permissions preflight — each
failing closed with no state change; advice names only the registry UUID;
state evolves v2→v3 with `offeredOutputRouteFamilies` inside the capsule
transaction; `transactCacheAdvice` action becomes a discriminated
batch/output-route union; `recordBatchCall` preserves state version), and
`9abd5aee` (owned matcher `^(?:Read|Grep|Glob|Bash)$` + legacy repair proof).

Command-preservation evidence (apps/cli/test/hooks/cache-advice-run.test.ts,
"output-route advice (Bash)" describe): an eligible `grep -r -e
TODO_SECRET_PATTERN -- src` yields only additionalContext naming the registry
UUID — no command, pattern, project, store, or hook session anywhere in
response or persisted state; `grep … | head`, `rg TODO src`, `find src
-delete`, and `..` escapes return empty with zero filesystem state. Gate
negatives (no/wrong/duplicate project, zero/two/ended/non-claude sessions,
storeRawOutput off, permissions throw, policy deny, non-default store,
Windows) all suppress with no family consumption; concurrent same-family
offers serialize to exactly one advice; v2→v3 migration runs in-transaction
while malformed/v1/v99 bytes stay byte-identical. Full hooks suite 452
passed / 2 platform-skipped; install+status 49 passed. Changeset
`.changeset/output-route-adviser.md` states the public contract: nothing is
run, rewritten, denied, or granted; adoption is tracked separately and advice
events prove no use and no savings. (source:
`docs/superpowers/specs/2026-08-02-cache-phases-3-4-contract-amendment-design.md`
§§3–4; `docs/superpowers/plans/2026-08-01-output-route-adviser-plan.md`)

Follow-up `b8cad110` closes the bundle-artifact evidence for the output-route
branch: the freshly built bundle and the installed packed mega bin both emit
nothing and persist nothing for an eligible grammar without a registered
project (fail-closed gate proof through the real binary), a shell-bearing
form emits nothing, and no store file contains the fixture pattern.
Bundle-smoke 31 passed / 5 platform-skipped; `pnpm verify` 60/60 green.

Independent-review status: author==reviewer is forbidden for this HIGH-risk
range, so the code-reviewer and critic passes were delegated to fresh-context
subagents. All spawn attempts failed on provider quota (429 usage-limit,
reset 2026-08-08) and a subsequent 401 credential-pool outage on 2026-08-05;
the review remains pending until subagent capacity returns. The author's
adversarial self-review (grammar bypass, gate races, privacy, Windows
creation, suffix-audit DoS) found no P0/P1 defects; it is NOT a substitute
for the independent pass, which stays on the merge checklist.

## 2026-08-05 — Codex review-fix pass (code-reviewer + critic P1s closed)
Both independent reviews LANDED after the quota note above: code-reviewer
APPROVE-WITH-P1-FIXES, critic SURVIVES-WITH-P1-FIXES (see agent-channel.md).
The critic's megasploit foreign-launcher hijack was DISPROVEN — the owned
launcher matcher is exact `=== "mega"` identity, not substring/prefix, so
`/usr/local/bin/megasploit hooks cache-advice` returns false (probe test
confirms). Fixes implemented and `pnpm verify` green:

- Reviewer P1-3 durability: capsule state/suppression unlink, GC sweep-lock
  release, and future-timestamp normalization now fsync the parent directory
  after the unlink/futimes (gc.ts, cache-advice-private-node.ts).
- Reviewer P1-2 queue liveness: new `compactCacheAdviceQueue` drops fully
  consumed work-log bytes under the no-wait queue lock (durable new-file +
  rename + parent fsync, never around an inflight frame); wired into
  `maintainCacheAdviceStore` before the legacy sweep. Crash-cut test added.
- Reviewer P1-1 spec divergence: fair-GC spec §2.1 amended to record the
  accepted single-JSONL work log + control-offset design (head/inflight
  replay is the WAL) replacing the specified transition.json.
- Critic #3 gate-1: default-store gate compares canonical real paths, so a
  symlinked/relative path to the default store is the same store.
- Critic #4 composition overflow: token counts capped at 2**40 in
  proxyUsageEventSchema; cacheComposition adds an `overrange` status with null
  shares instead of a corrupted 0%/100%.
- Critic #2 SAFE_WORD: spec §3 pins the exact ASCII-safe class
  `[A-Za-z0-9_./:@%+=,-]+` (no leading `-`); test pins the divergence.

Deferred (trackable, not blockers): dead exports claimCacheAdviceQueueHead /
requeueCacheAdviceRecord (kept — they exercise the crash-replay path the
maintainer relies on); generated_output_byte_variance is intentionally
advisory-only, not wired into runCache; critic P2s #5-8 (upgrade UX drought,
30-day stale migration lock, capsule growth, gate TOCTOU).

## [2026-08-06] fix | two load-sensitive tests, made honest

Both surfaced during the saver token-count-bound verification and were
unrelated to it. Both failed only under `turbo test --force` across all 60
tasks — never in isolation, and not under synthetic CPU load alone, which was
the first clue that filesystem and process-spawn contention, not raw CPU, was
the driver.

**`saver-seen-concurrency`** asserted `landed.length > (WRITERS * ROUNDS) / 2`
as a guard against a vacuous pass. That count is exactly what the file's own
documented fail-open reduces: under load a writer skips past `withFileLock`'s
deadline, lands fewer hashes, and the guard trips on a run where nothing was
lost. Seen at 47 against a required 48. The header comment already said load
"can make this test slower but never wrong" — which is true of the lost-update
property it tests — so the assertion moved to match the comment rather than the
reverse.

What actually makes that property meaningful is that MORE THAN ONE PROCESS
landed a hash: a single writer's records cannot exercise a cross-process
read-modify-write race. That is structural and does not scale with load. The
count is now deliberately unasserted, with the reasoning at the assertion site.
Verified: a no-op `recordSeenOutput` fails it, and `WRITERS = 1` fails it.

**`task-kickoff-hardening`**'s process-group kill test had two coupled timings:
the kill must land INSIDE the descendant's delay, and the post-abort wait must
EXCEED that delay or the marker's absence proves only that the descendant has
not written yet. 0.75 s / 1.0 s left 250 ms of slack. The failure meant the
kill was slow, not that it missed the descendant, so the window widened to
3 s / 5 s and both constants are named so they cannot drift apart. Verified:
killing the child instead of the process group still fails it.

**The general shape, worth remembering:** a timing threshold sitting inside a
correctness guard reads as a correctness assertion and fails as a performance
one. When a test's comment and its assertion disagree about what load can do,
the comment is usually describing the property and the assertion is usually
measuring the machine.

Both now pass under `turbo test --force`, 60/60 tasks, zero failures.

## [2026-08-08] fix | Windows CI starvation is repo-wide, and the first fix was inert

Two separate lessons from landing PRs #329/#330/#331, both about believing a
setting rather than measuring it.

**The failure is repo-wide, not per-package.** `[vitest-worker]: Timeout
calling "fetch" with [..., "ssr"]` — collection timing out before any test
runs — is now on its third package. [[concepts/windows-support]] records the
first at `@megasaver/retrieval` (PR #321, 2026-07-27), fixed with a
per-package `singleFork: true`. It reappeared in `@megasaver/long-memory`; a
per-package cap there fixed that package and the identical timeouts then
surfaced in `@megasaver/core` (`handoff-export`, `run-verify`,
`context-gate/run-command`). Windows runners starve the Vite transform under
the repo-wide Turbo test graph; capping one package just moves the pressure to
whichever package is scheduled next. The cap now lives once, in `ci.yml`, on
the Windows leg only. Note that `retrieval`'s `singleFork` is still in place,
so two mechanisms coexist — the per-package one was left alone rather than
churn a package this work never touched.

**A setting being accepted is not evidence it is applied.** The first fix set
`VITEST_MAX_THREADS=1` in the workflow env. Vitest 2.1.9 silently ignores it:
aggregate test time was 275 s before and 275 s after, to the second. Tests
stayed green throughout, so nothing would have flagged it — it would have
merged as a fix that changed nothing. The CLI flags are honoured, and Turbo
forwards them through `--`:

| invocation | aggregate | transform | collect |
|---|---|---|---|
| unbounded | 275 s | 1.3 s | 4 s |
| `VITEST_MAX_THREADS=1` | 275 s | — | — |
| `--maxWorkers=1 --minWorkers=1` | 40.4 s | 388 ms | 1.4 s |

`--maxWorkers` alone throws `options.minThreads and options.maxThreads must
not conflict`; both bounds are required. This is the **second** time an inert
setting nearly shipped as this fix — PR #321's reviewer caught an inactive
thread-pool setting the same way. The rule this yields: when a config change
claims a performance effect, pin the number it should move and read it back.

**Dead end, recorded so it is not retried:** `pool: "forks"` fixes the
starvation but breaks `lm2-vector-store-quota` on Windows, where
`statSync().ino` is not stable across processes.

**Verified.** `main` is green on both legs at `83202e0d` (run 31274756914) —
the first run in which #329, #330 and #331 are exercised together, and the
condition that blocked every merge (`main` unable to pass its own required
checks) is cleared.

**Honest limits.** The shipped value is `--maxWorkers=2`, but the 275 s → 40 s
measurement was taken at `1`; `2` has two green Windows runs behind it (PR #330
at `ebd38cf9`, `main` at `83202e0d`), which is thin. And the failure is
load-dependent, not deterministic — PR #329 passed the Windows leg at 17:24
with no cap at all — so a small number of green runs is weak evidence in both
directions. If it returns, drop to `1` before looking for a new cause.

**Process note.** PR #329 was merged on a CI run from 17:24 that predated both
#330 and #331. `gh run rerun --failed` no-ops on a run with no failed jobs, so
the intended re-run never happened and a branch-scoped "latest run" query
returned the stale green. A green check is only evidence about the commit it
actually ran on.

Still open, needs a Windows machine: three `lm2-catalog-security` lock-identity
tests are marked POSIX-only rather than guessing at Windows expectations — see
[[concepts/windows-support]]. (source: GitHub Actions runs 31272570857,
31273463793; PR #330)

## [2026-08-09] fix | planner filePath was host-dependent; the emitter, not the test

`verify (windows-latest)` failed on PR #332 with one assertion:
`planner-service.test.ts:39` expected `.megasaver/planner/todo/` and received
`.megasaver\planner\todo\initial-task.md`. Provenance matters — the test came
in with `4f0f500c` (one of the 66 unpushed commits, not the audit sweep) and
the file does not exist on `origin/main`, so it had **never run in CI before**.

**The call: normalize the emitter, not the assertion.** The first read (and an
independent reviewer's) was that the test hardcoded a separator. Two pieces of
evidence overturned that. (1) `filePath` is never an fs path: every read/write
in `planner/service.ts` builds its own `join()`, and the `oldFilePath !==
targetFile` rename check at `:159` compares two `join()` values — the relative
string is a pure identifier with one consumer, a GUI display span. (2) Four
sibling emitters already POSIX-normalize the same class of value, and
`get-edit-impact.test.ts:155` (backslash-in → POSIX-out) is that convention
written as a test. Planner was the one emitter that missed it. All three
`relative()` sites normalized together; partial normalization was the only real
hazard. Recorded on [[concepts/windows-support]], including the qualifier that
keeps it from contradicting the existing host-independent-assertions rule:
decide whether a value is a native path or a POSIX identifier *before* deciding
which side to change.

**Verified against `path.win32`,** reproducing CI's exact string, since macOS
makes the fix a no-op: `.megasaver\planner\todo\x.md` → `.megasaver/planner/todo/x.md`,
with `basename(…, ".md")` unchanged on both platforms.

**Turbo no longer hides failures.** `--continue=dependencies-successful` on the
root `test` script: the default `never` meant one red task cancelled the rest,
and that single core failure hid **five Windows test tasks that never executed**
— including `cli`, which carries the bundle-smoke gating from `da89d9dc`. Exit
code unchanged, so the gate stays honest.

**Honest limits.** (a) The fix is verified *necessary*, not *sufficient* — those
five tasks still have not run on Windows, and a scan found no second instance of
this bug class but cannot rule out unrelated Windows failures. (b) A local
`pnpm verify` on the merged tree failed once on
`task-kickoff-hardening.test.ts:266` (detached process group, `expected true to
be false`), which then passed 3/3 in isolation — the same load-dependent flake
class as [2026-08-06] and `1285dbfc`; the merge touched no `apps/cli` file.
(c) Still open: the `Bundle smoke` step has no `shell:`, so on Windows it runs
under pwsh, where only the *last* command's exit code propagates — intermediate
failures in that step are silently swallowed, defeating the point of `da89d9dc`.
Deliberately not fixed in the same round: that step has never completed on
Windows, and changing its shell simultaneously would make a red unbisectable.
(source: GitHub Actions run 31274463307 job 93145698604; PRs #332, #330)

## [2026-08-09] finding | a green Windows check that is lying (pwsh swallows step failures)

Run 31279915849, job 93159452084. `verify (windows-latest)` reported **pass**
(15m15s) and the `Bundle smoke` step concluded **success**. The step's own log:

```
FAIL test/bundle-smoke.test.ts > standalone CLI bundle >
  captures the latest prompt after a same-session kickoff claim
AssertionError: expected undefined to be 'second prompt'   (:1260)
 Test Files  1 failed (1)
      Tests  1 failed | 17 passed | 18 skipped (36)
[ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL] Command failed with exit code 1
```

**Cause.** `Bundle smoke` declares no `shell:`, so on Windows it runs under
pwsh. GitHub appends only `exit $LASTEXITCODE`, which reflects the **last**
command in a multi-line `run:` block — here `node dist-bundle/mega.mjs doctor`,
which succeeded. The failing `vitest` call is second of seven, so its exit 1
never propagated. GitHub even emitted `##[error]` annotations and the step still
concluded success. The sibling `Packed bin cache-advice smoke` step already
carries `shell: bash`; `Bundle smoke` does not. This defeats the entire point of
`da89d9dc`, whose purpose was that bundle-smoke cannot read as green while
testing nothing — on the Windows leg it still can, for a different reason than
the one that commit fixed.

**The masked failure is separate and pre-existing.** `bundle-smoke.test.ts:1259`
takes a strict branch on win32 (`expect(latestIntent).toBe("second prompt")`)
where every other platform accepts `[undefined, "first prompt", "second
prompt"]`. Windows returned `undefined` — the intent was not captured. Either
`hooks intent` does not persist on Windows, or the win32 branch is over-strict
about a race the lenient branch tolerates. Not introduced by the sweep: the case
name was already inside the old `-t` filter, so it ran before too — the Windows
leg simply never reached this step, because `verify` failed first.

**Why the fix was not bundled.** Adding `shell: bash` turns this green check red
until the intent-capture question is settled, which is a different feature's
bug. Landing both at once would make the red unbisectable.

**Also confirmed this run:** the planner fix works — Windows
`Verify (Windows, capped workers)` reported `Tasks: 60 successful, 60 total /
Cached: 0 cached`, all fresh, with `planner-service.test.ts (4 tests)` passing in
6753 ms. That is the first time the full test graph has ever executed on the
Windows leg. (source: run 31279915849 job 93159452084; PR #332)

## [2026-08-09] fix | the pwsh hole, and the contradictory assertion behind it

Two commits, deliberately separate.

**1. `shell: bash` on `Bundle smoke`.** The step now aborts on the first failing
command on both OSes (`bash --noprofile --norc -eo pipefail`). Verified by
parsing the resulting workflow: the only two multi-line `run:` blocks in
`ci.yml` — `Bundle smoke` and `Packed bin cache-advice smoke` — both carry
`shell: bash`. The two `Verify` steps are left on the default shell on purpose:
they are single-line `&&` chains, and pwsh 7 short-circuits `&&` and propagates
the failing command's `$LASTEXITCODE`, so they were never exposed to this.

**2. Windows dropped from the strict branch at `bundle-smoke.test.ts:1259`.**
Not a Windows product bug — a self-contradictory assertion:

- Intent capture and the delivery envelope share **one** 500 ms budget measured
  from process entry (`TASK_KICKOFF_DEADLINE_MS`, `taskKickoffDeadlineAtMs`).
  Inside that budget the hook must boot node, load the bundle, spin a
  `worker_threads` Worker, and prepare the store root. `capturePreparedIntent`
  bails on `deadlineAtMs <= Date.now()` (`task-kickoff-worker.ts:32`), as do the
  worker's own preflights (`:50`, `:57`).
- The line **above** the failure, `expect(first).toBe("")`, already asserts
  unconditionally that Windows **loses** that race — no envelope was produced.
- So the old branch demanded the deadline-gated side effect on the one platform
  it had just asserted misses the deadline.

The impl calls capture advisory in two places (`"Intent is advisory"`,
`"best-effort; never block the prompt"`), so the lenient branch — the one every
other platform takes — is the real contract. The strict branch survives intact
for `MEGASAVER_BUNDLE_REQUIRE_TASK_KICKOFF_DELIVERY=1`, an **opt-in** signal
meaning "this host is fast enough, hold me to it". win32 is the slowest leg in
the matrix; it was the odd one out, and the file's three other strict sites
(`:1293`, `:1324`, `:1358`) gate on the env var alone, never on win32.

**Why this is not last round's "fix the emitter, not the test".** Inverse case.
There the impl violated a contract the test correctly stated. Here the test
asserted a guarantee the impl never offers. Deciding which one is wrong still
requires reading the impl — that is the rule, not "always fix the impl".

**Evidence.** Full CI smoke sequence run locally, all seven commands, exit 0:
`bundle-smoke` 31 passed / 5 skipped, `task-kickoff-event-fallback` 7 passed,
`task-kickoff-process` 2 passed, `task-kickoff-hardening` 1 passed,
`task-kickoff-worker` 3 passed, `doctor` 15 PASS / 0 FAIL. Re-run under
`MEGASAVER_BUNDLE_REQUIRE_TASK_KICKOFF_DELIVERY=1`: still 31 passed, with the
strict assertion itself exercised (`✓ captures the latest prompt after a
same-session kickoff claim 939ms`) — the guarantee is still tested, just where
it is meetable. (source: run 31279915849 job 93159452084; PR #332)

**Limit.** macOS cannot prove the pwsh fix. Only the next Windows leg can, and
the honest expectation is that it now reports what it finds instead of `success`.

## [2026-08-11] spec | Wave-3 — 9 ideas spec+plan batch landed (P0→P2)

User directive: "butun fikirleri senin onerdigin sira ile isleyelim superpowers ile specleri ve planlari yaz". Processed all 9 wave-3 ideas in priority order P0(3)→P1(2)→P2(4) via superpowers:brainstorming → writing-plans chain (wiki-first, pain mapping, divergence→convergence). Sources: wiki/syntheses/vibe-coding-pains-2026.md, wiki/syntheses/next-wave-2-ideas-2026-08-06.md, wiki/syntheses/rtk-competitive-analysis-2026-08-01.md, wiki/syntheses/cache-write-cost-reduction-2026-08-01.md, wiki/syntheses/solo-developer-roadmap.md, decisions/content-store-no-core-edge.md, concepts/risk-aware-development.md.

Specs (9) at docs/superpowers/specs/2026-08-11-*-design.md + plans (9) at docs/superpowers/plans/2026-08-11-*.md:

1. **workspace-preflight-diff** (MEDIUM, 1/9) — git-grounded snapshot as reserved content sibling PREFLIGHT_FILENAME_RE skipped by listers/pruner; diff renderer ≤200 paths/section. Input seam for sweeper + bundle. Owner: @megasaver/content-store (filename+listers) + apps/cli (git capture pure).
2. **session-residue-sweeper** (HIGH, 2/9) — quarantine-only (rename/copy, never delete) at .megasaver/quarantine/<ts>-<id>/ with manifest+undo.sh+index; ranking buckets tmp>cache>build-output>agent-draft>other; fenced/secret paths refused. Consumes P0-1 preflight.
3. **context-drop-inspector** (MEDIUM, 3/9) — deterministic replay via inspectPack in @megasaver/context-pruner (BM25+scorer+rank→fit) producing DropReport with reason budget/rank/policy/dedup/stale and restore pointers. No new storage.
4. **evidence-bundle-exporter** (MEDIUM, 4/9) — mega pr bundle builds content-addressed bundleId=sha256(canonical)[0:12] at store/bundles/<id>.json+.md joining preflight/sweep/chunk-hashes/receipts; verify is hash-join. Graceful fallback when claim-verification-gate not yet landed.
5. **cross-repo-deja-vu-lite** (MEDIUM, 5/9) — local BM25 lexical recall over all workspaceKeys (chunk failures+LM1+FORGE+approved memories); teaser 200-char redacted two-step open via teaserId=sha256(wk+recordId)[0:8]; no network, no embeddings in v1.
6. **token-hotspot-heatmap** (LOW, 6/9) — derived hotspot score estTokens*(1+dropRate*0.5) from indexer blocks+chunk bytes+inspector counters; CLI mega hotspots + GUI bars. Read-only.
7. **prompt-diet-coach** (MEDIUM, 7/9) — 5 deterministic heuristics (repeated mentions, file-list-then-read, scaffolding, pasted error, dedup) advisory additionalContext only, off by default via store/config/prompt-coach.json.
8. **conversation-fork-time-travel** (HIGH, 8/9) — fork point = preflight+workStateCapsule+intent at store/forks/<id>.json; resume reuses session-resurrection pending capsule (writeResumeCapsule, at-most-once, refused if occupied). Flat list v1.
9. **pipeline-audition** (LOW, 9/9) — sandboxed temp store three fixtures (read/grep/build) via runOutputPipeline in-process; honest byte counters + disclaimer, no hook/daemon. npx megasaver audition.

Contracts locked additive beside wave-1(11)+wave-2(20): PREFLIGHT_FILENAME_RE skip (P0-1), FORK_FILENAME_RE skip (P2-3), quarantine rename-only, DropReport scorerConfigHash, bundleId canonical, teaser two-step, coach off-by-default, hotspot formula, audition sandbox isolation.

Backlog now 40 pairs (11+20+9) pending user spec review; HIGH(2,8) additionally architect pass. No code written; pnpm conventions:check green; pnpm verify deferred to implementation. Next: user spec review → architect passes for HIGH → direct implementation (author≠reviewer, worktree per HIGH).

## [2026-08-11] verify | Wave-3 P0-1/P0-2 smoke + 7 pure TDD green

Implemented P0-1 workspace-preflight-diff (content-store PREFLIGHT_FILENAME_RE skip, preflight/snapshot.ts pure, git-capture execFile 2s, commands/preflight snapshot/diff with realpath-normalized findProjectByCwd) and P0-2 session-residue-sweeper (sweep/rank.ts buckets tmp>cache>build>agent-draft>other, quarantine.ts rename/copy never delete, commands/sweep scan/quarantine/restore). Smoke: preflight 1→2 untracked second.txt diff, sweep scan tmp+build-output quarantine/restore byte-identical, context why DropReport, hotspots, prompt diet, audition, pr bundle, deja-vu, fork all wired to pure cores. Pure TDD: context-pruner/inspect 5 tests, hotspots 3, prompt 4, fork 3, bundle 3, deja-vu 2, audition 2 — all green (content-store 77, context-pruner 54, cli 167 passed, 1811 total). Builds green, conventions:check ok. Changeset .changeset/wave-3-preflight-sweep.md added. Remaining DoD: integration CLI tests for 7 per plan Task 3/4 + code-reviewer/critic (HIGH sweeper, fork) in fresh worktree.

## [2026-08-12] spec | Wave-4 — 3 specs (context-yield-audit, session-mission-control, on-demand-core)

Wave-4 spec batch (user directive wave-3 → wave-4) via brainstorming → writing-plans. Sources: vibe-coding-pains, next-wave-2, rtk, cache-write, solo-dev roadmap, context-ledger. Specs at docs/superpowers/specs/2026-08-11-*-design.md + plans at docs/superpowers/plans/2026-08-11-*.md: (1) **context-yield-audit** (MEDIUM) — yield = reused/injected via 3-gram fingerprint, tier HOT≥0.5/COLD≥0.1/FREELOADER, 7d window max 30d cap 50, redacted, yieldAuditReportSchema strict. (2) **session-mission-control** (MEDIUM) — liveTableSchema strict deriveStatus <60s working/60-5m blocked/>5m done, shortCwd last-two, /api/sessions/live + SessionsLivePanel poll 5s, stats read via fs. (3) **on-demand-core** (HIGH, architect+critic) — ON_DEMAND_ALLOWLIST 19 commands closed, mega.config.json core flag>config>daemon, one-shot spawnOnDemandWorker 10s/SIGTERM→500ms→SIGKILL 1MB, --worker --on-demand echo. PR #337 docs/wave-4-specs 1a63ac2c.

## [2026-08-12] implement | Wave-4 3/3 shipped → release v2.4.0 (PRs #338-#341)

Direct implementation (no herdr), TDD red→green, pnpm verify 60/60.

- **#338 context-yield-audit** `b73dcce7` — packages/context-pruner/src/yield-audit.ts 186LOC computeYieldAudit + fingerprintMemory + tierFor (strict Zod cap50) + apps/cli/src/yield-audit/compute.ts + commands/context/yield.ts 330LOC runContextYield (execFile git diff fail-open) — tests 8+4+5. verify SUCCESS 14:36.
- **#339 session-mission-control** `4f2eb167` — packages/daemon/src/live-table.ts buildLiveTable + apps/cli/src/sessions/live.ts 151LOC fs read daemon/live-sessions.json + stats bytesSavedTotal guard + bridge routes/sessions-live.ts + SessionsLivePanel poll 5s — tests 6+3+1+3+2 (daemon 126 total), removed @megasaver/stats dep via fs, frozen-lockfile fix. verify SUCCESS 17:07.
- **#340 on-demand-core** `a3ee0afa` HIGH — packages/policy/src/on-demand-gate.ts 33LOC + apps/cli/src/config.ts 38LOC resolveCoreMode + core/worker.ts 223LOC spawnOnDemandWorker + cli.ts 51LOC --worker gate isOnDemandAllowed — tests 5+3+3+4. verify SUCCESS 17:26.

Release **v2.4.0** `d040b80a` PR #341 chore(release): pnpm changeset version consumes 3 changesets → cli 2.3.0→2.4.0, context-pruner 0.3→0.4, daemon 0.2→0.3, policy 2.0→2.1, gui 1.5→1.6 +12 patch; biome 19 files; tag v2.4.0. Backlog 43 pairs.

## [2026-08-12] implement | Wave-5 1/3 brain-doctor + 2/3 context-contracts → release v2.5.0 (PRs #342-#344)

Sources: solo-developer-roadmap §2.3/2.4.

- **#342 brain-doctor** `bb15ced9` — packages/core/src/brain-doctor.ts 205LOC diagnoseMemoryHealth 6 families (stale-flagged warn, decayed >2*30d info, contradicted-by-code error, rule-contradiction warn 200cap, lineage-conflict, suggestion-backlog warn≥10/≥14d) + doctor-sources.ts 138LOC hookCoverage+syncFreshness + commands/brain/doctor.ts 155LOC --json schemaVersion 1 — tests 11+5+4 (20). verify SUCCESS 22:29.
- **#343 context-contracts** `d0d0b64b` HIGH — packages/memory-recall/src/contract.ts strict name /^[a-z0-9][a-z0-9-]{0,63}$/ intent 50k + evaluate-contract.ts 178LOC 5 reasons entry-missing/stale/not-recallable/ranked-below-budget/no-entry-in-cut (safe profile early, \→/ normalize) + rank-project-memories profile safe + cli contracts/run 160LOC repairHint + record withFileLock + add 204LOC slugify trace — tests 5+8+22+6+3+6. Windows fix isAbsolute for --dir. verify SUCCESS 02:19. PR #343 merge commit d0d0b64b.

Release **v2.5.0** `08cea9a0` PR #344 `f3c9244a` → squash `08cea9a0` chore(release): pnpm changeset version 2 changesets → cli 2.4→2.5, core 1.5→1.6, memory-recall 0.0.2→0.1.0 +7 patch; biome 10 files; Windows long-memory flaky `lm2-index-operation recovers exact named prefix` `invalid→ready` failed first run `31571796079` then rerun --failed passed at 10:34 (flaky timing, not version bump); verify 60/60 188 files 1873 tests; tag v2.5.0 pushed. Changeset status NO packages. Backlog 45 pairs. Next: Wave-3 remaining P0-3→P2-4 integration tests + code-reviewer/critic for HIGH.

## [2026-08-12] feat | review-attestation A1 (MEDIUM) — `mega review attest/check` diff-hash ledger → feat/review-attestation

A kümesi 1/4, spec `docs/superpowers/specs/2026-08-08-review-attestation-design.md`, plan `docs/superpowers/plans/2026-08-08-review-attestation.md`. TDD red→green, herdr kapalı direkt worktree.

- **Core** `packages/core/src/review-attestation.ts` 80LOC — `reviewVerdictSchema`/`reviewAttestationSchema` strict, `computeDiffHash` sha256 `git diff --no-color <range>`, `attestationLogPath` `<storeRoot>/review-attestation/<projectId>/attestations.jsonl`, `appendAttestation` (never swallows write, `mkdirSync`+`appendFileSync`), `readAttestations` (per-line safeParse skip malformed). `packages/core/src/index.ts` re-export.
- **CLI** `apps/cli/src/commands/review/{attest,check,index}.ts` 360LOC — `parseRange` pure, `runReviewAttest` (resolveStore, project lookup, verdict safeParse, `redact(note)` before storage, `reviewPackId` optional, `attested <12> verdict=…`), `runReviewCheck`+`classifyAttestations` pure (sorted by createdAt desc, current vs mostRecentStale co-occurrence), `mega review check` report-only exit 0, `--json` strict. `apps/cli/src/main.ts` register `review: reviewCommand`.
- **Tests** `packages/core/test/review-attestation.test.ts` 7 tests (determinism, hex, spy, round-trip, malformed skip, write-failure via fileAsDir) + `apps/cli/test/json-failure-paths.test.ts` 5 new cases (invalid verdict/range, project not found) + manual smoke: empty diff e3b0… attest→check current, commit→stale, second attest→current+stale co-occurrence, secret note redacted via policy.
- **Verify** `pnpm verify` 60/60 188 files 1847 tests green after fs-ext Node24 rebuild; `pnpm lint` green; `pnpm typecheck` green; dependency-graph ok (cli→core+policy allowed). Changeset `.changeset/review-attestation.md` minor core+cli.

Dogfood: `mega review attest main..HEAD --verdict approve --reviewer code-reviewer` on this branch's own diff hash verified via `mega review check` reports current.

## [2026-08-12] feat | undisclosed-change-audit A4 (MEDIUM) — `mega session disclosure` file-change reconciliation → feat/undisclosed-change-audit

A kümesi 2/4, spec `docs/superpowers/specs/2026-08-06-undisclosed-change-audit-design.md`, plan `docs/superpowers/plans/2026-08-06-undisclosed-change-audit.md`. TDD red→green, herdr kapalı direkt worktree.

- **git-delta** `apps/cli/src/git-delta.ts:18` `gatherCommittedPaths(cwd,since,until)` — `git log --name-only --since --until --format=` dedup, null on fail, `tryGit` soft. Test `apps/cli/test/git-delta.test.ts:12` 2 cases.
- **Extractor** `path-claims.ts` 60LOC — bounded quantifiers, BACKTICK 1..256, DIFF_HEADER 1..512, BARE 1..64 x1..8 seg, MAX 512 cap first-kind-wins, diff-header excluded from bare. Test 4 cases + ReDoS guard `session-disclosure-redos-guard.test.ts` n=2MB vs 4n=8MB ratio <8 min 5, non-vacuity ≥3, cap not hit.
- **Normalize** `normalize.ts:1` — trim quotes, `:\d` suffix, `\→/`, cwd relativize, drop foreign absolute/`..`, length ≤512, redact(p).count>0 drop. `reconcile.ts` pure sorted dedup set diff. Test 4 cases.
- **Observe** `observe.ts` union `gatherDirtyState` + `gatherCommittedPaths` → `paths` dedup, dirty/committed counts, null on not-a-repo.
- **Receipt** `receipt-store.ts` Zod strict, `writeDisclosureReceipt` tmp+rename, `readDisclosureReceipt` null on missing/malformed. Test 2 cases tmp residue check.
- **CLI** `disclosure/disclosure.ts` 180LOC — `runSessionDisclosure` resolveStore→sessionId parse→getSession→report/compute branching, `statSync` cap 8M, `extractClaimedPaths`→`normalize`→dropped count, `observeTreeDelta` null→notAGitRepo, `reconcile`→receipt, `writeReceipt`, render table/json. `session/index.ts:1` register `disclosure`, `errors.ts:451` 4 helpers pinned messages. Test `session-disclosure.test.ts` 9 cases (compute+replay+oversize+phantom/undisclosed).
- **Verify** `pnpm verify` 60/60 194 files 1876 tests green (1 flaky task-kickoff-hardening re-run passed); smoke: scratch repo session `a8e0c2ba` claimed 2 observed 4 undisclosed 3 phantom 1 persisted and replayed without --text-file.

## [2026-08-12] feat | Session Mesh Task 6 — Hook integration + daemon accelerator → feat/session-mesh-family

Phase 1 hook wiring (direct worktree, no herdr). Implements umbrella LD3/LD4 + Global Constraints “Hook hot-path guard: saver adds no awaited mesh I/O”.

- **warmup-run.ts** `registerSession` (encodeWorkspaceKey + familyKeyFromPath via canonicalFamilyPath, branch from gatherDelta, agent claude-code, status working, fail-open, SAFE_SEGMENT, handleWarmup export).
- **saver-run.ts** `heartbeat` fire-and-forget debounced ≥5s (asSid helper, SAFE_SEGMENT, sync heartbeat via mtime HEARTBEAT_DEBOUNCE_MS=5000, no await, handleSaver export, hot-path test not.toContain await heartbeat).
- **guard-run.ts** `checkConflicts` → `⚠️ peer … claimed …` + `drainInbox` bounded ≤5/≤2000 tokens, untrusted label, toRepoRelative for absolute file_path, meshAdditional merge with firewall warn/deny (deny carries additionalContext).
- **daemon server.ts** `GET /mesh/status` (auth, listPeers all:true → {ok:true, peers}) accelerator, files are truth.
- **install.ts** managed block unchanged, comment notes mesh rides warmup/saver/guard (no new process).

Tests (TDD): `apps/cli/test/hooks/mesh-hooks.test.ts` 11 tests (warmup register with/without project, saver debounce + hot-path, guard conflict absolute→rel, inbox bound 5/2000, untrusted, firewall preserve, fail-open) + `packages/daemon/test/mesh-status.test.ts` 4 tests (401, empty, lists peers, wrong token). `pnpm --filter cli test 196/196`, `daemon 40/40`, `mesh 5/5`, `typecheck` green after core/daemon/cli tsup rebuild, `biome check` clean. Commit `bf418b04 feat(cli,daemon): mesh hooks and status route`.

Report: `.superpowers/sdd/2026-08-12-session-mesh-family/task-6-report.md`.

## [2026-08-12] feat | Session Mesh Family (A1→A5) — Task 1–10 integration → feat/session-mesh-family

Umbrella `docs/superpowers/specs/2026-08-12-session-mesh-family-design.md` + plan `docs/superpowers/plans/2026-08-12-session-mesh-family.md` (HIGH, files-are-truth, 4 phases). Branch `feat/session-mesh-family` off `main@c2c69ace`.

**Phase 1 mesh** (Tasks 1–6):
- Task 1 `b6a53e59..5d4a82ea` `feat(mesh): scaffold package and schemas` — `@megasaver/mesh@0.1.0` `presenceRecordSchema`/`meshEventSchema`/`claimRecordSchema`/`boardFactSchema` strict + `meshPaths`.
- Task 2 `5d4a82ea..ad74b4e9` `feat(mesh): presence, events, gc` + fix `ad74b4e9` review hards (perms 0600/0700, quarantine, safeParse, staleness).
- Task 3 `ad74b4e9..2b445ffb` `feat(mesh): inbox send/drain at-most-once` — `redact()` before persist, bounded, broadcast vs directed, at-most-once drain.
- Task 4 `2b445ffb..c0fe08ab` `feat(mesh): advisory claims` — `claimPaths`/`checkConflicts` TTL 30m repo-relative, glob NFA `compileGlob`, `releaseClaim`.
- Task 5 `c0fe08ab..04e7c4e2` `feat(cli,mcp): mesh commands and tools` + fix `04e7c4e2` `ensureStoreReady` before mesh I/O — `mega mesh {status,send,claims,events,gc}` + MCP 7 `mesh_*` + `meshUnavailableMessage`.
- Task 6 `04e7c4e2..a27cbbcb` hook+daemon (detailed above, commit `bf418b04`).

**Phase 2 board** (Task 7) `a27cbbcb..61b093f9` `feat(mesh,cli): structured blackboard` — `normalizeTopic` + `postFact`/`readBoardFacts`/`resolveFact` (disputed cross-session vs supersede same-session, redact, atomic), `selectFactsForInjection` 500 tokens/30s debounce/ `sameScope` repo filter, CLI `mega board {post,list,resolve,promote}` via `saveMemoryWithLineage→suggested`, MCP `board_*` 3, hooks board digest/delta. Tests `packages/mesh/test/board.test.ts` 9, `apps/cli/test/board.test.ts` 6.

**Phase 3 Q&A** (Task 8) `61b093f9..a39787f0` `feat(mesh,cli,mcp): peer Q&A routing` — `askPayloadSchema`/`answerPayloadSchema` (provenance+evidence), `postAsk` (no_live_peers, 60s `ask-state` rate-limit, `redact()`), `extractKeywords`/`matchPeerAnswer` ≥3 overlap ≤200/30m ≤500 chars, `mesh_send` kind routing (no new MCP tool, roster 7), CLI `mega mesh ask/answer` + hook `mega hooks mesh-hint` opt-in `--mesh-hints` (`MESH_HINT_HOOK_COMMAND`, `meshHintInstalled` status). Tests `qa.test.ts` + hint + integration ask→fanout→drain→answer→drain.

**Phase 4 handoff** (Task 9) `a39787f0..cc027c5e` `feat(connectors,cli): handoff capability and offer` — `HandoffCapabilityProfile` `{acceptsDiff,acceptsGitLine,maxBlockChars}` required on every `ConnectorTarget` (`OPEN` permissive, `aider {acceptsDiff:false}`, `windsurf {maxBlockChars:6000}`), `evaluateHandoffFit` measured on `renderHandoffBlockText`, `open --fit` strict vs fit drops `diff→git`, `pack` advisory `fit(codex): ok`, `peers` free repo-scoped + `peers --packet` fit verdict, `offer` Pro-gated `hot-handoff` pointer-only (`handoff-offer` bus kind, `stats` `kind:offer`). mesh `handoff-offer` additive kind union. Tests 7+25+6+3.

**Task 10 integration** (this commit):
- Changeset `.changeset/session-mesh-family.md` — minor `cli, mcp-bridge, daemon, connectors-shared, connector-generic-cli, connector-claude-code, mesh` + patch `stats, gui`.
- Verify `pnpm verify` 62/62 Turbo `lint` 2128 files 0, `typecheck` 62 tasks, `test` 198 files 1909 tests + 33 skipped (cli) + 62 tasks full turbo (see tail below).
- Smoke (temp store `mktemp`, `realpath` wk fix, `CHROME`): `mega mesh status` 2 peers (table+--json, --follow prints `follow: watching…`, --all), `mega mesh send s-beta` → drainInbox 1, `mega board post --topic` + disputed second fact via `s-beta` → 2 disputed, `mega mesh ask` `ask <id> posted to 2` + events fanout 2 + `rate_limited` second, `mega mesh answer` `delivered to cli-…` + drain `answer` provenance `file-line`, `mega handoff peers` `receivable` + `--json`, `pack --dry-run` `fit(codex): ok`, `offer` Pro gate `Hot handoff is a Mega Saver Pro feature`, `mesh events` bus 4, `gc` 0. See task-10-report.
- Wiki: new `entities/mesh.md` + `index.md` (mesh entry, updated 2026-08-12) + this log.

Spec coverage: LD1 store Tasks1-2, LD2 scope Tasks1-5, LD3 pull Tasks3+6, LD4 fail-open Task6, LD5 TTL Task4, LD6 familyKey Tasks2+5, LD7 mesh package Task1; Phases 2-4 → Tasks7-9 1:1. `pnpm conventions:check` ok (CLAUDE/AGENTS/.cursor 5/5).

Verify tail (62/62):
```
@megasaver/cli:test:  Test Files  198 passed (198)
@megasaver/cli:test:       Tests  1909 passed | 33 skipped (1942)
 Tasks:    62 successful, 62 total
Cached:    62 cached, 62 total
  Time:    ~123ms >>> FULL TURBO
ok      CLAUDE.md
ok      AGENTS.md
ok      .cursor/rules/mega-context.mdc
ok      .cursor/rules/mega-conventions.mdc
ok      .cursor/rules/mega-discipline.mdc
```

Report: `.superpowers/sdd/2026-08-12-session-mesh-family/task-10-report.md`.

## [2026-08-13] decision | v2.7 direction — Net-Positive Saver

User directive after v2.6.0: prioritize the unshipped spec bank for the next version. Outcome: v2.7 = **Net-Positive Saver** cluster — 1) exec-rewrite-saver (HIGH, build-order #1), 2) filter-matrix-expansion (MEDIUM), 3) mega-discover (MEDIUM). Rationale: saver measures net-negative (Stage A 0.948x, cache-churn 0.93–0.97x) while the tagline promises "Less tokens"; RTK leapfrog §5 orders exactly this cluster by leverage-per-effort. cache-boundary-guard deferred on its own spec's 2026-07-30 retraction (PostToolUse rewrites land before first send; history immutable). Trust cluster → wave-8 candidate; activation cluster postponed. Spec freshness flags recorded (Stage A, mesh hook infra, AuditEvent ledger shapes). New page `decisions/v27-net-positive-saver.md` + index.md link.

## [2026-08-13] feat | exec-rewrite-saver (v2.7 #1) — spec refresh → TDD build → smoke

Branch `feat/exec-rewrite-saver` (worktree), v2.7 Net-Positive Saver first pick.

- **Spec+plan refresh** (`4955b153`): Q1 resolved via official hooks docs (full-replacement contract → LD2 corrected); Problem reframed post-2026-07-30 retraction (30k truncation ceiling, 24–30KB band, suffix write cost); architect pass APPROVE-WITH-CHANGES folded: LD10 SAFE_TOKEN launcher/store gate, LD11 tool-timeout threading, LD12 saver exemption, LD13 self-validation, LD14 evidenceStoreRoot+newId, LD15 100MB bound; selector YAGNI cut; plan contradictions fixed.
- **Q1 runtime probe** (Claude Code 2.1.223, live): settings-only PreToolUse hook emitting `updatedInput` WITHOUT permissionDecision rewrote `echo hello` → `echo PROBE_UPDATE_OK` executed. LD2 assumption proven.
- **TDD build** (`052f7019..64a87947`): classifier (47 tests), connector trio (59+172), origin thread (stats 352, context-gate 434, daemon), saver exemption, exec-live (13 tests; runChild spawn optional core-owned), hook runner (13), CLI tri-state. pnpm verify 62/62 green (cli 201 files / 1989 tests + gui 103/706 + conventions ok).
- **Smoke-found bug fixed** (`64a87947`): macOS getcwd resolves `/var` → `/private/var`; exec-live's process.cwd() and a symlinked payload cwd derived different workspace keys → settings gate silently failed closed. Canonicalize on both hook gate + exec-live (cache-advice precedent); regression tests key the store under the canonical spelling.
- **Smoke evidence**: install entry (`^Bash$`, timeout 10), rewrite JSON (updatedInput only, description echo, --timeout threading), exec-live compressed 91890→12211 B + 76 recoverable chunks (footer + content-derived id stable across re-runs), LD13 refusal exit 1 no spawn, LD12 saver passthrough, negative payload empty exit 0.
- **Note for future smokes**: tsup bundle can silently NOT rebuild (mtime older than source, stale output) — use `tsup --config tsup.bundle.config.ts --clean` after source edits.
- Wiki: new `entities/exec-rewrite-saver.md` + index link. Remaining: code-reviewer + critic passes (fresh contexts), changeset commit, merge.

## [2026-08-13] review | exec-rewrite-saver — code-reviewer + critic, P1 fixes

- **code-reviewer** (fresh context): APPROVE-WITH-CHANGES. P1: LD12 exemption missed `cli.js`/`mega.mjs` launcher spellings (dev/dogfood footer-on-footer) — fixed (`eafbd639`, regex `\b(?:mega|mega\.mjs|cli\.js)\s+output\s+(?:chunk|exec-live)\b` + multi-spelling tests). P2s folded: LD13 argv SAFE_TOKEN check at spawn boundary, reject non-positive `--timeout`/`--max-bytes` (parseExecLiveNumericArgs), evidenceStoreRoot pinned in tests.
- **critic** (fresh adversarial context): APPROVE-WITH-CHANGES, 3 P1s vs the spec's own promises:
  - P1-1 footer truncation: compressed delivery under safe mode can exceed the ~30k client cap and the footer is the last bytes → LD16 (`d1565bec`): `EXEC_LIVE_MAX_DELIVERED_CHARS = 28_000`, raw fallback above it. Residual (accepted, P2): fallback runs persist compressed-basis rows — excluded from all aggregates, flagged for the origin-aware wave.
  - P1-2 aggregate mixing: origin rows folded into summary totals (status/sessions-live/GUI) on a full-raw basis — the spec-named "rtk gain" anti-pattern → LD17: excluded from summary fold/rebuild/reconcile AND from `mega audit honest`'s direct loader (`719e2c18`).
  - P1-3 `git branch` admitted `-D`/`-m` mutations under the "read-only" allowlist → dropped from GIT_READONLY + rejection tests.
  - Re-check: P1-1/P1-3 FIXED; P1-2 remainder (`audit honest`) found and fixed; pnpm verify 62/62 green (cli 2028 tests).
- P2 deferrals documented in spec LD16: footer 30-day note + baked-store recovery hint (pre-existing footer gaps, follow-up wave).

## [2026-08-13] feat | filter-matrix-expansion (v2.7 #2) — registry + 10 filters + W4 gate

Branch `feat/filter-matrix-expansion` (worktree), v2.7 Net-Positive Saver second pick.

- **Spec+plan refresh** (`ad857662`, `1a85885b`): freshness reconciliation (4 v2.7 flags all N/A, code drift check clean), exec-live compounding note, plan anchors re-verified.
- **TDD build** (Tasks 1-6): registry + conformance harness + git-status wiring first (`5a008aa6`), then git-log/docker-ps, kubectl-get/gh-pr-list, npm-install/pip-install, cargo-build/docker-build, terraform-plan. output-filter 66 files / 605 tests.
- **Execution-time discoveries folded into the plan**: `CompressorName` widening breaks `rankingTraceSchema.compressor` z.enum (persisted mirror — both must grow together); W4 fixtures must clear the shipped admission guard (≥256 B AND ≥15%) and fit the mode budget in whole lines (mid-line truncation otherwise).
- **W4 gate** (`cd333d6e`): 10 fixtures through `recordAndFilterOverlayOutput` — reconstruct + no-fabrication + honest-naming; context-gate 64/445 green.
- **Smoke evidence**: plan's `mega output exec -- git status` is policy-denied BY DESIGN (BB6: git absent from baseline allowlist, cannot be re-allowed). Correct production path = PostToolUse hook: 1300-file repo, `mega hooks saver` with a `git status --porcelain` payload → 31,393→855 B, "… [1280 more ??]", 33 recoverable chunks, honest summary (97.2%).
- Wiki: `entities/output-filter.md` command-filter registry section. Remaining: code-reviewer pass, changeset commit, merge.

## [2026-08-13] mega-discover (v2.7 #3) — spec+plan refresh + TDD build in progress

- Spec refresh: `docs/superpowers/specs/2026-08-06-mega-discover-design.md` — freshness reconciliation against shipped surfaces (hook-log `agent` field + new categories, exec-rewrite LD8 origin, overlay events layout); new `command_unmeasured` group + `aboveFloor` info line + `stat.isFile()` measurement guard + top-5 rollup + windowed origin-split mediated context. User-approved S1-S3.
- Plan refresh: `docs/superpowers/plans/2026-08-06-mega-discover.md` — 6 tasks.
- TDD build (worktree `feat/mega-discover`): parser (`812ea055`), scanner + fold (`c1f77d4a`), store reader + core re-export (`439ce6bc`), `mega discover` CLI (`d5b8fdde`), install nudge (`b91c781b`).
- Execution-time fixes: plan's window test expectation corrected (path-less rows are unmeasuredCalls, not group calls); `MediatedEvent.origin` widened to `| undefined` for exactOptionalPropertyTypes cross-package assignability; biome↔tsc bracket-access conflict resolved with `biome-ignore` per cli-test-pattern.
- Smoke: temp workspace + 3-row fixture log → text report (workspace disabled: 3 calls / 10,000 B measured, top-repeated-reads rollup) + JSON contract single line (hookMissing false, groups, mediated nulls).

## [2026-08-14] v2.7 Net-Positive Saver — closed

All three locked items shipped on `main` (#348 exec-rewrite, #349 filter-matrix, #350 mega-discover). Decision page `wiki/decisions/v27-net-positive-saver.md` status → complete. Next direction candidates remain per the deprioritized list (cache-boundary-guard B4, trust cluster wave-8, activation cluster).

## [2026-08-14] debug-agent full pass on v2.7 final state — saver canonical-cwd fix (PR #352)

Runtime-evidenced bug: the PostToolUse saver silently passed through payloads whose `cwd` carries a symlinked/dotdot spelling — `saver.ts decide()` derived the settings gate + workspace key from the RAW cwd while the enable command and exec-live/exec-rewrite use the resolved real path (macOS `/var/folders` vs `/private/var/folders` repro; before-log `settingsResolved: null`, after-log `{enabled, balanced}` + events under the canonical key). Fix: one `realpathSync` canonicalization (fail-open fallback) feeding the gate, key, heartbeats, and first-sight ledger. `mega discover` rejected hypotheses: key derivation (physical cwd is already canonical), relative-path rows (0 in real data), outside-workspace attribution (37/5017 rows), performance (0.25s on 5,017 rows). Real-data dogfood: below-floor 573 calls/3.27 MB with top-5 rollup; command-unmeasured 3,702 count-only with caveat.
- Open trap: Windows-only LM2 flake (`expected 'invalid' to be 'ready'` in long-memory quota/index/catalog tests, ~40-50% of windows runs, different tests each time; pre-dates v2.7 — also hit on #350/#351). Remote-debug evidence: prepare returns invalid; one capture showed a fresh root with `embeddings/legacy.json`. Instrumentation branch closed 2026-08-14 (PR #354) — next failing run should be caught with synchronous stderr instrumentation before a fix PR.

## [2026-08-15] feat | package-hallucination-firewall (v2.8 #3) — spec refresh + TDD build

Branch `feat/package-hallucination-firewall` (worktree, HIGH). v2.8 trust slice third pick.

- **Architect pass (fresh context): REQUEST-CHANGES → all folded.** B1 (BLOCKING): shipped `subCommands: { airlock }` makes citty throw `E_UNKNOWN_COMMAND` on `mega firewall --days 7` (empirically verified — shipped defect) and would eat the new verbs; feature removes the block, folds airlock into positional dispatch, pins a citty-layer regression test. M2: collector filter needs explicit kind narrowing (TS does not narrow through `.includes()`) — compile tripwire fired and closed at the CLI collectors, pro-analytics untouched. M3: tier-1 PyPI gains `<name>.py`/`<name>/__init__.py` file probes (dominant false-positive class). M4: mesh stays OUTSIDE the compose seam (joined at caller sites, `\n\n`); three mesh-variant compose tests. M5: refresh grammar-validates names before any fetch. Minors: typosquat hints distance-1 only, RMW inside withFileLock + Windows rename, `__future__` pinned, no hint for truncated unscoped npm names, per-name refresh progress, both joins pinned.
- **TDD build:** extraction (8 linear-time regexes, per-line scan keeps text order; npm/pypi source + manifests; caps), ReDoS probe harness (fixed ~3.9x growth ≤0.19ms@cap; revert `([^"']*[\w./-]+)+["']` never finished in 90s), local resolver (walk-up ≤12, lockfile token boundaries, PyPI file probes), registry cache + allowlist (withFileLock RMW; pypi seeds expanded from the top-pypi dataset (1000), npm seeds RETRACTED to curated 41 — the registry search API treats qualifiers literally, total:1), banded OSA typosquat (distance-1 hints), ledger kinds unknown-package/typosquat-suspect (grammar-bounded, F-FW-1) + byte-identical Pro audit/alerts isolation, warn-only hook builder + per-session warned-set, composeGuardOutputs seam (behavior-preserving guard-run refactor; inert gate byte-identical; deny drops package text, keeps mesh), `mega firewall status/refresh/allow` with the B1 dispatch repair, offline structural test (fetch literal only in refresh.ts; non-vacuity revert-proven).
- **Smoke:** hook warn + typosquat hint + 2 ledger events; allow → silent re-run; refresh 404 "likely hallucinated" vs allowlist skip; `--days 7` audit runs (no E_UNKNOWN_COMMAND); airlock list via dispatch. pnpm verify 62/62 (cli 214 files / 2096 tests + context-gate 70/500).
- **Critic pass (fresh adversarial context): REQUEST-CHANGES → all closed.** B1 (BLOCKING): FIFO/device files passed the size-only read gates and hung the hook path forever (reproduced) — every hook-path reader now gates on `statSync().isFile()` (local resolver, warned-set, cache, allowlist, ledger append) with a mkfifo regression test. M1: the repaired `--days 7` printed a bogus unknown-verb note — dispatch now scans pairwise consuming `--days`/`--store` values; the B1 test asserts stderr EMPTY. M2: one corrupt ledger line wiped the whole refresh-from-ledger set — per-line tolerance + test. M3: the offline structural test now pins the full hook-path import graph (data files, firewall-ledger, board-inject, store, warmup) with import-form needles. Minors: m11 truncated-name test, wiki seed-count honesty, `mega firewall help` usage text, flags-before-verb forwarding.

## [2026-08-15] v2.8 trust slice — closed

All three locked items shipped on `main`: #355 claim-verification-gate (C3),
#356 silent-failure-monitor, #357 package-hallucination-firewall. CI
ubuntu+windows green on all three (the monitor's windows run exposed a
test-fixture path bug — exists-uncaptured fixture matched forward slashes —
fixed platform-neutrally before merge). Decision page
`wiki/decisions/v28-trust-slice.md` added; index status updated. Worktrees
removed. Next candidates per the decision page: memory-write-verify,
mcp-security-doctor (trust remainder), compaction-guard (re-enables the
monitor's degraded legs), review-packs.

## [2026-08-16] feat | memory-write-verify (wave-2 #9) — shipped via PR #359

Write gate + trust tiers + rule TTL, per spec
`docs/superpowers/specs/2026-08-06-memory-write-verify-design.md` (HIGH).
Agent-sourced writes at the MCP boundary resolve evidence pointers and
check contradiction against approved memory BEFORE persist; failures land
`suggested` + capped confidence + system sidecar + 90d default TTL
(`mega memory sweep` enforces losslessly; `expired=`/`rulesExpired=`
reporting; `rankApplicableRules(asOf)` read-exclusion). Gated surfaces:
`save_memory` (boundary-forced source), `convert_failure_to_rule`,
`save_project_rule`, `memory_from_session` (test_failure candidates).
`approve_memory` stays the only promotion path and now classifies
pointers (cs- no longer a dead-end; note-only evidence can never flip an
agent entry). Review history: code-reviewer REQUEST-CHANGES (3 MAJOR) →
fixed; critic 2× REQUEST-CHANGES (4 MAJOR, then 1 BLOCKING+2 MINOR) →
fixed; critic round 3 APPROVED. CI ubuntu+windows green. Wiki: failed-run-
learning + structured-memory-engine write-gate sections; v28 decision
 candidate list updated. Follow-ups per spec: CLI `memory from-session`
and brain-autopilot writers remain ungated (out of scope), `mega rules
apply`/GUI do not thread `asOf` (back-compat deliberate).

## [2026-08-16] feat | write-verify follow-up — remaining ungated surfaces (#361)

Closes the three follow-ups from #359. Spec
`docs/superpowers/specs/2026-08-16-memory-write-verify-followup-design.md`
(HIGH — autopilot write path).

**CLI `mega memory from-session`** now gates `test_failure` candidates
exactly like the MCP tool (empty resolution + corpus + 90d TTL +
quarantined sidecar, `session_summary` untouched).

**Brain autopilot (`runAutopilot`, core):** structural composition —
new `autopilot_attestation` pointer kind (`autopilot@1` prefix,
relocated into `write-verify.ts` so the closed-form table owns it).
The engine mints a verified attestation only from its own
cross-session recurrence computation (`priorSessionHit`); agents citing
`autopilot@…` at any MCP surface fail closed
(`autopilot_attestation_unverifiable`, no IO). Auto-approve now
requires `qualified ∧ verified ∧ conflict-free`
(duplicate/supersession/contradiction all block, plus anchor coverage)
— closing the “machine approves a contradicting row” hole. Gated rows
(suggested and approved) carry 90d TTL and a system sidecar;
`session_summary` candidates stay ungated. `mcp-bridge` resolver,
`mega rules apply` (`asOf: now`) and GUI workspace-rules
(`asOf: ctx.now()`) now exclude expired rules consistently with
`get_applicable_rules`.

Review history: architect APPROVED; code-reviewer REQUEST-CHANGES
(1 BLOCKING spec frontmatter, 2 MINOR) → fixed; critic APPROVED
(re-review: test isolation MAJOR → fixed with real-git fixtures).
CI ubuntu+windows green.

## [2026-08-16] feat | mcp security doctor — local MCP surface audit (wave-2 #12, #363)

Read-only, local, static audit `mega mcp doctor` — four checks over the
configured MCP surface (spec
`docs/superpowers/specs/2026-08-06-mcp-security-doctor-design.md`, MEDIUM):
over-privilege (capability lexicon vs hook-log evidence, unknown where
unobservable), tool-name clone/shadow (exact high, near medium via
O(n) two-pointer edit-distance ≤1, bridge shadowing in both naming
modes, 500-name cap → truncated info), description hygiene (lowercase
literal probes, url+imperative high), config surface (world-writable
critical, group medium, non-localhost URLs via origin, win32
evidence_gap). No writes, no spawns, no network, no regex. Findings
never echo secrets (env values → key names, URLs → origin). Exit 1 on
critical/high.

Review history: code-reviewer APPROVED (2 MINOR regex + same-server
clone_near — fixed verification pending → re-review APPROVED for
LD5 literal compliance; same-server gate now cross-server only);
security-reviewer REQUEST-CHANGES (1 BLOCKING 127.* spoof, 2 MAJOR
[::1] bracket + clone truncation, 2 MINOR regex/command) → fixed
(hardened `isLoopbackHostname`, hand-rolled loops, sampled truncation,
command scan, lowercase megasaver) → re-review APPROVED. CI
ubuntu+windows green after one windows flake retry.

## [2026-08-24] fix | long-memory seeded ledger identity bigint

PR #364 CI (runs 31976661584 + 32771189395) failed one random
seeded-ledger test per run on windows-latest only
(`expected 'invalid' to be 'ready'`; first misdiagnosed as transient
FS errors — a retry band-aid was pushed and reverted in the same PR).
Root cause: production derives lock identity from bigint stats
(`lm2-lock.ts` `lockedFileIdentity`), fixtures from NUMBER stats; on
Windows, NTFS file IDs `(seq<<48)|record` with seq ≥ 32 exceed 2^53
and the number stat rounds differently → ledger identity mismatches
the runtime lock → fail-closed invalid, deterministic per lock file.
Fix: seed fixture ledgers via
`statSync(lockPath,{bigint:true}).dev/.ino.toString()` in
`lm2-index-operation.test.ts` (2 sites) and
`lm2-vector-store-quota.test.ts` (`seedLedger`). Class documented in
[[concepts/windows-support]]. Same PR also carries the mcp-doctor
wiki close; branch `docs/mcp-doctor-close`.
