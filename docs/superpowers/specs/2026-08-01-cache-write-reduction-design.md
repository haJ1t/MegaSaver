# Cache-Write Cost Reduction — Turn Control, Batch Advice, and Lossless Output Routing

> **Date:** 2026-08-01
> **Status:** DRAFT — user approved the direction on 2026-08-01; review of this written specification is required before planning or code.
> **Risk:** HIGH — the work touches Claude Code hooks, the saver’s reporting path, and lossless output handling. `code-reviewer` and `critic` review every implementation phase.
> **Scope authorization:** User: “hepsini senin önerdiğin sıra ile yap bitir” (“do all of them in your recommended order and finish”).

## 1. Problem and correction

Measured baseline sessions place 62–75% of cost in `cache_creation`. A turn is
not itself a cache failure: each new, uncached suffix is legitimately written
once. The controllable levers are therefore (1) fewer exploratory turns, (2)
smaller, losslessly delivered tool output on its first appearance, and (3)
removing configuration that causes a previously cacheable prefix to miss.

The former claim that the PostToolUse saver mutates an already cached
`tool_result` is retracted. It returns `updatedToolOutput` before the first
request containing that result; no implementation in this work may rely on
that false mechanism. (source: `wiki/syntheses/saver-cache-churn.md`)

`@megasaver/connector-claude-code`’s first-party routing flag and the
SessionStart Warm Start feature are already shipped. They are foundations, not
new duplicate features. `mega cache` already diagnoses counts-only cache
misses. (source: `wiki/syntheses/proxy-first-party-cache-parity.md`,
`wiki/entities/cli.md`)

## 2. Goal, non-goals, and success measure

### Goal

Ship the four recommended interventions, in order, while preserving evidence:

1. extend the shipped Warm Start with one byte-stable task kickoff pack;
2. advise batching repeated read/search exploration;
3. extend `mega cache` with a suffix/configuration audit; and
4. provide a lossless, opt-in route for narrow, read-only Bash output.

### Non-goals

- Do not rewrite arbitrary Bash, tool schemas, system reminders, or model
  requests in transit.
- Do not issue cache keep-alive API calls or make the proxy default-on.
- Do not claim that all compressed tokens were billable cache writes.
- Do not store prompt, request, tool-output, or command text in the proxy
  usage ledger.
- Do not suppress a Read or Bash result merely because it was seen before.

### Outcome gate

The acceptance metric is total normalized session cost, with its
`cache_creation` component reported separately. A phase may claim a reduction
only after fresh-store, isolated A/B runs execute the same fixed transcript and
the real API benchmark reports both arms, all turns, and the raw token classes.
The feature is a failure if it increases total cost or causes a task outcome
regression. A lower cache-write *share* alone is not success.

## 3. Alternatives considered

| Approach | Decision | Reason |
| --- | --- | --- |
| Rewrite every outgoing request at the proxy | Rejected | Changes model semantics across every turn and cannot prove parity. |
| Automatically truncate or rewrite arbitrary Bash in PreToolUse | Rejected | Loses evidence or bypasses Claude Code’s permission model. |
| Stable task context + conservative advice + lossless output route | **Selected** | Attacks repeated exploration without changing an existing tool request; the only transformed output remains recoverable. |

## 4. Phase 1 — Stable Task Kickoff Pack (Warm Start extension)

`UserPromptSubmit` currently records a redacted prompt but returns no context.
On the first valid user prompt in a session, it will assemble a task pack from
the existing repository index, Code-Truth-verified memories, and candidate
files. It returns the pack as `hookSpecificOutput.additionalContext` and
persists the exact text at `stats/<workspace>/task-pack/<safe-session>.json`.
It emits only on that first prompt; every later prompt in the same session
returns no additional context. A compact, permanent claim beside the pack is
the durable one-emission tombstone; overlay GC never scans or deletes
task-kickoff packs or claims. The stored row prevents duplicate emission, not
the repeated injection of a cache-growing suffix. The pack contains only a
bounded repository synopsis, verified decisions, and path-plus-summary
candidate files—not source-file bodies.

The hard cap is 2,000 measured tokens. Assembly timeout, missing index, invalid
session id, or any storage error returns no context and still exits zero. The
pack’s first prompt is a cost and is recorded as such; it is never reported as
saved tokens. PreToolUse telemetry is used to compare early Read/Grep/Glob
counts with a prior baseline, but no counterfactual saving is displayed until a
matched benchmark proves it.

**Invariants:** same inputs produce byte-identical text; one session emits at
most one pack; changed repository state applies only to a new session; stale or
unverified memory cannot enter; the hook does not delay or block the prompt.

