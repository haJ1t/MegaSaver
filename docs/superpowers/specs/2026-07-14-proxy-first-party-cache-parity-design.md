# Proxy First-Party Cache Parity

- **Date:** 2026-07-14
- **Risk:** HIGH (connector core path, public routing behavior)
- **Status:** approved-by-evidence (root cause proven in session forensics)

## Problem

Routing Claude Code through the MegaSaver proxy (`ANTHROPIC_BASE_URL=http://127.0.0.1:8787`)
makes sessions 2–10x more expensive than direct API use. Benchmark (4 tasks × 2 arms,
2026-07-14): geomean cost savings 0.38x — every task lost.

Root cause (proven by request-body capture + per-request usage forensics + 7-agent
transcript analysis): Claude Code switches to a **non-first-party mode** for any custom
`ANTHROPIC_BASE_URL`:

1. MCP tool search is disabled — ~93 tool schemas (~63k tokens) inline in every request
   prefix instead of deferred (+90k cache-read per call; cold-cache writes double).
2. Accumulated SessionStart/UserPromptSubmit hook output (~20k tokens) is sent as a
   trailing `role:"system"` message **after the last `cache_control` breakpoint** —
   billed as uncached input once per session.
3. Session-start attachments (skill/agent/tool listings, ~47k tokens) merge **after**
   API call 1 when mega hooks are present → call 2 gets a full prefix miss (`cache_read=0`)
   and rewrites the whole context (task_1: 131,858-token cold write, 87.5% of its $4.03).

The proxy and hooks themselves are byte-clean (proven: verbatim forwarding, zero
stdout injection from log/intent hooks, saver disabled in bench workspace).

## Fix

Claude Code 2.1.207 reads `_CLAUDE_CODE_ASSUME_FIRST_PARTY_BASE_URL=1` (internal flag,
discovered via binary strings; verified empirically 2026-07-14): the client then treats
the custom base URL as first-party and restores all three behaviors. Other client
versions require the same smoke probe because the flag is undocumented.

Verified effect through the MegaSaver proxy (probe pairs):

| metric              | proxy before | proxy + flag | baseline |
|---------------------|-------------:|-------------:|---------:|
| uncached input      | 19,663       | 2            | 2        |
| request prefix size | 85,390       | 40,456       | 40,617   |
| call1→call2 jump    | +69k, read=0 | +698, full hit | +698   |

The route installer writes the flag **next to** `ANTHROPIC_BASE_URL` in
`~/.claude/settings.json` `env`, and removes it when the route is removed.

## Design

`createClaudeRouteAdapter(settingsPath, opts?)` gains `opts.assumeFirstParty: boolean`.

- `apply(expectedUrl)`: when `assumeFirstParty`, also set
  `_CLAUDE_CODE_ASSUME_FIRST_PARTY_BASE_URL: "1"`. Existing foreign-route value-guard
  unchanged. Returns `boolean` (whether a write happened) and skips the write when the
  env is already complete, so idempotent re-applies cost zero I/O.
- `removeExpected(expectedUrl)`: always drop the flag when dropping the owned base URL
  (cleanup is unconditional; a stale flag without our route must not survive).
- `inspect(expectedUrl)`: **unchanged, URL-only semantics.** An earlier draft reported
  `"absent"` when the flag was missing; adversarial review proved that lie strands a
  live route on every removal path (the reconcile matrix treats `"absent"` as
  nothing-to-remove) and lets `verify_route` confirm removals that never happened.
  Instead, self-healing lives in the supervisor monitor: on a healthy tick with an
  `"exact"` route, it calls the idempotent `apply` and counts a re-apply only when a
  write actually happened.
- Upstream gates are **origin-compared** (mirroring the credential-forwarding gate):
  a trailing slash or case difference must not silently disable the flag. The control
  plane gates on the persisted `control.upstreamBaseUrl` fact, not on prose invariants.

Callers:
- `supervise.ts`: `assumeFirstParty: upstream === DEFAULT_UPSTREAM`. A custom
  `--upstream` (credential-forwarding acknowledged) is genuinely non-first-party;
  telling the client otherwise would leak attribution/beta behavior to a third party.
  **Never set the flag for custom upstreams.**
- `commands.ts` (control plane): the LaunchAgent it installs always supervises with the
  default upstream (no `--upstream` in `superviseArgv`), so `assumeFirstParty: true`.
- `mega proxy start`: when an exact owned route already exists, re-run the adapter's
  idempotent `apply` from the upgraded CLI process. This heals an older still-running
  supervisor without stopping the listener or interrupting connected clients.

## Constraints / risks

- The flag is **undocumented and underscore-prefixed**: it may vanish in a future
  Claude Code release. Failure mode is graceful (client ignores unknown env; behavior
  reverts to today's non-first-party costs). Track via `mega doctor` in a follow-up.
- A custom-upstream adapter removes a stale first-party flag from an exact owned route;
  foreign base URLs remain untouched. A version downgrade/manual foreign-URL swap can
  still leave an orphan, so `mega doctor` should detect and offer to remove it.
- Flag applies only to Claude Code; other agents' connectors unaffected.
- No proxy-side body rewriting in this fix: not needed once the client behaves
  first-party. (Rejected alternative: proxy-side `cache_control` injection — larger
  surface, only fixed penalty 2 of 3.)

## Definition of done

- TDD: route-adapter tests for apply/remove/inspect with and without the option.
- `pnpm verify` green.
- Smoke evidence: probe through proxy with flag → uncached input ≈ 2, prefix ≈ baseline.
- Benchmark rerun with fix (and saver enabled in bench workspace) shows megasaver arm
  ≥ parity on cost.
- Reviewer: code-reviewer + critic (separate contexts, HIGH risk).
