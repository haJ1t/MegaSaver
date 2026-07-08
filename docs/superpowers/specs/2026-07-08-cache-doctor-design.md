---
title: Pro module 9 — prompt-cache doctor (mega cache)
date: 2026-07-08
status: approved
risk: HIGH
scope: a ninth Pro module — a gated top-level `mega cache` command that reads the metering proxy's counts-only usage log (`usage.jsonl`), groups calls into conversations heuristically, detects four prompt-cache-miss signatures (no-cache, unstable-prefix, ttl-expiry, model-switch), prices what the misses burned in dollars, and prints one-line fixes. Read-only analytics — writes nothing, never reads message content. Token-audit logic per §12 → HIGH.
base: main (0d2e0018)
reviewers: [code-reviewer, critic]
---

# Pro module 9 — prompt-cache doctor (`mega cache`)

## Motivation

Anthropic prompt caching bills a cache write at 1.25× the input price and a
cache read at 0.1×. A client that busts its cache — unstable prompt prefix,
mid-conversation model switch, or turns spaced past the 5-minute TTL — silently
re-pays the whole prefix at 1.25× where a hit would have cost 0.1×. Nobody
surfaces this: it is invisible in the bill and no competitor diagnoses it
(source: wiki/syntheses/pro-differentiation-portfolio.md N2 — "niche economics
expertise; no competitor"). Mega Saver already has the evidence: the opt-in
metering proxy records `cacheReadTokens` / `cacheCreationTokens` per
`/v1/messages` call in `usage.jsonl` — counts and metadata only, never content.
`mega cache` turns that log into "$X burned on cache misses, fix: …".
This is the LOCKED 1.11 slot of the 1.x → 2.0 program.

## Locked decisions (user-approved 2026-07-08)

1. **Four detectors ship in v1**: D1 no-cache, D2 unstable-prefix,
   D3 ttl-expiry, D4 model-switch (user picked the full set over the D1+D2
   subset). All four work from counts only.
2. **Command surface: `mega cache`** — a single top-level command in the
   roi/bench/compress mold (no one-member `cache doctor` namespace). citty
   default-run leaves room for future subcommands without breaking.
3. **Counts-only, honest heuristics.** The proxy stores no message content, so
   conversation grouping is a heuristic (messageCount + time + ordering) and
   the report says so: a `reliable` flag plus a fixed footer caveat, following
   `proxy-usage-savings`'s precedent of suppress-don't-bluff.
4. **Advice-only.** No auto-fix: the client owns prompt construction; Mega
   Saver cannot rewrite another tool's request ordering. Mirrors savings-fix
   R-rows pre-R5.

## Design

### Data flow

```
<storeRoot>/proxy-usage/usage.jsonl          (written by `mega proxy`)
  │  CLI reads lines, parses each against proxyUsageEventSchema
  │  (@megasaver/llm-proxy export); invalid lines are skipped
  ▼
diagnoseCache(events, { now, days, priceUsd })   pure, @megasaver/pro-analytics
  ▼
CacheDoctorReport ──► text render (default) │ raw JSON (--json)
```

- **New file `packages/pro-analytics/src/cache-doctor.ts`** — the pure
  analyzer. Its input element type is declared **structurally** in
  pro-analytics (`CacheUsageEvent`: ts, model, inputTokens, outputTokens,
  cacheReadTokens, cacheCreationTokens, messageCount) so pro-analytics gains
  no `llm-proxy` dependency edge — the same hygiene `@megasaver/stats` used
  for `ProxyUsageTokenCounts`. `ProxyUsageEvent` is structurally assignable
  to it.
- **New CLI command `apps/cli/src/commands/cache.ts`**, registered in
  `main.ts`. The CLI owns all I/O: resolve store root, locate the usage log
  via llm-proxy's usage-log path helper (exported from its public entry; add
  the export if it is not yet public), read + per-line parse + skip-invalid,
  call `diagnoseCache`, render. apps/cli already depends on llm-proxy.

### Constants (true constants, SCREAMING_SNAKE_CASE)

| Const | Value | Why |
|---|---|---|
| `CACHE_WRITE_MULTIPLIER` | 1.25 | Anthropic cache-write price factor |
| `CACHE_READ_MULTIPLIER` | 0.1 | Anthropic cache-read price factor |
| `MIN_CACHEABLE_TOKENS` | 1024 | Anthropic minimum cacheable prefix; doubles as the significance threshold |
| `CACHE_TTL_MS` | 300000 | 5-minute default cache TTL |
| `CHAIN_GAP_MAX_MS` | 3600000 | >60 min gap always starts a new conversation |
| `D1_MIN_TOTAL_INPUT` | 10000 | below this a no-cache conversation is noise, not a finding |

Price: the house flat estimate `INPUT_PRICE_PER_MTOK_USD` (3.0, from
`@megasaver/stats`), overridable via `opts.priceUsd`; the text render carries
the house price footnote. No per-model price table (non-goal).

