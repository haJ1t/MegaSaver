---
feature: token-hotspot-heatmap
date: 2026-08-11
risk: LOW
status: draft-design
pending: [user-spec-review]
reviewers: [code-reviewer]
build-order: "6 of 9 (wave-3 batch)"
---

# Token Hotspot Heatmap — GUI + CLI (P2-1)

## Problem

The audit dashboard (`packages/stats/src/audit.ts`, `wiki/entities/stats.md`) reports totals, and the cost ledger (wave-1) will report per-task spend, but neither shows **which files/blocks burn the budget**. The inspector (P0-3) explains one query; the user needs a glanceable map of the whole repo's token weight so they can fence or split hot files before the next pack. `wiki/syntheses/cache-write-cost-reduction-2026-08-01.md:99-102` B5 already names the need as a "suffix-stability linter" — this is its visual counterpart.

## Goal

1. `mega hotspots [--top 20] [--json]` emits a ranked list of **token hotspots**: `filePath | block type | bytes | est. tokens | hotspot score | keep rate` derived from `indexer` block inventory + `content-store` chunk-set sizes + `stats` kept/dropped counters (via `context-drop-inspector` join when available).
2. GUI panel `Insights → Hotspots` renders the same data as an inline heatmap (bars, not a canvas library) with sort/filter and a link to `mega context why` for any row.
3. No new measurement — pure derived view over already-persisted bytes; deterministic, honest-metrics compliant.

Success criteria: same repo state → same hotspot order; top row matches the largest file by est. tokens; GUI renders 100 rows under 16ms; `pnpm verify` green.

## Non-Goals (YAGNI)

- No flamegraph, no treemap library — simple sorted bars (accessibility + bundle size).
- No per-turn timeline (that is audit timeline); hotspots are aggregate.
- No write or policy suggestion — map only (fence suggestion is P0-2).
- No daemon, no network.

## Locked Decisions

1. **Source = indexer blocks + content-store bytes + inspector counters.** Hotspot score = `estTokens(block) * (1 + dropRate * 0.5)` where `estTokens = estimateTokens(bytes)` (`@megasaver/output-filter`), `dropRate = dropped/(kept+dropped)` from `inspectPack` counters when available, else `0`. `keep rate = kept/(kept+dropped)` when available, else `1`. This biases toward files that are both large and frequently evicted.
2. **Bytes source hierarchy.** Primary = `packages/indexer` block `bytes` (typed CodeBlock). Fallback = `packages/content-store` chunk-set `rawBytes` for files that were read at least once. Non-code files (md, yaml) use raw stat size via `fs.statSync` at CLI run time, not at index time.
3. **Deterministic ranking.** `hotspotScore desc → estTokens desc → filePath lex`. No sampling.
4. **Output caps.** CLI text: top N (default 20, max 100), each line ≤ 120 chars, truncated paths with `…` (like sweeper renderer). JSON: full array with scores. GUI: virtualized list (CSS, no library) — renders only viewport rows.
5. **Ownership.** `apps/cli` owns CLI + data joiner `apps/cli/src/hotspots/compute.ts` (pure); `apps/gui` owns the panel `apps/gui/src/routes/hotspots.tsx` reusing the same joiner via a shared `@megasaver/stats` re-export if needed. No new package.

## Architecture

```
mega hotspots -> computeHotspots({storeRoot, cwd}):
  load index blocks (index/meta.json)
  listChunkSets (all sessions in workspace)
  optional: last DropReport counters (if inspector was run)
  for each block/file -> {bytes, tokens, score, keepRate}
  sort by score -> top N -> render
GUI: GET /api/hotspots -> same computeHotspots, returns JSON -> React bars
```

## Components

- **C1 `apps/cli/src/hotspots/compute.ts` (pure):** `computeHotspots(input): Hotspot[]`, deterministic, no I/O.
- **C2 `apps/cli/src/commands/hotspots/index.ts`:** citty `mega hotspots`.
- **C3 `apps/gui/src/routes/hotspots.tsx` + `apps/gui/bridge/hotspots.ts`:** API route + panel (bars, sort, why-link).

## Error handling

- No index → `error: no index found; run mega index` exit 1 (same as P0-3).
- No chunk-sets → hotspots from index blocks only, `keepRate = 1`, `dropRate = 0` (degraded but succeeds).
- Malformed block.meta → skip with omission count on stderr, continue.

## Security & privacy

- Paths redacted once at render time; scores carry no secrets.
- No file contents read for hotspot scoring — only sizes and counters.

## Testing

- **Unit:** score formula (evicted large file outranks small kept file), deterministic sort tie-break, 100-row trim, cap.
- **Integration:** tmp repo `mega index` + one pack → `computeHotspots` top is the largest file; GUI bridge returns same JSON shape.
- **Perf:** 500-block fixture → compute < 10ms, GUI render < 16ms (Vitest bench, not flaky).

## Risk & process

**LOW** (§12: read-only derived view, no workspace mutation). Abbreviated chain allowed, but full `pnpm verify` still required. Reviewer `code-reviewer` only.

## Dependencies / build order

- Depends on: `packages/indexer` blocks, `packages/content-store` bytes, optional P0-3 counters. Independent of P0-1/P0-2/P1-1 but strongest after them.
- Build order **6 of 9 (wave-3 batch)**.

## Open questions

1. Should GUI hotspots link to `mega sweep scan` for large untracked hotspots? (v1: link to `mega context why` only.)
