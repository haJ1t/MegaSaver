---
title: BB7b — mega output exec + child-process spawn (CRITICAL)
status: proposed
risk: CRITICAL
created: 2026-05-10
updated: 2026-05-30
parent: aa1-context-gate-epic
sub-pr: BB7b
revision: 2  # reconciled to locked BB7b decisions — child-exit-code mirror (§6); --timeout/--max-bytes flags, 20MB default (§2/§3.5); filterOutput redacts internally so no separate policy.redact (§3.6); EffectiveSettings carries no redactSecrets field (§3.2)
---

# BB7b — `mega output exec` + policy-gated child-process spawn

## 1. Scope & non-goals

This sub-PR ships the single spawn surface of the AA epic: the
`mega output exec` CLI subcommand. It is the FIRST user-visible
child-process spawn in Mega Saver and is therefore **CRITICAL**
risk (`CLAUDE.md` §12; epic §15).

The epic authority is
`docs/superpowers/specs/2026-05-10-aa1-context-gate-epic.md`:
§5b (the `exec` row of `mega output`), §8d (`mega_run_command`
critical-path flow — `exec` mirrors it from the CLI side), §9 /
§9a (policy: `evaluateCommand`, `PolicyDenyCode`, the
`MEGASAVER_ORIGIN_PID` env field, `recursive_megasaver`), §12
(CRITICAL risk rules), §2a (the orchestrator lives in
`core/context-gate`), §14 BB7b row, §16 (CRITICAL pipeline). This
child spec summarises and locks BB7b decisions; the epic spec is
the source of truth.

### 1a What BB7b adds

- A new **core orchestrator** that spawns a policy-gated child
  process and runs its combined output through the existing
  redact → filter → store → stats pipeline:
  `packages/core/src/context-gate/run-command.ts` (spawn-
  specialised orchestrator). This is the architectural payoff of
  keeping context-gate inside `@megasaver/core` (§2a): ONE
  orchestrator, TWO entry points. BB8's MCP `mega_run_command`
  (§8d) will be the second entry point and MUST reuse this exact
  function — BB7b's job is to make the CLI the first caller.
- A new **thin CLI adapter**:
  `apps/cli/src/commands/output/exec.ts` (`runOutputExec` +
  `outputExecCommand`). It does ONLY: arg plumbing, store
  resolution, session-id Zod parse, the `--intent` presence
  check, env-marker computation, and mapping the orchestrator's
  typed result/errors to text/JSON + exit codes. No spawn logic,
  no policy logic, no filter logic lives in `apps/cli`.
- Registration of `exec` in
  `apps/cli/src/commands/output/index.ts`.
- CLI-boundary error message builders in
  `apps/cli/src/errors.ts` (extend, do not rewrite).

### 1b Explicitly OUT of scope

- The MCP `mega_run_command` tool and the `@megasaver/mcp-bridge`
  wiring — BB8. BB7b only builds the orchestrator BB8 will reuse.
- Any new package or new closed enum. `PolicyDenyCode` and
  `OutputSourceKind` are **consumed**, not defined here.
- The `file` / `filter` / `chunk` subcommands — shipped by BB7a.
- The v0.9 `.megasaver/permissions.yaml` layer.
- A `git` allowlist entry (epic §9b removed it deliberately).

### 1c Relationship to the in-flight extraction PR

A separate in-flight PR (`feat/bb7-orchestrator-extract`) moves
the output pipeline OUT of `apps/cli` into
`packages/core/src/context-gate/`. BB7b is specced to build ON
TOP of that: `run-command.ts` is a NEW core file, and the CLI
`exec` command is a thin adapter that calls it. BB7b MUST NOT
re-implement the spawn orchestration inside `apps/cli`. See §11
(open questions) for the one hard dependency on that PR's final
exported function signature.

## 2. Surface (LOCKED)

```
mega output exec <session-id> --intent <s> -- <cmd> [args...] [--store <dir>] [--timeout <sec>] [--max-bytes <n>] [--json]
```

- `<session-id>` — positional, required, parsed through
  `sessionIdSchema` at the CLI boundary (mirror
  `apps/cli/src/commands/output/file.ts:51-58`).
