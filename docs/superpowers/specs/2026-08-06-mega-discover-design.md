---
feature: mega-discover
date: 2026-08-06
refreshed: 2026-08-13
risk: MEDIUM
status: draft-design
pending: [user-spec-review]
reviewers: [code-reviewer]
build-order: "4 of 20 (wave-2 batch); v2.7 #3"
---

# Mega Discover — Honest Missed-Savings Finder

## Problem

Tool outputs that bypass the saver are invisible. The PostToolUse hook maps
every gate miss to passthrough (`apps/cli/src/hooks/saver.ts`): uncovered
tools (`resolveSourceKind` → undefined), disabled workspaces
(`resolveSettings` → null), below-floor outputs (`totalBytes <=
minBytesFor(tool, mode)`), already-seen outputs (P1 first-sight ledger), and
non-compressed `record()` decisions all return before any persistence. MCP
tool results reach the hook (floor max(mode budget, 16 384 B)) but never the
proxy metering path. Nothing tells the operator what they are leaving
uncovered, or how to fix it.

Since the 08-06 draft, exec-rewrite-saver (v2.7 #1) shipped: allowlisted Bash
commands are rewritten at PreToolUse to `mega output exec-live`, which
persists the raw output and records events with `origin: "exec-rewrite"`
(LD8). Rewritten calls never reach PostToolUse (LD12 exemption). The
PreToolUse hook log is metadata-only (§13.4: tool, category, filePath,
sessionId — no command text, no sizes), so a hook-log row alone cannot say
whether a given Bash call was rewritten or bypassed. Discover must account
for this honestly: never mislabel rewritten calls as exposure, and never
invent per-call joins the artifacts cannot support.

RTK ships `rtk discover` as its adoption loop — the right product idea with
the wrong metric next door: `rtk gain` reported 96.2M tokens "saved" while
the measured bill went UP 7.6% (JetBrains paired A/B; unverified-source
caveat noted). The scoreboard priced invented counterfactuals as fresh input
(`wiki/syntheses/rtk-competitive-analysis-2026-08-01.md` §2 finding 5). §5
idea 4 of that synthesis is this feature: "ours can be honest: scan
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
- No hook-config reads: the report is artifact-evidenced only (hook log +
  events ledger). Whether the exec-rewrite hook is installed is NOT read
  from hook settings; ledger `origin` rows are the evidence of rewrite
  activity.

## Locked Decisions

1. **Measurement grades, never blended.** (a) *measured-now*: `stat()` size
   of a hook-log row's `filePath` at scan time, labeled "current size on
   disk"; (b) *mediated*: windowed `OverlayTokenSaverEvent` byte totals for
   outputs the saver DID handle (context lines only); (c) *unmeasured*:
   rows with no size evidence — reported as a count, never converted to
   bytes. Token figures only from `tokensFromBytes(measuredBytes)`, always
   labeled `(est.)`.
2. **File measurement is `stat.isFile()`-gated.** The logger writes
   `filePath` from `file_path` (Read → file) or `path` (Grep/Glob/LS →
   usually a DIRECTORY). A directory `stat()` size is never a proxy for
   output size. Only `stat.isFile() === true` rows can feed `below_floor`
   measured bytes; everything else (missing path, unresolvable relative
   path, directory, stat failure) is unmeasured, count-only.
3. **Cause taxonomy** (grouping) with remediation one-liners:
   - `hook_missing` — no `<cwd>/.megasaver/hooks/claude-tool-calls.jsonl`:
     zero visibility, no numbers claimed → `mega hooks install claude-code`
     (mirrors `HOOK_MISSING_HINT` discipline, `packages/stats/src/metrics.ts`).
   - `workspace_disabled` — activation resolves disabled/null: every eligible
     logged call is exposure → `mega session saver workspace enable`.
     File-backed rows measured; command rows count-only.
   - `source_uncovered` — logged tool the saver cannot map: honest
     remediation is "none — Mega Saver coverage gap" (no enable command
     exists; drift detector for future tools). Empty today: all 11 logged
     native tools are TOOL_SOURCE-mapped and `mcp__*` maps to `command`.
   - `mcp_unproxied` — `category: "eligible_mcp"` rows: hook-covered at
     floor max(mode budget, 16 384 B) but outside proxy metering;
     count-only → `mega mcp install`.
   - `below_floor` — enabled workspace, file-backed rows (`stat.isFile()`)
     whose current size is ≤ `minBytesFor(tool, mode)`: measured →
     `mega session saver workspace enable --mode <next smaller>` (safe →
     balanced → aggressive; at aggressive: "already at the smallest floor").
     Caveat printed verbatim: smaller floors mean more rewrites; the billed
     net effect is unmeasured (A4 open) — this is a coverage fact, not a
     savings promise.
   - `command_unmeasured` — `eligible_command` rows (Bash/Task/BashOutput/
     Monitor) in an enabled workspace: metadata-only log carries no command
     text and no size, so rewritten (covered) and bypassed calls are
     indistinguishable per row. Count-only, with a verbatim caveat pointing
     at the ledger context lines as the rewrite-coverage evidence.
     `remediation` is `null` (no command fixes an unmeasured gap); the
     caveat names the two honest levers as hints (widen the exec-rewrite
     allowlist / smaller floor mode) — never as a command that "fixes" it.
   - Residual unmeasured read/search rows: in a disabled workspace they
     count unmeasured INSIDE `workspace_disabled` (the group keeps a
     measured/unmeasured split); in an enabled workspace they have no
     determinable cause and land in a report-level `unmeasuredCalls` count
     (rendered "no size evidence"), never a group, never bytes.
   - Above-floor file rows in an enabled workspace are NOT exposure: the
     saver attempted them. They surface as an informational count line
     `above_floor` (calls + measured bytes, no remediation), labeled
     honestly — the admission guard may still have declined the compression,
     so "attempted" is never "saved".
4. **Per-file rollup.** The `below_floor` group carries a top-5 rollup by
   `filePath`: calls × measured bytes, deterministic order (bytes desc,
   then path asc). Repeated reads of one file count per call (each delivered
   bytes); the group also reports `uniqueFiles`. Rollup is part of text and
   `--json` output.
5. **Ledger context is windowed and origin-split.** The context lines read
   `stats/<workspaceKey>/<liveSessionId>.events.jsonl` (lenient per-line
   parse) and fold `rawBytes`/`returnedBytes` per origin
   (`origin: "exec-rewrite"` vs absent = PostToolUse) restricted to rows
   whose `createdAt` falls inside the hook log's observed `[from, to]`
   window. No rows in window → "no mediated events in the observed window".
   Unreadable/corrupt session files are skipped (lenient, like
   `readWorkspaceTokenSaverTotals`); a session file with zero usable rows
   contributes nothing and is not an error. Windowing keeps exposure and
   context comparable spans — no side-by-side across different time ranges.
6. **Placement honors the dependency graph.** The pure scanner lives in
   `@megasaver/stats` (`src/discover.ts`) — precedent: `ingestHookLog`
   already parses this log format there. All IO (fs stat, log read,
   activation resolve, events read) is injected by the CLI. Stats gains no
   new deps.
7. **Floor and coverage authority stays in `saver.ts`.** The CLI injects
   `minBytesFor` (already exported) and a new one-line `isSaverCoveredTool`
   wrapper — never a duplicated table.
8. **apps/cli imports the scanner via `@megasaver/core`** (§3c allow-list;
   `apps/cli/test/dependency-graph.test.ts`). New symbols are re-exported in
   `packages/core/src/context-gate.ts` following its existing stats block.
   Direct `@megasaver/context-gate` imports for activation are the existing
   precedent (`hooks/status.ts`, `saver-run.ts`).
9. **Nudge is opt-in.** `mega hooks install claude-code --discover`
   (boolean, default false) appends up to 3 exposure lines, best-effort in a
   try/catch (like the maintenance block) — never affects install output
   contract, exit code, or JSON mode default.

## Architecture

```
<cwd>/.megasaver/hooks/claude-tool-calls.jsonl   (read; lenient parse)
<store>/stats/<workspaceKey>/*.events.jsonl      (read; windowed, origin-split)
resolveWorkspaceTokenSaverSettings(store, cwd)   (read; activation + mode)
        │
        ▼
parseHookLogRows(content) ──► HookLogRow[]                (@megasaver/stats)
readMediatedWindow(rows)   ──► {createdAt, rawBytes,
                                returnedBytes, origin}[]  (@megasaver/stats, IO)
scanExposure({rows, activation, floorFor,                 (@megasaver/stats,
  coveredTool, sizeOf, mediatedEvents, hookLogPresent})    pure, injected IO)
        │
        ▼ ExposureReport (groups sorted measuredBytes desc, deterministic;
          top-5 rollup; window {from,to}; mediated context)
mega discover [--json]           apps/cli/src/commands/discover.ts
mega hooks install --discover    top-3 lines, best-effort
```

## Components

1. **`parseHookLogRows(content): HookLogRow[]`** (`packages/stats/src/discover.ts`)
   — Zod-per-line lenient parse of `{timestamp, agent: "claude-code", tool,
   category, filePath?, sessionId?}` (the shipped `logger.ts` shape, which
   added `agent` after the 08-06 draft); blank/malformed/partial-tail lines
   skipped (mirrors `ingestHookLog`). A line with an unexpected `agent` is
   still parsed — the log is single-agent in practice; the field is carried,
   not gated.
2. **`readMediatedWindow(eventsRows): MediatedEvent[]`** (`discover.ts`, IO
   injected) — folds `.events.jsonl` rows into the minimal
   `{createdAt, rawBytes, returnedBytes, origin}` view via
   `overlayTokenSaverEventSchema` lenient parse.
3. **`scanExposure(input): ExposureReport`** — pure classifier per Locked
   Decision 3. Enabled workspace: uncovered → `source_uncovered`;
   `eligible_mcp` → `mcp_unproxied`; file-backed and
   `sizeOf(filePath) <= floorFor(tool)` → `below_floor` (measured);
   file-backed and above floor → informational `above_floor` (measured,
   not exposure); remaining eligible rows without size evidence → their
   cause group's unmeasured count (`command_unmeasured` for
   `eligible_command`, unmeasured read/search for the rest). Disabled:
   every row → `workspace_disabled` with the same measured/unmeasured
   split. `scanExposure` never classifies an exec-rewrite-covered call —
   no artifact supports it per row; the `command_unmeasured` caveat owns
   that statement. Report carries `window: {from, to}` from row timestamps
   and the windowed `mediated: {execRewrite, postToolUse}` folds.
