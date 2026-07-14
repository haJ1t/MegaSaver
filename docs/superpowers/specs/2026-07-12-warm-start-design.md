---
title: Warm Start — budgeted session boot brief for every agent
status: approved
risk: HIGH
approved-design: 2026-07-12
revised: 2026-07-12 (architect pass — 2 BLOCKER, 4 SHOULD-FIX, 4 NIT incorporated)
---

# Warm Start — budgeted session boot brief (2.2)

## Problem

Every session starts cold: the agent re-reads the repo, re-discovers
decisions, re-litigates settled arguments, and retries failed approaches —
tens of thousands of exploration tokens per session that the brain already
paid for once. Returning to a project after weeks is worse: nothing tells
the agent (or the user) what changed, expired, or was superseded in the
gap.

The memory store has everything needed to fix this (approved decisions,
current rules, open todos, failed attempts, bi-temporal validity), but no
delivery path pushes it into a session at start time. claude-mem primes
sessions free but Claude-only, unbudgeted, and unmeasured. Warm Start is
the i8 pick from `wiki/syntheses/memory-moat-portfolio.md` (user-approved
sequence, 2026-07-12).

## Locked decisions (user, 2026-07-12)

1. **Full scope in one feature**: SessionStart hook (Claude Code) +
   `mega warmup` CLI + cross-agent sentinel block + warm-start stats
   event + MCP `get_warm_start_brief`.
2. **Gating**: brief itself is free (proof surface, table stakes vs
   claude-mem). Pro: cross-agent `--write` under the existing
   `brain-portability` key; reonboard expanded body + per-session
   attribution under the existing `savings-analytics` key. No new
   entitlement key.
3. Budget default 2000 tokens; only the budget is a flag. Mode thresholds
   hardcoded.

## Design

### 1. Core assembler (pure)

`packages/core/src/warm-start.ts`:

```ts
assembleWarmStartBrief(input: WarmStartInput): WarmStartBrief
```

`WarmStartInput` = `{ projectId, branch, now, budgetTokens (default
2000), lastSeenAt: string | null, memories: MemoryEntry[],
rules: ProjectRule[], failedAttempts: FailedAttempt[], graph:
Graph | null, gitDelta: { commits: {sha, subject, date}[],
changedFiles: {path, churn}[] } | null }`.

No I/O, deterministic. Callers gather inputs (registry reads + git
commands, see §4a/§7).

Content filter: `isRecallable(m, now) && !m.stale`. `isRecallable` alone
does NOT exclude stale (memory-entry.ts gates stale in the searches, not
the predicate) — the spec test suite asserts both exclusions explicitly.
Ranking reuses `effectiveConfidence(now)`, `rankApplicableRules`, and
`searchFailedAttempts` (excluding `convertedToRule`), with failed
attempts filtered to `relatedFiles ∩ gitDelta.changedFiles`. Entity
digest = top-5 nodes of `buildGraph` output by in-degree over
`entity-mention` edges (`GraphNode` carries no mention count; derive it).
This adds a core → `@megasaver/memory-graph` dependency edge — legal (no
cycle: memory-graph depends only on shared), called out for the plan.

Output: `WarmStartBrief` = `{ text (markdown), tokenEstimate, mode,
sectionCounts }`.

### 2. Budget algorithm

Fixed section priority: (1) header — project, branch, last-visit age;
(2) current project rules; (3) standing decisions; (4) open todos
(`type=todo`, not stale); (5) failed attempts touching branch-changed
files; (6) git delta digest; (7) entity digest. Greedy fill: render item →
`estimateTokens` (reuse `packages/output-filter/src/tokens.ts`; core
already depends on output-filter, direction is fine) → stop section at
its cap, stop brief at budget. The hard invariant is on the FINAL text:
`estimateTokens(brief.text) ≤ effectiveBudget` for every input, including
adversarial long memories — per-item sums drift from the joined-text
estimate (separators, headers), so the assembler must re-check the
assembled text and trim the last section if needed. Each item renders as
one line: `[type] title — first-sentence clamp (confidence, age)`.

### 3. Freshness state + modes

**Freshness source (architect BLOCKER fix).** `sessions.json` `endedAt`
is written only by manual `mega session end` — the hook flow never
produces it, so it cannot drive modes. Instead: new per-project state
file `warm-start/<projectId>.json` = `{ lastSeenAt: string }` in the
store root, following the saver-heartbeat stamp pattern
(`recordInvocationHeartbeat`). Both the hook entrypoint and `mega warmup`
stamp `lastSeenAt = now` after assembling. Atomic tmp+rename write like
the rest of the store.

