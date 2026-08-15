---
feature: silent-failure-monitor
date: 2026-08-06
risk: MEDIUM
status: draft-design
pending: [user-spec-review]
reviewers: [code-reviewer]
build-order: "7 of 20 (wave-2 batch)"
freshness: |
  Reconciled 2026-08-15: compaction-guard surfaces (listOverlayChunkSets,
  CAPSULE_FILENAME, workStateCapsuleSchema) are unshipped — Decision 8 +
  Dependencies amended to degrade those legs by construction (v1 hardcodes
  chunkSets: [] / capsule: undefined; read-index leg carries the phantom
  detector). claim-verification-gate (childExitCode + Stop plumbing) lands
  via PR #355. mega alerts Pro surface + citty mode-flag decision re-verified
  at impl time. Cross-batch contracts intact (no network I/O in hook paths,
  no new ledger, no transcript reading).
---

# Silent-Failure Monitor (wave-2 #7)

## Problem

41% of agent failures go unnoticed (research scan, proposal 4:
`wiki/syntheses/llm-code-problems-research-2026-07.md` — taxonomy:
tool-call errors, context overflow, partial-completion delusion,
permission overreach, hallucinated state). Mega Saver already holds
the raw signals locally: command receipts with `childExitCode`
(batch-1 claim-verification-gate,
`2026-08-06-claim-verification-gate-design.md` Decision 1), overlay
chunk-sets whose `source` carries redacted file paths / command lines
(`packages/content-store/src/chunk-set.ts:22`), the per-session
sha256 read-index (`packages/context-gate/src/read-index.ts`),
expansion rows (`kind: "expansion"`, `packages/stats/src/event.ts:28`),
and the compaction capsule (batch-1 compaction-guard). Nothing joins
them into a failure report. Evidence exists; the monitor does not.

## Goal

1. `mega alerts --failures` — free, session-scoped report running
   four detectors over existing stores; alerts-style table + `--json`;
   per-detector opt-out; `--strict` CI exit.
2. Opt-in, off-by-default Stop-hook scan that warns when the session
   stops with an unresolved failing receipt (partial-completion).
3. Honesty: a detector whose backing signal is absent reports
   `no-signal` with the reason — it never guesses.

## Non-Goals (YAGNI)

- NO new capture. v1 reads existing stores only: no schema fields, no
  new ledger, no transcript reading (`transcript_path` untouched —
  same posture as claim-verification-gate Non-Goal 1).
- No permission-overreach detector (taxonomy category 5): no local
  signal exists today. Deliberately out, not silently missing.
- No registry `--session` mode. `mega verify claims` covers registry
  sessions; the monitor covers live/overlay sessions (complementary).
- No blocking: the Stop hook never emits `decision: "block"`.
- No semantic/LLM judgement of "acknowledged". Detectors use store
  joins only and label results as candidates.
- No persistence of reports or of the scanned input text.

## Locked Decisions

1. **Surface = `mega alerts --failures` mode flag, not a subcommand.**
   `mega alerts` verified real (`apps/cli/src/commands/alerts.ts`,
   Pro-gated anomaly report). Verified against installed citty
   (`dist/index.mjs` `runCommand`): when `subCommands` exist, the
   first non-dash rawArg is resolved as a subcommand name and unknown
   names throw `E_UNKNOWN_COMMAND` — adding subcommands would break
   the shipped `mega alerts --days 30`. The mode flag extends the
   alerts home (research proposal: "extends `mega alerts`") with zero
   breakage. The failures branch runs BEFORE the entitlement gate and
   is free; the Pro anomaly path and its stable `--json` contract are
   untouched (`--days` combined with `--failures` is a usage error).
2. **Closed 4-detector union:** `tool-error`, `context-overflow`,
   `partial-completion`, `hallucinated-state`. Opt-out via
   `--no-tool-errors` / `--no-overflow` / `--no-partial` /
   `--no-hallucinated` (citty parses `--no-X` to `false` for a
   boolean arg with `default: true` — verified empirically against
   the installed version).
3. **Overlay targeting, writer/reader parity.** `workspaceKey =
   encodeWorkspaceKey(cwd)` (same derivation as the intent hook);
   session = `--live-session <id>` or newest by last-event
   `createdAt` across `<storeRoot>/stats/<wk>/*.events.jsonl`
   (data-derived, never mtime — deterministic tests, no timing-tight
   assertions).
4. **Input text is explicit only** (`--file <path>` or piped stdin),
   capped at `MAX_FAILURES_INPUT_BYTES = 8_388_608` (the C3 cap).
   It feeds only the reference legs (overflow chunk refs,
   hallucinated-state paths). No input → those legs are `no-signal`.
5. **Failing receipt** := overlay `sourceKind: "command"` event with
   `childExitCode` present and ≠ 0 (`null` = bound-killed child,
   counts as failing). Absent = pre-gate row = unrecorded, excluded —
   zero recorded rows drives `no-signal`, never a guess. This spec
   consumes the field; it adds no writer.