- `--intent <s>` — **REQUIRED**. Undefined or empty string →
  `intent_required` error, exit 1, **before any IO or spawn**
  (mirror `file.ts:60-65`). Drives `filterOutput` ranking.
- `--` separator — everything after it is the command + its
  arguments. Citty exposes trailing tokens via `args._`
  (positional rest); the first is `<cmd>`, the remainder are
  `args`. An empty command (`--` with nothing after it) → the
  command is treated as missing → `command_denied:
  command_not_allowed` from the policy gate (no special CLI code;
  the policy gate is the single arbiter of command validity).
- `--store <dir>` — overrides the resolved store directory
  (mirror `file.ts:39-44`).
- `--timeout <sec>` — max child wall-clock seconds (default
  **300**). On expiry the orchestrator sends `SIGTERM`, then
  `SIGKILL` after a 2 s grace; the partial captured output is
  STILL filtered → stored, a `terminated: timeout` warning is
  appended, and `exec` exits 1 (§6).
- `--max-bytes <n>` — max bytes of combined child output captured
  (default **20_000_000**). On breach capture stops, the child is
  killed (SIGTERM→SIGKILL), a `terminated: max_bytes` warning is
  appended, partial output is processed, and `exec` exits 1 (§6).
- `--json` — single-line JSON output (§7).

The run-function shape mirrors the existing thin commands
(`RunOutputFileInput` in `file.ts:21-34`): a pure `runOutputExec`
takes an explicit input record (no `process.*` reads inside),
returns `Promise<number>` (the child-mirrored exit code on a clean
run, or 1/2 for MegaSaver errors — §6), and the `defineCommand`
wrapper
reads `process.*` (including `process.env.MEGASAVER_ORIGIN_PID`
and `process.pid`) and wires stdout/stderr.

## 3. Flow (LOCKED — adapts §8d for the CLI side)

The CLI adapter performs steps 0–2 and 3a (env-marker capture
happens in the `defineCommand` wrapper, passed in as input). The
**core orchestrator** (`run-command.ts`) performs steps 3b–10.
Step numbering mirrors §8d so the two entry points stay aligned.

0. **Resolve store root** (`resolveStorePath`, mirror
   `file.ts:39-44`). Whitespace-only `--store` → store error,
   exit 1.
1. **Validate input.**
   - Parse `<session-id>` via `sessionIdSchema`. Parse failure →
     `invalidSessionIdMessage` (exit 1).
   - `--intent` undefined/empty → `intent_required`, exit 1.
     This is the CLI surfacing of `PolicyDenyCode.intent_missing`
     before any IO (epic §9a pins `intent_missing` for exactly
     this boundary).
2. **Resolve session.** `ensureStoreReady(rootDir)` →
   `registry.getSession(sessionId)`. `null` → `session_not_found`,
   exit 1. From the session derive `projectId`, `projectRoot`
   (via `registry.getProject(projectId).rootPath`), and the
   effective token-saver settings (mode, maxReturnedBytes,
   storeRawOutput) via BB7a's `resolveEffectiveSettings`
   (`apps/cli/src/commands/output/shared.ts:36-55`). Pre-AA
   sessions (`session.tokenSaver === undefined`, §4c) derive
   read-only defaults — mode `"balanced"`, `storeRawOutput: true`.
   No write to the session record. NOTE (correction): the shipped
   `EffectiveSettings` exposes NO `redactSecrets` field, and the
   v1 `filterOutput` pipeline redacts UNCONDITIONALLY (§3.6);
   BB7b therefore never branches on `redactSecrets`. Honoring a
   per-session `redactSecrets:false` opt-out is unwired in the
   shipped pipeline and is OUT of scope for BB7b.
