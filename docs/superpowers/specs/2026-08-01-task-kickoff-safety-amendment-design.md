# Task Kickoff Safety Amendment — Session Tombstone and Delivery Accounting

> **Date:** 2026-08-01
> **Status:** APPROVED — the user authorized continuous implementation on 2026-08-01.
> **Risk:** HIGH — this changes Claude Code hook delivery, persistent state, and cost-event semantics.
> **Supersedes:** the Phase 1 task-kickoff lifecycle portions of `2026-08-01-cache-write-reduction-design.md` and `2026-08-01-cache-write-reduction-phase-1-plan.md`.

## 1. Decision

Task Kickoff promises **at most one** additional-context response for a Claude
`session_id`, not exactly-once delivery. It must prefer losing optional kickoff
context to sending a second cache-growing suffix. A task-kickoff cost row means
the hook's stdout write callback succeeded before the absolute deadline; it is
not proof that Claude subsequently consumed the pipe.

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
listener. Only a write callback that succeeds before the same absolute deadline
may append the `TaskKickoffEvent`. Calling `stdout.write` is irreversible: an
envelope queued before the deadline may drain afterward, but a late callback
still resolves the runner as `{ wrote: false }` and never authorizes an event.
The parent does not claim that it can retract those bytes. If writing stdout,
appending the event, or the process fails, the claim remains and the event is
absent. An accepted response can lack a cost row after a post-write crash,
which is the safe reporting trade-off.

The event reader has no retraction protocol. Prepared and failed responses are
never appended, so a compensating record cannot itself fail open into a false
cost row.

## 4. Bounded hook work

`UserPromptSubmit` starts its 500 ms budget at process entry. The parent reads
stdin only, then a dedicated worker captures intent, assembles context, and
performs all task-kickoff persistence. The parent terminates an incomplete
worker and exits zero when the budget expires. If preparation is incomplete at
the write boundary, no task-kickoff output is queued. A timeout may lose the
optional intent record, and a terminal claim and pack may remain when
persistence completed before the timeout. Task-pack persistence is
asynchronous. Best-effort intent capture retains its synchronous atomic writer
inside the isolated worker, where worker termination may abandon it; it never
runs in the parent. No worker stdout/stderr reaches Claude.

After the stdout callback succeeds before the deadline, delivery accounting is
authorized and the parent posts one `record` message. The worker remains
referenced until it acknowledges recording, fails, exits, or the same absolute
deadline expires; accounting may be absent after a deadline, but can never
precede callback-confirmed stdout delivery. The published
single-file `mega.mjs` re-enters itself for worker execution through an
`isMainThread` branch, so no sidecar is required by the release download.

The 500 ms contract applies to Mega Saver's work after the hook process starts;
it does not claim to bound Claude Code process startup or pipe consumption.
Tests exercise the actual process wrapper with a deliberately non-completing
worker and prove that no stdout is queued when preparation times out. A separate
pending-write fixture proves that a pre-deadline queued envelope may remain in
the stream after timeout while the result is false and no event is requested.
If persistence completed before the timeout, the terminal claim and pack may
remain visible and prevent a retry.

## 5. Privacy, durability, and size limits

Phase 1 enables task-kickoff persistence only on POSIX. It creates owner-only
directories/files and synchronizes the claim/pack file and parent directory
before exposing a response. On Windows the hook returns empty stdout without
creating task-kickoff state until a reviewed ACL implementation exists; it does
not claim POSIX permissions that NTFS cannot enforce.

The POSIX storage boundary is an owner-only local Mega Saver store. A stable
regular-file or symlink component is rejected before any task state is written.
An adversarial same-effective-UID process that replaces a directory component
after descriptor validation but before Node's pathname-based create is outside
this boundary: Node exposes no descriptor-relative `openat`/`renameat` API on
macOS, and closing that race requires a separately shipped native filesystem
subsystem. Such a process already has full authority over the owner's local
Mega Saver state. This phase does not claim protection against that active
same-UID attacker; it retains descriptor-bound validation and modes to reject
non-racing invalid trees. A future expansion of this boundary must provide a
reviewed native descriptor-relative implementation on every supported POSIX
platform.

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
cross-workspace first prompts; stdout-write failure; timeout-before-ready and a
late successful callback after a pre-deadline queued write;
oversized rendered text; POSIX durability ordering/failure paths; Windows
fail-open; an installed-hook fresh-store real Claude smoke with one pack and
one event; focused and full verification; and fresh `code-reviewer` plus
`critic` passes. No savings figure is published without the separate paired
benchmark in the parent cache-write reduction specification.
