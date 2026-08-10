---
feature: exec-rewrite-saver
date: 2026-08-06
risk: HIGH
status: draft-design
pending: [user-spec-review, architect-pass]
reviewers: [code-reviewer, critic]
build-order: "1 of 20 (wave-2 batch)"
---

# Exec-Rewrite Saver (wave-2 #1)

## Problem

The PostToolUse saver compresses output the client has ALREADY seen: the
in-place `tool_result` rewrite invalidates the native prompt cache
(measured 0.93–0.97x, `wiki/syntheses/saver-cache-churn.md`). Stage A
first-sight (net-positive spec §P1) stops RE-compression churn, but every
hook-path delivery still races the client's cache. RTK proved the
structural fix — rewrite the COMMAND before execution so the compressed
output is the only version that ever exists (zero churn by construction,
`wiki/syntheses/rtk-competitive-analysis-2026-08-01.md` §3.3) — but RTK
is lossy and its `rtk gain` scoreboard is fiction (96.2M tokens "saved"
while the bill rose 7.6%, ibid. §2).
`cache-write-cost-reduction-2026-08-01.md` §2 row 3 names this mechanism
as the spec'd direction: RTK's mechanism, our chunk-store losslessness.

## Goal

Opt-in PreToolUse mode that rewrites eligible agent Bash commands to run
through a live-session-keyed exec path BEFORE execution. The compressed
(chunk-store-backed, recovery-footer'd) output is the only version the
client ever caches. When the filter declines, delivery is byte-identical
raw. Failing commands always have their full raw persisted. Rewritten-path
savings are counted separately with the existing honest event pipeline —
no counterfactuals. This path needs NO first-sight ledger: nothing is ever
rewritten after the client has seen it (complements net-positive Stage A).

## Non-Goals

- Not default-on (install flag AND workspace enablement required, LD9).
- Bash only. Read/Grep/Glob stay on the PostToolUse path.
- No shell-string interpretation: pipes, quotes, env-prefixes, heredocs,
  substitutions are never rewritten (flat-token grammar only).
- No script runners (`pnpm test`, `npm run`) in v1 — Open Q2.
- No new package, no MCP tools, no new persisted file formats.
- No savings dashboard: v1 ships the `origin` event field + a pure stats
  selector; UI surfacing is follow-up.
- No change to `mega output exec` (registry-keyed) semantics.

## Locked Decisions

- **LD1 — Own hook subcommand, not a guard-run extension.** New
  `mega hooks exec-rewrite` with its OWN PreToolUse entry, matcher
  `^Bash$`. The batch-1 mesh decision (piggyback existing handlers to
  avoid spawns) governs default-on handlers; a command-REWRITING behavior
  earns an explicit, auditable, independently-removable settings.json
  entry. Piggybacking on guard would (a) add opt-in config IO to every
  Bash call for ALL users, (b) couple two output contracts in one process
  (guard emits `additionalContext`/`deny`, guard-run.ts:212-224; rewrite
  emits `updatedInput`), (c) bury a mutating capability inside a
  default-on hook. Accepted cost: +1 spawn per Bash call, opted-in only.
- **LD2 — Rewrite via `hookSpecificOutput.updatedInput`, NEVER
  `permissionDecision`.** Guard-run's "NEVER allow" discipline
  (guard-run.ts:221) holds: the user's permission system evaluates the
  REWRITTEN command itself; opt-in docs advise allowlisting the mega
  launcher. ASSUMPTION gate: Open Q1 must be verified before any code.
- **LD3 — Rewrite target is a new `mega output exec-live`,** keyed
  `(workspaceKey = encodeWorkspaceKey(cwd), liveSessionId = session_id)`
  — the hook has no registry session. Identity mirrors the daemon
  `execHandler` (packages/daemon/src/handlers.ts:101) and the overlay
  record path.
- **LD4 — exec-live pipeline = `runChild` + `recordAndFilterOverlayOutput`
  (daemon-first via `makeRecord`), NOT `runOverlayOutputExecCommand`.**
  The record path returns the raw byte-identical on every non-compressed
  decision (packages/context-gate/src/record-output.ts:260-271), owns the
  F30 footer accounting (footer bytes count into returnedBytes), and
  carries the net-negative degradation guard. `runOutputExecCommand`'s
  envelope never returns raw and cannot honor byte-identical passthrough.
- **LD5 — Decision function = flat-token allowlist grammar** (discipline
  of `apps/cli/src/hooks/output-route-command.ts`): ASCII-space tokens,
  SAFE_TOKEN class, ≤64 tokens, ≤4096 bytes, null-biased. Allowlist
  seeded from existing parser coverage (packages/output-filter/src/
  parsers/): `vitest`, `tsc`, `pytest`, `eslint`, `go test`, `cargo
  {test,build,check,clippy}`; plus read-only `git
  {status,log,diff,show,branch}` and `ls`/`grep`/`rg`/`find`. Per-program
  vetoes: watch flags (`--watch`, `-w`, `vitest watch`), `find
  -delete/-exec/-execdir/-ok/-okdir`. Any token whose program basename is
  a mega launcher (`mega`, `mega.mjs`, `mega.cmd`, `mega.exe`) → never
  rewrite (also makes hook re-entry a structural no-op). Everything not
  allowlisted — sudo, editors, REPLs, watchers, servers, shell syntax —
  is null by construction.
- **LD6 — Semantics-parity invariant.** exec-live must never change what
  the command would have done: any mega-internal failure (store resolve,
  settings, record throw, daemon error) degrades to plain `runChild`
  capture delivered raw; the child's exit code is always mirrored
  (exec.ts:165-167 precedent). The rewrite may improve delivery, never
  behavior.
- **LD7 — Failure-tee parity (RTK idea 7).** `storeRawOutput: true`
  always on this path — the rewrite replaced the only copy the agent
  would have had. Non-compressed decisions deliver full raw anyway;
  compressed decisions carry the recovery footer declaring chunk
  recoverability (recovery-footer.ts:36); non-zero exit adds stderr
  `note: command exited N`.
- **LD8 — Honest stats.** Additive optional `origin: "exec-rewrite"`
  threaded `RecordOverlayOutputInput` → `overlayTokenSaverEventSchema`
  (`.strict()`, packages/stats/src/event.ts:72) → daemon
  `excerptRequestSchema` (`.strict()`, handlers.ts:23 — omit it and the
  daemon 400s, hook falls back in-process; intent-aware spec §5 lesson).
  Savings = actual rawBytes vs returnedBytes from the existing pipeline
  only. The RTK `rtk gain` counterfactual ("raw priced as fresh input
  even when the client would have truncated it") is the named
  anti-pattern — we never model what output "would have cost".
  `childExitCode` on saver events is OWNED by claim-verification-gate
  (batch-1, build 3): consume it once merged, never duplicate.
- **LD9 — Dual activation gate.** Rewrite fires only when (a) the hook
  entry is installed (`mega hooks install claude-code --exec-rewrite`,
  default off; `--no-exec-rewrite` removes; flag absent preserves current
  state) AND (b) `resolveWorkspaceTokenSaverSettings(storeRoot, cwd,
  nodeResolverDeps())` reports enabled.

## Architecture

```
PreToolUse(Bash) payload {session_id, cwd, tool_input.command}
  -> mega hooks exec-rewrite (own entry, matcher ^Bash$, opt-in)
     classifyExecRewrite(command)        null -> emit nothing (raw Bash runs)
     workspace saver enabled?            no   -> emit nothing
  -> {"hookSpecificOutput":{"hookEventName":"PreToolUse",
       "updatedInput":{"command":
        "<mega> output exec-live --live-session <sid> [--store <s>] -- <tokens>"}}}
  (permission system evaluates the rewritten command; agent's Bash runs it)

mega output exec-live
  -> runChild (shell:false, timeout/max-bytes bounds)     [context-gate]
  -> settings enabled? no -> deliver raw, mirror exit code
  -> record = makeRecord(storeRoot)  (daemon /excerpt first, in-process
     recordAndFilterOverlayOutput fallback)  with:
       storeRawOutput:true, includeFooter:true, origin:"exec-rewrite",
       intent: readSessionIntent(storeRoot, wk, liveSessionId)
  -> compressed  -> deliver returnedText (footer inside, chunks recoverable)
     otherwise   -> deliver raw byte-identical
  -> stdout via write() (no added newline); exit code = child's
```

## Components

1. **Classifier** — `apps/cli/src/hooks/exec-rewrite-command.ts`,
   `classifyExecRewrite(command): {command, args} | null` (LD5).
2. **Hook runner** — `apps/cli/src/hooks/exec-rewrite-run.ts`
   (`buildExecRewriteHookOutput`, contract identical to
   `buildGuardHookOutput`: never throws, "" on any failure, exit 0) +
   `apps/cli/src/commands/hooks/exec-rewrite.ts` subcommand.
3. **exec-live CLI** — `apps/cli/src/commands/output/exec-live.ts`,
   `runOutputExecLive` (LD4/LD6/LD7), registered in `output/index.ts`.
4. **Origin thread** — context-gate `RecordOverlayOutputInput.origin`,
   stats event field, daemon excerpt schema (LD8).
5. **Install surface** — connector-claude-code `hook-settings.ts`:
   `EXEC_REWRITE_HOOK_COMMAND`/`_MATCHER`, add/has/remove trio (guard
   trio model, hook-settings.ts:453-484), `installClaudeCodeHook`
   tri-state `execRewrite`, uninstall + status; CLI `--exec-rewrite`.
6. **Stats selector** — `splitOverlayEventsByOrigin` in
   `@megasaver/stats` (pure; CLI surfacing deferred — no core re-export
   needed this wave).

## Error handling

- Hook: malformed payload, non-Bash tool, unsafe `session_id`, classifier
  null, disabled workspace, any throw → emit "" and exit 0 (fail-open;
  the original command runs untouched).
- exec-live: LD6 parity fallback on every internal failure; spawn failure
  → `error: command_failed: <detail>` exit 1; `terminated:
  timeout|max_bytes` → partial delivered, stderr note, exit 1.
- Daemon: `origin`-bearing body against an old daemon → 400 → counted
  daemon-fallback, in-process record proceeds (existing makeRecord
  behavior, saver-run.ts:108-139).

## Security & privacy

- The record path redacts raw and label before persist (`redact`,
  packages/policy/src/redact.ts:44; record-output.ts:274-278) — no new
  redact callsites needed; the hook itself persists nothing.
- Rewritten string is built only from SAFE_TOKEN-classed tokens, a
  validated `session_id` segment, and the launcher path quoted via
  `quoteForPosixShell` (export from hook-settings.ts:46) — no injection
  surface beyond what the agent already typed.
- No permission widening: no `permissionDecision` ever (LD2); a strict
  guard DENY on the same tool call still blocks (deny wins over input
  updates — verify with Q1 probe).
- Loop safety: rewritten commands start with a mega launcher token, which
  the classifier refuses (LD5) — re-entrant hook passes are no-ops.
- No new locks or writers: all persistence goes through the existing
  overlay chunk-store/stats appenders; `withFileLock` is not needed.

## Testing

- Classifier: accept/reject table mirroring output-route-command.test.ts
  (shell syntax, watchers, find mutators, mega targets, byte/token caps).
- exec-live: byte-identical passthrough (stdout === raw, no trailing
  newline added), compressed delivery, storeRawOutput+origin always set,
  exit-code mirroring incl. non-zero + terminated, record-throw parity
  fallback, disabled-workspace raw path. Injected `runChildImpl` +
  `record` — no real spawn, no timing-tight assertions.
- Origin thread: context-gate event carries `origin`; absent-field
  back-compat; daemon strict schema accepts it.
- Install: entry shape (matcher `^Bash$`, timeout 10), tri-state
  add/preserve/remove, uninstall, status.
- Integrity: the existing save-integrity property
  (packages/context-gate/test/save-integrity.property.test.ts) already
  covers the record path this feature rides.
- Smoke evidence (DoD §5): captured terminal session — install with
  `--exec-rewrite`, pipe a PreToolUse payload, show the rewrite JSON;
  run exec-live over a fixture command showing footer + `mega output
  chunk` recovery.

## Risk & process

HIGH (§12): public CLI flags + connector core path + saver semantics.
Worktree mandatory (no `main` edits); architect pass on this spec;
`code-reviewer` AND `critic` in separate fresh contexts; `pnpm verify`
plus smoke evidence before any "done"; changesets for cli,
connector-claude-code, context-gate, stats, daemon. No convention-file
changes expected (DoD §10).

## Dependencies / build order

Wave-2 build 1 of 20. Consumes (never duplicates) claim-verification-gate's
additive `childExitCode` when that lands; does not block on it. Independent
of net-positive Stage B. Blocks the wave-2 filter-matrix expansion (idea
3), which wants this delivery path in place.

## Open questions

- **Q1 (gate).** Verify the Claude Code PreToolUse `updatedInput`
  contract against current docs/runtime before Task 1 exit: field name,
  whether it applies without `permissionDecision`, and hook re-fire
  behavior on updated input. If it requires `permissionDecision:
  "allow"`, STOP — LD2 forbids that; return to spec review.
- **Q2.** Script runners (`pnpm test`, `npm test`) — high-frequency but
  execute arbitrary package scripts; needs a stateful-script analysis
  before allowlisting.
- **Q3.** Timeout interplay: Bash tool timeout vs exec-live's 300s
  default — should the rewrite carry `--timeout` derived from the tool
  payload when present?
- **Q4.** Whether `mega hooks status` should warn when exec-rewrite is
  installed but the workspace saver is disabled (silent no-op today).