6. **Unresolved/unacknowledged** := failing receipt with (i) no later
   in-window command receipt with `childExitCode === 0` and (ii) no
   later expansion row (`kind: "expansion"`) carrying its
   `chunkSetId`. Reported as "unacknowledged-failure candidate" —
   honest naming for a store-side proxy of "next turn never
   acknowledged".
7. **Stop hook shares the gate's plumbing, triggers disjointly.**
   Reuses claim-verification-gate's `Stop` hook-settings entry and
   `hasStopHook`/`addStopHook`/`removeStopHook`
   (`packages/connectors/claude-code/src/hook-settings.ts:324`, the
   `:413`/`:421` SessionStart-pair mirror). Sharp delineation: the
   gate reminds iff ZERO in-window command receipts exist (claims
   lack evidence); the monitor warns iff ≥1 unresolved FAILING
   receipt exists (failure evidence outstanding). The triggers are
   mutually exclusive by construction. Off by default;
   `mega alerts --failures --enable-hook` / `--disable-hook` toggle a
   second Stop entry keyed by subcommand (`mega hooks failure-scan`;
   two same-event entries coexist — guard-hook precedent).
8. **Hallucinated-state is 3-way; only `phantom` is a finding.**
   A referenced path resolved against cwd is `captured` when
   `hashPath(abs)` hits the read-index; `exists-uncaptured` when on disk
   but never captured (the saver captures only
   `Read/LS/Bash/Grep/Glob/WebFetch` — `apps/cli/src/hooks/saver.ts:28`
   — so agent-written files legitimately miss the index; also absorbs
   hash misses from symlink/case variance); `phantom` when neither
   captured nor on disk. Existence probes run only for paths contained
   in cwd; outside-workspace refs are listed as `outside-workspace`
   info, never probed.
   AMENDED 2026-08-15: the chunk-set `source.kind === "file"` capture
   leg is DEFERRED until compaction-guard lands (`listOverlayChunkSets`
   unshipped). v1 capture = read-index leg only; the snapshot returns
   `chunkSets: []` by construction, and the no-signal condition is
   `readIndex === undefined`. When compaction-guard ships, the chunk-set
   leg is re-enabled additively.
9. **Patterns are linear by construction and fenced.** Chunk refs:
   `/\bcs-[0-9a-f]{8,64}\b/g` (matches the saver's content-derived
   `cs-<sha256-prefix>` ids, `saver.ts:425`). Path refs: whitespace/
   quote tokenizer, then a per-token anchored bounded validator — no
   scanning regex over the whole input. Both ship with the
   growth-ratio guard suite ([[concepts/redos-guard-testing]]:
   non-vacuity minimum match count, n-vs-4n min-per-size ratio,
   revert proven red).
10. **Redact on echo.** Every string the report or hook prints
    (labels, paths, excerpts) passes `@megasaver/policy` `redact()` at
    render time — defense in depth over persist-time redaction.
11. **Window:** `--window` minutes, default 240, range 1..1440.
    `--strict` exits 1 iff any enabled detector has findings
    (`no-signal` is not a finding); default exit 0.

## Architecture

```
mega alerts --failures [--live-session i] [--window m] [--file p|stdin]
            [--json] [--strict] [--no-<detector> x4] [--store p]
  wk = encodeWorkspaceKey(cwd); sid = flag | newest-by-createdAt
  snapshot = { events:    readOverlayEvents({root}, wk, sid)   (core)
               chunkSets: []               (compaction-guard M-dep, v1 hardcode)
               readIndex: loadReadIndex(content/<wk>/<sid>)    (M6 re-export)
               capsule:   undefined        (compaction-guard M-dep, v1 hardcode)
               refs:      scanRefs(inputText?) }
  detectSilentFailures(snapshot, {windowMinutes, now, cwd, enabled})
    -> DetectorResult[4]  (findings | clear | no-signal | disabled)
  -> alerts-style "[axis] message" + "no signal:" + "fix:" lines
  -> --json: SilentFailureReport, ALWAYS JSON incl. the empty case

Stop {session_id, cwd} -> mega hooks failure-scan   (opt-in)
  readOverlayEvents -> unresolved failing receipt in window?
  -> hookSpecificOutput.additionalContext warn ; else silent ; exit 0
```

## Components

- **M1 `apps/cli/src/commands/failures/scan-refs.ts`** — `scanRefs`,
  `MAX_FAILURES_INPUT_BYTES`; pure, fenced per Decision 9.
- **M2 `failures/snapshot.ts`** — `loadFailureSnapshot`; session pick
  (Decision 3); every store read degrades to `undefined`/`[]`. v1
  hardcodes `chunkSets: []` / `capsule: undefined` (compaction-guard
  surfaces unshipped — Decision 8 amendment).
- **M3 `failures/detectors.ts`** — four pure detector functions +
  `detectSilentFailures`; closed `DetectorId` union; verdicts per
  Decisions 5–8.
