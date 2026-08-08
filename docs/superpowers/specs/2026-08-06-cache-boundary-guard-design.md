---
feature: cache-boundary-guard
date: 2026-08-06
risk: HIGH
status: draft-design
pending: [user-spec-review, architect-pass]
reviewers: [code-reviewer, critic]
build-order: "2 of 20 (wave-2 batch)"
---

# Cache-Boundary Guard (wave-2 #2, idea B4)

## Problem

The saver's cache-safety story is a heuristic, not a proof. Stage A/P1
(net-positive spec, merged) added the first-sight seen-hash ledger — a
*content* heuristic standing in for the *positional* fact that matters:
whether a rewrite could touch bytes at or before the client's last
`cache_control` breakpoint. The superseded cache-aware spec §1 called
the positional version "the 'correct' long-term fix", rejected only
because "proxy↔hook coupling … doesn't exist yet"
(`2026-07-19-cache-aware-saver-design.md:60-62`). The coupling can now
exist: the opt-in proxy buffers every outgoing `/v1/messages` body
(`proxy-handler.ts:119`) and already JSON-parses it once for metering
(`proxy-handler.ts:181`), so it KNOWS where the breakpoints sit.

Honesty constraint (do not overclaim): the in-place-churn mechanism was
RETRACTED 2026-07-30 (`wiki/syntheses/saver-cache-churn.md` CORRECTION)
— PostToolUse rewrites land before first send; history is immutable.
On today's client a rewrite *cannot* hit cached bytes, so the guard's
steady-state refusal count is expected ≈ 0. Its value is exactly that:
it converts an unverified assumption about client behavior into a
checked, receipted invariant, fires conservatively where positional
knowledge is incoherent (compaction/resume rebuilds, interleaved
sessions), and is the structural prerequisite for the real payoff —
safe re-compression of the live suffix (B4's "unlock", see Non-Goals).

## Goal

1. Proxy extracts the last `cache_control` breakpoint POSITION from
   each successful `/v1/messages` request — zero added latency on the
   streaming path (rides the existing single post-response JSON.parse).
2. A tiny atomic record in the store carries the last two observations
   (positions + timestamps only).
3. `buildSaverDecision` consults it: refuse the rewrite when the
   projected target index ≤ the recorded cached breakpoint. Fail-open:
   no record → exactly today's behavior.
4. Receipts-based stats: `consults` / `refusals` counters incremented
   only by real gate evaluations. No estimated-savings claims, ever.

## Non-Goals

- Relaxing the P1 first-sight ledger (compressing seen repeats that sit
  past the boundary). That is B4's unlock and the actual churn-relevant
  behavior change; it stays gated on this guard having receipts AND the
  open A4 billed-S measurement. This feature changes no compression
  outcome on a coherent, growing, single-session conversation.
- Per-workspace/session attribution of observations. F33: the proxy has
  no per-request workspace signal (`usage-event.ts:31-38`,
  `workspaceKey` reserved and never stamped). Scoped out; see Locked
  Decision 2 for why the gap is safe here.
- Any mutation of proxied bodies (byte-verbatim forwarding invariant
  holds — observation is read-only). No `proxyUsageEventSchema` change
  (stays counts-only `.strict()`): a separate record file, not a
  ledger column.
- Daemon routes, `mega proxy status` UI, system/tools-array breakpoint
  tracking (only `messages[]` indices position tool_results).

## Locked Decisions

1. **Extraction point: post-response, single parse.** The request body
   is already buffered before forwarding and parsed once AFTER
   `res.end()` for metering (`countRequestMessages`,
   `proxy-handler.ts:179-198`). Extraction extends that same parse
   (`parseRequestBodyFacts` replaces `countRequestMessages` — no
   back-compat shim, pre-1.0). Structural no-latency guarantee: every
   response byte is flushed to the client before the parse runs. No
   benchmark needed; a test asserts callback-after-flush ordering.
2. **Record scope: global per store-root** at
   `<storeRoot>/proxy-usage/cache-boundary.json`, sibling of
   `usage.jsonl`. F33 makes per-workspace stamping impossible today.
   Safe because the guard's error direction is one-sided: a mis-scoped
   or stale consult can only *refuse* (skip one compression → baseline
   cost) — it can never authorize an unsafe rewrite, because "allow"
   restores today's already-safe behavior. Interleaved sessions through
   one shared proxy will flip-flop the shrink detector and depress
   savings; receipts + a doctor hint make that visible (F33 follow-up
   fixes it properly).
3. **Record shape: last two observations.**
   `{version: 1, current: {messageCount, lastBreakpointIndex|null,
   observedAt}, previous: <same>|null}` — Zod `.strict()`, positions
   and timestamps ONLY. Written by the proxy supervisor sink under
   `withFileLock` (`{deadlineMs: 50, staleMs: 5000}`, the saver-seen
   options) with tmp+rename; read-modify-write shifts current→previous.
4. **Decision rule (exact, one comparison).**
   `projectedIndex = current.messageCount` — the sound lower bound for
   where the next tool_result can append.
   `boundaryIndex = max(current.lastBreakpointIndex ?? -1,`
   `shrank ? previous.lastBreakpointIndex ?? -1 : -1)` where
   `shrank = current.messageCount < previous.messageCount`.
   Refuse iff `projectedIndex <= boundaryIndex`, and only while
   `current.observedAt` is within `CACHE_BOUNDARY_TTL_MS` (1h — the
   client's native prompt-cache TTL per saver-cache-churn; an expired
   breakpoint protects nothing). Well-formed growth can never fire
   (breakpoint index < messageCount by construction); firings are
   rebuild windows (previous request's cached breakpoint still spans
   positions the rebuilt conversation reuses — self-heals on the next
   observation) or malformed/forged records (tripwire).
5. **Guard placement: after the seen-hash gate, before `record()`** in
   `buildSaverDecision`. Every refusal is then a receipt for a
   compression that would actually have proceeded — honest counting.
6. **Fail-open, everywhere, hook exits 0.** Missing/stale/unparseable
   record → allow (no consult recorded). Reader/stat writers injected
   through `SaverDeps` with try/catch wrappers in `saver-run.ts`
   (mirroring `recordSeenOutput`). Proxy-side write failures drop the
   observation silently. `FailureKind` union untouched (enum order is
   a contract); a guard throw surfaces under the existing `resolve`
   stage.
7. **2xx-only observation.** A non-2xx round trip caches nothing;
   observing it would move the boundary on evidence that does not
   exist.

## Architecture

```
mega proxy (supervise.ts)                          store
  POST /v1/messages ──stream response──▶ client      │
    └─ after res.end(): parseRequestBodyFacts        │
         ├─ onUsage ─▶ usage.jsonl (unchanged)       │
         └─ onBoundary ─▶ recordCacheBoundaryObservation
                            └─▶ proxy-usage/cache-boundary.json
PostToolUse saver hook (exit 0 always)
  buildSaverDecision: …floor gate → seen-hash gate →
    readCacheBoundary ─▶ evaluateCacheBoundary(record, now)
      ├─ allow  → recordBoundaryGuardOutcome("allow")  → compress
      └─ refuse → recordBoundaryGuardOutcome("refuse") → passthrough
doctor-saver: sums stats/<wk>/boundary-guard.json → one Check line
```

## Components

1. `packages/llm-proxy/src/parse-usage.ts` —
   `parseRequestBodyFacts(bodyText)` → `{model, messageCount,
   lastCacheBreakpointIndex}` (walks `messages[]` from the end; a
   breakpoint is any content block carrying a `cache_control` key;
   block text is never read or retained). Replaces
   `countRequestMessages`.
2. `packages/llm-proxy/src/boundary-record.ts` (new) — schemas,
   `cacheBoundaryRecordPath`, `readCacheBoundaryRecord` (null on any
   anomaly), `recordCacheBoundaryObservation` (lock + tmp+rename,
   0700/0600, symlink refusal mirroring `store.ts:24-31`),
   `evaluateCacheBoundary(record, nowMs)` (pure verdict),
   `CACHE_BOUNDARY_TTL_MS`. Adds `@megasaver/shared` (workspace:*) dep
   for `withFileLock` — no new package.
3. `packages/llm-proxy/src/proxy-handler.ts` + `server.ts` — optional
   `onBoundary` sink, invoked post-flush, 2xx-gated, inside the
   existing best-effort try.
4. `apps/cli/src/commands/proxy/supervise.ts` — wires `onBoundary` to
   the record writer (best-effort, like `appendProxyUsage`).
5. `packages/context-gate/src/boundary-guard-stats.ts` (new) —
   `recordBoundaryGuardOutcome` / `readBoundaryGuardStats` on
   `stats/<wk>/boundary-guard.json`
   `{version, consults, refusals, lastRefusalAt}` under the same lock
   options.
6. `apps/cli/src/hooks/saver.ts` — `SaverDeps.readCacheBoundary` +
   `recordBoundaryOutcome`; the gate per Locked Decisions 4-5.
   `saver-run.ts` wires real implementations.
7. `apps/cli/src/commands/doctor-saver.ts` — informational Check
   (`pass: true` always; refusals are conservative skips, not faults).

## Error handling

All consumers degrade to today's behavior: ENOENT/parse-fail/lock-miss
→ `null` record → allow; stat write fail → dropped receipt
(undercount, never overcount); proxy write fail → dropped observation;
hook catch-all keeps exit 0 (`runSaverHookFromProcess` unchanged).
Schema bounds (`max 1_000_000` indices) reject forged giants; a forged
`lastBreakpointIndex >= messageCount` is deliberately representable —
rejecting it at the schema would blind the tripwire.

## Security & privacy

HARD RULE preserved: the proxy never persists request/response bodies
(`usage-event.ts:7-9`). The boundary record stores integer indices and
timestamps — no content, no hashes of content, no labels. File
discipline mirrors the usage log: dir 0700, file 0600, refuse symlinked
paths, loopback-only proxy unchanged. No `redact` needed (no text
fields exist). Record values are untrusted at read time (Zod `.strict()`
at the boundary, per §8).

## Testing

TDD, red-first, per component: extraction table tests (last-breakpoint
index, none→null, string content skipped, malformed JSON→zero facts);
record round-trip + current→previous shift + corrupt-file recovery +
symlink refusal; verdict table (growth→allow, shrink→refuse via
previous breakpoint, TTL-stale→allow with injected clock — no
timing-tight tests, TTL is 1h vs ms-scale test runs; forged
bp≥mc→refuse); handler observation (positions correct, fires only
after full body flushed, non-2xx silent, throw isolated); supervise
wiring; stats receipts math; saver gate decision-table on the existing
`deps()` fixture (refuse→passthrough with zero `record()` calls +
refuse receipt; allow→compress + consult receipt; null→no consult and
ALL existing saver tests green unchanged — that suite is the
regression evidence); saver-run fail-open wiring; doctor line.
Smoke (DoD 5): real `mega proxy` session capture showing
`cache-boundary.json` updating + doctor receipts line.

## Risk & process

HIGH (§12: saver decision path + proxy-adjacent core path). Worktree
mandatory, no `main` edits. Chain: this spec → user review →
`architect` pass → plan → TDD → `pnpm verify` → `code-reviewer` AND
`critic` in separate fresh contexts → `verifier`. Escalation: if
implementation ever needs to MUTATE request bodies or touch
`proxyUsageEventSchema`, stop — that is CRITICAL territory (net-positive
Stage C precedent). Changesets: `@megasaver/llm-proxy`,
`@megasaver/context-gate`, `@megasaver/cli`.

## Dependencies / build order

Wave-2 #2 of 12. Depends on: shipped proxy + first-party route,
Stage A P1 seen-ledger (both on `main`). Independent of other wave-2
items. Enables (does not include): suffix re-compression unlock;
F33 workspace attribution is the named follow-up. Delineation:
complements net-positive Stage A (first-sight stays, untouched);
builds the exact positional coupling the superseded cache-aware spec
called correct; contradicts neither — no stage gate, mode, or
benchmark semantic changes.

## Open questions

1. F33 signal design for per-workspace records (per-workspace proxy
   port vs. injected header vs. env) — wave-3 candidate.
2. Interleaved-session flip-flop through a shared proxy: accepted and
   receipted for v1; does real usage show enough refusals to justify
   pulling F33 forward?
3. TTL constant: 1h assumed from the client's native cache
   (saver-cache-churn §Claim); if the client actually uses 5m
   ephemeral TTL, 1h is merely more conservative — confirm from a
   recorded corpus before tuning down.
4. Should the unlock (first-sight relaxation past the boundary) get
   its own spec once A4's billed leg lands? (Recommended: yes,
   separate HIGH spec.)
