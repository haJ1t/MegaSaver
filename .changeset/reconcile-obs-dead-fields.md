---
"@megasaver/proxy-control": major
---

Remove the unread `ownerDead` and `leasePhase` observations from `ReconcileObs`.

Both were computed by `observeReality` on every reconcile tick and never read by
`reconcileTransition`, which branches only on `route`, `health`, `hasLease`,
`generationLive`, and `confirmed`.

`ownerDead` was the worse of the two. It derived from the durable transition's
`handoffDeadline`, which both production writers hardcode to `null`
(`apps/cli/src/commands/proxy/control.ts:158`, `apps/gui/bridge/proxy-control.ts:95`),
so it was pinned permanently `true` — a safety-shaped constant that read like a
route-takeover guard.

**No guard is lost, because the real one is upstream and stronger.** "May I
displace the previous owner?" is decided at the lock layer by `isOwnerStale`
(`locks.ts:44-54`) from real process identity — boot id, lease expiry, and a
live-same-boot pid + process-start-token check — and every reconcile driver runs
inside `withTransitionLock` (`supervise.ts:184` and `:211`). By the time the
matrix runs, single-writer ownership is already settled. Wiring `ownerDead` into
it would have derived a weaker liveness answer, downstream of the strong one,
from a field the code documents as a sentinel.

`handoffDeadline` stays in `proxyTransitionSchema` — it belongs to the
bootstrap-handoff protocol (CLI releases the lock mid-bootstrap, supervisor
re-acquires it), which is not implemented. Holding the lock for the whole
operation, as the code does today, is the more conservative shape: there is no
released-but-live transition window for a deadline to bound.

Behaviour is unchanged — the fields were write-only. A key-set test now pins
`observeReality` to exactly the five consumed fields so another write-only
observation cannot accumulate.

Major: `ReconcileObs` is exported from the package index and loses two public
fields. No consumer outside the package constructs one.

See `docs/superpowers/specs/2026-07-25-reconcile-obs-dead-fields-design.md`.
