---
title: Agent Office Phase 1 — AgentLauncher capability + claude-code adapter
status: draft
risk: high
created: 2026-06-22
author: brainstorming session (Halit Ozger + Claude Code)
parent_spec: docs/superpowers/specs/2026-06-22-agent-office-design.md
---

# Agent Office Phase 1 — AgentLauncher

## Summary

Add the process-spawning capability the office needs: an agent-agnostic
`AgentLauncher` interface and a concrete **claude-code** adapter that
runs a single headless task via `claude -p` and streams its activity.
This is Phase 1 of the Agent Office feature (parent spec §3, §9). It is
the first code that can spawn an agent process.

## Scope

- `AgentLauncher` interface + supporting types in
  `@megasaver/connectors-shared`.
- `claude-code` adapter (argv builder + spawn + stream-json line parser)
  in `@megasaver/connector-claude-code`.

## Non-goals (later phases)

- No supervisor / task queue loop (Phase 2).
- No `@megasaver/agent-office` engine wiring, no `@megasaver/core`
  Session creation, no evidence-ledger audit (Phase 2).
- No permission-policy *enforcement* (safe-by-default gating, the
  "explicit confirm for full" rule) — Phase 2 owns the decision to
  *allow* a mode. Phase 1's argv builder only faithfully *maps* a
  requested `permissionMode` to the CLI flag.
- No GUI, no CLI commands (Phases 4–5).

## Risk

**HIGH** (parent feature is CRITICAL). Phase 1 introduces the ability to
spawn `claude` and to emit `--permission-mode bypassPermissions`, but it
is not yet driven by any autonomous loop. **Tests MUST inject a fake
spawn — never launch a real `claude`.** No autopilot/loops.

## Grounding (verified against installed `claude` 2.1.177)

- `-p, --print` exists; `--output-format` supports `stream-json`;
  `-r, --resume [value]`, `--session-id <uuid>`, `--model <model>`
  (accepts aliases `opus`/`sonnet`/`haiku`), `--allowedTools <tools...>`,
  `--append-system-prompt <prompt>`, `--add-dir`, `--verbose` all exist.
- `--permission-mode` choices: `acceptEdits | auto | bypassPermissions |
  default | dontAsk | plan`. So `plan`→`plan`, `acceptEdits`→`acceptEdits`,
  `full`→`bypassPermissions`.
- `--verbose` is included alongside `--print --output-format stream-json`
  defensively (that combination has historically required it); the line
  parser skips any non-JSON output, so extra verbose noise is harmless.

## §1 Interface (`packages/connectors/shared/src/launcher.ts`)

```ts
import type { AgentId } from "@megasaver/shared";

export type LauncherPermissionMode = "plan" | "acceptEdits" | "full";
export type LauncherModel = "opus" | "sonnet" | "haiku";

export interface LaunchInput {
  workdir: string;
  instruction: string;
  model: LauncherModel;
  permissionMode: LauncherPermissionMode;
  allowedTools: readonly string[];
  persona?: string;          // → --append-system-prompt
  sessionId?: string;        // first run → --session-id
  resumeSessionId?: string;  // later runs → --resume
}

export type LauncherEvent =
  | { kind: "stream"; payload: unknown }  // one parsed stream-json line
  | { kind: "stderr"; text: string };

export interface LaunchHandle {
  readonly sessionId: string;            // id used (assigned or resumed)
  onEvent(cb: (e: LauncherEvent) => void): void;
  onExit(cb: (r: { code: number | null }) => void): void;
  cancel(): void;                        // SIGTERM the child
}

export interface AgentLauncher {
  readonly kind: AgentId;
  launch(input: LaunchInput): LaunchHandle;
}
```

`@megasaver/connectors-shared` must declare `@megasaver/shared` as a
dependency (for `AgentId`); add it if absent. The launcher types are a
new module exported from the package index.

## §2 argv builder (pure — the primary unit-tested core)

In `@megasaver/connector-claude-code`, `buildClaudeArgs(input: LaunchInput): string[]`:

Deterministic order:

```
-p <instruction>
--output-format stream-json
--verbose
--model <mapModel(model)>
--permission-mode <mapMode(permissionMode)>
[--allowedTools <t1> <t2> ...]            // only if allowedTools non-empty
[--append-system-prompt <persona>]        // only if persona set
(--session-id <sessionId>) | (--resume <resumeSessionId>)
```

- `mapMode`: `plan`→`"plan"`, `acceptEdits`→`"acceptEdits"`,
  `full`→`"bypassPermissions"`.
