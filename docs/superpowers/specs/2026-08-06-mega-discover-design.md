---
feature: mega-discover
date: 2026-08-06
risk: MEDIUM
status: draft-design
pending: [user-spec-review]
reviewers: [code-reviewer]
build-order: "4 of 20 (wave-2 batch)"
---

# Mega Discover — Honest Missed-Savings Finder

## Problem

Tool outputs that bypass the saver are invisible. The PostToolUse hook maps
every gate miss to passthrough (`apps/cli/src/hooks/saver.ts`): uncovered
tools (`resolveSourceKind` → undefined), disabled workspaces
(`resolveSettings` → null), and below-floor outputs (`totalBytes <=
minBytesFor(tool, mode)`, safe floor 32 000 B via `modeToBudget`) all return
before `record()`; non-compressed `record()` decisions return before any
persistence (`packages/context-gate/src/record-output.ts:260`). MCP tool
results reach the hook (floor max(mode budget, 16 384 B) — 16 384 B minimum,
32 000 B under the default safe mode) but never the proxy metering path.
Nothing tells the operator what they are leaving uncovered, or how to fix it.

RTK ships `rtk discover` as its adoption loop — the right product idea with
the wrong metric next door: `rtk gain` reported 96.2M tokens "saved" while
the measured bill went UP 7.6% (JetBrains paired A/B; unverified-source
caveat noted). The scoreboard priced invented counterfactuals as fresh input
(`wiki/syntheses/rtk-competitive-analysis-2026-08-01.md` §2 finding 5).
§5 idea 4 of that synthesis is this feature: "ours can be honest: scan
hook/usage logs, report commands that bypassed the saver with their MEASURED
sizes (not invented counterfactuals)."

## Goal

`mega discover [--json]`: a read-only scanner over already-persisted
artifacts that reports **unfiltered exposure** — measured byte sizes of tool
outputs that bypassed the saver — grouped by cause, each cause carrying its
exact remediation command. Plus an opt-in one-line nudge on
`mega hooks install` showing the top-3 exposure groups.

## Non-Goals (YAGNI)

- **No counterfactual claims.** Never "you would have saved X tokens/$Y".
  No dollar output at all (harder than field-telemetry, which allows a
  labeled estimate).
- No new capture, no new hook fields, no daemon route. The §13.4
  metadata-only hook-log contract is untouched.
- No per-call joins between hook-log rows and saver events (fragile
  label/timestamp correlation). Aggregates side-by-side only.
