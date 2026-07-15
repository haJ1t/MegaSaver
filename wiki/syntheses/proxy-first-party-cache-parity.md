---
title: Proxy First-Party Cache Parity
type: synthesis
created: 2026-07-14
sources:
  - session forensics 2026-07-14 (7-agent workflow wf_7256731c-d79, request-body captures, proxy usage.jsonl)
  - docs/superpowers/specs/2026-07-14-proxy-first-party-cache-parity-design.md
  - commits 966ffad3, 3f11b49a, 09fe8970, 9c90ea20, 25ad04ae, b09a3983
---

# Proxy First-Party Cache Parity

## The problem (measured, 2026-07-14 morning)

Benchmark (4 coding tasks × 2 arms, real `claude -p` sessions, tokens from
`--output-format json`): the MegaSaver-routed arm cost **2.6x more** than
direct API (geomean; worst task 5.3x). Source: session forensics.

Claude Code enters a **non-first-party mode** for any custom
`ANTHROPIC_BASE_URL`:

1. MCP tool search disabled → ~93 tool schemas (~63k tok) inlined into every
   request prefix (+90k cache-read per call, doubled cold writes).
2. Accumulated SessionStart/UserPromptSubmit hook output (~20k tok) sent as a
   trailing `role:"system"` message **after** the last `cache_control`
   breakpoint → uncached once per session.
3. Session-start attachments (~47k tok) merge after API call 1 when hooks are
   present → call 2 full prefix miss (`cache_read=0`), whole-context cold
   rewrite (worst observed: 131,858-tok write, 87.5% of a $4.03 session).

Proxy and hooks code proven clean (byte-verbatim forwarding; log/intent hooks
emit nothing; saver was disabled in the bench workspace).

Confounder found during forensics: requests served at `speed="fast"` bill
**2x on all token classes**; fast-mode 429 fallback ("Usage credits are
required") is silent and unbilled. Only affects cross-batch cost comparisons.

## The fix (shipped to main 2026-07-14)

`_CLAUDE_CODE_ASSUME_FIRST_PARTY_BASE_URL=1` (internal client flag, verified
on Claude Code 2.1.207) restores first-party behavior. The route installer
writes it next to `ANTHROPIC_BASE_URL` (origin-gated to the default upstream),
removes it with the route; the supervisor monitor heals old installs via a
write-reporting idempotent `apply()`. `inspect()` stays URL-only — an earlier
draft that lied about flag-less routes was killed by adversarial review
(stranded live routes on every removal path).

Final hardening closes the upgrade and custom-upstream edges: the production
adapter removes any stale first-party flag when the configured upstream is not
Anthropic's default, and real-adapter tests cover canonical, normalized, and
custom origins. Existing managed supervisors are refreshed only through the
explicit `mega proxy start --restart-supervisor` operator action. URL equality
is never treated as proof of service ownership; legacy and foreign jobs are not
restarted.

## Result (same benchmark, after fix + saver enabled)

| task | cost savings | input savings |
|---|---|---|
| task_1 | 1.08x | 1.26x |
| task_2 | 1.15x | 1.27x |
| task_3 | 1.68x | 2.29x |
| task_4 | 1.38x | 1.93x |
| **geomean** | **1.30x** | **1.63x** |

4/4 tasks won (was 0/4 at 0.38x cost before the fix). Single-run cells —
direction robust, magnitudes carry run-to-run variance. Aggregate billed cost
was approximately **$1.87 MegaSaver vs $2.49 baseline**. The archived treatment
settings contained the log, intent, and saver hooks; the harness now snapshots
settings only after setup and fails before billing if the saver hook is absent.

## Open threads

- The flag is undocumented/internal: `mega doctor` follow-up should detect
  orphaned flags (downgrade/manual-swap residual) and client versions that
  drop the flag. (Spawned task chip 2026-07-14.)
- The "4x cheaper" product claim needs aggressive saver mode + longer
  tool-heavy sessions to test honestly; balanced mode measured 1.30x cost in
  this smoke benchmark, with nondeterministic turn counts limiting magnitude
  claims.
- Benchmark harness (`scripts/run-megasaver-claude-limit-test.sh`) now
  measures real usage tokens, isolates arms via `--setting-sources ""`, and
  suppresses aggregates when any session fails.