4. **`mega discover` command** — resolves store (`resolveStorePath`), reads
   the log, resolves activation (injectable for tests, like `SaverDeps`),
   stats file sizes, reads mediated events, renders text or `--json`
   single-line JSON. Groups render sorted by measured bytes desc
   (count-only groups by calls desc), then cause name — deterministic.
   Text layout: window line → cause groups (headline + remediation +
   caveats) → `above_floor` line → mediated context lines (origin-split,
   windowed).    JSON contract (single line): `{window: {from, to} | null, hookMissing:
   boolean, groups: ExposureGroup[], aboveFloor: {calls, measuredBytes} |
   null, mediated: {execRewrite: {calls, rawBytes, returnedBytes} | null,
   postToolUse: {calls, rawBytes, returnedBytes} | null}, generatedAt}`
   where `ExposureGroup = {cause, calls, measuredBytes, uniqueFiles,
   topFiles: {filePath, calls, measuredBytes}[], remediation, caveat?}`;
   `measuredBytes` is `null` for count-only groups and `remediation` is
   `null` for `command_unmeasured`. Registered in `apps/cli/src/main.ts`.
5. **Install nudge** — `--discover` flag on `hooksInstallCommand`; after a
   successful install, best-effort scan + up to 3 `exposure:` lines.

