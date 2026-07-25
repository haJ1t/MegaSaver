---
title: Plan — stop the dedupe growth-ratio guard flaking
spec: docs/superpowers/specs/2026-07-25-dedupe-guard-flake-design.md
risk: HIGH
created: 2026-07-25
---

# Plan — dedupe guard flake

## Task 1 — measure (DONE before any edit)

Ran the guard's own harness (warm-up, 3 trials, min per side) x5 under
three conditions; numbers in spec §3. Established that uniform load does
not move the ratio, and that a restored all-pairs scan reads 3.92–3.99.

Measurement harness was a scratch file, deleted afterwards — not shipped.

## Task 2 — the change

`packages/output-filter/test/dedupe-quadratic.test.ts`

- `it(..., { retry: 3 }, async () => {...})` — the option object form
  used by every sibling timing guard.
- Extend the existing comment block with the §3 table and with why a
  retry cannot mask the defect. Do NOT touch `MAX_GROWTH`, `TRIALS`,
  `LINES`, or the harness.

**Verify:** `pnpm --filter @megasaver/output-filter test` green.

## Task 3 — prove it is still load-bearing

Restore the all-pairs scan in `src/dedupe.ts`, run the guard WITH the
retry active, confirm it fails on every attempt, then restore the banded
scan by copying back the saved original and diffing to confirm identity.

A retry that lets the defect through on attempt 2 of 4 would make this
change worse than the flake, so this is the gate, not a formality.

**Verify:** guard red under the mutant; `git diff -- src/dedupe.ts` empty
afterwards.

## Task 4 — docs + release

- `.changeset/dedupe-guard-retry.md` — patch, `@megasaver/output-filter`.
- `wiki/log.md` — entry recording that the chip's premise was wrong and
  why the ceiling stays rejected, so this is not re-proposed.
- Do NOT touch the two sibling ratio guards (spec §6) — flagged, not
  swept in.

**Verify:** `pnpm verify`; run `biome check --write` on edited files
FIRST (four format-only verify failures earlier in this session).

## Task 5 — review (HIGH, §12)

`critic`, fresh context. Forbid working-tree git commands; snapshot
first. Run verify AFTER the review, not concurrently.
