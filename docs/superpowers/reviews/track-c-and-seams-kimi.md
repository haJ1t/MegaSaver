# Review — Track C (5 commits) + Track A/B seams

- **Date:** 2026-07-29
- **Reviewer:** Kimi K3 (Track B author — reviewing C, and A's changes to B's work; NOT reviewing own work)
- **Tree:** `/Users/ozger/Desktop/MegaSaver-review` @ `c1d37849` (merged A+B+C)
- **Method:** packet-vs-diff comparison per commit, stop-word list byte-diff,
  seam tracing at HEAD, test suites re-run at HEAD.

## Overall verdict

**Track C: APPROVE** (C1, C3 clean; C2, C4, C5 approve-with-notes — none blocking).
**Seams: sound, with two coverage gaps worth a follow-up** (read-path events
still pre-B1; `proxy_search_code` wrapper bytes uncounted). The
`admission-guard` threshold question is **not answerable from B4's numbers** —
what is missing is named below.

---

## Part A — Track C, commit by commit

Packet: `docs/superpowers/plans/2026-07-28-dispatch-track-c.md`.

### C1 `e0184acf` — filenames rebuild corruption — APPROVE (1 nit)

Implemented: rebuilt array filtered through a `Set` of the ORIGINAL paths
(`apps/cli/src/hooks/saver.ts:185-193`), `numFiles = kept.length`. Set
membership subsumes the packet's three negative patterns. Tests drive the
real pipeline (`recordAndFilterOverlayOutput`, 2000 paths — a superset of the
packet's 500) and assert every packet point: membership, the three forbidden
patterns, `numFiles === length`. The updated legacy pin (`numFiles` 2000 → 1)
correctly retires an assertion that had pinned the defect itself. Ownership
clean (saver.ts + its test only).
Nit: stale comment at `saver.ts:177` still says the rebuild keeps "footer".

### C2 `6e408658` — stop-word leakage — APPROVE (2 notes)

- Intent-side-only filter (`rank.ts:86`); chunk side and `tokenizeForMatch`
  untouched — matches "filter where the intent set is built".
- **Stop-word list fidelity: verified byte-exact as a set**, at the commit AND
  at HEAD, against the packet — 95 unique words, zero added, zero removed
  (the packet's Turkish list literally repeats `mi`; the shipped `Set`
  collapses the duplicate — the WORD SET is identical). Turkish entries all
  diacritic-folded as specified.
- All five packet assertions present in `test/rank.test.ts:107-131`.
- C5 (`303de7ee`) also touched `tokenize.ts` (+101): verified pure reformat
  (one word per line); the set is unchanged. No semantic interaction.
- Note 1: packet asked the commit body to name which pre-existing fixtures
  moved and why; the body is silent. In practice none moved (491/491 green,
  zero existing tests edited) — a one-line "no fixtures moved" would have
  closed the requirement.
- Note 2 (for the packet author, not Flash): the Turkish folding test would
  also pass with broken folding (`bu` is filtered as ASCII regardless).
  Sharper pin: intent `nasıl` alone vs a chunk containing `nasıl` → 0 only
  via the folded `nasil` entry. Implemented as the packet wrote it.

### C3 `5fa4b5e5` — BM25 identifier splitting — APPROVE

All requirements met at `packages/retrieval/src/bm25.ts:33-63`: split before
case folding, lower→upper boundaries, snake/kebab/dot separators, acronym run
(`HTTPServer` → `http`, `server`), digits attached (`utf8` whole), unsplit
original retained alongside parts, `\p{L}\p{N}` + `u` flag (no `\W` left),
same `tokenize` on both sides. All seven packet assertions present and
non-tautological; retrieval 50/50 green at HEAD (43 baseline + 7 new, no
regressions). Nit: the `auth_token_gen` test doesn't pin whole-token
membership (implementation keeps it); `result.includes` dedup is O(n²).

### C4 `7859df31` — safe-mode Bash dead zone — APPROVE (2 notes)

- Invariant, not a magic number: `saver.ts:54` derives the floor from
  `modeToBudget(mode)` (`max(budget+1, min(budget, FLOOR))` ≡ `budget+1`).
  `modeToBudget` (packages/shared, off-limits) untouched — no stop-and-report
  violation.
- Tests: the three-mode loop asserts `minBytesFor("Bash", mode) >
  modeToBudget(mode)` against the live function; the safe-mode
  just-above-floor case produces `compressed` end-to-end. The B9 fixture
  change is legitimate — the old pin (26 KB payload, 24 KB floor) encoded the
  dead zone itself.
- Note 1: stale comment `saver.ts:30-33` still claims the floor stays "below
  the ceiling so safe mode still saves" — post-fix the safe floor is 32 001,
  ABOVE the ~30 k truncation ceiling, so safe-mode Bash compression now fires
  rarely. That trade-off is what the packet specified ("this is the
  specification, not the numbers") — but the comment now contradicts the code.
- Note 2: `Math.min(budget, BASH_COMPRESS_FLOOR)` is a dead subexpression;
  plain `budget + 1` would say what it means.

### C5 `303de7ee` — combined stdout/stderr gate — APPROVE (3 notes)

- Combined gate (`saver.ts:124-139`): `stdout + marker + stderr` measured as
  one; both fields rebuilt shorter; split restored via the
  `--- STDERR error boundary ---` marker; other fields preserved via `...o`.
  stdout-only/stderr-only paths traced equivalent to the old single-slot
  behavior. All four packet assertions covered, end-to-end through the real
  pipeline (`saver.test.ts:1097-1194`).
- The `tokenize.ts` +101 in this commit is a formatting-only reformat of C2's
  list (sets verified identical). Within owned files, harmless — but out of
  C5's stated scope; should have been its own `style:` commit.
- Note 1 (real follow-up): **marker fragility** — if the compressor ever
  drops/rewrites the boundary line, the rebuild lands everything in `stdout`
  and `stderr: ""`, silently breaking the split the packet requires. A user
  output containing the literal marker would also collide, and `newStderr` is
  `.trim()`-ed (bytes not round-tripped). No test pins the marker-dropped
  degenerate case.
- Note 2: the rewritten legacy test pins the exact marker string (tests the
  written thing, not the required thing) — acceptable as a rebuild unit test.
- Note 3: commit subject is ~65 chars, over the ≤50 convention.

---

## Part B — Track A's changes to Track B's work

### B-1. `model-facing-bytes.ts` rewrite (93cf6a8c): no capability lost

The rewrite drops `overlayModelFacingText` and counts the DELIVERED text
instead of re-rendering it. Verified at HEAD:

- **No production caller of the removed renderer existed** (grep across
  packages/apps: only its own tests). Nothing Track B shipped depends on it.
- The single-renderer rationale is correct and I co-sign it: my renderer
  numbered gap markers in post-collapse space, which is exactly the
  coordinate system A3 abolished because it cannot address the stored chunks.
  Delegating record-output.ts to it would have reverted A3. (The invitation
  comment in my original module predated A3's landing.)
- New `modelFacingBytes({delivered, summary, excerpts, footer})` measures
  bytes on the actual delivered string; `totalBytes` is exact by
  construction; any renderer-injected content the two `GAP_MARKER` forms
  don't match lands in `separatorBytes` (residual), so the breakdown can't
  understate the total. Tests rewritten accordingly, 4/4 green.

### B-2. `run-command.ts` envelope accounting: consistent with B1, no double count

- Both exec seams (`run-command.ts:432` registry, `:668` overlay) record
  `returnedBytes = mcpEnvelopeBytes(result)` and
  `deltaBytes = rawBytes − modelFacingReturnedBytes` — B1's sign convention,
  unclamped; `bytesSaved`/`savingRatio` stay clamped legacy. Consistent.
- **No double count:** exactly one event append per call — the daemon writes
  it when forwarded, the in-process fallback when not; never both. The
  counted object is the same one `server.ts:316` JSON-stringifies
  (`handleRunCommand` returns `ExecResult` verbatim; daemon JSON round-trip
  preserves key order, hence bytes).
- **Gap 1 (follow-up): `proxy_search_code` wrapper bytes uncounted.**
  `search-code.ts:283-296` delivers `{files, status, metrics}` — per-file
  `matchCount`/`reason` plus a metrics block — built AROUND the exec result.
  The recorded envelope is the inner `ExecResult` only; the wrapper fields
  are model-facing and counted nowhere. Same class of undercount B2 was
  created for, one layer up.
- **Gap 2 (follow-up): the read path is still pre-B1.** `run.ts:229` and
  `run.ts:380` (registry + overlay reads) still record
  `returnedBytes = filteredResult.returnedBytes` (summary + excerpt text, no
  envelope) and **no `deltaBytes` at all** — so `deltaBytesOf` falls back to
  the clamped legacy value and an inflating read still cannot go negative.
  "Hook and exec producers write it" is true; "all four entry points" (spec
  §W0) is not yet: 3 of 5 seams converted, the two read seams remain.
  (`run.ts` is unowned by any track — same orphan class as `stats/store.ts`
  was for B1.)
- Also still inflated: `apps/cli/src/commands/bench.ts:198` publishes
  `filtered.returnedBytes` (was on B2's list; apps/cli is unowned).

### B-3. `admission-guard.ts` and the threshold: B4 alone cannot set it

There is no literal `TODO(threshold)` left — the guard ships floors as
parameters defaulting to `NO_FLOORS`, applied only on the hook path
(`record-output.ts:267`), with the reasoning written down (cost axis belongs
to the net-positive spec; PR #278's shipped behaviour; don't guess).

**Do B4's numbers suffice to pick the floor? No — they answer a different
question.** B4 measured tokenizer divergence (bytes/4 vs cl100k BPE per
content class: code 0.975, prose 1.013, JSON 1.193, TR 0.961). That validates
expressing the floor in BYTES (±4 % error for code) and warns that JSON-heavy
outputs undercount ~19 % in token terms. What the floor actually needs is the
**measured cache-creation cost of one `tool_result` rewrite** — the number of
prefix tokens re-billed at cache-write price when the hook mutates the
conversation. B4 never measured that; it is billing data, not tokenizer data.
What is missing, in order:

1. Per-rewrite cache-creation token count as a function of prefix length
   (the net-positive spec's harness has the raw material;
   `wiki/syntheses/saver-cache-churn` measured the NET effect 0.93–0.97× but
   not the per-rewrite churn term).
2. The price ratio cache-write vs cache-read (~12.5×) to convert churn into
   the byte-saving a rewrite must beat.
3. A spec-level decision (net-positive spec owns the cost axis) whether the
   floor applies to MCP/exec paths at all — Track A deliberately left those
   unguarded until B1's signed delta reports inflation frequency. That
   sequencing is correct: measure first, gate second.

One more B4 caveat for whoever picks the number: cl100k_base is a proxy, not
the provider's tokenizer; for a byte-space floor that doesn't matter, but any
token-space threshold inherits the JSON-class error.

---

## Environment note (not attributable to any track)

`apps/cli` full suite at HEAD: 1436 passed, 2 failed + 3 file-load failures —
ALL from `@megasaver/gui/bridge` being unresolvable in this worktree
(`apps/gui` exports `./bridge` → `dist-bridge/index.js`, which the cached
build did not produce). Affects `gui.test.ts`, `firewall.test.ts` (its 1
failure is the same import chain), `handoff-registration`, `init`,
`version-source`. Unrelated to Tracks A/B/C (none touch gui); rebuilding
`apps/gui` should clear it. Track-relevant suites are green:
output-filter 491/491, retrieval 50/50, `apps/cli/test/hooks/saver.test.ts`
64/64, stats 262/262, context-gate 373/373, bench-replay 155/155.
