---
title: Outline-First Read — Size Floor (follow-up)
status: ready
risk: medium
created: 2026-06-29
spec: docs/superpowers/specs/2026-06-29-outline-first-read-design.md
---

# Outline Size Floor — Plan

Follow-up guard for the outline-first read feature (PR #190). Closes the
"no saves-tokens floor" limitation: `outline: true` can return a skeleton
as large as — or larger than — the raw file on tiny/dense files
(measured: small `alpha`/`beta` `.ts` → skeleton 204 B vs raw 148 B,
ratio 1.378). Opt-in, so not a correctness bug, but the "saves tokens"
framing is false there and nothing stops a payload larger than a plain
read.

## Decision

Take the outline branch only when the skeleton is meaningfully smaller
than the raw file: `skeletonBytes < OUTLINE_MAX_SKELETON_RATIO * rawBytes`
with `OUTLINE_MAX_SKELETON_RATIO = 0.9` (skeleton must save ≥ 10 %).
Otherwise fall through to the normal rank/fit pipeline. Lossless either
way — the normal read persists its own chunks.

Ratio rationale: `>= rawBytes` (merely "not bigger") still lets a 99 %
skeleton through, which costs a second fetch round-trip for ~no saving.
0.9 is the smallest round margin that keeps the saving real; the bodies
are still one fetch away in either branch.

## Steps

1. TDD red: in `packages/output-filter/test/filter-output.test.ts`
   - tiny/dense file + `outline: true` → `decision !== "outline"`, no
     `result.chunks` (floor fallback, outlineFile returned non-null).
   - large multi-declaration file + `outline: true` → `decision: "outline"`
     with body chunks (existing happy path, moved to a larger fixture).
   → verify: tests fail.
2. Green: add `OUTLINE_MAX_SKELETON_RATIO` const + floor guard in
   `filterOutput`'s outline branch in `src/types.ts`. → verify: tests pass.
3. Docs: spec "Out of scope" + wiki `concepts/outline-first-read.md`
   "Limitations" note the floor is now implemented with the ratio.
4. Changeset: patch bump `@megasaver/output-filter`.
5. `pnpm verify` green; no-eager-typescript guard still passes; reviewer.
