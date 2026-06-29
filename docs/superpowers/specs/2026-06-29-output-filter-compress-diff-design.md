---
title: Diff-aware Output Compressor (compressDiff)
status: approved
risk: medium
created: 2026-06-29
---

## Goal

Add a `diff` output category and a `compressDiff` compressor to
`@megasaver/output-filter`. Unified diffs and `git status` / `git log --stat`
output are dominated by unchanged context (typical PR diff is 60–85% unchanged
context). Collapsing that context returns ~65–75% fewer tokens to the agent
while every changed line and diagnostic is preserved verbatim.

The compressor must stay tool-resident: it runs inside the same
`compressByCategory` pipeline used by the CLI saver hook AND the MCP tools
(`mega_run_command` / `mega_read_file`), so the feature works on Claude Desktop
via MCP with no extra wiring.

## Mechanism

(From the locked, pre-vetted design — formalised, not redesigned.)

### Classification (`classify.ts`)

- Add `"diff"` to `outputCategorySchema`.
- Sniff `diff` by EITHER:
  - **Output signature** — lines matching `^diff --git`, hunk headers
    `^@@ .* @@`, or leading `+`/`-` changed lines.
  - **Command signature** — command is `git diff` / `git status` / `git log` /
    `git show`.
- Extend `isConfidentClassification` to include `diff` (same confidence-floor
  rule as `vitest` / `typescript`).

### Compression (`compress/diff.ts`)

Wired into `compressByCategory` exactly like `compressTsc` / `compressVitest`:
`if (category === "diff") return { text: compressDiff(text), compressor: "diff" }`.

For a **unified diff**:
- Keep every file header (`diff --git`, `---`, `+++`).
- Keep every `@@ ... @@` hunk header.
- Keep ALL `+` / `-` changed lines.
- Reduce surrounding unchanged context to 1 line on each side of a changed run.
- Collapse fully-unchanged runs to a marker: `… [N unchanged]`.

For **`git status` / `git log --stat`**:
- Keep the file-list / stat summary lines.
- Drop decorative ASCII graph lines (e.g. `* | \`).

## Files to touch

| File | Change |
|------|--------|
| `packages/output-filter/src/classify.ts` | Add `diff` to enum; add command + output sniffers; extend `isConfidentClassification` |
| `packages/output-filter/src/compress/diff.ts` | New `compressDiff` compressor |
| `packages/output-filter/src/compress/index.ts` | Dispatch `diff` → `compressDiff` in `compressByCategory`; add `"diff"` to `CompressorName` |
| `packages/output-filter/test/...` | Unit tests per Test plan |

## Lossless / evidence-preservation

- **Lossless** — raw output already persists to a ChunkSet before compression;
  `compressDiff` only changes what is RETURNED, never what is recoverable.
  The full diff stays expandable via `mega_fetch_chunk`.
- **Deterministic** — no LLM calls. Pure line transforms.
- **Evidence-preserving** — collapsing applies ONLY to unchanged context lines.
  No `+`/`-` change, hunk header, or diagnostic is ever merged, hidden, or
  combined with another. Distinct changes remain distinct.

## Test plan

1. **Unified diff** — given a multi-hunk diff: every `+`/`-` line and every
   `@@` hunk header is present in the output; unchanged context is reduced to
   1 line per side; a long unchanged run is replaced by a `… [N unchanged]`
   marker with the correct N.
2. **`git status` / `git log --stat`** — file-list / stat summary lines are
   kept; decorative ASCII graph lines are dropped.
3. **Non-diff fall-through** — a non-diff input (e.g. a vitest or plain shell
   blob) classifies as a non-`diff` category, so `compressDiff` never fires and
   existing behaviour is unchanged.

## Out of scope

- Side-by-side / word-level intra-line diff rendering.
- Reformatting or re-coloring changed lines (ANSI handling stays in the
  existing normalize pre-pass).
- Configurable context width — fixed at 1 line per side for v1.
- Any change to ChunkSet persistence or `mega_fetch_chunk`.
