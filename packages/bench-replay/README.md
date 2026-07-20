# @megasaver/bench-replay

Records one Claude Code conversation's `/v1/messages` request bodies, then
replays that frozen sequence against the real Anthropic API as two arms —
**baseline** (as recorded) and **megasaver** (each `tool_result` rewritten by the
real shipped saver hook) — and reports `baseline ÷ megasaver` on normalized cost.

It exists to resolve a **≤5% cost effect**. That is a demanding target for an
instrument, and most of this document is about where the instrument stops.

> **Governing principle: a measurement tool that silently drifts is worse than no
> tool.** Every guard here prefers refusing a verdict over emitting one it cannot
> vouch for. A refusal is the harness working, not the harness broken.

---

## What it measures

**The saver's direct input-side token and cache effect on one frozen
conversation.** Both arms replay the identical turn sequence; the only difference
between them is the bytes the saver removed from `tool_result` blocks. That byte
delta, and its knock-on effect on `input` / `cache_creation` / `cache_read`
tokens, is what the ratio prices.

Compounding **is** measured: the Messages API resends the whole history each
turn, so a `tool_result` compressed at turn 3 is smaller in every later request
too, and the harness prices all of them. This is a common assumption about what
replay misses; it does not miss it.

## What it does not measure

**Any effect the saver has on agent *behaviour*.** If compressed output causes
the agent to take fewer turns (clearer signal) or more turns (re-reading what was
elided), none of that appears here — the trajectory is frozen by construction.
That behavioural effect is plausibly the larger prize, and measuring it needs
high-N end-to-end runs, not replay. Do not quote this harness on it.

---

## The counterfactual-trajectory caveat

**The recording's assistant turns were produced by an agent reading
*uncompressed* tool output. The megasaver arm replays those same turns while
feeding it *compressed* output.** That conversation never happened and could not
have: it depicts an agent that saw a 4 KB summary yet reasoned and acted exactly
like one that saw 100 KB.

Which way does this bias the ratio? Two separate answers, and conflating them is
how a number gets misquoted:

**As an input-side measurement of this conversation: no bias.** The turn sequence
is held identical across both arms, so it cancels. The only thing priced
differently between the arms is the bytes the saver removed, and those bytes are
real and correctly counted. Within its stated scope the counterfactual cannot
contaminate the number.

**As a proxy for what the saver would save in a live session: biased
optimistic — treat the ratio as an upper bound, not an estimate.** The reasoning:

- The mechanism with a concrete causal path runs *against* the saver. Compression
  removes bytes the agent may need, and the recovery footer explicitly invites it
  to fetch them back (`mega output chunk …`). Every such recovery turn is a
  *whole extra request* that resends the entire conversation history at full
  price. A frozen trajectory contains exactly zero of them, so the harness omits
  the saver's principal cost channel while counting all of its savings.
- The offsetting channel — compressed context making the agent *more* efficient,
  finishing in fewer turns — is the product's thesis, not an observation. It is
  a hoped-for behavioural effect with no mechanism this harness can exhibit.
- Absent evidence, an asymmetry in the *quality* of the two arguments is itself
  evidence. Recovery turns follow mechanically from removing bytes; efficiency
  gains do not follow mechanically from anything.
- A second, smaller channel points the same way: replay pins the exact tool-call
  multiset an *uncompressed* run produced. A live compressed agent might issue
  different, broader, or repeated tool calls, which the saver would then face
  under different conditions. Direction unknown, magnitude unknown, but it is
  another way the replayed megasaver arm is easier than the real one.

So: the ratio answers "how much smaller are the prompts?" honestly, and answers
"how much cheaper is the session?" optimistically.

---

## Other scope limits, all load-bearing

**Generation is capped to `max_tokens: 1` on both arms.** The replay never uses
generated text — assistant turns come from the recording — so resampled output is
pure cost and pure noise (~26% of arm cost at $25/Mtok; simulation put sd at
3.78% on the combined ratio, enough to report a true 5% saving as a net *loss*
15.5% of the time). **Reported output tokens are therefore an artifact of the
cap, not behaviour**, and the ratio is an input-side comparison, not end-to-end.
The cap is safe for the measurement because `max_tokens` takes no part in the
prompt-cache key.

**Costs are priced at fixed standard rates from `scripts/benchmark-rates.json`,
at a single model's card** ($5 / $10 / $0.50 / $25 per Mtok). A recording contains
*every* `/v1/messages` call the agent made, including Claude Code's sidecar Haiku
calls (conversation titling and similar), which are replayed at their recorded
model but priced as the primary one — roughly 6x their true cost. Those calls
carry no `tool_result`, so they are byte-identical in both arms and **drag the
ratio toward 1.00 carrying inflated weight**. The direction is conservative (the
saver is *under*-reported) and the magnitude is bounded by their share, which the
runner now prints as a per-model histogram on every recording it loads. It is
disclosed, not corrected: repricing would mean per-model rate cards inside a cost
function other benchmarks share, and excluding the sidecar calls would mean
silently dropping recorded traffic from a replay.

