---
title: The Conductor is a role, not an elected leader
tags: [decision, agent-harness, mesh, agent-office, multi-terminal, locked]
sources:
  - docs/superpowers/specs/2026-08-19-rust-agent-harness-design.md §5
  - docs/superpowers/reviews/2026-08-19-rust-agent-harness-review.md B2
  - docs/superpowers/specs/2026-08-06-session-mesh-design.md:38
  - packages/agent-office/src/task-store.ts
  - packages/agent-office/src/task.ts:4
status: locked
created: 2026-08-19
updated: 2026-08-19
---

# Conductor is a role

The Rust agent harness ([[entities/mega-agent]]) needs multiple terminals to
cooperate. Its v1 draft proposed **leader election** — earliest `startedAt`
wins, 5 s heartbeats, promotion on failover, `.megasaver/mesh/peers/<pid>.json`
presence, plus a blocking "Claim Lock Engine".

That reads as a direct contradiction of [[entities/mesh]], whose approved
design is *no leader, files are truth, pull-based*, and whose spec lists
blocking claims as an explicit **Non-Goal**
(`2026-08-06-session-mesh-design.md:38` — "v1 is warn-only").

**It is not a contradiction, because the Conductor does not need to be
elected.** The terminal the operator hands a goal to *is* the Conductor for
that goal. It decomposes and assigns; the others execute. No title is
contested, so nothing needs electing, and no superseding spec is required.

## What this deletes

Leader election, heartbeat-ranked promotion/failover, PID-keyed presence files
(`liveSessionId` is the identity and survives worktrees), a second UDS socket
mesh, and the Claim Lock Engine. Workers run in separate worktrees, so they
edit separate copies of a file — the real conflict is at merge, handled by a
single `flock` on a serialized integration queue.

## Assignment, not claim — the primitive boundary

Two stores, often conflated:

| Store | Primitive | Contention |
|---|---|---|
| `agent-office/task-store` | `saveTask` / `loadTask` / `listTasks` / `deleteTask`; `status: queued \| running \| done \| failed \| canceled` | **No atomic claim.** Per-agent queues, assigned by the Conductor. |
| `@megasaver/mesh` inbox | `drainInbox(liveSessionId)`, at-most-once | Atomic — but it carries **messages**, not tasks. |

Contention is designed out, not locked away. The decision holds under either
primitive, which is why the pre-assignment shape was chosen over waiting for a
claim API. A future shared unassigned pool would need an atomic claim
`task-store` does not have — Phase 4 open question, not a Phase 1 blocker.

Related: [[entities/agent-office]], [[concepts/risk-aware-development]].
