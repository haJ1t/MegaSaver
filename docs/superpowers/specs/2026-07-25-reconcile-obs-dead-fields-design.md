---
title: Remove the unread `ownerDead` / `leasePhase` reconcile observations
status: proposed
risk: HIGH
created: 2026-07-25
package: "@megasaver/proxy-control"
builds-on: docs/superpowers/specs/2026-07-02-persistent-proxy-routing-design.md
found-by: 2026-07-25 security review (deny.write change)
---

# Unread `ownerDead` / `leasePhase` on `ReconcileObs`

> HIGH risk — route-ownership safety path (`CLAUDE.md` §12). The
> finding was raised as "either the takeover decision should consult
> `ownerDead`, or it is dead code", so the *investigation* is the
> deliverable and the code change follows from it.

## §1 The finding

`ReconcileObs` (`packages/proxy-control/src/reconcile.ts:24-25`)
declares two fields `reconcileTransition` never reads:

- `leasePhase: "installing" | "active" | null`
- `ownerDead: boolean`

`observeReality` (`supervisor.ts:45-48`) computes both on every tick.
`ownerDead` derives from the durable transition's `handoffDeadline`,
and **both production writers hardcode `handoffDeadline: null`**
(`apps/cli/src/commands/proxy/control.ts:158`,
`apps/gui/bridge/proxy-control.ts:95`), so the ternary always takes its
`: true` branch — the value is permanently `true`.

An unread safety signal that is also pinned true is worth resolving in
one direction or the other.

## §2 Investigation — where owner liveness is actually decided

**Owner liveness IS enforced. It lives at the lock layer, not the
reconcile layer, and it does not use `handoffDeadline`.**

Every production entry into the reconcile matrix is wrapped in
`withTransitionLock`:

| driver | call site | wrapped |
|---|---|---|
| `runStartupRecovery` | `apps/cli/src/commands/proxy/supervise.ts:211` | yes |
| `superviseDrive` (5s tick) | `apps/cli/src/commands/proxy/supervise.ts:184` | yes |

`withTransitionLock` (`transition-lock.ts:25-56`) acquires
`transition.lock` through `tryAcquireLock`, which decides whether a
previous owner may be displaced via `isOwnerStale`
(`locks.ts:44-54`) using **real process identity**: a different
`bootId`, an expired `leaseExpiresAt`, or `isLiveSameBoot(pid,
processStartToken, bootId)` returning false. These are alternative
predicates, so PID reuse cannot create a permanent veto.

That is a strictly stronger answer to "is the previous owner dead?"
than a self-reported timestamp in a JSON record. And the record's owner
fields are already documented as non-authoritative — verbatim at
`apps/cli/src/commands/proxy/control.ts:147-149`:

> The transition RECORD owner fields are sentinels: the real
> single-writer guarantee comes from the transition.lock (fenced,
> process-identity based), not from these fields.

By the time `reconcileTransition` runs, single-writer ownership is
already settled. It has no takeover decision left to guard.

### §2.1 Why `handoffDeadline` is null, and why that is safe

The parent spec describes a bootstrap handoff
(`2026-07-02-persistent-proxy-routing-design.md:356-360`): the CLI
persists a transition with a fresh `handoffDeadline`, **releases**
`transition.lock`, and the supervisor re-acquires it and rewrites the
owner. `handoffDeadline` exists to give a *released* transition a
liveness bound so a suspended CLI cannot become an immortal owner.

That handoff was never implemented — `withTransitionLock` holds the
lock across the whole operation (`try { fn() } finally { releaseLock }`)
and never persists a deadline. **Not implementing it is the more
conservative choice**: holding the lock throughout means there is no
released-but-live transition window for a deadline to bound. So the
permanent `null` is consistent with the shipped protocol, not a bug in
it.

## §3 Decision — delete both fields

Not "wire `ownerDead` into the matrix". Doing that would feed a route
safety decision from a field the codebase documents as a sentinel and
which both writers hardcode — deriving a weaker liveness answer,
downstream of the strong one, on data that is currently a constant.
That is worse than dead code: it would look like a guard while adding
nothing.

`leasePhase` goes for the same reason. The matrix distinguishes lease
presence (`hasLease`) and takes the transition's own `lease_installing`
/ `route_verified` phases from `ProxyTransition`; the *lease record's*
phase is never a decision input.

Out of scope: `handoffDeadline` stays in `proxyTransitionSchema`
(`state.ts:56`). It is a persisted field of a durable record, removing
it is a state-format migration, and the handoff design it belongs to
may still land. Its status is documented rather than changed.

## §4 Design

- Delete `leasePhase` and `ownerDead` from `ReconcileObs`.
- Delete their computation from `observeReality`.
- `ReconcileObs` is then exactly the five fields the matrix consumes:
  `route`, `health`, `hasLease`, `generationLive`, `confirmed`.
- Add a guard test asserting `observeReality`'s returned key set is
  exactly those five, so a future unread observation field fails loudly
  instead of accumulating. A type-level (`expectTypeOf`) guard was
  rejected: this package's `vitest.config.ts` has no `typecheck` block
  and `include` is `test/**/*.test.ts`, so a `.test-d.ts` would silently
  not run — a guard that does not execute is the defect being fixed.

`reconcile.test.ts:45` ("intent_persisted with desired-false **dead
owner** clears the transition") passes `obs({ ownerDead: true })` while
the decision turns purely on `desiredEnabled === false`. The name
asserts a causal role the field never had; it is renamed.

## §5 Blast radius

None at runtime. Both fields were write-only: computed, stored in an
object, never read. Behaviour of every matrix row is unchanged, which
the existing exhaustive recovery-matrix tests pin.

`@megasaver/proxy-control`: **major**. `ReconcileObs` is exported from
the package index and loses two public fields. No consumer outside this
package constructs one, so the practical radius is zero — but a public
type shrinking is breaking, and the two sibling changes in this batch
were classified the same way.

## §6 Alternatives considered

- **Wire `ownerDead` into `reconcileTransition` — REJECTED.** §3. The
  guard already exists upstream and is stronger; this would add a
  decision input that is a hardcoded constant.
- **Implement the bootstrap handoff so `handoffDeadline` becomes
  meaningful — REJECTED here.** A real feature (release the lock mid-
  bootstrap, re-acquire, rewrite owner under lock) with its own spec.
  Nothing today needs it, and the current always-hold-the-lock shape is
  safer, not less safe.
- **Leave both and document — REJECTED.** Same reasoning as the two
  sibling findings in this batch: a computed-but-unread safety-shaped
  signal reads as a guard to the next person. The `security-reviewer`
  flagged this one precisely because it *looked* load-bearing.
- **Also remove `handoffDeadline` from the schema — REJECTED.** §3,
  persisted-state migration, out of scope.

## §7 Definition of Done

1. RED first: the key-set guard fails against today's 7-key object.
2. `ReconcileObs` has exactly the five consumed fields.
3. Every existing recovery-matrix test passes unchanged (behaviour is
   provably identical).
4. The misleading `reconcile.test.ts:45` name is corrected.
5. `pnpm verify` green.
6. `critic` pass, fresh context.
7. Changeset (major), wiki entity + `log.md`.
