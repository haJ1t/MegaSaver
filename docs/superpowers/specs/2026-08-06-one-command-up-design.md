---
feature: one-command-up
date: 2026-08-06
risk: HIGH
status: draft-design
pending: [user-spec-review, architect-pass]
reviewers: [code-reviewer, critic]
build-order: "19 of 20 (wave-2 batch)"
---

# One-Command Up (`mega up` / `mega down`)

## Problem

Our #1 competitive gap is the activation funnel. RTK's biggest structural win
is `brew install rtk && rtk init -g` — one command — while ours is npm
install → hook install → workspace enable → daemon → GUI
(wiki/syntheses/rtk-competitive-analysis-2026-08-01.md §3.1). We have
`mega init` (apps/cli/src/commands/init.ts:44), but it is continue-and-report
onboarding: it prints a 4-line intent list (not the actual writes), records
nothing, verifies nothing, and has no reverse. There is no way to see exactly
what will be written to the operator's `~/.claude/settings.json` before it
happens, no drift report on re-run, and no `mega down`.

## Goal

`mega up` collapses activation into one idempotent PLAN → APPLY → VERIFY
transaction; `mega down` reverses exactly what a recorded manifest says `up`
did — never more. Re-running `up` is a drift report plus a repair plan, not a
blind rewrite. Verification claims only what hook telemetry has observed.

## Non-Goals

- Proxy routing. `env.ANTHROPIC_BASE_URL` is never read or written. That is
  the pending persistent-proxy-routing spec's territory
  (docs/superpowers/specs/2026-07-02-persistent-proxy-routing-design.md,
  status draft, risk CRITICAL) — explicitly out of scope for `up` v1.
- Daemon lifecycle. No spawn, no kill, no LaunchAgent (see Architecture).
- Agent-binary detection for non-Claude agents (Codex/Cursor/Aider install
  probing). v1 detects and activates the Claude Code surface; other connector
  targets only via explicit `--target`.