## Measurement Honesty Rules (structural)

- A group reports bytes only from a measurement (file `stat.isFile()`
  size or ledger event fields). Every other row is a count.
- No group ever sums unmeasured counts into bytes. No estimate fills a
  gap.
- Token figures = `tokensFromBytes(measuredBytes)` exactly, labeled
  `(est.)`. Never a token without a byte measurement behind it.
- The report contains no `$` / price field anywhere (test asserts the
  shape structurally, not by content sniffing).
- `uniqueFiles` counts distinct `filePath`s; repeated calls count per call
  in `calls` and per-call bytes in `measuredBytes`.

## Error Handling / Boundaries

- Missing/unreadable log → `hook_missing` report (exit 0). Unreadable is
  treated as absent (precedent: `readHookLog` in `hooks/status.ts`).
- `stat()` failure or non-file on a `filePath` → that call moves to the
  group's unmeasured count. Never a crash, never a guess.
- Malformed JSONL lines (both artifacts) skipped silently (boundary Zod,
  §8 conventions).
- Exit 1 only on store-resolution failure (`mapErrorToCliMessage`), matching
  `runHooksStatus`. The scanner itself cannot fail the command.
- Scanner opens no file contents — `stat` only. No ReDoS surface: no regex
  over log content (wiki `concepts/unbounded-run-redos` class).
