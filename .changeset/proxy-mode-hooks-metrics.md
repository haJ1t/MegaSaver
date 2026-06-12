---
"@megasaver/stats": minor
"@megasaver/cli": minor
---

Proxy Mode v1.2 Phase P5 — adoption + measurement (D7-rest, D8, D9).

`@megasaver/stats` gains proxy metrics: `readEvents` reads the per-call
audit trail, `aggregateAdoption` computes the universal adoption block
(adoption rate, call count, calls-by-type, expand rate, proxy-mediated
token savings, raw stored output count, average compression ratio),
`ingestHookLog` + `computeInterception` derive the hook-based
interception rate, and `buildProxyMetrics` assembles the combined shape
(adoption always present; interception only when a Claude Code hook log
exists, otherwise the verbatim install hint). Zero-denominator cases
yield `0.0`; malformed JSONL lines are skipped.

`@megasaver/cli` gains a `hooks` command group:
- `mega hooks install claude-code` idempotently writes a `PreToolUse`
  telemetry hook into an injectable Claude Code `settings.json`,
  preserving unrelated keys.
- `mega hooks log` is the metadata-only, best-effort, always-exit-0
  logger the hook invokes (never logs file contents, never blocks the
  tool call).
- `mega hooks status <sessionId>` prints proxy adoption metrics always
  and hook-based interception only when the log exists, with honest
  wording that never overclaims universal interception.

`mega doctor` now reports Claude Code hook telemetry as installed or
missing (with the install hint). Connector instruction blocks bias
agents to `proxy_*` tools and to expanding chunks before assuming
omitted content is irrelevant. The README documents Proxy Mode as
opt-in with the approved category-comparison framing and no
competitor-specific headline.
