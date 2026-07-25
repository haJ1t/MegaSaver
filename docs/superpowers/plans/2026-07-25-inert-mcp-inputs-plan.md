---
title: Plan — honor `max_results`, drop `around`
spec: docs/superpowers/specs/2026-07-25-inert-mcp-inputs-design.md
risk: HIGH
created: 2026-07-25
---

# Plan — inert MCP tool inputs

## Task 1 — RED: search-code tests

`packages/mcp-bridge/test/tools/search-code.test.ts`

- `max_results` smaller than the file count ⇒ `files.length === max_results`,
  and `omitted` reports the dropped file + match counts.
- The retained files are the **top-ranked** ones, not grep's first N —
  drive it with a fixture where BM25 order differs from grep order, so
  a slice-before-rank implementation fails.
- `max_results` ≥ file count ⇒ no truncation, `omitted` absent.
- `max_results` absent ⇒ result byte-identical to today (`omitted`
  absent, not `{files:0,matches:0}`).
- The daemon-forward branch caps too (existing daemon-200 test shape).

**Verify:** `pnpm --filter @megasaver/mcp-bridge test` red on all five.

## Task 2 — GREEN: search-code

`packages/mcp-bridge/src/tools/search-code.ts`

- `SearchCodeResult` gains `omitted?: { files: number; matches: number }`.
- `shapeResult(query, exec, maxResults?)`; slice AFTER `enrich`.
- Thread `max_results` into both call sites (`:249` in-process, `:251`
  daemon).
- WHY comment: the cap runs post-rank, and the omission is reported
  because a silent cap is the defect being fixed.

**Verify:** package tests + `pnpm --filter @megasaver/mcp-bridge typecheck`.

## Task 3 — `around`

- RED: `packages/mcp-bridge/test/tools/fetch-chunk.test.ts` — `around`
  in args ⇒ `validation_failed` whose message names `around`.
- GREEN: delete the line from `fetchChunkInputSchema`.

**Verify:** package tests.

## Task 4 — docs + release

- `.changeset/inert-mcp-inputs.md` — minor, `@megasaver/mcp-bridge`.
- `wiki/entities/mcp-bridge.md` — dated section.
- `wiki/log.md` — timestamped entry.
- Amend `docs/superpowers/specs/2026-06-12-proxy-mode-v1.2-design.md`
  where P3-T8 / "omitted low-value matches" is now partly delivered
  (file-level only, not per-match collapsing).

**Verify:** `pnpm verify`.

## Task 5 — review (HIGH tier, §12)

`critic` + `code-reviewer`, fresh context, parallel.

**Verify:** `pnpm verify` captured; verdicts recorded.
