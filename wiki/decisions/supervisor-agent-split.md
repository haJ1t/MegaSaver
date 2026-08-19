---
title: The harness is two processes (supervisor / agent)
tags: [decision, mega-agent, security, sandbox, critical]
sources:
  - docs/superpowers/specs/2026-08-19-rust-agent-harness-design.md (§3.3, §11.1, §11.2)
  - docs/superpowers/plans/2026-08-19-rust-agent-harness-plan.md (Tasks 3, 4, 5)
status: active
created: 2026-08-19
updated: 2026-08-19
---

## Decision

[[mega-agent]] runs as **two processes**, and the split is a security boundary,
not an optimisation.

| | Supervisor | Agent (child) |
|---|---|---|
| Sandbox | none | `workspace-write`, **network literally none** |
| Holds | model API connection, daemon HTTP connection, the NDJSON journal | one inherited pipe pair |
| Does | spawns agents, proxies their model and daemon calls, writes the journal | every filesystem read/write, every edit, every `bash` |
| Trust | the operator's shell | model-directed; assume hostile |

They speak over the child's own **stdin/stdout pipe pair** — already inherited,
already bidirectional, needing no `unsafe`, no `libc`, and no platform-specific
fd passing. Frames are 4-byte big-endian length + JSON.

## What this replaced

Spec v1 and the first plan installed the sandbox by wrapping each child
`Command` (`Profile::wrap(cmd)`). Two things were wrong with it, and the second
was not visible until the first was fixed:

1. **The harness's own writes were never inside the profile.** `bash` was guarded
   at the syscall boundary while `write` and edit-apply, in the same process
   image, were guarded by an `if`. That makes §11.2's central claim — no fenced
   path is writable by any route — false, and re-enters the v1 defect with its
   polarity flipped.
2. **Arm A ran unsandboxed.** The eval baseline is a real agent loop with a real
   `bash` tool, run unattended across dozens of instances, five tasks before any
   sandbox existed. A prior session note claiming no commit in this repo's
   history had an unattended agent with an unsandboxed shell was simply wrong.

Fixing (1) means the profile is entered by the **process**
(`Profile::enter(self)`, irreversible, process-global). But a process that
sandboxes itself with no network cannot call the model — which is what forced the
split.

## Why not a single self-sandboxing process with carve-outs

That was the option on the table, and it is the one rejected. Carving out the
model endpoint means carving out an **outbound internet host** — precisely the
exfiltration path §11.1 exists to close. A packet filter cannot tell `/status`
from `/exec`; the supervisor can.

## What it closed

- **§11.1 is resolved by deletion, not by pinning a port.** No sandboxed process
  ever needs a socket, so `workspace-write` = network: none, with no exception.
- **Both eval arms run in the same box**, removing an environment asymmetry that
  the §4.4 same-model check could never have caught, because it is not a model
  difference.
- **Phase 2 workers need no new mechanism** — they are just more children.

## What it cost

One process split plus a ~150–200 LOC framed-RPC module that Phase 0 carries
before the first model call. Sequencing changed: the sandbox moved from Phase 1
to **Phase 0, ahead of Arm A**.

## Corollaries that bite in implementation

- **The agent cannot write the journal** — it lives outside the worktree. Events
  ship as `event` frames; the supervisor holds the file handle. Components take a
  `dyn Events` seam, never an `EventSink`.
- **One emitter per event type.** `usage` reaches the agent as a forwarded chunk
  and the supervisor as a real one; if both emit, every token metric doubles and
  every gate still passes.
- **The agent must not out-talk the pipe buffer.** The supervisor is inside the
  stream loop and not reading `rx` between `model.chat` and `end`, so mid-stream
  events queue in the buffer — safe at ~100 bytes an event against ~64KB, a
  deadlock above it. The kernel emits in `Observe`, after the drain.
- **`serve` takes the two pipes, not the `Child`.** That is what makes the two
  silent rules above testable offline: a `Cursor` of canned frames and a tempfile
  journal, no process and no socket (plan Task 5 Steps 7–10).
- **macOS re-execs under `sandbox-exec`** (`exec` replaces the image, so pipes
  survive); Linux uses `landlock_restrict_self` with no re-exec, ABI V4 floor,
  and must fail unless `FullyEnforced`.

## Status

Implemented in the plan (Tasks 3–5), not yet in code. The trust boundary is
assigned to `architect` + `security-reviewer` and is the remaining reason
Phase 1 does not merge.