### Conversation grouping (heuristic)

Sort events by `ts` ascending. An event **starts a new conversation** when any
of: (a) it is the first event; (b) its `messageCount` ≤ the previous event's
(a real conversation's count strictly grows; a reset or unrelated call breaks
the chain); (c) the gap to the previous event exceeds `CHAIN_GAP_MAX_MS`.
A **model change does NOT break the chain** — D4 exists to price exactly that.
Interleaved parallel conversations can mis-group; that is the caveat the
`reliable` flag and footer disclose. `reliable` is `false` when the window
holds fewer than 20 events or fewer than 3 conversations — too little data to
advise on; the renderer then prints counts but suppresses the burned-$
headline (suppress-don't-bluff).

### Detectors

Turn 1 of a conversation is exempt everywhere (the first cache write is the
legitimate price of admission). Let `P = priceUsd / 1e6` ($ per token),
`priorWritten_i` = Σ `cacheCreationTokens` of turns 1..i−1.

**D1 `no-cache`** (conversation-level): every turn has
`cacheReadTokens = 0 ∧ cacheCreationTokens = 0`, the conversation has ≥ 2
turns, and Σ `inputTokens ≥ D1_MIN_TOTAL_INPUT`. The client is not using
prompt caching at all; every turn re-bills the shared prefix at full price.

- `missedTokens = Σ_{i≥2} min(input_i, input_{i−1})` — the reusable-prefix
  lower bound (counts-only cannot see the true shared prefix; `min` of
  consecutive input loads is a conservative floor).
- `burnedUsd = max(0, missedTokens × P × (1 − CACHE_READ_MULTIPLIER)
  − min(input_2, input_1) × P × (CACHE_WRITE_MULTIPLIER − 1))` — what full
  price cost over cached reads, minus the one-time 0.25× write premium the
  client never paid.

**D2/D3/D4** (turn-level, mutually exclusive, priority **D4 > D3 > D2**, at
most one per turn): a turn `i ≥ 2` triggers when the conversation had a cache
(`priorWritten_i ≥ MIN_CACHEABLE_TOKENS`) yet this turn read almost nothing
back and re-wrote a significant prefix:
`cacheReadTokens_i < MIN_CACHEABLE_TOKENS ∧ cacheCreationTokens_i ≥
MIN_CACHEABLE_TOKENS`. Writing *new* content to cache is normal and never
flagged — only the re-paid portion counts:

- `rePaidTokens = min(cacheCreationTokens_i, priorWritten_i)`
- `burnedUsd = rePaidTokens × P × (CACHE_WRITE_MULTIPLIER −
  CACHE_READ_MULTIPLIER)` — paid a 1.25× write where a 0.1× read should have
  sufficed.

Classification of a triggered turn:

| Detector | Condition | Fix line |
|---|---|---|
| **D4 `model-switch`** | `model_i ≠ model_{i−1}` | switching models mid-conversation abandons the cache (it is per-model); switch at conversation boundaries |
| **D3 `ttl-expiry`** | gap to previous turn > `CACHE_TTL_MS` | gaps over 5 min expire the cache; batch follow-ups within the TTL or use the 1-hour cache option |
| **D2 `unstable-prefix`** | otherwise | keep the prompt prefix byte-stable across turns (system prompt, tool definitions, early messages) — any edit or reorder above the cache point rewrites everything after it |

D1's fix line: enable prompt caching in your client (`cache_control` on the
system prompt/tools) — repeated prefixes are re-billed at full price every
turn.

D1 is structurally exclusive with D2–D4 (it requires zero cache activity in
the whole conversation; the others require a prior write).

### Report shape

```ts
export interface CacheDoctorReport {
  windowDays: number;
  since: string;                 // ISO
  until: string;                 // ISO (now)
  calls: number;
  conversations: number;
  inputTokens: number;           // uncached input (API input_tokens excludes cache fields)
  cacheReadTokens: number;
  cacheCreationTokens: number;
  hitRate: number;               // cacheRead / (input + cacheRead + cacheCreation); 0 when denominator 0
  findings: CacheFinding[];      // one row per detector that fired, D1..D4 order
  burnedUsdTotal: number;
  reliable: boolean;
}
export interface CacheFinding {
  detector: "no-cache" | "unstable-prefix" | "ttl-expiry" | "model-switch";
  conversations: number;         // distinct conversations affected
  occurrences: number;           // conversations (D1) or triggered turns (D2–D4)
  missedTokens: number;          // D1 missedTokens / D2–D4 Σ rePaidTokens
  burnedUsd: number;
  advice: string;
}
```

### CLI surface

```
mega cache [--days <n>] [--json] [--store <dir>]
```

