# Mega Saver v1.0.0

**Context Gate / Mega Saver Mode** — session-scoped, GUI-controlled,
MCP-backed output compression. *Less tokens. More signal. Same or
better agent performance.*

## Highlights

- **One-click Mega Saver Mode.** Enable per session from the GUI (or
  `mega session saver enable --mode balanced`). Mega Saver writes the
  session settings, syncs the connector block, installs/repairs the
  MCP bridge, initializes stats, and verifies the content store in one
  step.
- **Deterministic output compression.** Raw tool output is routed
  through redact → chunk → rank → fit → summarize. The agent receives
  only the most relevant excerpts; raw evidence stays on local disk.
- **Three modes** — `safe` (32 000 B), `balanced` (12 000 B),
  `aggressive` (4 000 B) returned-byte budgets.
- **Real MCP bridge over stdio** exposing `mega_fetch_chunk`,
  `mega_read_file`, `mega_recall`, `mega_run_command` — policy-gated
  and redaction-pipelined.
- **Measurable savings** — per-event `rawBytes` / `returnedBytes` /
  `savingRatio`, surfaced in the GUI TokenSaverPanel with a raw/sent
  viewer.
- **Agent Setup Doctor** — install / repair / status per agent, no
  terminal required.

## New packages

`@megasaver/policy`, `@megasaver/content-store`,
`@megasaver/output-filter`, `@megasaver/retrieval`, `@megasaver/stats`,
plus the real `@megasaver/mcp-bridge` (replacing the v0.3 placeholder).

## Security

- Command execution is gated by an allow-list + dangerous-pattern
  deny-list; a `MEGASAVER_ORIGIN_PID` env marker blocks recursive
  self-invocation.
- Secrets are redacted before any output is stored or returned.
- File reads pass a secret-path denylist plus a structural sandbox
  gate (no symlink escape, no `..` traversal, no out-of-sandbox
  absolute paths).

## Compatibility

- Pre-v1.0 sessions load unchanged (`tokenSaver` is optional; absent
  means "not enabled").
- The connector `MEGA SAVER:CONTEXT_GATE` block is **additive** — the
  legacy `MEGA SAVER:BEGIN/END` block is untouched.

## Verification

`pnpm verify` green (lint + typecheck + test + conventions). End-to-end
acceptance test: `apps/cli/test/e2e/v1-closeout-flow.test.ts`. All
closed-enum tuple pins audited (`apps/cli/test/enum-pin-audit.test.ts`).

## Not in v1.0

Auth / per-project ACLs on the bridge, multi-user / team chatops,
real-time push to the GUI, model proxying, external embedding /
retrieval services (all local). Registry publish is a CI step
(packages are private in this release).
