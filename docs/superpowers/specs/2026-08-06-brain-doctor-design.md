---
feature: brain-doctor
date: 2026-08-06
risk: MEDIUM
status: draft-design
pending: [user-spec-review]
reviewers: [code-reviewer]
build-order: "10 of 20 (wave-2 batch)"
---

# Brain Doctor — `mega brain doctor` (roadmap 2.3)

## Problem

The memory layer now has stale flags, 30-day decay, bi-temporal lineage,
conflict classes, code-truth badges, an approval backlog, capture hooks, and
E2E sync — but no single surface tells the user whether their brain is
healthy. Signals are scattered across `mega memory review`, `mega memory
verify`, `mega hooks status`, and `mega brain sync status`. The roadmap 2.3
gate (wiki/syntheses/solo-developer-roadmap.md): "Every finding is explainable
from local evidence and points to an existing repair."

## Goal

A deterministic, read-only health report over one project's agent memory:
`mega brain doctor <project>`. Six finding families — stale/decayed memories,
contradicted entries, lineage conflicts, suggestion backlog, hook coverage,
sync freshness. Each finding carries severity, a local-evidence citation
(entry id or file path), and an EXISTING repair command. Output: human table
plus `--json`.

## Non-Goals (YAGNI)

- Repairing anything. Brain Doctor mutates zero memory entries, settings, or
  sync state — it only points at `mega memory review/approve/reject/sweep/
  verify`, `mega brain sync init/push/status`, `mega hooks install`.
- Network calls. Sync freshness is judged from local `brain-sync.json` state
  only; the live check stays `mega brain sync status`.
- New detectors. Every finding reuses an existing disclosure surface
  (`checkConflicts`, `verificationBadgeFor`, supersession lineage, decay
  half-life, `readClaudeCodeHookStatus`, brain-sync `lastSeen`).
- Duplicate detection, LLM scoring, cross-project reports, GUI panel, watch
  mode, autofix flags (`--fix` is explicitly rejected — MEDIUM depends on it).
- Observation (LM1) hygiene — owned by batch-1 long-memory-ga
  (`2026-08-06-long-memory-ga-design.md`: candidate expiry, contradiction
  flagging at promotion). The write-side gate is owned by wave-2
  memory-write-verify. Brain Doctor is the reporting layer over both.

## Locked Decisions

1. **Read-only, no exceptions.** The only write is the established
   `ensureStoreReady` store bootstrap every read command already performs
   (`apps/cli/src/commands/memory/review.ts`). No entry mutation, ever.
2. **Deterministic with injected `now`.** All age math takes an ISO `now`
   argument (mirrors `effectiveConfidence` / `isRecallable` in
   `packages/core/src/memory-entry.ts`). No wall-clock reads in core logic;
   the CLI wrapper injects via `MEGA_TEST_NOW` per
   wiki/workflows/cli-test-pattern.md.
3. **Core/CLI split by agnosticism.** Memory findings are agent-agnostic →
   new pure module `packages/core/src/brain-doctor.ts`. Hook coverage
   (Claude-Code-specific, via `@megasaver/connector-claude-code`) and sync
   freshness (via `@megasaver/brain-sync`) are composed in the CLI command,
   never in core (§1 non-negotiable).
4. **Decay threshold = 2 half-lives.** `DECAY_HALF_LIFE_MS` (30d,
   memory-entry.ts:205) becomes an exported const; "decayed" = age since
   `lastActiveAt ?? updatedAt ?? createdAt` > 2 × half-life (weight ≤ 0.25).
5. **"Recallable now" reuses `isRecallable`** (memory-entry.ts:176) — the
   single approval+validity+tier gate. No parallel predicate.
6. **Bounded conflict scan.** Pairwise `checkConflicts` runs over at most
   `DOCTOR_CONFLICT_SCAN_CAP = 200` approved+recallable entries (most recent
   first, id tiebreak); over-cap emits a `conflict-scan-truncated` info
   finding. Only `contradiction` outcomes are reported.
7. **Sync freshness is local-only:** `loadConfig(storeRoot)` +
   `deriveBrainId(key, projectName)` + `lastSeen[brainId] ?? 0`
   (packages/brain-sync/src/config.ts, brain-id.ts). Generation 0 = never
   synced. Missing config = not configured (info, not an error).
8. **Free command, exit 0 on findings.** No Pro upsell gate (2.3 targets
   activation/retention). Exit 1 only for operational failures (bad store,
   unknown project) via `mapErrorToCliMessage`. Findings never fail the exit.
9. **Finding granularity:** one finding per affected entry for entry-scoped
   checks (stale, decayed, contradicted, lineage); one aggregate finding for
   backlog, hook coverage, sync freshness, scan truncation.

## Architecture

```
mega brain doctor <project> [--store] [--json]
  └─ runBrainDoctor (apps/cli/src/commands/brain/doctor.ts)
       ├─ resolveStorePath → ensureStoreReady → registry.listMemoryEntries(projectId)
       ├─ core: diagnoseMemoryHealth(entries, now)          [pure, agent-agnostic]
       ├─ cli:  buildHookCoverageFindings(readClaudeCodeHookStatus({settingsPath}))
       ├─ cli:  buildSyncFreshnessFindings(storeRoot, projectName)   [local files only]
       └─ render: aligned table (severity | check | evidence | repair) or --json
```

## Components

### 1. Core analyzer — `packages/core/src/brain-doctor.ts` (new)

`DoctorSeverity = "info" | "warn" | "error"`. `DoctorFinding = { check,
severity, message, evidence: { entryIds?, files? }, repair }`.
`diagnoseMemoryHealth(entries, now)` → `{ findings, summary }` where summary =
`{ total, recallableNow, suggested, staleFlagged }`.