**Modes** (auto from `now − lastSeenAt`):

- `micro` (< 4h): header + rules + open todos. Effective budget is a hard
  300 regardless of `--budget` (explicit `--mode standard` escapes). No
  daily spam.
- `standard` (4h–14d): full brief, effective budget = `budgetTokens`.
- `reonboard` (> 14d): budget reallocated to "project state as of your
  last visit" — expanded git delta grouped by scope, MEMORIES whose
  `validTo`/`expiresAt` fell inside the absence window (first real
  consumer of the bi-temporal fields), and rules added since (via
  `createdAt`; `ProjectRule` has no validity fields — architect fix, the
  expired-diff applies to memories only).

`lastSeenAt === null` (first run) ⇒ `standard`.

### 4. Delivery

**(a) Claude Code — SessionStart hook**: widen
`packages/connectors/claude-code/src/hook-settings.ts`: add `"warmup"` to
the `buildHookCommand` subcommand union, add `SessionStart` to
`SettingsObject.hooks` and the `pruneHooks` key union, following the
matcher-less UserPromptSubmit precedent — the hook fires on all
SessionStart sources (startup/resume/clear); micro mode makes repeat
fires cheap. `timeoutFor` already yields 10s for non-saver hooks.
`mega hooks install` writes it (`--no-warmup` opts out); `uninstall`
removes; `status` shows it. New entrypoint
`apps/cli/src/commands/hooks/warmup.ts`: reads SessionStart JSON on stdin
(`{session_id, cwd, source}`), resolves project by cwd, gathers inputs,
assembles, prints brief to stdout, stamps `lastSeenAt`.

**(b) Codex / Cursor / Aider — sentinel block**: new
`MEGA_SAVER_WARM_START_BLOCK`. This is NOT a drop-in: `upsertBlock`
(`packages/connectors/shared/src/upsert.ts`) is hardcoded to two blocks
driven by `ConnectorContext`, which carries only
project/session/memoryEntries. Work: wire a third sentinel pair into
`upsertBlock`, extend the context (or add a parallel input) with rules,
failed attempts, and the as-of stamp, and apply the existing
anti-sentinel-injection guard (`context.ts` superRefine) to every
rendered brief line. Written by `mega warmup --write
[--target codex|cursor|aider|claude-code|all]`, refreshed by
`mega connector sync`. Block carries only timeless sections (rules,
decisions, todos, failed attempts) plus
`As of: <timestamp> — run "mega warmup --write" to refresh`. Live git
delta stays hook-only. Daemon auto-refresh on HEAD change: deferred.

**(c) MCP**: `get_warm_start_brief` tool in mcp-bridge (live package,
v1.2.2) — thin wrapper over the same assembler.

### 5. Stats event (architect BLOCKER fix — honest v1)

`TokenSaverEvent` is a measured byte record with no "estimated" marker,
and its `sourceKind` enum lives in output-filter's bounded context —
`warm_start` does not belong there, and no data source exists today for a
cold-start exploration baseline (saver events cover compressed outputs
only; proxy token counts are opt-in). Therefore v1 reports MEASURED
facts only and defers the counterfactual:

- New `WarmStartEvent` in `@megasaver/stats`:
  `{ kind: "warm_start", projectId, at, mode, briefTokens,
  estimated: true }` — its own schema and store file, NOT a
  `TokenSaverEvent`; honest-metrics segregation intact.
- Reader changes are explicit, not "automatic":
  `apps/cli/src/commands/savings/shared.ts` + `history` + `insights` gain
  a separate "Warm Start" line — sessions warmed, brief tokens injected,
  labeled "brief size (measured)".
- The "saved ~Xk exploration tokens" counterfactual claim is a NON-GOAL
  for v1. It becomes possible once a per-session exploration baseline
  exists (future: session token totals via saver heartbeats or proxy);
  the event schema's `estimated` discriminant reserves the slot.
- Per-session attribution detail view is Pro (`savings-analytics`).

### 6. CLI surface

- `mega warmup` — print brief to stdout. Flags: `--budget <tokens>`
  (default 2000, min 300, max 8000), `--mode auto|micro|standard|reonboard`
  (default auto), `--json`, `--write [--target …]` (Pro).
- `mega hooks warmup` — hook entrypoint only (stdin JSON → stdout brief).
- `mega hooks install|uninstall|status` — SessionStart entry management.