- Timestamps: window endpoints come from valid row timestamps; invalid
  timestamps leave that row out of the window computation (the row itself
  still counts). Events with unparsable `createdAt` are skipped.

## Security & Privacy

- Read-only over local artifacts the user already owns; nothing leaves disk.
- Printed `filePath`s come from the hook log the user's own agent wrote;
  no file bodies are read or echoed. No secrets pass through the scanner.
- The nudge prints group totals and remediation commands, not paths.

## Testing (TDD — red first; no timing-sensitive tests)

| Unit | Test |
|------|------|
| `parseHookLogRows` | valid lines parsed (incl. `agent` field); blank/malformed/partial-tail skipped; missing optional fields ok |
| `scanExposure` | disabled → all rows one group, measured vs unmeasured split; below-floor stat ≤ floor boundary (=, +1); above-floor file rows → informational `above_floor` (measured, not a group); directory `filePath` → unmeasured (never bytes); uncovered tool; `eligible_mcp` count-only; `eligible_command` → `command_unmeasured` count-only; empty log; deterministic sort; top-5 rollup order + tie-break; window from timestamps |
| window fold | events outside `[from,to]` excluded; origin split (exec-rewrite vs absent); corrupt rows skipped; empty window → zero mediated, flagged |
| honesty invariants | no group reports bytes without a measurement; token figure = `tokensFromBytes(measuredBytes)` exactly; report contains no `$`/price fields (structural assertion); unmeasured counts never summed into bytes |
| CLI | cli-test-pattern: mkdtemp store, fixture log file, injected activation; text lines; `--json` parses and round-trips; missing log → hint + exit 0 |
| nudge | install with `--discover` prints ≤3 lines; without flag prints none; scan throw → install output unchanged |
| re-export | scanner symbols reachable from `@megasaver/core`; dependency-graph test stays green |

## Risk & Process

MEDIUM (§12): read-only reporting, no saver-path changes, no user-file
mutation. Full superpowers chain; reviewer `code-reviewer`. Escalation
triggers → HIGH: the scanner grows a write path, touches saver gates/floors,
or any output line implies unmeasured savings.

## Dependencies / Build Order

4 of 20, wave-2 batch; v2.7 #3. No dependency on other wave-2 items.
Consumes shipped surfaces only: hook log (`HOOK_LOG_RELATIVE_PATH`,
`logger.ts` line shape with `agent`), `minBytesFor`, `resolveSourceKind`
(behind the new `isSaverCoveredTool` wrapper),
`resolveWorkspaceTokenSaverSettings` + `nodeResolverDeps`,
`overlayTokenSaverEventSchema` (`origin` field, LD8), `tokensFromBytes`.
Changeset required (new public CLI command + stats/core API):
`@megasaver/stats`, `@megasaver/core`, `@megasaver/cli` minor.

## Freshness Reconciliation (08-06 → 08-13)

- Hook-log line gained `agent: "claude-code"` and new categories
  (Task/BashOutput/Monitor/WebFetch/WebSearch/ToolSearch, wave 1) — parser
  mirrors the shipped `logger.ts` shape.
- exec-rewrite (#1) shipped: LD8 `origin` on overlay events, LD12
  PostToolUse exemption, exec-live `storeRawOutput`. The 08-06 taxonomy had
  no answer for rewritten calls → `command_unmeasured` + windowed
  origin-split context (Locked Decisions 3, 5).
- The 08-06 `noSizeEvidenceCalls` single bucket is split: command rows
  carry the rewrite caveat; read/search rows stay plain unmeasured counts.
- The 08-06 `below_floor` measurement is corrected: `stat.isFile()` guard
  (directory `path` values from Grep/Glob/LS would otherwise mint fake
  measured bytes). Top-5 rollup added per user decision 2026-08-13.
- Ledger read is the shipped overlay layout (`<workspaceKey>/<liveSessionId>
  .events.jsonl`), not `readWorkspaceTokenSaverTotals` (no origin split).
- P1 first-sight repeat passthrough and non-compressed record decisions
  remain invisible to artifacts; not claimed, noted in caveats.

## Open Questions

1. Hook-failure surface: `readHeartbeatView` exposes per-workspace failure
   counts (`payload`/`resolve`/`record`) — a "hook installed but failing"
   warning line could ride the same report. Deferred; needs its own
   windowing story (heartbeat registry TTL).
2. Hook-log rotation/`--since`: the log grows unbounded; a windowing flag
   likely lands with a shared rotation policy, not per-command.
3. Should `mega doctor` link here when exposure is nonzero? Separate spec.