3. **Compute `MEGASAVER_ORIGIN_PID`** (epic §8d step 3; §9a
   env-marker semantics). In the `defineCommand` wrapper:
   ```
   originPid = process.env.MEGASAVER_ORIGIN_PID && process.env.MEGASAVER_ORIGIN_PID !== ""
     ? process.env.MEGASAVER_ORIGIN_PID   // inherited → this proc is downstream of MegaSaver
     : String(process.pid)                // absent/empty → this proc is the root
   ```
   `originPid` (a string) is passed into `runOutputExec`, which
   forwards it to the orchestrator. The orchestrator does NOT read
   `process.env` itself — the value is injected (testability;
   mirrors the `now`/`newId` injection convention).
4. **Policy gate.**
   `policy.evaluateCommand({ command, args, project: projectId,
   env: { MEGASAVER_ORIGIN_PID: originPid } })`.
   On `allowed: false`:
   - text mode → stderr `command_denied: <reason>` (where
     `<reason>` is the `PolicyDenyCode` string), exit 1.
   - JSON mode → see §7 (`details.reason: <PolicyDenyCode>`),
     exit 1.
   The reason may be any `PolicyDenyCode` the gate returns:
   `command_not_allowed`, `dangerous_pattern`, or
   `recursive_megasaver` (see §4).
5. **Spawn.**
   ```
   child_process.spawn(command, args, {
     cwd: projectRoot,
     shell: false,                                 // argv form; never a shell string
     stdio: ["ignore", "pipe", "pipe"],
     env: { ...process.env, MEGASAVER_ORIGIN_PID: originPid },
   })
   ```
   No shell. `cwd` pinned to the project root. Capture stdout and
   stderr, **combining them preserving arrival order** (interleave
   by `data`-event arrival across both streams; §11.5). Two
   caller-overridable bounds (injected into the orchestrator,
   defaults from the CLI flags §2):
   - **timeout** (`--timeout`, default 300 s): a MANUAL timer (NOT
     Node `spawn`'s `timeout` option — so we own the signal and
     keep partial output) sends `SIGTERM`, then `SIGKILL` after a
     2 s grace.
   - **max-bytes** (`--max-bytes`, default 20_000_000): once the
     combined capture reaches the cap, stop appending and kill the
     child (SIGTERM→SIGKILL).
   On EITHER bound the orchestrator does NOT error out — it marks
   `terminated: "timeout" | "max_bytes"`, appends a warning, and
   still runs the partial output through filter→store→stats (a
   partial chunkSet beats none); `exec` then exits 1 (§6). The
   spawn ENV ALWAYS carries `MEGASAVER_ORIGIN_PID = originPid` so
   any descendant that tries to re-enter Mega Saver is denied at
   its own step 4 — the propagation half of the
   `recursive_megasaver` guard. On spawn *error* (ENOENT for a
   non-existent binary, EACCES, etc.) the orchestrator returns a
   typed `spawn_failed`-class result → CLI exit 1
   (`command_failed: <message>`).
6. **Redact — folded into the filter (correction vs epic §8d).**
   The shipped BB5 `filterOutput` ALREADY redacts its `raw` input
   unconditionally as its first step
   (`packages/output-filter/src/types.ts:82` calls
   `policy.redact(raw)` and appends a `"redacted N secret(s)
   before processing"` warning). BB7b therefore does NOT make a
   separate `policy.redact()` call — epic §8d step 6 is superseded
   by the shipped pipeline; a separate call would double-redact
   and zero out the count. The combined raw output is passed
   straight to `filterOutput` (step 7); the redaction count is
   read back from `result.warnings`. Secrets never reach the
   chunks because redaction runs before chunking INSIDE the
   filter — the "redact before store" invariant (epic §10d) holds.
7. **Filter.**
   ```
   filterOutput({
     raw: combined,        // filterOutput redacts internally (step 6)
     intent,
     mode: session.tokenSaver?.mode ?? "balanced",
     maxReturnedBytes,
     sessionHints: contextHints(session),
     source: { kind: "command", command, args },
   })
   ```
   `contextHints(session)` is the existing context-gate helper
   (`packages/core/src/context-gate/context-hints.ts`, epic §2a
   file list). If the in-flight extraction PR has not yet landed
   `context-hints.ts`, BB7b passes `sessionHints` omitted (the
   field is `.optional()` in `filterOutputInputSchema`) and notes
   the follow-up — see §11.