- No cross-workspace scan; current cwd's hook log only (v1).
- No changes to saver gates, floors, or coverage. Discover observes.
- No `--since` windowing (v1 reports the log's observed time span instead).

## Locked Decisions

1. **Measurement grades, never blended.** (a) *measured-now*: `stat()` size
   of a hook-log row's `filePath` at scan time, labeled "current size on
   disk"; (b) *mediated*: `TokenSaverEvent` byte totals for outputs the saver
   DID handle (context line only); (c) *unmeasured*: rows with no size
   evidence — reported as a count, never converted to bytes. Token figures
   only from `tokensFromBytes(measuredBytes)`, always labeled `(est.)`.
2. **Cause taxonomy** (grouping) with remediation one-liners:
   - `hook_missing` — no `<cwd>/.megasaver/hooks/claude-tool-calls.jsonl`:
     zero visibility, no numbers claimed → `mega hooks install claude-code`
     (mirrors `HOOK_MISSING_HINT` discipline, `packages/stats/src/metrics.ts`).
   - `workspace_disabled` — activation resolves disabled/null: every eligible
     logged call is exposure → `mega session saver workspace enable`.
   - `source_uncovered` — logged tool the saver cannot map: honest
     remediation is "none — Mega Saver coverage gap" (no enable command
     exists; drift detector for future tools).
   - `mcp_unproxied` — `category: "eligible_mcp"` rows: hook-covered at
     floor max(mode budget, 16 384 B) — 16 384 B minimum, 32 000 B under
     safe — but outside proxy metering; count-only → `mega mcp install`.
   - `below_floor` — enabled workspace, file-backed rows whose current size
     is ≤ `minBytesFor(tool, mode)`: measured →
     `mega session saver workspace enable --mode <next smaller>` (safe →
     balanced → aggressive; at aggressive: "already at the smallest floor").
     Caveat printed verbatim: smaller floors mean more rewrites; the billed
     net effect is unmeasured (A4 open) — this is a coverage fact, not a
     savings promise.
3. **Placement honors the dependency graph.** The pure scanner lives in
   `@megasaver/stats` (`src/discover.ts`) — precedent: `ingestHookLog`
   already parses this log format there. All IO (fs stat, log read,
   activation resolve) is injected by the CLI. Stats gains no new deps.
4. **Floor and coverage authority stays in `saver.ts`.** The CLI injects
   `minBytesFor` (already exported) and a new one-line
   `isSaverCoveredTool` wrapper — never a duplicated table.
5. **apps/cli imports the scanner via `@megasaver/core`** (§3c allow-list;
   `apps/cli/test/dependency-graph.test.ts`). New symbols are re-exported in
   `packages/core/src/context-gate.ts` following its existing stats block.
   Direct `@megasaver/context-gate` imports for activation are the existing
   precedent (`hooks/status.ts`, `saver-run.ts`).
6. **Nudge is opt-in.** `mega hooks install claude-code --discover`
   (boolean, default false) appends up to 3 exposure lines, best-effort in a
   try/catch (like the maintenance block) — never affects install output
   contract, exit code, or JSON mode default.

## Architecture

```
<cwd>/.megasaver/hooks/claude-tool-calls.jsonl   (read; lenient parse)
<store>/stats/<workspaceKey>/…                   (read; mediated totals)
resolveWorkspaceTokenSaverSettings(store, cwd)   (read; activation + mode)
        │
        ▼
parseHookLogRows(content) ──► HookLogRow[]                (@megasaver/stats)
scanExposure({rows, activation, floorFor,                 (@megasaver/stats,
  coveredTool, sizeOf, mediatedEvents, hookLogPresent})    pure, injected IO)
        │
        ▼ ExposureReport (groups sorted measuredBytes desc, deterministic)
mega discover [--json]           apps/cli/src/commands/discover.ts
mega hooks install --discover    top-3 lines, best-effort
```

## Components

1. **`parseHookLogRows(content): HookLogRow[]`** (`packages/stats/src/discover.ts`)
   — Zod-per-line lenient parse of `{timestamp, tool, category, filePath?,
   sessionId?}`; blank/malformed lines skipped (mirrors `ingestHookLog`).
2. **`scanExposure(input): ExposureReport`** — pure classifier per Locked
   Decision 2. Enabled workspace: uncovered → `source_uncovered`;
   `eligible_mcp` → `mcp_unproxied`; file-backed and `sizeOf(filePath) <=
   floorFor(tool)` → `below_floor`; remaining rows are NOT exposure — they
   are counted once as `noSizeEvidenceCalls` (may include mediated calls; no
   join, per Non-Goals). Disabled: every row → `workspace_disabled`.
   Repeated reads of one file count per call (each delivered bytes); the
   group also reports `uniqueFiles`. Report carries the observed
   `window: {from, to}` from row timestamps.
3. **`mega discover` command** — resolves store (`resolveStorePath`), reads
   the log, resolves activation (injectable for tests, like `SaverDeps`),
   stats file sizes, reads mediated totals
   (`readWorkspaceTokenSaverTotals`), renders text or `--json`
   single-line JSON. Registered in `apps/cli/src/main.ts`.
4. **Install nudge** — `--discover` flag on `hooksInstallCommand`; after a
   successful install, best-effort scan + up to 3 `exposure:` lines.

## Error Handling / Boundaries

- Missing/unreadable log → `hook_missing` report (exit 0). Unreadable is
  treated as absent (precedent: `readHookLog` in `hooks/status.ts`).
- `stat()` failure on a `filePath` → that call moves to the group's
  unmeasured count. Never a crash, never a guess.
- Malformed JSONL lines skipped silently (boundary Zod, §8 conventions).
- Exit 1 only on store-resolution failure (`mapErrorToCliMessage`), matching
  `runHooksStatus`. The scanner itself cannot fail the command.
- Scanner opens no file contents — `stat` only. No ReDoS surface: no regex
  over log content (wiki `concepts/unbounded-run-redos` class).

## Security & Privacy

- Read-only over local artifacts the user already owns; nothing leaves disk.
- Printed `filePath`s come from the hook log the user's own agent wrote;
  no file bodies are read or echoed. No secrets pass through the scanner.
- The nudge prints group totals and remediation commands, not paths.

## Testing (TDD — red first; no timing-sensitive tests)

| Unit | Test |
|------|------|
| `parseHookLogRows` | valid lines parsed; blank/malformed/partial-tail skipped; missing optional fields ok |
| `scanExposure` | disabled → all rows one group, measured vs unmeasured split; below-floor stat ≤ floor boundary (=, +1); uncovered tool; `eligible_mcp` count-only; empty log; deterministic sort; window from timestamps |
| honesty invariants | no group ever reports bytes without a measurement; token figure = `tokensFromBytes(measuredBytes)` exactly; report contains no `$`/price fields (structural assertion) |
| CLI | cli-test-pattern: mkdtemp store, fixture log file, injected activation; text lines; `--json` parses and round-trips; missing log → hint + exit 0 |
| nudge | install with `--discover` prints ≤3 lines; without flag prints none; scan throw → install output unchanged |
| re-export | scanner symbols reachable from `@megasaver/core`; dependency-graph test stays green |

## Risk & Process

MEDIUM (§12): read-only reporting, no saver-path changes, no user-file
mutation. Full superpowers chain; reviewer `code-reviewer`. Escalation
triggers → HIGH: the scanner grows a write path, touches saver gates/floors,
or any output line implies unmeasured savings.

## Dependencies / Build Order

4 of 20, wave-2 batch. No dependency on other wave-2 items. Consumes shipped
surfaces only: hook log (`HOOK_LOG_RELATIVE_PATH`), `minBytesFor`,
`resolveWorkspaceTokenSaverSettings` + `nodeResolverDeps`,
`readWorkspaceTokenSaverTotals`, `tokensFromBytes`. Changeset required
(new public CLI command + stats/core API): `@megasaver/stats`,
`@megasaver/core`, `@megasaver/cli` minor.

## Open Questions

1. Should repeated reads of one file also surface a "top offender" list
   (per-file rollup)? Deferred; `uniqueFiles` is the v1 hook for it.
2. Hook-log rotation/`--since`: the log grows unbounded; a windowing flag
   likely lands with a shared rotation policy, not per-command.
3. Should `mega doctor` link here when exposure is nonzero? Separate spec.
