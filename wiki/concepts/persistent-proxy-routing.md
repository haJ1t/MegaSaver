---
title: Persistent Proxy Routing
tags: [proxy, lifecycle, launchd, claude-code]
sources:
  - docs/superpowers/specs/2026-07-02-persistent-proxy-routing-design.md
  - wiki/log.md
status: active
created: 2026-07-02
updated: 2026-07-03
---


## Implementation (P0-P8 on `feat/persistent-proxy-routing-impl`, 2026-07-03)

TDD; `pnpm verify` green (48/48 tasks). llm-proxy: nonce-bound HMAC health
endpoint. New `@megasaver/proxy-control` (agent-agnostic): versioned state
stores, fenced PID-reuse-safe locks, the pure recovery matrix (foreign never
removed, no route during disable, remove only leased-exact), supervisor wiring
(startup fixpoint + 5s monitor), macOS LaunchAgent adapter (legacy manual
bootout, idempotent-by-observation). connector-claude-code: value-guarded route
adapter. CLI: `proxy start/stop/status/service uninstall` + internal
`supervise`; old foreground start → supervise (public break). GUI: persistent
toggle, singleton + osascript + boot/shutdown route-clear removed (the stranding
bug). Deferred: GUI auth bootstrap + the long-running supervise control server.

## Purpose

Persist the operator's proxy opt-in across GUI and terminal lifetimes without
leaving future Claude processes routed to a dead listener. The 2026-07-02 live
diagnosis showed the proxy running while no current client had the route
(source: `wiki/log.md`, 2026-07-02 diagnosis).

## Locked design

- A dedicated `mega proxy supervise` process owns the LLM listener; the existing
  context daemon remains independent.
- `com.megasaver.proxy` provides macOS RunAtLoad/KeepAlive lifecycle only after
  explicit opt-in.
- Nonce health must pass before a leased route is written.
- Foreign routes and LaunchAgents are never overwritten.
- CLI and GUI share one controller; the GUI owns no listener or settings writer.
- Stop removes future routing, then drains for old clients until the operator
  confirms they were restarted.
- Status separates desired state, health, route, traffic, hook invocation, and
  compression evidence.

Source: `docs/superpowers/specs/2026-07-02-persistent-proxy-routing-design.md`.

## Risk

CRITICAL: the proxy carries credentials and complete API traffic. Architect and
critic approved the design; security review remains mandatory before merge.

## Related

- [[entities/llm-proxy]] — the listener this supervisor owns; nonce-bound HMAC
  health endpoint gates every leased route.
- [[concepts/proxy-mode]] — the Proxy Mode surface (`proxy_*` tools, output
  classifier) that persistent routing keeps pointed at a live listener.
- [[syntheses/post-v1.1-roadmap]] — where this proposed next-arc item is tracked.


## Where owner liveness is actually decided (2026-07-25)

Traced while resolving an unread `ReconcileObs.ownerDead` field. Recorded so the
question is not re-derived.

**The reconcile matrix does not observe owner liveness, and should not.**
"May I displace the previous route owner?" is answered upstream at the lock
layer: `withTransitionLock` → `tryAcquireLock` → `isOwnerStale`
(`packages/proxy-control/src/locks.ts:44-54`), which uses real process identity —
a different `bootId`, an expired `leaseExpiresAt`, or `isLiveSameBoot(pid,
processStartToken, bootId)` returning false. Alternative predicates, never an
AND, so PID reuse cannot create a permanent veto.

Both production drivers run inside that lock — `runStartupRecovery`
(`apps/cli/src/commands/proxy/supervise.ts:211`) and the 5-second `superviseDrive`
tick (`:184`). By the time `reconcileTransition` runs, single-writer ownership is
settled and there is no takeover left to guard.

**The transition record's owner fields are sentinels**, stated verbatim at
`apps/cli/src/commands/proxy/control.ts:147-149`: the single-writer guarantee
comes from the fenced, process-identity-based `transition.lock`, not from the
record.

**`handoffDeadline` is null because the bootstrap handoff is unimplemented.**
The design (`2026-07-02-persistent-proxy-routing-design.md:356-360`) has the CLI
persist a deadline, RELEASE `transition.lock`, and the supervisor re-acquire and
rewrite the owner; the deadline exists to bound a *released* transition so a
suspended CLI cannot become an immortal owner. `withTransitionLock` instead holds
the lock across the whole operation (`try { fn() } finally { releaseLock }`) and
never persists a deadline. That is stricter, not laxer — no released-but-live
window exists to bound. The permanent `null` is consistent with the shipped
protocol.

Consequence: `ownerDead` (derived from that null, hence pinned `true`) and
`leasePhase` were deleted from `ReconcileObs` rather than wired in. Wiring them
would have fed a route-safety decision from a documented sentinel that is
currently a constant — a guard in appearance only.

Sources: [[docs/superpowers/specs/2026-07-25-reconcile-obs-dead-fields-design]].