## 5. Phase 2 — Batch-Read Adviser

A new metadata-only session sequence ledger records only `{tool, directory,
timestamp, sessionId}` for eligible Read/Grep/Glob calls. It deliberately does
not persist paths beyond the current user-owned `.megasaver` telemetry surface,
and never persists command text or file contents.

When the second eligible exploration call in the same directory occurs inside a
60-second window, a once-per-directory PreToolUse response supplies one concise
`additionalContext` hint: batch the remaining search with a targeted
`mega output exec` / `mega output file` call, including an intent and recovery
handle. The current tool call continues unchanged; this hook never emits
`permissionDecision: "allow"` or `"deny"`. A bounded advisory event records
that the hint was offered, not that it was followed or saved tokens.

The adviser is deliberately conservative. It cannot turn “the agent may choose
to batch” into a claimed reduction, and it does not replace exact file reads.

## 6. Phase 3 — Cache Doctor suffix audit

The existing `mega cache` command remains the one cache-doctor entry point.
It gains a read-only `--suffix-audit` mode and matching JSON field. The audit
combines two independently labelled results:

1. **Measured usage ledger:** current global counts (`cacheCreationTokens`,
   `cacheReadTokens`, input/output) and the existing D1–D4 diagnoses. It
   remains global when proxy rows lack `workspaceKey`; it must not attribute a
   cache write to a project, hook, or saver without an input signal.
2. **Static configuration:** known Mega Saver hook entries and generated
   connector blocks are rendered twice from fixed fixtures. Byte variance,
   duplicate hook registration, a foreign custom base URL, and a missing
   first-party flag are reported as configuration risks. A static finding is
   not assigned dollars or cache-creation tokens.

The output distinguishes `measured`, `global-only`, and `configuration-risk`
facts. It exposes the current cache-creation share, but never presents that
share as avoidable waste. No request body or hash of request content is added to
the proxy ledger.

## 7. Phase 4 — PreToolUse lossless output-route adviser

The tool recognizes only a strict grammar of read-only, single-process Bash
commands: `rg`, `grep`, `find`, `git log`, and `git diff`, with no shell
operators, redirections, substitutions, assignments, or environment prefixes.
All other Bash input is an unconditional passthrough.

For an eligible command whose static risk score predicts large output, the
PreToolUse hook provides a one-time recommendation to run the same argv via the
existing policy-gated `mega output exec` surface. That surface captures stdout
and stderr together, redacts before persistence, writes recoverable chunks, and
reports an omission marker. The hook does not rewrite the current command,
does not grant permissions, and does not claim the agent followed the advice.

The user may opt into an explicit output-route profile only after the command
grammar and Claude Code hook input-mutation contract are separately verified on
the supported Claude Code version. That profile is a follow-on HIGH-risk
sub-specification, not an implicit feature flag: silent mutation of a user’s
Bash command is forbidden here.

## 8. Test and evidence plan

Every phase follows red → green → refactor.

| Phase | Red tests before code | Feature evidence |
| --- | --- | --- |
| 1 | deterministic pack, final token cap, stale-memory exclusion, timeout/invalid input → empty | first prompt emits once; second prompt emits nothing; hook smoke in a real session |
| 2 | directory-window state, one-shot suppression, expiry, no permissions field | hook integration shows current native call still proceeds |
| 3 | global-only attribution, static duplicate/variance findings, no request-content persistence | `mega cache --suffix-audit --json` fixture and real ledger smoke |
| 4 | grammar rejects every shell feature, accepted argv preservation, advice only, recovery path | valid `rg` advice and unsafe Bash passthrough smoke |

For every implemented phase: package tests, `pnpm verify`, an independent
`code-reviewer` pass, an independent `critic` pass, and a benchmark receipt.
The benchmark has a clean per-arm store, arm-order isolation, fixed standard
rates, and reports task completion, turns, input, cache creation, cache read,
output, and total cost. A benchmark that does not satisfy those conditions is
diagnostic only, never a product claim.

## 9. Delivery order and release boundaries

1. Verify and extend the shipped Warm Start (Phase 1).
2. Add the Batch-Read Adviser (Phase 2).
3. Add the Cache Doctor suffix audit (Phase 3).
4. Add the safe PreToolUse output-route adviser (Phase 4).

Each phase is independently reversible, changesets its touched public package,
and updates its wiki evidence. Proxy request rewriting, cache keep-alives,
model routing, tool-schema pruning, and automatic Bash mutation require their
own future specifications and approval; none may be smuggled into this work.
