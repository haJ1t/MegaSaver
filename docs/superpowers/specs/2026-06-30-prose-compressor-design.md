# Prose Compressor Design

**Date:** 2026-06-30
**Feature:** WS4 — Extractive Prose/Markdown Compressor
**Risk:** MEDIUM

## Summary

Add an extractive, deterministic compressor for prose/markdown/docs output to
`packages/output-filter`. This covers long markdown docs, web-fetched API docs,
README files, and similar structured-prose content. No LLM — pure text
heuristics. Lossless (raw persists to ChunkSet, only the returned text changes).

## Compressor Rules (`compressProse`)

1. **Headings** — every ATX heading (`# … ######`) and setext heading (line
   followed by `===` or `---` underline) is always kept verbatim.
2. **First paragraph per section** — the first paragraph (or first ~2 sentences
   if the paragraph is long) under each heading is kept verbatim.
3. **Extra paragraphs** — remaining body paragraphs in each section are
   collapsed to `… [N paragraphs]`.
4. **Fenced code blocks** — `` ``` … ``` `` blocks are always kept verbatim;
   never counted or collapsed.
5. **Indented code blocks** — lines with 4+ leading spaces (outside a list) are
   kept verbatim.
6. **Lists** — bullet (`-`/`*`/`+`) and numbered (`N.`) lists:
   - ≤3 items → keep all.
   - >3 items → keep first 3 + `… [N more items]` marker.
7. **Blockquotes** — `>` lines kept verbatim (short; signal-dense).
8. **Section preservation** — sections are never merged; each heading opens a
   new section context.
9. **Short documents** — a document with ≤5 paragraphs and ≤500 chars passes
   through unchanged (no point compressing a README that's already small).

## Markers

Match the existing idiom in diff.ts / json.ts:

- `… [N paragraphs]` for collapsed body text
- `… [N more items]` for list tails

## Classification (`classifyOutput` addition)

New `"prose"` category in `OutputCategory`. Checked **after** all existing
categories (diff → typescript → vitest → structured) so it never steals those.

**Signal sources:**

1. `source === "fetch"` (URL fetch) — any content that looks like prose/markdown
   (has markdown headings OR more than 30% lines start with `#`, `-`, `*`, `>`,
   or are blank). Confidence: 0.75.
2. Markdown structure density on content alone:
   - Has at least one ATX heading (`^#{1,6} `) — confidence 0.7.
   - Has ATX heading **plus** at least one of: fenced code block, bullet list,
     numbered list — confidence 0.85.
3. Command hint: `cat`/`less`/`bat` on a `.md`/`.rst`/`.txt` file — confidence
   0.8.

**Anti-fire guards** (must NOT classify as prose):
- Contains `diff --git` or `@@ … @@` (diff).
- Contains `error TS\d+:` patterns (typescript).
- Contains `Test Files` or `AssertionError` (vitest).
- Is valid JSON (structured).
- Has `command` that matches existing diff/ts/vitest commands.
- Plain shell logs: require markdown structure signals, not just any text.

## `isConfidentClassification` update

Add `"prose"` to the allowed-category set so the gate passes it through.

## Files Changed

| File | Change |
|------|--------|
| `packages/output-filter/src/compress/prose.ts` | New compressor |
| `packages/output-filter/src/classify.ts` | Add `"prose"` category + sniff |
| `packages/output-filter/src/compress/index.ts` | Wire prose dispatch |
| `packages/output-filter/test/compress-prose.test.ts` | New test file |
| `packages/output-filter/test/classify.test.ts` | Add prose classify tests |
| `.changeset/prose-compressor.md` | Changeset |

## Non-goals

- No LLM, no semantic understanding, no lossy summarization.
- No special deduplication exemption for prose chunks (prose is not diagnostics;
  default dedupe applies).
- No setext underline detection in the first iteration (ATX headings cover 99%
  of real-world docs; setext detection adds regex complexity for rare gain).