- `mapModel`: identity over `"opus"|"sonnet"|"haiku"` (CLI accepts these
  aliases).
- Session continuity: the builder requires **exactly one** of
  `sessionId` / `resumeSessionId`. If both or neither are provided it
  throws a `ClaudeCodeConnectorError` (`invalid_request`) — callers must
  decide new-vs-resume. (Phase 2's supervisor sets this.)
- Does NOT add `--add-dir` (workdir confinement: cwd is the only allowed
  root). `cwd` is applied by the adapter at spawn, not via argv.

## §3 adapter (`packages/connectors/claude-code/src/launcher.ts`)

`createClaudeCodeLauncher(options?: { spawn?: SpawnFn }): AgentLauncher`
where `SpawnFn` matches `node:child_process` `spawn(command, args, opts)`
and defaults to the real one. `kind = "claude-code"`.

`launch(input)`:

1. `const args = buildClaudeArgs(input)` (throws on bad session config
   before spawning).
2. `const child = spawn("claude", args, { cwd: input.workdir })`.
3. `sessionId = input.resumeSessionId ?? input.sessionId` (guaranteed set
   by the builder's validation).
4. stdout: accumulate into a buffer, split on `\n`; for each complete
   line, `JSON.parse`; on success emit `{kind:"stream", payload}`; on
   parse failure, skip the line (verbose/non-JSON noise). Buffer the
   trailing partial line until the next chunk (mirrors the bridge's
   `tailTranscript`).
5. stderr: emit `{kind:"stderr", text}` per chunk (utf8).
6. child `error` (e.g. `claude` not found / ENOENT): emit
   `{kind:"stderr", text: message}` then `onExit({code: null})`.
7. child `close`: flush any final complete line, then `onExit({code})`.
8. `cancel()`: `child.kill("SIGTERM")` (idempotent; no throw if already
   exited).

Handlers registered via `onEvent`/`onExit` are invoked for events that
arrive after registration; for Phase 1 the caller registers synchronously
right after `launch()` returns (before the child produces output on the
next tick), so no early-event buffering is required.

## §4 Error handling

- Bad session config (both/neither id) → throw
  `ClaudeCodeConnectorError("invalid_request", ...)` from
  `buildClaudeArgs` / `launch` before spawning.
- Spawn failure (binary missing) → surfaced via a `stderr` event +
  `onExit({code:null})`, not a throw (launch already returned a handle).
- Malformed stdout line → skipped, not fatal.

## §5 Testing (no real `claude`)

- **argv builder (pure):** each `permissionMode` → correct flag; each
  model passes through; `allowedTools` present (multiple) vs empty
  (omitted); `persona` present vs omitted; `--session-id` vs `--resume`
  selection; both-ids and neither-id throw; instruction/flag ordering.
- **adapter (fake spawn):** inject a `spawn` returning a fake child
  (an `EventEmitter` with `stdout`/`stderr` as `Readable`/`PassThrough`,
  a `kill` spy, and a `close` emit). Assert:
  - cwd passed to spawn equals `workdir`; command is `"claude"`; args
    equal `buildClaudeArgs(input)`.
  - feeding two stream-json lines (incl. a split-across-chunks line and a
    non-JSON line) yields exactly the right `{kind:"stream"}` events,
    with the non-JSON line skipped and the partial line reassembled.
  - stderr chunk → `{kind:"stderr"}` event.
  - `close` with code 0 → `onExit({code:0})`; code 2 → `onExit({code:2})`.
  - child `error` → `stderr` event + `onExit({code:null})`.
  - `cancel()` calls `child.kill("SIGTERM")`.
  - `sessionId` on the handle equals the resumed-or-assigned id.

## Definition of Done

- Interface in connectors-shared (exported); adapter in
  connector-claude-code (exported); `@megasaver/shared` dep present in
  connectors-shared.
- argv builder + adapter fully tested with injected spawn; no real
  `claude` spawned in any test.
- `pnpm verify` green.
- Changeset: minor for `@megasaver/connectors-shared` and
  `@megasaver/connector-claude-code`.
- code-reviewer + (per §12 HIGH) critic adversarial review; author ≠
  reviewer.

## Phase 2 preview (not built here)

Supervisor pulls queued tasks → creates a `@megasaver/core` Session →
chooses new-vs-resume session id → enforces safe-by-default permission
policy (only emits `full`/`bypassPermissions` when the role is `full`
AND an explicit confirmation flag is set) → calls this launcher →
streams events to live status → logs spawn + lifecycle to the
evidence-ledger.
