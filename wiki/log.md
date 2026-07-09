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
