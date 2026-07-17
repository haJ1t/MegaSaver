---
title: Reserve the from-session ledger keyword namespace (denial-of-capture fix)
risk: MEDIUM
status: approved
created: 2026-07-17
source: i14 gauntlet critic finding #5
---

# Reserve the `from-session:` ledger keyword namespace

## The weakness (denial-of-capture, agent-facing)

The idempotence ledger keys on the keyword `from-session:<failureId>:<contentHash>`
(`DEDUPE_KEYWORD_PREFIX` + `dedupeKeyword`). `runAutopilot`'s dedupe scan
(`autopilot.ts:73-77`) reads keywords across **all** memory entries — regardless
of approval or who wrote them — and skips any candidate whose ledger keyword
already appears. `from-session` (CLI + MCP) does the same.

Agent-facing surfaces accept **arbitrary** keyword strings:
- `save_memory` MCP (`save-memory.ts:48,136`) — `keywords: z.array(z.string())`
- `mega memory create` (`create.ts:172`)
- `mega memory update` (`update.ts:155`, replace)
- `brain import` (`brain-import.ts:49-50`, spreads imported `keywords`)

So an agent can pre-write `from-session:<failureId>:<contentHash>` onto any
memory and make autopilot (and from-session) **silently skip that legitimate
recurring lesson** — `{autoApproved:0, staged:0, skippedExisting:1}`. Impact is
**denial** (a real lesson never gets captured), not forgery. Reachable by an
agent for its own failures (it knows their id + contentHash).

This is a pre-existing property of the from-session ledger that autopilot
inherits; it did not block the i14 merge, tracked as a follow-up.

## Why the shared namespace can't just be split

The ledger is deliberately **one shared namespace**: from-session CLI, from-session
MCP, and autopilot all write and scan the same `from-session:` keyword so any one
writer skips a candidate another already captured (architect m6 — that's the whole
point of promoting `DEDUPE_KEYWORD_PREFIX` to a core export). Giving autopilot a
*different* ledger keyword would stop it deduping against from-session captures and
**reintroduce duplicate rows** — the exact thing the ledger prevents. So the fix
must keep one shared namespace.

## Why not filter the dedupe scan by provenance

The critic's alternative — "only trust ledger keywords on rows carrying provenance
the agent can't forge" — is not cleanly implementable: from-session rows carry no
unforgeable marker (`source`, `approval: "suggested"`, and the ledger keyword are
all agent-forgeable via `save_memory`). There is no forge-proof field on a
from-session row to gate the scan on. So gating the scan can't distinguish a real
ledger entry from a forged one.

## The fix: reserve the namespace at every non-internal write boundary

Make `from-session:` a **reserved keyword namespace** that only the internal ledger
writers (from-session, autopilot) may place. Every path that admits external /
agent-supplied keyword data strips reserved-prefix keywords before the write:

- **Core:** two helpers beside `DEDUPE_KEYWORD_PREFIX` / `dedupeKeywordFor` in
  `session-memory.ts`, exported (public — the CLI/MCP boundaries import them):
  - `isReservedKeyword(keyword: string): boolean` — `keyword.trim().toLowerCase()
    .startsWith(DEDUPE_KEYWORD_PREFIX)`. Single source of truth for what "reserved"
    means. **The normalization is load-bearing:** `keywordsSchema` (memory-entry.ts)
    stores every keyword as `.trim().toLowerCase()`, and that runs AFTER the strip.
    A case/whitespace forge (`From-Session:x`, ` from-session:x `) checked raw would
    pass a naive `startsWith`, then be normalized back into the reserved namespace on
    write — defeating the strip. Matching the schema's normalization here closes that
    (gauntlet: both reviewers independently proved the case bypass end-to-end).
  - `stripReservedKeywords(keywords: string[]): string[]` — `keywords.filter(k => !isReservedKeyword(k))`.
- **Boundaries route user keywords through it:**
  - `save_memory` (MCP): `keywords: stripReservedKeywords(d.keywords ?? [])`
  - `memory create` (CLI): `stripReservedKeywords(toStringArray(input.keywordFlags))`
  - `brain import` (core): strip reserved keywords from each imported memory's
    `keywords` before `createMemoryEntry`.
  - `memory update` (CLI): full-REPLACE of keywords, so it must be transparent to
    the ledger in BOTH directions — strip reserved from the user's set AND carry
    over the existing row's reserved keywords:
    `patch.keywords = [...existing.keywords.filter(isReservedKeyword),
    ...stripReservedKeywords(userKeywords)]`. Otherwise a naive strip would DROP a
    real from-session row's ledger keyword on any keyword edit → autopilot
    re-captures → duplicate. Preserving the existing reserved keywords keeps the
    ledger intact while still blocking a forged add.

Internal writers (from-session, autopilot) build the ledger keyword themselves and
write via `createMemoryEntry` / `saveMemoryWithLineage` directly — they do NOT go
through these boundaries, so they are unaffected and the shared ledger keeps
working. This closes the denial vector for from-session AND autopilot at once, and
matches §8 parse-on-handoff (sanitize agent input at the boundary, trust internal
writes).

**Strip, not reject.** The memory still saves, minus the reserved keyword — least
disruptive, and `from-session:` is our internal namespace a user would not
legitimately type. No error surface to probe for the exact prefix.

## Idempotence is not weakened

The fix only removes reserved keywords from **external** input. Every internal
write still emits the real ledger keyword, so legitimate re-runs still dedupe and
never duplicate. The change cannot cause a duplicate capture — it only prevents a
*forged* ledger entry from suppressing a real one.

## Verification

- Core unit: `stripReservedKeywords(["a","from-session:x","b"])` → `["a","b"]`;
  empty in → empty out; no-reserved in → unchanged.
- Boundary tests (real stored rows): each of save_memory / create / update / import
  with a `from-session:forged` keyword in the input → the stored row's keywords do
  NOT contain it, other keywords survive.
- **Regression / reproduction:** the end-to-end suppression — an agent plants a
  forged ledger keyword via `save_memory`, then a genuinely cross-session-recurring
  failure is run through autopilot. Written first: FAILS against current code (the
  forged keyword lands and suppresses the capture → `skippedExisting:1`); after the
  fix, the keyword is stripped and autopilot captures the lesson.
- `pnpm verify` green. External review: code-reviewer AND critic (agent-facing
  security boundary) — confirm no internal writer is caught by the strip, the shared
  ledger still dedupes, no duplicate-capture regression, all four boundaries covered.

## Non-goals

- Not changing the ledger keyword format or splitting the namespace.
- Not adding a surface/notification for stripped keywords (silent strip).
- The `memory update` boundary is made transparent to the ledger (it preserves the
  row's existing reserved keywords), so the update-drops-ledger-keyword removal
  vector is closed as a side effect. Any *other* exotic removal path (e.g. a future
  bulk-keyword tool) is out of scope — a duplicate capture, not a denial, and a
  different failure mode.
