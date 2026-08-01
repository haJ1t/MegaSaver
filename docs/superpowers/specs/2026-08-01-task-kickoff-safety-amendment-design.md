# Task Kickoff Safety Amendment — Session Tombstone and Delivery Accounting

> **Date:** 2026-08-01
> **Status:** APPROVED — the user authorized continuous implementation on 2026-08-01.
> **Risk:** HIGH — this changes Claude Code hook delivery, persistent state, and cost-event semantics.
> **Supersedes:** the Phase 1 task-kickoff lifecycle portions of `2026-08-01-cache-write-reduction-design.md` and `2026-08-01-cache-write-reduction-phase-1-plan.md`.

## 1. Decision

Task Kickoff promises **at most one** additional-context response for a Claude
`session_id`, not exactly-once delivery. It must prefer losing optional kickoff
context to sending a second cache-growing suffix. A task-kickoff cost row means
the hook successfully wrote its JSON response to stdout; it is not proof that
Claude subsequently consumed the pipe.

No automatic task-pack deletion is in scope. Claims and packs are permanent
local state. The earlier native-retention proposal remains superseded.

## 2. Session-global tombstone

The claim key is `stats/task-kickoff-sessions/<safe-session>.json`, independent
of `cwd` and workspace. The atomically-created, owner-only claim contains the
winning workspace key, event id, and creation timestamp. Its existence is a
terminal consumed state even if it is empty, malformed, or only partially
written: the hook fails closed and emits no further task context for that
session.

The rendered pack remains at
`stats/<winning-workspace>/task-pack/<safe-session>.json`. Concurrent prompts
may render in parallel, but only the process that creates the session claim may
store a pack or continue to response delivery. A later prompt in another
project checks the global claim before project resolution and returns empty.

This gives a strict normal-operation and crash-path at-most-once boundary.
It deliberately does not retry an incomplete claim: retrying can create a
duplicate after an unobservable stdout delivery.

## 3. Delivery and cost-event order

The worker writes the global claim and pack before it exposes an output envelope
to the process runner. The runner writes the envelope to stdout with an error
listener. Only a successful write callback may append the `TaskKickoffEvent`.
If writing stdout, appending the event, or the process fails, the claim remains
and the event is absent. Cost reporting therefore never treats an undelivered
or timed-out response as injected context; an accepted response can lack a
cost row after a post-write crash, which is the safe reporting trade-off.

The event reader has no retraction protocol. Prepared and failed responses are
never appended, so a compensating record cannot itself fail open into a false
cost row.

## 4. Bounded hook work

`UserPromptSubmit` starts its 500 ms budget at process entry. The parent reads
stdin only, then a dedicated worker captures intent, assembles context, and
performs all task-kickoff persistence. The parent terminates an incomplete
worker and exits zero when the budget expires. A timeout may lose the optional
intent record; it must never delay the prompt or emit task-kickoff stdout or a
cost event. A terminal claim and pack may remain when persistence completed
before the timeout. The worker receives one absolute wall-clock deadline, all
of its task/intent filesystem operations are asynchronous, and no worker
stdout/stderr reaches Claude.

After the stdout callback succeeds, delivery is complete and the parent posts
one `record` message. The worker remains referenced until it acknowledges
recording, fails, exits, or the same absolute deadline expires; accounting may
be absent after a deadline, but can never precede stdout delivery. The published
single-file `mega.mjs` re-enters itself for worker execution through an
`isMainThread` branch, so no sidecar is required by the release download.

The 500 ms contract applies to Mega Saver's work after the hook process starts;
it does not claim to bound Claude Code process startup or pipe consumption.
Tests exercise the actual process wrapper with a deliberately non-completing
worker and prove that stdout and events remain absent after a deadline timeout.
If persistence completed before the timeout, the terminal claim and pack may
remain visible and prevent a retry.

## 5. Privacy, durability, and size limits

Phase 1 enables task-kickoff persistence only on POSIX. It creates owner-only
directories/files and synchronizes the claim/pack file and parent directory
before exposing a response. On Windows the hook returns empty stdout without
creating task-kickoff state until a reviewed ACL implementation exists; it does
not claim POSIX permissions that NTFS cannot enforce.

`additionalContext` is capped at 9,000 UTF-16 code units as well as 2,000 real
tokens, leaving headroom below Claude Code's hook-output string limit. The
renderer rejects an over-limit candidate rather than truncating evidence.

## 6. Store override and documentation

Installed `hooks intent --store <path>` accepts the baked path and passes it to
the intent/task-kickoff runner. Hook command recognition derives the subcommand
from `hooks <name>`, allowing old pre-subcommand store commands to migrate in
place without duplicate hooks. Public hook help and documentation describe the
one-shot injected context, cost-event meaning, permanent retention, and
fail-open behavior.

## 7. Evidence gates

Required evidence: session movement across two registered projects; concurrent
cross-workspace first prompts; stdout-write failure; timeout-before-ready;
oversized rendered text; POSIX durability ordering/failure paths; Windows
fail-open; an installed-hook fresh-store real Claude smoke with one pack and
one event; focused and full verification; and fresh `code-reviewer` plus
`critic` passes. No savings figure is published without the separate paired
benchmark in the parent cache-write reduction specification.
