---
title: Proxy Mode (v1.2)
tags: [concept, proxy-mode, context-gate, output-filter, mcp, v1.2]
sources:
  - docs/superpowers/specs/2026-06-12-proxy-mode-v1.2-design.md
  - docs/superpowers/plans/2026-06-12-proxy-mode-v1.2-roadmap.md
status: active
created: 2026-06-14
updated: 2026-06-14
---

# Proxy Mode (v1.2)

**Proxy Mode** is the public-facing name for MegaSaver's token-saving
tool-output pruning. It is **not** a new architecture — it evolves the
existing [[concepts/context-gate-pipeline]] (Mega Saver Mode),
`output-filter`, `content-store`, `policy`, `stats`, and the `mega_*`
MCP tools. Product claim: *"Others prune output. MegaSaver prunes with
your project's memory."*

Shipped across 7 phases on branch `feat/proxy-mode-v1.2` (TDD →
`pnpm verify` green → external review → changeset per phase). Full
`pnpm verify`: 30/30 tasks, 1828 tests.

## The 7 phases

- **P0 — Tool naming mode** (`mcp-bridge`, commit `49b002e`).
  `MEGASAVER_TOOL_NAMING=proxy|legacy` (default proxy). `tools/list`
  exposes exactly one name per tool: `proxy_read_file` /
  `proxy_run_command` / `proxy_expand_chunk` in proxy mode, the
  `mega_*` set in legacy — never both (no duplicate schemas). Same
  implementation behind both. `mega_recall` is not renamed.
- **P1 — Output classifier** (`output-filter`, `c356e04`).
  `classifyOutput` → `{category, confidence}` over
  `vitest | typescript | generic_shell | unknown`, command-matching +
  output-sniffing on ANSI-stripped text, surfaced on
  `FilterOutputResult.classification`. Low confidence → generic.
- **P2 — Compressors + passthrough** (`output-filter`, `6f65d10`).
  `compressVitest` (keep failures/assertions/stack/summary, collapse
  passing), `compressTsc` (group-by-file, dedupe cascading, top-files
  header). `decision` = passthrough (<1200 tok) / light (<2000) /
  compressed; specialized compressor only when confident; reports
  `rawTokens`/`returnedTokens`, no fake savings on small output.
- **P3 — `proxy_search_code`** (`mcp-bridge`, `31bd0d7`). New
  task-aware search tool backed by **policy-gated `grep`** through
  `runOutputExecCommand` (reuses spawn/policy/redact/filter/store/
  stats). Live grep is source of truth; group-by-file; optional BM25
  enrichment that only reorders (`index_enrichment` status);
  `path_scope` confined to the project (rejects absolute / `..`).
- **P4 — Engine-aware ranking** (`output-filter`, `7a3c85b`).
  `applyEngineRanking` re-weights the existing `scoreChunk` output —
  no second scorer: `0.70*base + 0.15*memory + 0.15*failure`, all
  signals `[0,1]`, behind `MEGASAVER_ENGINE_RANKING` (off by default).
  Per-chunk `engine` explanation for audit/replay.
  `SessionHints.recentFailures` feeds the failure boost.
- **P5 — Hooks + metrics + connectors** (`cli`/`stats`, `07040de`).
  `mega hooks install claude-code` installs an idempotent PreToolUse
  telemetry hook (matcher `Read|Bash|Grep|Glob|LS`, command
  `mega hooks log`). Logger is metadata-only, best-effort, always
  exits 0. Stats reports proxy **adoption** (universal) and
  **hook-based interception** (only when the jsonl log exists, else
  adoption-only + install hint — never overclaimed). Setup Doctor
  detects the hook. Connector block biases to proxy tools.
- **P6 — Replay trace** (`output-filter`, `3873ae0`). With
  `recordTrace`, `filterOutput` emits a trace of
  classification/decision/compressor/engine-flag/tokens and
  candidate/selected/omitted chunk **references** (scores + signals,
  no raw text — privacy §12.3). `finalizeReplayTrace` adds
  session/project/tool/query + content-store `chunkSetId`;
  `writeReplayTrace` appends JSONL best-effort. Feeds v1.4 ablations.

## Spec-vs-repo reconciliations (locked)

The roadmap was authored from the spec without repo access (everything
tagged "confirm in repo"). Confirmed and reconciled:

- **`grep`, not `rg`** — `ALLOWED_COMMANDS` is LOCKED and grep is
  universal; rg / index-first search defer to v1.3 (spec §9.4 already
  defers).
- **No persistent index** — `retrieval` is in-memory BM25 only, so
  index enrichment is optional/best-effort, never "stale".
- **No P0 stubs** — repo §13 forbids merged stubs; `proxy_search_code`
  landed real in P3, not a P0 placeholder.
- **`mega_recall`** keeps its name (absent from the §5.3 rename map);
  `proxy_search_code` is new and exposed in both modes.
- **`MEGASAVER_ENGINE_RANKING` default off** — shipping a brand-new
  ranking default-on is riskier; opt-in flag flips it on.

## Relationship to other concepts

- Evolves [[concepts/context-gate-pipeline]] (redact → chunk → rank →
  fit → summarize); P1/P2 add classify + specialized compressors, P4
  adds the memory/failure boost layer on the same scorer.
- [[concepts/context-pruning-engine]] (LAMR) is the repo-side scorer
  cousin; P4 stays narrow (3 signals) — the wider LAMR signal set is
  v1.3.
- v1.4 will run the ablation ladder over P6 replay traces.