8. **Store.** When `storeRawOutput` is true, build a `ChunkSet`
   with `source: { kind: "command", command, args }` and call
   `contentStore.saveChunkSet({ storeRoot, chunkSet })`. On throw
   → `store_write_failed`, exit 1. The `redacted` flag is derived
   from `result.warnings` (any warning starting `"redacted"`),
   exactly as BB7a's `persistChunkSet` does
   (`apps/cli/src/commands/output/shared.ts:122`); since the
   filter redacts unconditionally (step 6), `redacted` is `true`
   whenever the input carried ≥1 secret. When `storeRawOutput` is
   false, no chunkSet is written and `chunkSetId` is absent from
   the result.
9. **Stats.** Append a `TokenSaverEvent` via `stats.appendEvent`
   with `sourceKind: "command"`, `label` (the rendered
   command-line), `rawBytes`, `returnedBytes`, `bytesSaved`,
   `savingRatio`, `chunkSetId` (when stored), `summary`, `mode`,
   plus `secretsRedacted: redact.count` and `chunksStored:
   chunks.length`. `appendEvent` updates the per-session summary
   inline (`packages/stats/src/store.ts:57-88`). See §11 for the
   §8d `updateSessionStats` naming note.
10. **Return.** The orchestrator returns
    `{ summary, excerpts, chunkSetId?, rawBytes, returnedBytes,
    bytesSaved, savingRatio, warnings?, childExitCode,
    terminated? }` — the `FilterOutputResult`
    (`packages/output-filter/src/types.ts:52`) augmented with
    `chunkSetId` (when stored), `childExitCode` (the spawned
    process's numeric exit code, or `null` when killed by a
    bound), and `terminated` (`"timeout" | "max_bytes"` when a
    bound fired). `childExitCode` is in the live result + the
    `--json` payload + drives the CLI exit code (§6); it is NOT
    persisted into the `ChunkSet` / `TokenSaverEvent` schemas
    (both `.strict()`, AA3-pinned in other packages — adding an
    `exitCode` field is a content-store/stats change, OUT of BB7b
    scope; see §11.7). The CLI adapter emits the result per §7.

Steps 4–9 are load-bearing and MUST run in this order: policy
BEFORE spawn, redact BEFORE store, store BEFORE stats. A test
asserts `spawn` is never invoked when the policy gate denies.

## 4. `recursive_megasaver` re-entry detection (LOCKED)

The detection rule is enforced inside `policy.evaluateCommand`
(`packages/policy/src/evaluate-command.ts:18-21`) and consumed —
not re-implemented — by BB7b:

> Deny with `recursive_megasaver` when `originPid` is present
> (truthy, non-empty) **AND** `originPid !== String(process.pid)`.

Restating against the epic's three conjuncts (§9a, §8d step 4):

1. `originPid` present and non-empty — the marker was inherited
   from the spawn ENV of a MegaSaver-orchestrated parent.
2. `originPid !== String(process.pid)` — the current process is
   NOT the root MegaSaver process; it is a descendant of one.