- MCP bridge install (`mega mcp install`) — stays in `mega init` v1 (Open
  questions #1).
- Removing or deprecating `mega init` (Open questions #2).
- Store-data reversal: `down` never deletes registry projects, sessions,
  stats, or chunk sets. It reverses agent-visible config writes only.

## Locked Decisions

1. **Three recorded apply steps, all existing installers, nothing invented:**
   hooks → `installClaudeCodeHook` (packages/connectors/claude-code/src/
   hook-settings.ts:540), connector block → `runConnectorSync`
   (apps/cli/src/commands/connector/sync.ts:47), workspace enable →
   `runSessionSaverWorkspaceEnable` (apps/cli/src/commands/session/saver/
   workspace.ts:55). Apply order is hooks → connector → saver.
2. **PLAN before any write.** The plan names each file/record and the action:
   `install | repair | ok | conflict`. `--plan` stops there. Interactive TTY
   without `--yes` prompts (`confirmYesNo`, init.ts:107). **Non-TTY without
   `--yes` prints the plan and exits 1 writing nothing** — a deliberate
   fail-closed divergence from `mega init`'s proceed-on-CI behavior, because
   `up` writes the operator's global settings.
3. **Manifest is store-persisted and atomic:**
   `<storeRoot>/up/<workspaceKey>/manifest.json`, Zod-validated, rewritten
   tmp+rename after EACH completed step, guarded by `withFileLock`
   (`@megasaver/shared/node`, packages/shared/src/file-lock.ts:25). Each step
   records the PRIOR observed state, so `down` can restore rather than blank.
   For the connector step the prior is an enum
   (`missing | no-block | block`), not the prior block content — see
   Decision 4 for what that means on `down`.
4. **`down` reverses only manifest-recorded deltas.** Hooks are uninstalled
   (`uninstallClaudeCodeHook`, hook-settings.ts:568) only if the manifest says
   hooks were not connected before `up`. Saver activation is restored to the
   recorded prior `{enabled, mode}` via `writeActivation`. Connector files:
   the Mega Saver sentinel block is stripped only for recorded targets whose
   prior was `missing` or `no-block`; everything outside sentinels is
   untouched. A target whose prior was `block` is left AS-REFRESHED — `up`
   only rewrote content inside sentinels it already owned, the manifest does
   not record prior block content, and re-materializing stale block text
   would be a blank-restore ("never more" principle). Full prior-state
   restore therefore applies to hooks and saver; the connector block is
   ours by construction.
5. **Foreign-value posture mirrors the proxy conditions**
   (wiki/agent-channel.md, 2026-07-02 18:20, condition 3: never overwrite a
   foreign `env.ANTHROPIC_BASE_URL`; on disable remove only if the value
   equals ours). Every `up`/`down` write inherits that stance: hook removal is
   command-level and keeps co-located foreign hooks (hook-settings.ts
   `stripCommand`, :344); an unparseable settings.json is a `conflict` —
   fail-closed, shown, never rewritten.
6. **Re-run = drift report + repair.** The plan IS the drift report.
   `installClaudeCodeHook` already value-diffs and repairs drifted matchers in
   place instead of no-opping on presence (hook-settings.ts:558–565) — `up`
   surfaces that as `repair` before applying it. Connector drift comes from
   the existing status comparison (connector/status.ts upsert-equality).
7. **Verify claims only observed events.** Active probe reuses the
   doctor-saver E22.4 pattern (apps/cli/src/commands/doctor-saver.ts:440):
   spawn the EXACT registered saver command with a synthetic benign payload,
   assert exit 0 AND invocation+completion heartbeat advance
   (`readHeartbeatView`, @megasaver/context-gate). Hooks that cannot be
   probed without a live agent session (pre-log, intent, warmup, guard)
   report **"installed, not yet observed"** — never "✓ working" without an
   observed event (honest-metrics ethos; hooks always exit 0, so exit codes
   alone prove nothing).
8. **Daemon is lazy-spawn, not an `up` write.** The saver hook prefers a
   running daemon and falls back in-process, counting the fallback
   (apps/cli/src/hooks/saver-run.ts:104–136; `getRunningDaemon`;
   `spawnDaemon` exists at packages/daemon/src/spawn.ts:17 for callers that
   want it). A process is not durable state: nothing to record, nothing for
   `down` to undo, and supervising process lifecycle is the CRITICAL-class
   supervisor spec's job. Verify reports daemon presence informationally.
9. **GUI is a handoff, not a write.** Default off; `--gui` opens it after the
   report (init.ts:88 precedent). No manifest entry.
10. **Transaction = fail-fast + idempotent resume, not auto-rollback.** A
    failed step stops apply; completed steps stay recorded; re-running `up`
    repairs the remainder. Auto-rollback would double writes to the
    operator's settings on transient failures; `mega down` is the explicit
    undo.

## Architecture

```
mega up
  DETECT  read-only: settings.json hook state (readClaudeCodeHookStatus,
          hook-settings.ts:604), connector target file state (readTargetFile
          + parseBlock + upsert-equality, connector/status.ts), saver
          activation (resolveWorkspaceTokenSaverSettings,
          packages/context-gate/src/resolve-saver-settings.ts:68)
  PLAN    pure diff: DetectedState -> UpPlan (install|repair|ok|conflict per
          step) -> printed; stop on --plan / declined prompt / non-TTY
  APPLY   per step: record prior -> run existing installer -> append result
          -> atomic manifest rewrite (withFileLock + tmp/rename)
  VERIFY  saver self-test probe + heartbeat delta; passive surfaces named
          ("installed, not yet observed"); daemon presence informational
mega down
  read manifest -> plan reversal (same confirm gates) -> reverse recorded
  deltas only -> rewrite manifest with reversal record
```

All new code is CLI orchestration in `apps/cli/src/up/` (init.ts precedent),
plus ONE connector-package addition: `planClaudeCodeHookInstall` on
`@megasaver/connector-claude-code` — a pure dry-run factored out of
`installClaudeCodeHook`'s existing value-diff (hook-settings.ts:558–565), so
PLAN can report install/repair/ok before any write (Locked Decisions 2 and 6;
`readClaudeCodeHookStatus` exposes only presence booleans, not the
value-diff). Claude-Code-specific writes stay behind
`@megasaver/connector-claude-code` (agent-agnostic core untouched, §1). Settings writes only ever go through
`writeSettingsFile` — the single-writer invariant for the file holding the
operator's `ANTHROPIC_API_KEY` (packages/connectors/claude-code/src/
settings-write.ts:15).

## Components

1. `apps/cli/src/up/manifest.ts` — Zod schema v1 (steps as a discriminated
   union on `kind: hooks-install | connector-sync | saver-enable`, each
   carrying prior state), `readUpManifest` / `writeUpManifest` (atomic,
   locked). `workspaceKey = encodeWorkspaceKey(cwd)`.
2. `apps/cli/src/up/detect.ts` — `detectUpState` gathering the three
   surfaces; settings parse failure ⇒ `conflict`, distinguished from absent.
3. `apps/cli/src/up/plan.ts` — pure `buildUpPlan(state)` + renderer
   (`--json` parity).
4. `apps/cli/src/up/apply.ts` — dependency-injected executors (RunInitDeps
   pattern, init.ts:14) so tests never touch real `~/.claude`; resolves or
   creates the registry project for connector sync (reusing
   `runProjectCreate`, apps/cli/src/commands/project.ts:112; creation is
   recorded, never reversed — store data).
5. `apps/cli/src/up/verify.ts` — injectable spawn (DoctorSaverDeps.spawn
   shape), heartbeat before/after, honest wording.
6. `apps/cli/src/commands/up.ts`, `apps/cli/src/commands/down.ts` — Citty
   commands registered in apps/cli/src/main.ts:60; flags: `--yes`, `--plan`,
   `--mode`, `--exact`, `--target` (repeatable), `--settings`, `--store`,
   `--gui` (up only), `--json`.
7. `packages/connectors/claude-code/src/hook-settings.ts` —
   `planClaudeCodeHookInstall(input: InstallClaudeCodeHookInput):
   ClaudeCodeHookResult`, exported from the package index: the only new
   public connector API (a `@megasaver/connector-claude-code` minor
   changeset accompanies it alongside the `@megasaver/cli` one).

## Error handling

- Unresolvable store / invalid mode / unknown target: existing
  `mapErrorToCliMessage` / `invalidModeMessage` / `invalidTargetMessage`
  paths, exit 1.
- Settings unparseable: `conflict` in plan; apply refuses that step, exit 1.
- Lock not acquired (`withFileLock` returns false): "another mega up/down is
  running", exit 1, nothing written.
- Corrupt manifest on `down`: refuse with the Zod error and point at
  `mega hooks uninstall` / `mega session saver workspace disable` as the
  manual path; never guess a reversal.
- Verify probe failure: apply results stand; verify FAIL reported with the
  doctor repair hint; exit 1.

## Security & privacy

- settings.json holds the operator's API key: single-writer
  `writeSettingsFile` only (symlink refusal, mode preservation, fsync); `up`
  never prints settings content — plan output names keys and paths, not
  foreign values.
- Manifest contains paths, booleans, modes, timestamps — no secrets.
- No new network, no telemetry, no LLM calls (`claude-api` not triggered).

## Testing

- Every test injects a temp `settingsPath` and temp `storeRoot` — the
  connector tests never touch the real `~/.claude` (hook-settings.ts:639
  SAFETY comment; wiki/workflows/cli-test-pattern). No timing-tight tests;
  `now`/`spawn`/prompt are injected.
- Round-trip property: `up` then `down` on a fixture settings.json carrying
  foreign hooks and foreign env leaves the foreign content byte-identical
  (JSON-normalized) and removes only ours.
- Idempotence: second `up` plans all-`ok` and appends no duplicate steps.
- Prior-state restore: saver previously enabled (aggressive) → `up` (mode
  balanced) → `down` restores enabled+aggressive, not disabled.
- Conflict fence: unparseable settings fixture → plan `conflict`, apply
  refuses, file bytes untouched.

## Risk & process

HIGH (§12: user-global settings writes, connector core path, public CLI
flags). Worktree `feat/one-command-up`, no `main` edits; architect design
pass pending (frontmatter); reviewers: `code-reviewer` AND `critic`, separate
passes, author ≠ reviewer. DoD 5 evidence: captured terminal session of
`up` (plan + apply + verify), re-run drift report, and `down` restore against
a temp settings path. Flagged for reviewer attention: `down` deletes a
connector file only when the manifest says `up` created it AND the post-strip
content is empty — reviewers may strike the deletion to "leave empty block
stripped file" if judged CRITICAL-adjacent.

## Dependencies / build order

19 of 20 in the wave-2 batch; no blocking dependency. Reuses shipped
saver-activation-inheritance resolver surfaces. Explicitly sequenced BEFORE
any proxy work: persistent-proxy-routing (CRITICAL, draft) remains untouched
and unblocked.

## Open questions

1. Fold `mega mcp install` in as a fourth recorded step in v1.1?
2. `mega init` fate: alias onto `up --gui --yes`-style flow, or keep both?
3. Wave-3 multi-agent detect: probe agent binaries/config dirs for the six
   generic-CLI targets, or stay file-state-based?
4. Should verify optionally tail `mega hooks status` heartbeat recency on a
   later run (`mega up --verify-only`) as the "now observed" upgrade path?