| Check | Evidence (local) | Severity | Repair pointer |
|---|---|---|---|
| `stale-flagged` | `entry.stale === true` (id) | warn | `mega memory sweep <project>` (archives stale) or `mega memory update <id> --no-stale` after re-check |
| `decayed` | age > 2×`DECAY_HALF_LIFE_MS`, approved+recallable, not stale (id, age in days) | info | `mega memory sweep <project>` |
| `contradicted-by-code` | `verificationBadgeFor(entry) === "contradicted-by-code"` (id, `lastVerified.headSha`) | error | `mega memory verify <project>` then `mega memory update`/`reject <id>` |
| `rule-contradiction` | `checkConflicts` outcome `contradiction` (both ids, reason `rule_polarity_divergence`) | warn | `mega memory reject <id>` for the wrong side |
| `lineage-conflict` | approved entry whose `supersedesId` target is still open (`validTo == null`) and recallable — `applySupersession` never closed it (both ids) | error | `mega memory history <id>` then `mega memory reject <superseded-id>` |
| `lineage-conflict` (dangling) | `supersedesId` target not found (id) | warn | `mega memory history <id>` |
| `suggestion-backlog` | count of `approval === "suggested"` + oldest `createdAt` age | info; warn if count ≥ 10 or oldest ≥ 14d | `mega memory review <project>` then `mega memory approve <id>` |

Additive core change: export `DECAY_HALF_LIFE_MS` from memory-entry.ts; export
the new module from `packages/core/src/index.ts`.

### 2. Hook coverage — CLI-side builder

`buildHookCoverageFindings(status: ClaudeCodeHookStatus, settingsPath)`.
Consumes `readClaudeCodeHookStatus`
(packages/connectors/claude-code/src/hook-settings.ts:604): `connected ===
false` → warn, repair `mega hooks install claude-code`; individual missing
optional hooks (warmup/guard/cacheAdvice) → info. Evidence file:
`settingsPath` (resolved via `resolveClaudeCodeSettingsPath(env)`, injectable
in tests).

### 3. Sync freshness — CLI-side builder

`buildSyncFreshnessFindings({ storeRoot, projectName })`: config missing →
info "sync not configured", repair `mega brain sync init <project>`; keyfile
unreadable → warn; `lastSeen[brainId] ?? 0 === 0` → warn "never synced",
repair `mega brain sync push <project>`; otherwise info line with local
generation, pointer `mega brain sync status <project>` for the live check.
Evidence file: `configPath(storeRoot)` (= `<storeRoot>/brain-sync.json`).

### 4. Command — `apps/cli/src/commands/brain/doctor.ts` (new)

Citty `defineCommand` per cli-test-pattern: positional `projectName`, flags
`--store`, `--json`; inner `runBrainDoctor(input): Promise<0 | 1>` with
env-slice + `stdout`/`stderr` callbacks + injected `now`/`settingsPath`.
Registered as `doctor` in `apps/cli/src/commands/brain/index.ts` subCommands.
`--json` emits one `JSON.stringify({ project, generatedAt, summary, findings })`.

## Error handling

- Store/project errors → `mapErrorToCliMessage` / `projectNotFoundMessage`
  (exit 1), identical to `runMemoryReview`.
- Hook settings unreadable → `readClaudeCodeHookStatus` already returns
  all-false (its own catch); doctor reports "not connected", never crashes.
- `BrainSyncError` from `loadConfig`/keyfile → mapped to the info/warn
  findings above, never a crash (boundary Zod validation lives in brain-sync).
- Malformed timestamps → `Date.parse` NaN follows `effectiveConfidence`
  discipline: no decay finding rather than a NaN age.

## Security & privacy

- Read-only; no network; no entry content beyond title snippets (≤ 60 chars)
  in the human table; `--json` carries ids + metadata, not full content.
- Never prints keyfile bytes, endpoint credentials, or recovery codes —
  sync evidence is the config path + generation number only.
- Respects the store boundary: only `resolveStorePath` roots are read.

## Testing

TDD, red first. Core: fixture-built `MemoryEntry` objects (conflict-checker
test `mk` style), injected `now` strings, boundary cases (age exactly at
2×half-life ± 1ms, cap 200 vs 201, dedup of contradiction pairs, dangling vs
open supersession targets, backlog thresholds). CLI: cli-test-pattern —
mkdtemp store, `--store` flag, `MEGA_TEST_NOW`, temp `settingsPath`, table +
`--json` snapshots, exit codes. No timing-tight tests: all age math uses
injected `now` (repo rule). Evidence for DoD: captured smoke run on a seeded
store showing each finding family.

## Risk & process

MEDIUM (§12): read-only reporting over existing surfaces; no ranking, write
path, or schema change. Full superpowers chain; reviewer: `code-reviewer`.
Escalation triggers → HIGH: any repair/mutation behavior, any change to
`checkConflicts`/`verificationBadgeFor`/decay weights, any network I/O.

## Dependencies / build order

Wave-2 #10 of 20. Depends only on shipped surfaces (core memory schema M1/M2,
code-truth i6, brain-sync 2.1, hooks). Cross-references: batch-1
long-memory-ga (observation hygiene), wave-2 memory-write-verify (write gate)
— Brain Doctor reports over both but blocks on neither. New CLI subcommand +
core exports → changeset required (DoD #9).

## Open questions

1. Should `--json` include a stable `schemaVersion` field for future GUI
   consumption? (Default: yes, `1`.)
2. Backlog warn thresholds (10 entries / 14 days) — product-tune later;
   constants are exported for one-line adjustment.