Free users invoking `--write` get the standard upsell print, exit 0.
Free users in reonboard mode get the FULL STANDARD body plus one upsell
line for the expanded absence diff (architect fix: free must never get
less content for a longer absence).

### 7. Git delta gathering (architect fix — no dead sections)

`changedFiles` primary source: `git diff --stat <merge-base(HEAD,
default-branch)>..HEAD`. Fallback chain, because on the default branch
merge-base(HEAD, default) = HEAD ⇒ empty diff ⇒ the branch-aware
failed-attempts section would be a permanent no-op for the common solo
workflow:

1. Feature branch with commits ahead of default → merge-base diff.
2. On the default branch, empty diff, or detached HEAD → union of files
   from `git log --name-only --since=<lastSeenAt>`.
3. `lastSeenAt === null` → `--since` capped at 14 days.
4. Default-branch detection: `origin/HEAD`, else `main`, else `master`;
   none found → fallback 2.
5. Git absent / not a repo / command failure → `gitDelta: null`;
   git-dependent sections skip, brief still renders.

## Error handling

Hook path is **fail-open, no exceptions**: any error (store unreadable,
git missing, project unresolved, assembler bug) ⇒ empty stdout, exit 0,
within the 10s timeout. A crashing SessionStart hook would block every
Claude Code session — this is the one place defensive handling is
mandatory. The `lastSeenAt` stamp write is also best-effort (failure ⇒
skip, never crash the hook). All other surfaces (`mega warmup`,
`--write`, MCP) report errors normally.

## Testing

TDD per process discipline; the assembler is a pure function, so the core
suite needs no I/O:

1. Budget invariant on the FINAL text:
   `estimateTokens(brief.text) ≤ effectiveBudget` — adversarial fixtures
   (huge memories, many sections).
2. Section priority order and per-section caps.
3. Content filter: unapproved, archival, AND stale memories excluded
   (stale via the explicit `!m.stale` check, not `isRecallable`).
4. Failed-attempt section empty when no `relatedFiles` intersect changed
   files.
5. Mode auto-selection at the 4h / 14d boundaries; `lastSeenAt` null ⇒
   standard; micro's hard 300 effective budget overrides a larger
   `--budget`.
6. Reonboard surfaces a memory whose `validTo` fell inside the absence
   window; rules-added-since uses `createdAt`.
7. Deterministic output for identical input.
8. Sentinel-injection guard rejects a memory title containing the
   sentinel string.

Integration: hook entrypoint stdin→stdout round-trip; fail-open (corrupt
store ⇒ empty stdout, exit 0); `lastSeenAt` stamped after a successful
hook run; git-delta fallback on default branch yields non-empty
changedFiles in a fixture repo with recent commits. Sentinel block:
upsert idempotence, hand-kept content outside the block preserved. Smoke
evidence (DoD): captured real Claude Code session showing the injected
brief, and `mega warmup --write --target codex` producing the block in
`AGENTS.md`.

## Non-goals

- Counterfactual "exploration tokens saved" estimation — v1 reports
  measured brief size only (see §5); revisit when a baseline source
  exists.
- Daemon auto-refresh of sentinel blocks on HEAD change (v2).
- LLM-generated summaries in the brief (deterministic templating only).
- New entitlement keys, pricing changes.
- Fixing approval-backlog rot (i14 Brain Autopilot's job) — noted: until
  then, agent-captured `suggested` memories don't reach briefs.

## Risks

1. Hook crash/hang blocks sessions → fail-open + timeout + `--no-warmup`.
2. Context pollution from a wrong brief → `isRecallable && !stale`, hard
   budget, micro mode.
3. Metrics honesty → v1 shows measured brief tokens only; counterfactual
   savings deferred (§5). Overclaiming would poison the proof thesis.
4. Weak moat (claude-mem / native memory converge here) → accepted:
   positioned as table stakes feeding the analytics moat; defensible parts
   are budget discipline, branch-aware failures, cross-agent delivery,
   measured reporting.
5. Stale sentinel blocks between syncs → timeless sections + as-of stamp.
6. JSON-store full read per session start — fine at hundreds of memories,
   known ceiling (weakness #5 in the portfolio page).

## Process

Risk HIGH (§12: connector core path + hooks): isolated worktree, architect
pass on this spec (done 2026-07-12, findings incorporated), TDD,
`pnpm verify`, code-reviewer AND critic passes, verifier evidence.
Estimated 2 weeks.