3. "Parent already issued an evaluate-command in this process" —
   this is satisfied **structurally by ENV inheritance**, not by
   an in-process counter. The marker only appears in
   `process.env` because a MegaSaver orchestrator set it when it
   spawned this process (step 5). The check is a stateless guard,
   not a tracker (§9a: *"Any inherited env marker means the
   caller is downstream of MegaSaver and should not invoke
   MegaSaver again."*). BB7b does NOT add a per-process counter;
   it relies on the propagation contract.

Concretely: a root `mega output exec` run (no inherited marker)
sets `originPid = String(process.pid)` → passes step 4 → spawns
with `MEGASAVER_ORIGIN_PID = <root pid>`. If the spawned command
is itself `mega output exec -- ...`, the child process inherits
`MEGASAVER_ORIGIN_PID = <root pid>`, computes `originPid = <root
pid>` (inherited branch), and `<root pid> !== String(child pid)`
→ denied with `recursive_megasaver` at the child's step 4. This
defeats agents that try `mega output exec -- mega output exec
...` (or, post-BB8, `mega_run_command -- mega output exec`).

This is also the paradox guard (§15): Mega Saver Mode cannot run
the command that develops Mega Saver Mode itself.

## 5. maxBytes resolution (LOCKED)

`maxReturnedBytes` (the filter budget) resolves as (epic §8a /
§8d step 7):

```
maxBytes = session.tokenSaver?.maxReturnedBytes ?? modeToBudget(mode)
```

where `mode = session.tokenSaver?.mode ?? "balanced"`. An
explicit ceiling applies: the effective `maxBytes` MUST NOT
exceed `2 * modeToBudget("safe") = 64_000`. If a session's
persisted `maxReturnedBytes` somehow exceeds the ceiling it is
clamped to `64_000` (the orchestrator clamps; it does not error —
the value came from a validated session record, not user input).

The **raw capture cap** is the `--max-bytes` flag (default
20_000_000; §2, §3 step 5) — a separate, larger bound on how much
child output is read into memory before filtering, NOT the
returned filter budget (`maxReturnedBytes`). The two are
independent: `--max-bytes` bounds capture; `maxReturnedBytes`
bounds what the filter returns.

`modeToBudget` is imported from `@megasaver/shared`
(`modeToBudget("safe") = 32_000`, so the ceiling is `64_000`).

## 6. Exit codes (LOCKED — child-code mirror)

The `exec` exit code is **decoupled** from MegaSaver-internal
failure: when the child runs to completion, `exec` **mirrors the
child's exit code** so CI / scripts see the command's real
pass/fail.

- **child ran to completion** → `exec` exits **with the child's
  exit code** (`0` when the child succeeded, the child's non-zero
  code otherwise). Output is filtered + optionally stored
  regardless; `childExitCode` is in the result (§3.10) and the
  `--json` payload; a non-zero child also gets a one-line
  `note: command exited <code>` on **stderr** while the success
  stdout/JSON is STILL written — this is NOT a failure path.
- `1` — MegaSaver **expected error** (the command never ran to a
  clean finish, or MegaSaver itself failed): `intent_required`,
  invalid session id, `session_not_found`,
  `command_denied: <PolicyDenyCode>`, `command_failed` (spawn
  error), `store_write_failed`, store-resolution error, AND the
  **forced-termination** cases (`--timeout` / `--max-bytes` fired,
  §3.5) — partial output is still stored but the run is exit 1.
- `2` — **unexpected** error: anything re-thrown that
  `mapErrorToCliMessage` classifies as an unexpected failure
  (`error: unexpected failure: <message>`). `runOutputExec`
  returns `Promise<number>` (BB7a commands return `0 | 1`); exit 2
  is reserved for genuinely unexpected throws so CRITICAL failures
  are distinguishable from expected denials in supervision logs.

Asymmetry to note: a non-zero **child** exit is NOT a MegaSaver
failure — stdout/JSON success output is written and the code is
mirrored. A MegaSaver-internal failure (deny, spawn error, write
fail, forced-termination) writes a plain-text `error: …` line to
**stderr**, writes **nothing** to stdout, and exits non-zero —
the BB7a `--json` failure invariant (epic §5a): JSON is never
emitted on a MegaSaver failure path.

## 7. Output shapes (LOCKED — §5b)

### Text mode (default, success)

```
Ran <command> for <session-id> (<returnedBytes> B kept, <bytesSaved> B saved, <pct>%)
```
plus ` chunkSetId=<id>` when a chunkSet was stored, followed by
the `summary` line(s). (Mirrors the `file.ts:119-123` text shape.)
When the child exited non-zero, an additional
`note: command exited <code>` line goes to **stderr** (stdout
still carries the success summary; the process exit code is the
child's — §6).

### JSON mode (`--json`, success) — single line

```json
{ "sessionId": "<session-id>", "result": <FilterOutputResult + { childExitCode, chunkSetId?, terminated? }> }
```
`result.chunkSetId` present iff stored; `result.childExitCode` is
the spawned process's exit code (`null` if killed by a bound);
`result.terminated` is `"timeout" | "max_bytes"` when a bound
fired. Extends the §5b `file`/`filter` shape with the
exec-specific fields. The process still exits with the mirrored
child code (§6).

### JSON mode failure invariant

On failure, NO JSON on stdout. Text `error: …` on stderr, exit
non-zero (§6). For a policy denial specifically, the epic §5b
contract is: text-mode `command_denied: <reason>`, and when the
caller asked for `--json` the failure is STILL surfaced as a
plain-text stderr line (no stdout JSON) carrying the
`PolicyDenyCode` in the `command_denied: <reason>` text. The
machine-readable `details.reason: <PolicyDenyCode>` payload is
the contract that BB8's MCP wire envelope (§8b `command_denied`
with `details.reason`) emits; the BB7b CLI mirrors it as the
`<reason>` suffix on the stderr line so the same `PolicyDenyCode`
value is observable from both entry points.

## 8. Files

### New source

- `packages/core/src/context-gate/run-command.ts` — the
  spawn-specialised orchestrator (`runCommand` / `execCommand`;
  exact exported name follows the in-flight extraction PR, §11).
  ≤ 300 LOC (`CLAUDE.md` §8). Imports `policy`, `output-filter`,
  `content-store`, `stats`, and `@megasaver/shared`
  (`modeToBudget`); MUST NOT be imported back by any of those
  (§3c cycle guardrail).
- `apps/cli/src/commands/output/exec.ts` — `RunOutputExecInput`,
  `runOutputExec`, `outputExecCommand` (thin adapter). ≤ 300 LOC.

### Edited source

- `packages/core/src/context-gate.ts` (barrel) and
  `packages/core/src/index.ts` — re-export the orchestrator so
  `apps/cli` consumes it via `@megasaver/core` public surface.
- `apps/cli/src/commands/output/index.ts` — add
  `exec: outputExecCommand` to `subCommands` and re-export
  `runOutputExec` / `RunOutputExecInput`.
- `apps/cli/src/errors.ts` — add message builders:
  `commandDeniedMessage(reason: string)` →
  `error: command_denied: <reason>`; `commandFailedMessage(detail)`
  → `error: command_failed: <detail>`; `storeWriteFailedMessage(detail)`
  → `error: store_write_failed: <detail>`. Reuse the existing
  `intentRequiredMessage`, `sessionNotFoundMessage`,
  `invalidSessionIdMessage`. Extend, do not rewrite. (No
  `redactionFailedMessage`: redaction is internal to
  `filterOutput`, not a separate orchestrator step — §3.6.)
- `apps/cli/package.json` — add `@megasaver/stats` as
  `workspace:*` (BB7a did not need it; `exec` does, via the
  orchestrator's stats step — but note the dep is on `core`,
  which already depends on `stats`; if the orchestrator is
  consumed purely through `@megasaver/core`'s public surface,
  `apps/cli` may NOT need a direct `stats` dep — see §11 and the
  dependency-graph test).

### New tests

- `apps/cli/test/output/exec.test.ts` — full command coverage
  (§9).
- `apps/cli/test/output/exec.recursive.test.ts` — inherited
  `MEGASAVER_ORIGIN_PID` triggers `recursive_megasaver` (epic
  §14 BB7b row).
- `packages/core/test/context-gate/run-command.test.ts` — the
  orchestrator unit tests with `child_process.spawn` MOCKED.

### Edited tests

- `apps/cli/test/json-failure-paths.test.ts` — add `output exec`
  failure cases: intent missing, command denied, session not
  found (each: text stderr, empty stdout, exit ≥ 1).
- `apps/cli/test/dependency-graph.test.ts` (BB7a's guard) — widen
  the allow-list only if `apps/cli` gains a direct dep (§11).

### No new closed enum / no `*.test-d.ts`

BB7b introduces no new package and no new `z.enum` (§17). It
consumes `PolicyDenyCode`, `OutputSourceKind`, `TokenSaverMode`.
No tuple pin is added.

## 9. Test plan summary (TDD; full plan in the companion plan file)

Unit tests MUST mock `child_process.spawn` — **NO real process is
spawned in CI** (epic §12 CRITICAL: no unsupervised execution;
deterministic tests). Coverage:

- `intent_missing` — `--intent` absent/empty → exit 1, no spawn.
- `command_denied: command_not_allowed` — `evaluateCommand`
  denies a non-allowlisted command → exit 1, no spawn.
- `command_denied: dangerous_pattern` — e.g. `rm -rf /` rendered
  line matches a `DANGEROUS_PATTERN` → exit 1, no spawn.
- `command_denied: recursive_megasaver` — inherited
  `MEGASAVER_ORIGIN_PID !== pid` → exit 1, no spawn.
- `session_not_found` — unknown session id → exit 1, no spawn.
- spawn **success** (mocked) — combined stdout+stderr →
  filter (redacts internally) → store → stats; result shape
  asserted; chunkSet on disk when `storeRawOutput`; `redacted`
  flag derived from a `"redacted…"` warning.
- **child non-zero exit** — mocked child exits 7 → success output
  still written; `result.childExitCode === 7`; `exec` process
  exits 7; `note: command exited 7` on stderr.
- **timeout** — mocked spawn never closes → manual timer fires →
  SIGTERM (then SIGKILL) sent; partial output processed;
  `terminated: "timeout"` warning; exit 1.
- **max-bytes** — mocked spawn emits > `--max-bytes` → capture
  stops, child killed; `terminated: "max_bytes"`; partial
  processed; exit 1.
- **spawn error** — mocked ENOENT → `command_failed`, exit 1,
  nothing on stdout.
- **redaction applied** — secret-shaped output → stored/returned
  text is redacted by `filterOutput`; `"redacted…"` warning
  present.
- **JSON vs text shape** — `--json` success → single-line
  `{ sessionId, result }` incl. `childExitCode`; text success →
  the `Ran …` line.
- **exit codes** — child-mirror (0 and non-zero), MegaSaver-error
  1, unexpected 2 asserted per branch.
- spawn-never-called assertion on every denial branch.

**Real-spawn smoke evidence is gathered MANUALLY under §12
supervision, not in CI.** The acceptance smoke (`mega output exec
<id> --intent "failing tests" -- pnpm test`) is run by the user
during the manual-confirmation gate and its output is recorded in
the verifier evidence bundle — it is never automated into the
test suite.

## 10. Risk justification (CRITICAL) & §12 acceptance

`exec` is the first user-visible `child_process.spawn` in Mega
Saver and runs arbitrary (allowlisted) commands. Per `CLAUDE.md`
§12 and epic §15/§16, BB7b acceptance requires ALL of:

1. **`architect` design noted** — opus concept / alternatives
   memo BEFORE this child-spec brainstorm (§16 HIGH chain,
   inherited by CRITICAL).
2. **`critic` adversarial review** AFTER `executor` implements,
   BEFORE `code-reviewer` (§16).
3. **`security-reviewer` sign-off report** as a PR comment —
   OWASP-style review of the spawn path, env handling, and the
   policy gate (§16 CRITICAL).
4. **`tracer` pass** — enumerate every branch that could spawn a
   child or skip the policy gate (§16 CRITICAL).
5. **MANUAL user confirmation before merge** — the user replies
   `confirm BB7b merge` verbatim to a message linking the
   verifier evidence bundle, the security report, and the manual
   real-spawn smoke output (§16, F-MAJ-6).
6. **NO unsupervised completion** — NO `autopilot` / `ralph` /
   unsupervised loops (§12).
7. **NO log compression** — Mega Saver Mode CANNOT be enabled on
   the session that develops Mega Saver Mode itself (paradox
   guard, §15; also enforced by the env-marker
   `recursive_megasaver` gate).
8. **Post-merge LOC audit** (§2a deferred-extraction trigger):
   run `wc -l packages/core/src/context-gate/*.ts`; record total
   in the verifier evidence bundle. If > 500 LOC, queue the BB12
   chore PR to extract `@megasaver/context-gate`.

Standard DoD (`CLAUDE.md` §9) also applies: tests-first, `pnpm
verify` green, `code-reviewer` + `verifier` passes (separate
contexts), zero pending TODOs, changeset if `@megasaver/core`
public API changed (it does — the orchestrator is re-exported).

## 11. Open questions / ambiguities

1. **Orchestrator exported name + signature (HARD dependency on
   the extraction PR).** Epic §8d says
   `packages/core/src/context-gate/run.ts`; the §14 BB7b row says
   `run-command.ts`. This spec locks the FILE as `run-command.ts`
   (the more specific, spawn-specialised name from the acceptance
   row) but the EXPORTED function name (`runCommand` vs
   `execCommand` vs `runContextGateCommand`) and its exact input
   record MUST match whatever `feat/bb7-orchestrator-extract`
   lands. BB7b's CLI adapter is the only caller until BB8, so a
   rename is cheap — but the input record (does it take
   `originPid` as an injected string? does it take a `spawn`
   injectable for testing? does it take the resolved
   `EffectiveSettings` or re-derive from the session?) is the
   load-bearing contract. **Action:** confirm the extraction PR's
   `run.ts` / `run-command.ts` export shape before writing the
   adapter; the plan front-loads this as Phase 0.
2. **`stats.updateSessionStats` does not exist.** Epic §8d step 9
   names `stats.appendEvent(...)` AND `stats.updateSessionStats(
   sessionId, deltas)`. The current `@megasaver/stats` public
   surface (`packages/stats/src/index.ts`) exports `appendEvent`
   (which updates the per-session summary inline,
   `store.ts:57-88`), `readSummary`, and `resetOnDisable` — there
   is NO `updateSessionStats`. BB7b uses `appendEvent` alone (it
   already does both the event append and the summary update). If
   the §8d two-call shape is intended, that is a `@megasaver/stats`
   change owned by a stats child spec, not BB7b. **Locked for
   BB7b:** single `appendEvent` call.
3. **`contextHints(session)` availability.** §3 step 7 passes
   `sessionHints: contextHints(session)`. That helper lives in
   `packages/core/src/context-gate/context-hints.ts` (epic §2a
   file list) which is landed by the extraction PR, not BB7b. If
   it has not landed when BB7b is implemented, BB7b omits
   `sessionHints` (the field is optional) and files a follow-up.
4. **Direct `apps/cli` dep on `@megasaver/stats`.** If the
   orchestrator is consumed purely through `@megasaver/core`'s
   public re-export, `apps/cli` needs NO new direct dep and the
   BB7a `dependency-graph.test.ts` allow-list is unchanged. If
   any stats type leaks into the CLI adapter's signatures, a
   direct `workspace:*` dep + allow-list widening is required.
   **Preference:** consume via `@megasaver/core` only — keeps the
   CLI adapter thin and the allow-list stable. Confirm during
   implementation.
5. **stdout/stderr ordering fidelity.** §3 step 5 requires
   "combine stdout+stderr preserving order". Node's `spawn`
   delivers two independent streams; true wall-clock interleave
   is approximated by appending chunks in `data`-event arrival
   order across both streams. This is the same approximation
   §8d step 5 implies ("preserve order via marker line"). BB7b
   does NOT guarantee byte-exact interleave; it guarantees
   arrival-order chunk concatenation. Acceptable for filtering;
   noted so reviewers don't expect PTY-level fidelity.
6. **PR #75 is OPEN, not merged (hard blocker).** BB7b is
   BLOCKED-BY `feat/bb7-orchestrator-extract` (PR #75) for the
   orchestrator export shape (§1c) and `context-hints.ts` (§3.7).
   Implementation (writing-plans → TDD) MUST NOT start until #75
   lands; the BB7b plan's Phase 0 is "confirm #75 merged + read
   its exported `run`/`run-command` signature", then rebase this
   worktree on the updated `main`.
7. **`childExitCode` is surfaced, not persisted.** Per the
   exit-code decision (§6) the child's code is mirrored and
   carried in the live result + `--json`, but NOT written into the
   `ChunkSet` / `TokenSaverEvent` schemas (adding an `exitCode`
   field is a content-store/stats change, out of BB7b scope).
   Persisting it is a noted follow-up.
