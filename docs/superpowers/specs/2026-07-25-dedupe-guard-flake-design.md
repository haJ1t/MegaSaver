---
title: Stop the dedupe growth-ratio guard flaking on CI
status: proposed
risk: HIGH
created: 2026-07-25
package: "@megasaver/output-filter"
found-by: CI on PR #305 (docs-only change, run 30171707912)
---

# Dedupe growth-ratio guard flake

> HIGH — this guard is the only thing standing between a restored
> O(n²) dedupe scan and a shipped DoS-class regression. Loosening it
> wrongly is worse than the flake.

## §1 What happened

`packages/output-filter/test/dedupe-quadratic.test.ts` failed on
ubuntu-latest with `expected 3.178029923672654 to be less than 2.75`.
The PR was **docs-only** (three markdown files), so the change cannot
be causal. windows-latest passed the same commit; a re-run passed.

## §2 The originating report was wrong, and acting on it would regress us

The chip that opened this task said: *"the repo already solved this in
#301 (`gate ReDoS bound on a ceiling, not a growth ratio`) — apply the
same treatment."*

**That is backwards for this file.** This guard shipped with a 5 s
ceiling and was deliberately moved OFF it, in the same backlog commit
`07a4e3dc`, with measurements recorded in the file:

> this guard shipped with a 5 s ceiling at 128k lines and documented the
> reverted cost as 13.5 s (the changeset said 17.4 s — the two never
> agreed). Reproduced on the machine that wrote them […] the reverted
> scan costs 6.8 / 6.9 / 7.7 s: a 1.4x margin, not the 2.7x claimed. A
> machine ~1.5x faster — or a cheaper BigInt path in a future Node —
> greens this guard with the quadratic scan restored.

So the ceiling's failure mode here is **silent green with the defect
restored**, which is strictly worse than a false red. Re-applying #301
to this file would reintroduce exactly that. #301 was right for
`session-hints` (six orders of magnitude of separation); it is wrong
here. The repo deliberately runs both patterns, chosen per test by
measurement — `session-hints-redos.test.ts` even opens with "Why an
absolute ceiling and not a growth ratio", the mirror of this file's
"Why a growth RATIO and not a wall-clock ceiling".

## §3 Measurements (this machine, node v25.8.2, 10 cores)

Taken through the guard's own harness — warm-up, 3 trials, minimum per
side — repeated 5x.

| condition | ratio | half | full |
|---|---|---|---|
| linear (shipped), idle | 1.999 – 2.024 | ~102 ms | ~206 ms |
| linear, 2x core oversubscription | 1.838 – 2.104 | ~284 ms | ~530 ms |
| **quadratic restored (all-pairs)** | **3.916 – 3.992** (4/4) | ~4.5 s | ~18 s |

Two things follow.

**The ratio is robust to uniform CPU load.** At 2x oversubscription both
samples inflated ~2.8x and the ratio did not move — it even drifted
*down*. The file's central claim ("load and CPU speed move both samples
together") reproduces. My own chip's stated root cause — "scheduler
noise and GC pauses affect the two measurements unequally" — **does not
reproduce** and should not be treated as established.

**The threshold still discriminates.** 2.75 sits 1.31x above the worst
linear reading I could produce and 1.42x below the best quadratic one.
The quadratic is also 40–90x slower in absolute terms (18 s vs 206 ms),
so a restored defect is never subtle.

## §4 Root cause: not reproduced, and this fix does not claim it

I could not reproduce 3.178. Uniform contention is ruled out (§3).
Remaining hypotheses, none confirmed: memory pressure on a 2-core
runner where the `full` sample allocates twice as much and is therefore
hit harder by GC; or a burst of interference lasting longer than the
whole measurement window, which `min`-of-3 cannot filter by
construction.

Stating this plainly matters because the anti-pattern list forbids
silent retries on an undiagnosed error. What follows is a *bounded,
documented* mitigation with a proof that it cannot mask the defect —
not a retry standing in for a diagnosis.

## §5 Decision — `retry: 3`, the idiom this file is missing

Every other timing guard in the repo already carries it:
`policy/glob-redos`, `context-gate/session-hints-redos`,
`core/project-rule-ranking`, `policy/redact-jwt`. This file does not.
That is the whole gap.

Why it is safe here, from §3 rather than from argument: a restored
quadratic reads 3.92–3.99 on every measurement and never approaches
2.75. To survive `retry: 3` it would have to read below 2.75 on one of
four attempts. The four measured attempts read 3.929 / 3.897 / 3.831 /
3.885; the lowest is 1.39x the threshold, so passing needs a reading
~30% below anything the defect has produced, while still taking ~18 s
per full sample. Verified by running the guard with the
all-pairs scan restored *and* the retry in place (§7).

### Rejected alternatives

- **Convert to a ceiling (the chip's proposal)** — §2. Reintroduces the
  silent-green hole the ratio exists to close.
- **Raise `MAX_GROWTH`** — the observed CI linear reading is 3.178 and
  the quadratic is 3.92. Any threshold above 3.178 leaves under 1.24x
  separation. That trades a visible flake for an invisible blind spot.
- **More trials** — `min` per side already converges; more samples do
  not help against interference that spans the whole window, which is
  the only surviving hypothesis (§4).
- **Add a ceiling *alongside* the ratio** — tempting (18 s vs 206 ms is
  a huge second signal), but it re-litigates a decision made with
  measurement two commits ago, and nothing in §3 shows the ratio failing
  to discriminate. Not needed to fix the reported flake.

## §6 Sibling guards — same class, same gap

Two other growth-ratio guards exist and **also lack a retry**:

- `packages/content-store/test/prune-scan-cost.test.ts` (`MAX_GROWTH = 3`)
- `packages/policy/test/redact-redos.test.ts` (`MAX_GROWTH = 2.75`)

The retry idiom was applied to the repo's *ceiling* guards and never to
its *ratio* guards, though PR #305 showed ratio guards are just as
exposed to CI transients. Deliberately NOT changed here: adding a retry
to a guard whose margin I have not measured could mask a thin-margin
regression, and each needs its own measurement. Flagged for follow-up
rather than swept in.

## §7 Definition of Done

1. Guard carries `retry: 3`; nothing else about it changes — same
   threshold, same trials, same sizes.
2. The measurements in §3 are recorded in the test comment.
3. Proven load-bearing: with the all-pairs scan restored the guard
   still fails, with the retry active, on every attempt.
4. `pnpm verify` green.
5. `critic` pass, fresh context.
6. Changeset (patch), `wiki/log.md`.