- **M4 `failures/report.ts` + `failures/index.ts`** —
  `runAlertsFailures` (cli-test-pattern shape) + renderer;
  `alerts.ts` gains the flags and an early `--failures` branch.
- **M5 Stop hook** — `apps/cli/src/hooks/failure-scan-run.ts` +
  `commands/hooks/failure-scan.ts`; `buildHookCommand` union +
  `"failure-scan"`; enable/disable via the gate's Stop helpers.
- **M6 core re-exports** — `loadReadIndex`, `hashPath` added to the
  existing `@megasaver/context-gate` re-export block
  (`packages/core/src/context-gate.ts`; precedent: `readOverlayEvents`
  at `:91`).

## Error handling

- Usage errors (bad `--window`, `--days`+`--failures`, oversized or
  unreadable `--file`) → message to stderr, empty stdout, exit 1
  (JSON policy; helpers in `apps/cli/src/errors.ts`).
- Store anomalies are data, not crashes: `readOverlayEvents` already
  skips malformed JSONL lines; missing workspace/session dirs, absent
  read-index, or a capsule failing `workStateCapsuleSchema.safeParse`
  → the affected detector reports `no-signal`, exit stays 0.
- Hook mirrors `runSaverHookFromProcess`: outer try/catch, always
  exit 0, prints nothing on any failure (hooks always exit 0).

## Security & privacy

- Redact-on-echo per Decision 10; nothing from the scanned input is
  persisted; chunk CONTENT is never read — only ids, sources, and
  event metadata.
- Existence probes are metadata-only (`existsSync`) and confined to
  cwd-contained paths (Decision 8); no probe outside the workspace.
- Stop-hook copy is one fixed sentence plus a count and one redacted
  label; no session detail beyond what the payload handed the hook.
- ReDoS discipline per Decision 9; input cap per Decision 4.

## Testing (TDD — red first; detail in plan)

| Layer | Test |
|-------|------|
| scanRefs | chunk-id positives/negatives, path token classes, dedupe/order, cap |
| ReDoS guard | non-vacuity (min match count), n-vs-4n growth ratio (min-per-size, explicit timeout), revert proven red |
| snapshot | newest-session pick from injected `createdAt`; every absent store → degraded fields |
| detectors | per-detector findings/clear/no-signal; window edges; expansion resolves; `null` exit failing; phantom vs exists-uncaptured vs outside-workspace |
| CLI | table + `--json` stable (incl. empty), `--strict`, all 4 opt-outs, `--days` conflict, Pro path untouched (no entitlement on failures) |
| hook | unresolved failing → envelope; resolved / none / no-exit-codes → silent; malformed payload → exit 0; trigger disjoint from the gate's |
| redaction | secret-bearing label/path never echoed raw through report or hook |

## Risk & process

MEDIUM (§12): read-only reporters + a warn-only opt-in hook; consumes
schemas, writes none. Reviewer: `code-reviewer`. Worktree default
(§4). Escalation → HIGH if: any detector writes store data; the hook
gains blocking power; reference scanning moves into a hook hot path
against unbounded input; or the Pro `--json` AlertsReport contract
changes.

## Dependencies / build order

7 of 20 (wave-2 batch). Consumes batch-1 surfaces: claim-verification-
gate `childExitCode` rows + Stop plumbing (3 of 11) and
compaction-guard `listOverlayChunkSets` + `CAPSULE_FILENAME` +
`workStateCapsuleSchema` (2 of 11). AMENDED 2026-08-15: the
compaction-guard surfaces are unshipped; v1 builds WITHOUT them —
the snapshot hardcodes `chunkSets: []` and `capsule: undefined`, so the
dependent legs (chunk-set source capture, capsule annotation) degrade
to no-signal by construction, not by runtime absence. Landing order
cannot make the monitor lie; when compaction-guard lands, the legs are
re-enabled additively (Decision 8 amendment). Everything else is
shipped: overlay events (core re-export, `packages/core/src/index.ts:254`),
read-index (#181), redact, hook installer (PR #141). No new packages,
no new deps (pnpm catalog not in play). Changesets: `@megasaver/cli`,
`@megasaver/core`, `@megasaver/connector-claude-code` (DoD #9).

## Open questions

- ASSUMPTION (inherited from the gate): Stop-hook stdout accepts
  `hookSpecificOutput.additionalContext`; fallback `systemMessage`.
- ~~Chunk-set file-source equality uses `redact(abs)` string match; a
  secret-bearing path rewritten by redaction may miss — the
  read-index leg (`hashPath`, redaction-free) still matches. Accept?~~
  RESOLVED 2026-08-15: the chunk-set source leg is deferred until
  compaction-guard lands (Decision 8 amendment); v1 capture is the
  read-index leg only, so the redact-string equality question does not
  arise in v1.
- Escalate `exists-uncaptured` to a finding once Write capture
  exists? Deferred.
- Fold a failure axis into the Pro anomaly report later? Deferred.