- `--days` — window, integer ≥ 1, default 7 (diagnosis is about recent
  behavior; roi/forecast's month framing does not fit a doctor).
- Entitlement: `checkEntitlement("savings-analytics", …)`; free tier prints a
  `CACHE_UPSELL` line and exits 0 (house pattern, `COMPRESS_UPSELL` mold).
- No usage log, or zero events in the window: print
  `no proxy usage recorded — enable metering with \`mega proxy\` and route
  your agent through it` and exit 0. Absence of data is not an error.
- Malformed JSONL lines: skipped (per-line schema parse; a corrupt tail from a
  crashed writer must not kill the report).
- Text render: header `Prompt-cache doctor — last N days`; a totals line
  (calls, conversations, hit rate); the headline
  `$X.XX burned on cache misses` (suppressed when `reliable` is false — raw
  counts still print); one line per finding
  (`unstable-prefix: 3 conversations · 412K tokens re-paid · ~$1.42 — fix: …`);
  when data exists and nothing fired:
  `cache healthy — hit rate 87%, nothing burned`; footer = grouping caveat +
  house price footnote.
- `--json`: the raw `CacheDoctorReport`, nothing else on stdout.

### Error handling

Boundary validation only (§8): CLI validates `--days` (positive integer) and
parses each JSONL line against `proxyUsageEventSchema`, skipping failures.
Inside `diagnoseCache`, inputs are trusted; arithmetic clamps (`max(0, …)`)
guarantee no negative dollars and no NaN/Infinity (divide-by-zero → 0,
mirroring `computeRoi`'s ratio rule).

## Security / risk (HIGH)

- **Read-only.** Writes nothing anywhere. No repo files, no store mutation.
- **Privacy-preserving by construction.** The input log contains counts and a
  sanitized model label only — the proxy never persists prompts or messages,
  so the doctor cannot leak content even in `--json`.
- **Honest numbers.** Burned-$ uses conservative floors (`min`-bounds,
  clamped premiums) and a flat house price estimate with the standard
  footnote; the `reliable` flag suppresses the headline on thin data.
  Overstating waste would be the module's own credibility bug — treated as a
  correctness requirement, not polish.
- Threat surface: a hostile `usage.jsonl` (attacker-writable store) could
  inflate numbers shown to the user — same trust boundary as every existing
  stats consumer; per-line schema validation bounds field types/sizes.

## Testing (TDD)

Pure analyzer (`packages/pro-analytics/test/cache-doctor.test.ts`),
table-driven with synthetic event arrays:

- **Grouping**: messageCount reset starts a new conversation; equal
  messageCount breaks the chain; >60 min gap breaks; model change does NOT
  break; out-of-order timestamps are sorted first.
- **D1**: fires on ≥2-turn zero-cache conversation with Σ input ≥ 10000;
  does NOT fire below the floor, on 1-turn conversations, or when any cache
  activity exists; missedTokens/burnedUsd pinned by exact arithmetic
  (including the write-premium subtraction and the `max(0, …)` clamp).
- **D2/D3/D4**: trigger boundary at 1023/1024 for both `cacheReadTokens` and
  `cacheCreationTokens`; `priorWritten` floor respected; `rePaid` capped at
  `priorWritten` (new-content writes never counted); priority pin — a
  triggered turn with model change AND >5 min gap classifies as
  `model-switch`; gap boundary exactly at `CACHE_TTL_MS`; turn 1 never
  flagged; burnedUsd pinned (`rePaid × P × 1.15`).
- **Report**: hitRate divide-by-zero → 0; `reliable` thresholds (19 events /
  2 conversations → false; 20/3 → true); findings ordered D1..D4;
  burnedUsdTotal = Σ findings.
- **CLI** (`apps/cli/test/commands/cache.test.ts`): free tier → upsell, exit
  0, log never read; missing log / empty window → friendly note, exit 0;
  malformed lines skipped without crashing; `--days` validation (0, negative,
  non-numeric → stderr + exit 1); `--json` shape pin; text render pins
  (headline, suppressed-when-unreliable, healthy line); real-fs smoke: write
  a fixture `usage.jsonl` with a known miss pattern, assert the rendered
  dollars.

## Non-goals (deferred)

- Auto-fix / `--apply` — the client owns prompt construction.
- Per-model price table — flat house estimate + footnote (consistent with
  every other module).
- Live watch mode / proxy-side real-time detection.
- Reading message content to compute true shared prefixes — never; the
  counts-only privacy property is load-bearing.
- Proxy/dataplane changes — `usage.jsonl` already carries everything needed.

## Slices

1. **Analyzer** — `cache-doctor.ts` (types, constants, grouping,
   detectors, report) + full table tests. Pure, no I/O.
2. **CLI** — `mega cache` command (gate, log read, render, flags) +
   tests; llm-proxy path-helper export if needed; register in `main.ts`.
3. **Docs** — README command section, `.changeset` (`@megasaver/cli` minor →
   1.11.0), wiki entities/cli module-9 bullet + log entry.
