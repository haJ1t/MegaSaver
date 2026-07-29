---
title: Saver Root Cause — why compression neither saves nor stays lossless
tags: [saver, root-cause, architecture, token-savings, recovery, audit]
sources:
  - apps/cli/src/hooks/saver.ts
  - packages/context-gate/src/record-output.ts
  - packages/context-gate/src/resolve-saver-settings.ts
  - packages/output-filter/src/{types,fit,normalize,tokens}.ts
  - packages/context-gate/src/recovery-footer.ts
  - measured runs 2026-07-28 (recordAndFilterOverlayOutput driven over dist/)
status: active
created: 2026-07-28
updated: 2026-07-28
---

> **Companion page.** [[syntheses/token-saver-root-cause-2026-07-28]] is an
> independent same-day audit by another agent, written without knowledge of this
> one. It reaches the same architectural conclusions and carries a wider defect
> inventory (dedupe on the passthrough band, daemon-timeout double count,
> prose/json compressor lossiness — now spec items B10–B12). This page is the one
> with measured receipts and with the refuted-claims list. Neither supersedes the
> other; both are cited by the approved spec.

## TL;DR

Three **design-level** causes, not bugs. (1) The eligibility floor and the output
budget are the same number, so the pipeline is a fixed-size truncator whose ratio
is decided by input size, not by content redundancy. (2) Delivered line numbers
and stored recovery chunks live in two different coordinate systems, so expansion
fetches the wrong content and costs more than the original read. (3) The
already-documented in-place `tool_result` rewrite fights the client's native
prompt cache ([[syntheses/saver-cache-churn]]).

## A. Why the ratio cannot reach 60–90%

`minBytesFor` returns `modeToBudget(mode)` for the six original tools
(saver.ts:52-57); `record-output.ts:145` passes `maxReturnedBytes:
modeToBudget(input.mode)`. Same number on both sides. `fitBudget` packs greedily
*up to* that budget (fit.ts: `if (used + cost > budget) continue`) — it targets
full, never minimal. So `ratio = 1 - budget/rawBytes`.

Measured (2026-07-28, `recordAndFilterOverlayOutput` over `dist/`, TS source input):

| mode | floor=budget | 6 KB | 12.5 KB | 25 KB | 50 KB | 100 KB | 250 KB |
|---|---:|---:|---:|---:|---:|---:|---:|
| aggressive | 4 KB | 28.0% | 65.4% | 82.5% | 91.2% | 95.6% | 98.2% |
| balanced | 12 KB | gate-skip | 3.7% | 50.3% | 74.9% | 87.5% | 95.0% |
| safe | 32 KB | gate-skip | gate-skip | gate-skip | 34.5% | 67.4% | 86.9% |

`returnedBytes` is flat at the budget in every row (4.3 KB / 12.5 KB / 32.6 KB).

**Scope of that curve.** It holds when the returned text actually reaches the
budget — true for low-redundancy input (source files, i.e. the common Read case).
Highly redundant input can beat it: the section-B log (25 KB, 800 repeated lines)
returned 2.8 KB / 88.9% in balanced, because `collapseRepeatedLines` got there
before the budget mattered. So the binding constraint on exactly those cases is
not the budget but the **floor** — under `DEFAULT_MODE = "safe"` a 25 KB log never
reaches the collapse passes at all. That floor is a one-line config value, not a
redesign.

Compounding: `DEFAULT_MODE = "safe"` (resolve-saver-settings.ts:44) ⇒ a 32 KB
floor. Nothing smaller is ever touched. Bash uses `BASH_COMPRESS_FLOOR = 24_000`
(saver.ts:33) against Claude Code's ~30 000-char truncation ceiling — a ~6 KB
window. Typical Read/Grep/Bash payloads sit well below both ⇒ 0% on the majority
of tool calls.

Also: category compressors (vitest/tsc/json) are gated off for file sources
(types.ts:266-274), so a **Read never runs a compressor** — its only mechanism is
drop-chunks-until-budget.

## B. Why the save is lossy and can cost more than the raw output

Delivered excerpts and `… [lines X-Y omitted]` markers are numbered in
**post-collapse / post-compressor** space (types.ts:192, 261-274, 370;
record-output.ts:91-107). Stored recovery chunks index `redactedText` —
**pre-collapse, pre-compressor** (record-output.ts:181-183). The footer publishes
only "~40 lines each, i = 0..N-1" (recovery-footer.ts:43-46); the code comment
admits no line→id formula can be given.

Measured proof (1700-line build log: 800 repeated + 900 distinct lines, balanced):

- delivered marker: `… [lines 146-902 omitted]`
- only published rule (~40 lines/chunk) → chunk 3
- chunk 3 actually holds raw lines 121-160, content `[info] heartbeat ok` — noise,
  not the omitted stack frames. The correct chunk is ~23.