---

## KNOWN-UNVALIDATED — read before quoting any number

**This harness has never been run against the real API.** Everything below the
unit tests is unexercised.

- **Prompt-cache nondeterminism is untested and unquantified.** Anthropic's
  prompt caching is best-effort: the same bytes that returned `cache_read`
  moments earlier can return `cache_creation` on a later request. That is a **20x
  price swing** ($0.50 vs $10 per Mtok) on the affected segment. Nothing in the
  harness currently measures this, and the order check (which replays both arm
  orders and averages) bounds *systematic* cache-warming asymmetry, not this
  per-request flakiness.
- **Residual input-side variance is therefore unknown.** Since the effect being
  resolved is ≤5% and a single cache-class flip can dwarf it, **no ≤5% claim is
  supportable yet.** Establishing one requires real-API repeat runs measuring
  run-to-run spread on an unchanged recording.
- **The record path has not been adversarially reviewed.** `capture-proxy.ts` and
  `record-command.ts` decide what ends up in the recording at all; a defect there
  is upstream of every guard described here.
- **The cost function has not been adversarially reviewed.** `normalizedCostUsd`
  in `@megasaver/stats` converts usage to the dollars the entire ratio is built
  on.

---

## What the guards actually check

Two questions, deliberately answered at different levels, because round 4 of
review established that answering both with conversation-wide aggregates cannot
work — the aggregate axes trade off freely, so any destructive transform can be
moved inside any band by shrinking its blast radius.

**Per call — "is this a real compression?"** (`prepareArms`, before a single
request is sent.) Every output the saver reports applying must carry the recovery
footer and be strictly smaller than the raw it replaced. Both are guarantees the
saver itself enforces: `apps/cli/src/hooks/saver.ts` passes `includeFooter: true`
and returns an updated output only for a `"compressed"` decision, and
`record-output.ts`'s net-negative guard degrades to passthrough rather than
returning a replacement that is not smaller. An applied output missing either did
not come from a compression — it is content loss, or a different transform
wearing the saver's name. One bad call is refused regardless of how many good
ones surround it, and the refusal names the offending `tool_use_id`s.

**Per conversation — "is there enough here to resolve anything?"**
(`checkTransformIntegrity`.) `1 - byteRatio` bounds the input-side cost effect
from above, so a transform that moved under 5% of the tool_result bytes cannot
reach the band this harness exists to resolve, whatever number it would print.
Hence `MAX_BYTE_RATIO = 0.95`, derived from the question rather than fitted to an
escape. It is the **only** aggregate threshold, deliberately. Two others were
removed for the same reason — each stood in for a question it could not answer,
and each refused honest measurements as a side effect:

- **No byte floor.** It meant "a real compression rather than deletion"; the
  per-call contract answers that directly. Its only remaining effect was to
  reject the regime the saver is best in — the saver fits output to an
  *absolute* budget (aggressive 4000 B), so `byteRatio ≈ budget/original` falls
  as outputs grow, and a conversation of 100 KB outputs measures 0.039.
- **No applied-fraction floor.** It meant "the saver actually did something", and
  was redundant wherever it fired correctly: 1 tiny call of 100 lands at
  `byteRatio ≈ 0.999` and the ceiling refuses it anyway. Where it fired at all it
  was wrong — the same 1-of-100 fraction with one *large* output reaches
  `byteRatio 0.5`, which is squarely resolvable. That shape is the normal one,
  not an exotic case: the saver's per-tool `minBytesFor` floors mean most small
  outputs legitimately pass through, so a low applied fraction beside a large
  byte movement is what a healthy run looks like.

`applied` / `passthrough` counts and the applied fraction are still **reported**
on every verdict — a passthrough-heavy run is worth seeing. They just do not
decide anything.

---

## Usage

```bash
# Both commands spend real money.
node scripts/bench-replay.mjs record --out <dir> --repo <dir>
node scripts/bench-replay.mjs replay --recordings <dir> --mode <safe|balanced|aggressive>
```

The recording must be captured with the saver's hooks **off**
(`mega session saver default disable`). A recording made with them on already
contains compressed `tool_result`s: the "baseline" arm would secretly be a
megasaver run and the megasaver arm a double compression, collapsing the ratio
toward 1.00 and reading as a clean "no effect". `assertUncompressedRecording`
refuses that case by looking for the saver's own footer.