Every recovery on collapsed output mis-addresses; the agent probes further and the
compressed view + N blind expansions exceed the original read. This is the same
shape as [[syntheses/saver-savings-gaps]] C13 (10.4 KB file → 991 tok + ~2600 tok
sliced re-reads), recorded there as FIXED — the fix stopped re-compression of the
escape hatch; **addressability was never fixed and is still broken in current code.**

### B1. Silent evidence loss
`collapseRepeatedLines` (normalize.ts:22-35) emits `… [repeated N times]` as its
own line ⇒ its own chunk candidate ⇒ droppable by `fitBudget`. In the measured run
it *was* dropped (`… [lines 2-2 omitted]`): the model saw one `[info] heartbeat ok`
with no indication 800 existed. The count evidence vanishes without a marker.

### B2. Grep/Glob array corruption
saver.ts:183-186 splits the whole compressed text back into `filenames: string[]`,
so the array gains non-path entries (`"144 kept, 758 dropped"`, the footer line)
while `numFiles` (preserved via `...o`) still reports the true count. Corruption,
not just loss.

## C. Metrics honesty (secondary)

`filterOutput`'s own `returnedBytes`/`savingRatio` (types.ts:346-352) count summary
+ excerpt text only — they exclude the D16 gap markers and the recovery footer.
`record-output.ts:226` recomputes honestly, so hook stats are fine; every other
consumer publishes the inflated number: `read.ts:188` (`filterRaw`),
`run-command.ts:256` and `:527`, `bench.ts:184`.

The GUI is **not** in that list: `session-saver-stats.tsx` / `overview-page.tsx`
render aggregates fetched through `claude-sessions-client.ts`, which come from the
overlay-event store that `record-output.ts:272-295` writes with the honest
post-footer numbers.

## D. Contradictions with existing wiki pages

1. [[syntheses/saver-cache-churn]]:145-148 claims saver-run.ts wires
   `saverPausedByNetEffect`. **No such symbol exists.** Net-effect records are read
   only by `doctor-saver.ts` and `session/saver/resolve.ts` — diagnostic, never
   enforcement. Only the seen-hash ledger is wired.
2. The same page attributes task_1's run-2 no-op to "saver state carry-over between
   runs". `saver-seen.ts:20` keys the ledger at
   `stats/<wk>/saver-seen/<sessionId>.json` — session-scoped. Unless the harness
   reuses session ids, that cause is wrong and the run-2 no-op is unexplained; the
   "no stage can be validated with this harness" conclusion rests on it.

## E. Current state — no field telemetry exists

- `~/.claude/settings.json` (2026-07-28) carries no MegaSaver hook, only
  `herdr-agent-state.sh`.
- The only store, `~/.local/share/megasaver` (created 2026-07-28 01:06), holds the
  Agent Office seed plus `projects.json`/`sessions.json` — no `stats/`, `content/`,
  `evidence/`, or activation record.

⇒ The saver is not active on this machine. Every savings number in the wiki comes
from the benchmark harness, never from a real session. Any remediation is blind
until real-session telemetry exists.

## Verdict

Architecture, not a bug: floor == budget; delivered space ≠ stored space; in-place
rewrite vs native cache. B1/B2/C are real defects sitting on top, but none of them
is the reason the product misses its target.

## Outcomes (updated 2026-07-29, Track B)

Track B (`feat/saver-b-accounting`) landed the W0 observability layer and the
three evidence-loss compressors against the A1 contract:

- **B1 signed savings:** `deltaBytes`/`deltaBytesTotal` on both event+summary
  schemas; inflation now produces a NEGATIVE aggregate in `mega audit` (gate
  demonstrated). Legacy clamped fields kept one minor version.
- **B2 model-facing bytes:** `model-facing-bytes.ts` created+exported
  (summary + excerpts + gap markers + footer + MCP envelope); Track A wires.
- **B3 recovery debt:** `fetchChunk` appends a signed expansion event
  (`kind:"expansion"`, `deltaBytes = -fetched`); signed aggregates are NET.
- **B4 real tokenizer:** `countTokens` (cl100k_base, lazy) at the reporting
  boundary; divergence measured — code 0.975, prose 1.013, json 1.193,
  turkish 0.961 (bytes/4 understates JSON ~19%).
- **B5 field telemetry + fresh-store enforcement** in bench-replay.
- **B6–B9:** compressTsc silent drop, classifier over-reach, go-test panic
  drop, prose/json dishonest promises — all fixed red→green.
- **B10 daemon-timeout double count:** diagnosed, fix reported (deterministic
  event id + store-level idempotency); owner: saver-run.ts.

Remaining from this page's inventory: dedupe-on-passthrough (spec B10) —
unassigned to any track; stdout/stderr single-stream gate (spec B8) — Track A
territory (saver.ts is Track C's; see work-split).
