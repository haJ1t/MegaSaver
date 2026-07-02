---
title: Persistent proxy routing with a dedicated supervisor
status: draft
risk: CRITICAL
risk_note: >
  HIGH is the minimum because this changes global Claude settings and public
  CLI behavior. The predecessor LLM-proxy spec classified the full API and
  credential path as CRITICAL; persistent routing increases that exposure, so
  CRITICAL controls remain required.
created: 2026-07-02
branch: feat/persistent-proxy-routing
implementation_order: "2 of 2 — after saver activation inheritance"
design_reviews_completed:
  - architect
  - critic
  # Re-run against the round-2 amended text on 2026-07-03; archived artifacts:
  # docs/superpowers/reviews/2026-07-02-persistent-proxy-routing-security-design-review.md
  # docs/superpowers/reviews/2026-07-02-persistent-proxy-routing-tracer-design-evidence-loop.md
  # Both APPROVE_WITH_NOTES; every note incorporated (see artifact addenda).
  - security-reviewer
  - tracer-evidence-loop
counter_review:
  # Codex was unavailable (out of credits); counter-review performed by fresh
  # independent Claude subagent contexts across rounds 2-3. Found and fixed a
  # separate-git-dir BLOCKING the author introduced in round 2, plus 9 more.
  # Final: fix-verify + plan-readiness APPROVE, consistency CONSISTENT.
  # Artifact: docs/superpowers/reviews/2026-07-03-round2-round3-counter-review.md
  status: approved-fresh-context
  caveat: no independent non-Claude review line ran; re-bless before merge if available
required_implementation_reviews:
  - code-reviewer
  - critic-implementation
  - security-reviewer-implementation
  - tracer-runtime-evidence
  - verifier
manual_confirmation:
  date: 2026-07-02
  evidence: >
    User explicitly selected persistent CLI+GUI routing with manual next-launch
    restart and the six safety amendments (2026-07-02 chat), and directed the
    round-2 amendment implementation in chat the same evening; recorded as a
    dedicated user-confirmation entry in wiki/agent-channel.md dated
    2026-07-03 00:15.
sources:
  - docs/conventions/mission.md
  - docs/conventions/risk-modes.md
  - docs/superpowers/specs/2026-06-24-llm-proxy-phase0-design.md
  - docs/superpowers/specs/2026-06-25-context-daemon-design.md
  - wiki/log.md
  - wiki/agent-channel.md
---

# Persistent proxy routing with a dedicated supervisor

## Problem

The local Anthropic proxy can be healthy while receiving no traffic. The live
2026-07-02 investigation found a proxy process on port 8787, but
`proxy-usage/usage.jsonl` had not changed since 2026-06-24 because no current
Claude process had `ANTHROPIC_BASE_URL=http://127.0.0.1:8787`.

The current activation paths disagree:

- `mega proxy start` runs a foreground server and only prints an `export`
  instruction.
- The GUI owns a separate process-local proxy and writes the Claude route only
  for that instance.
- GUI bridge startup and shutdown unconditionally remove the route.
- CLI and GUI do not share desired state, runtime ownership, or status.
- A pre-existing third-party `ANTHROPIC_BASE_URL` can be overwritten or removed
  without an ownership check.

This creates an inaccurate “running means active” signal and can also create
the inverse failure: a persisted route pointing at a dead proxy breaks every
new Claude session.

There is also a support-boundary contradiction to resolve honestly. The 2026-06-25
context-daemon spec records that Claude Desktop ignored the LLM base URL, while
the current GUI restart helper injects it directly into `Claude.app`. This spec
supports Claude Code clients that honor the connector's settings route. It does
not claim Claude Desktop routing until a real post-restart usage event proves it.

## Goal

One explicit operator action in either CLI or GUI persistently enables the
local proxy for future supported Claude launches. A dedicated machine-wide
proxy supervisor owns the listener, reconciles desired and actual state, and
exposes honest status. No code restarts or mutates an already-running Claude
process.

The operator's CLI command or GUI toggle is the opt-in required by
`docs/conventions/mission.md`. A fresh install remains disabled, installs no
LaunchAgent, and never routes traffic automatically.

## Non-goals

- Rewriting or compressing conversation bodies. The proxy stays transparent.
- Automatically quitting or restarting Claude.
- Merging the LLM proxy into the existing context daemon.
- Fixing per-workspace Saver Mode activation. That is specified separately in
  `2026-07-02-saver-activation-inheritance-design.md`.
- Taking ownership of a user-configured third-party proxy.
- Claiming hook liveness from configuration alone.

## Approaches considered

1. **Shared state + dedicated proxy supervisor (selected).** Reuses the
   existing `com.megasaver.proxy` lifecycle, survives GUI/terminal lifetimes,
   and keeps LLM routing separate from the tool-output context daemon.
2. Put proxy reconciliation in `@megasaver/daemon`. Rejected because that
   random-port authenticated service owns tool-output processing; coupling it
   to global Claude routing mixes independent failure and security domains.
3. Persist only `ANTHROPIC_BASE_URL`. Rejected because a dead proxy strands new
   Claude sessions on an unreachable endpoint.
4. Write shell profiles. Rejected because Claude Desktop need not inherit the
   shell, ownership is ambiguous, and cleanup can destroy unrelated state.

## Locked decisions

1. Desired state is disabled by default and changes only through an explicit
   CLI/GUI enable or disable action.
2. `mega proxy supervise` is the sole proxy runtime and reconciliation owner.
   The GUI and `mega proxy start|stop|status` are clients.
3. The existing `com.megasaver.context-daemon` service is unchanged.
4. A route is written only after a nonce-bound ownership health-check succeeds.
5. A foreign `ANTHROPIC_BASE_URL` blocks enable. MegaSaver never overwrites it.
6. Disable and failure cleanup remove the route only when its value exactly
   equals the owned MegaSaver URL.
7. An unrecoverable listener failure removes the owned route before the
   supervisor gives up and persists a visible degraded status.
8. Claude settings and hooks live only in
   `@megasaver/connector-claude-code`. Control code receives a route adapter and
   never imports agent-specific logic into Core.
9. Existing Claude processes are untouched. The operator restarts manually;
   only the next process can load the route and hook configuration.
10. Port 8787 is the stable default. Persistent mode forbids random ports.

## Architecture and dependencies

| Component | Responsibility | Dependencies |
| --- | --- | --- |
| `@megasaver/llm-proxy` | Transparent forwarding, reserved ownership health endpoint, usage events | Node HTTP only |
| new `@megasaver/proxy-control` | Strict state/discovery stores, supervisor state machine, authenticated control client, macOS LaunchAgent adapter | `llm-proxy`; route-adapter interface |
| `@megasaver/connector-claude-code` | Sole owner of Claude settings: inspect/apply/remove route, install/repair hooks, locking and atomic writes | connector settings helpers |
| CLI `proxy supervise` | Composition root that injects the Claude route adapter and usage writer | proxy-control + Claude connector |
| CLI `proxy start|stop|status` | Persistent control client; never starts a second listener | proxy-control client |
| GUI bridge | Same control client and status schema as CLI | proxy-control client |

The route adapter is narrow:

```ts
interface ProxyRouteAdapter {
  inspect(expectedUrl: string): "absent" | "exact" | "foreign" | "invalid";
  apply(expectedUrl: string): void;
  removeExpected(expectedUrl: string): void;
  ensureHooks(): { configured: boolean; error?: "settings_invalid" | "lock_unverifiable" | "write_failed" };
}
```

`@megasaver/proxy-control` knows no Claude paths or settings shape. The CLI
supervisor supplies the Claude implementation; a future agent connector can
supply another adapter without changing the control package. `ensureHooks`
returns a bounded reason enum, never free text; it is logged internally only and
never echoed to browser status (status conveys hook health solely through
`hooksConfigured`).

## Persistent and runtime state

`<storeRoot>/proxy/control.json` is the operator-owned desired state:

```ts
type ProxyControlErrorCode =
  | "route_conflict"
  | "settings_invalid"
  | "port_unavailable"
  | "healthcheck_failed"
  | "runtime_failed"
  | "disable_failed"
  | "drain_expired"
  | "lock_unverifiable"
  | "recovery_failed"
  | "transition_in_progress"
  | "legacy_service_present"
  | "shutdown_requires_client_restart"
  | "reconfigure_requires_client_restart"
  | "autostart_failed";

type ProxySafeErrorDetail =
  | "foreign_route_present"
  | "route_removed_externally"
  | "invalid_settings_shape"
  | "listener_unavailable"
  | "ownership_unverified"
  | "operation_incomplete";

type TransitionOwner = {
  id: string;
  ownerKind: "offline_cli" | "supervisor" | "recovery";
  ownerInstanceId: string;
  ownerProcessStartToken: string;
  ownerBootId: string;
  ownerFenceToken: string;
  // Stamped by an offline_cli owner immediately before it releases
  // transition.lock for the bootstrap handoff (null until then). Liveness of a
  // released transition is decided from THIS
  // durable field, never from the (released) filesystem lock: unexpired ⇒ only
  // the authenticated replacement supervisor may take over; expired ⇒ the
  // transition is stale and recoverable. Bounded at 60 seconds.
  handoffDeadline: string | null;
  startedAt: string;
};

type ProxyTransition =
  | (TransitionOwner & {
      kind: "enable";
      phase:
        | "intent_persisted"
        | "bootstrap_pending"
        | "listener_healthy"
        | "lease_installing"
        | "route_verified"
        | "rollback";
      expectedUnrouted: false;
    })
  | (TransitionOwner & {
      kind: "disable";
      phase: "unroute_expected" | "rollback";
      expectedUnrouted: true;
    })
  | (TransitionOwner & {
      kind: "drain_complete";
      phase: "confirmation_persisted";
      expectedUnrouted: true;
    });

type ProxyControlState = {
  version: 1;
  desiredEnabled: boolean;
  port: number;
  upstreamBaseUrl: string;
  routeLease: null | {
    url: string;
    instanceId: string;
    phase: "installing" | "active";
    installedAt: string;
  };
  drainingGeneration: null | {
    instanceId: string;
    processStartToken: string;
    bootId: string;
    url: string;
    startedAt: string;
  };
  reconcileBlocked: null | {
    reason: "route_removed" | "route_conflict";
    at: string;
  };
  transition: ProxyTransition | null;
  updatedAt: string;
  lastError: null | {
    code: ProxyControlErrorCode;
    detail: ProxySafeErrorDetail | null;
    at: string;
  };
};
```

`<storeRoot>/proxy/runtime.json` is supervisor discovery and diagnostics:

```ts
type ProxyRuntimeState = {
  version: 1;
  pid: number;
  processStartToken: string;
  bootId: string;
  instanceId: string;
  controlUrl: string;
  controlToken: string;
  healthCapability: string;
  proxyUrl: string;
  startedAt: string;
  lastReconciledAt: string;
  lastUsagePersistedAt: string | null;
};
```

Both schemas are strict and versioned. Missing control state means disabled;
invalid state fails disabled with a visible offline diagnostic. `lastError`
lives in control state so status remains useful when no supervisor/runtime file
exists. The proxy directory is mode
`0700`; state files are mode `0600`, use atomic write + file and directory
`fsync`, and reject symlinks. `upstreamBaseUrl` must be an HTTPS origin or an
explicit loopback HTTP origin, with no userinfo, path, query, or fragment.

Service file operations (legacy plist replacement, managed-plist removal) are
journal-free: MegaSaver never stops a process it did not start, every step is
an individually atomic filesystem operation (rename to a digest-verified backup,
atomic install), and recovery is by observation — a re-run inspects
`launchctl print`, plist presence, and template digests and converges
idempotently. Backup paths must be inside the proxy migration-backup directory
and every digest is verified before restore or idempotent success. See
LaunchAgent lifecycle.

Runtime JSON is discovery, not truth. `running`, `healthy`, and `routed` are
always re-observed from the process, nonce health endpoint, and route adapter.
The random control token protects the supervisor's loopback API.

Every owner-only lock stores
`{ownerKind,pid,processStartToken,bootId,instanceId,fenceToken,operation,acquiredAt,leaseExpiresAt}`.
PID liveness alone is never identity. A platform process adapter reads an OS
process start token and boot identifier; tests inject it. Liveness is
owner-specific:

- a `supervisor` owner is live only when authenticated discovery returns its
  instance id and the observed boot id, PID, and process-start token all match;
- an `offline_cli` transition owner, which necessarily predates discovery, is
  live while it still holds `transition.lock` with a same-boot PID/start-token
  match and an unexpired 30-second lock lease (refreshed at least every five
  seconds and after every durable phase), OR — after it has released the lock
  for the bootstrap handoff — while the durable transition's `handoffDeadline`
  is unexpired. A released transition's liveness is decided from the durable
  deadline alone, never from the released filesystem lock, so a stopped or
  suspended CLI cannot become an immortal owner;
- a `recovery` owner uses the same bounded same-boot PID/start-token rule and
  never depends recursively on authenticated discovery.

Prior boot, missing process, start-token mismatch, an expired bounded lease, or
an expired `handoffDeadline` on a released transition makes the corresponding
offline/recovery owner stale. Any failed supervisor
tuple or authenticated-discovery check makes a supervisor owner unverifiable;
route safety must be established before replacement. These are alternative
staleness predicates, not an `AND` condition, so PID reuse cannot create a
permanent veto.

Lock files are created with `wx` (exclusive create). The creating owner keeps
the descriptor open and refreshes `leaseExpiresAt` by rewriting the fixed-shape
record in place through that held descriptor plus `fsync`; lock files are never
renamed except by quarantine. The inode captured at creation is the identity
reference for every later path/inode validation. The atomic-rename mutation
rule in Security invariants applies to state files, not lock files.

Every owner re-opens and validates the lock path/inode, unexpired lease,
`fenceToken`, and matching transition id/`ownerFenceToken` immediately before
each state write, settings mutation, listener action, or `launchctl` call. An
expired or suspended former owner that later resumes must self-abort before
mutation.

Owner takeover is serialized by `transition.lock`, not by a read-modify-write
race on `control.json`: the durable transition owner (including its fence
token) may be rewritten only while holding `transition.lock`. `recovery.lock`
exists solely to quarantine and recreate an unverifiable
`transition.lock`/`supervisor.lock`; after quarantine the contender must
`wx`-create the fresh `transition.lock` and re-read control state before any
rewrite, so recovery contenders and the bootstrap handoff contend on one
exclusive lock. In the handoff, the CLI persists the transition with a fresh
`handoffDeadline` and releases the lock; the supervisor `wx`-acquires
`transition.lock`, validates the transition id and unexpired deadline, and
rewrites the owner to itself with a new fence token under that lock. No two
owners can act on one transition concurrently.

Any start/stop/recover client that acquires `transition.lock` and finds a
persisted transition that is still live — owner live by the rules above, or
`handoffDeadline` unexpired — returns `transition_in_progress` without mutating
it, with one delivery rule: when the live owner is the authenticated supervisor
itself, the request is delivered through its control API instead, which resumes
or clears its own retained transition under the same locks — so a blocked
rollback held by a live supervisor is still escapable by explicit start/stop.
During an unexpired handoff a stop is delayed (at most 60 seconds), never
reversed. A dead or expired transition may be adopted or cleared only through
the recovery rules (route safety first). The single transition slot can
therefore never be silently overwritten.

`recovery.lock` uses the bounded recovery identity above. A contender may
quarantine a stale lock only after re-reading all owner evidence: atomically
rename the lock to
`recovery.lock.stale.<random-id>`, verify the moved inode/content matches what
was inspected, then create a fresh `wx` lock. Concurrent contenders retry after
`ENOENT/EEXIST`. A lock proven live at inspection is never chosen for
quarantine; if post-rename verification shows the record changed between
inspection and rename (a live owner refreshed inside the race window), the
rename stands, the displaced owner self-aborts at its next fenced validation,
and the contender proceeds only after route safety. Because fenced validation
and the following syscall are not one atomic step, a displaced owner may land
at most one already-validated operation after takeover; value-guarded route
writes and read-back verification bound that residual — documented rather than
claimed away. Before quarantining a
stale transition owner that reached any route-affecting phase, recovery makes a
leased exact route safe and preserves absent, foreign, or unleased values. This
makes owner death recoverable without a second recovery lock.

Recovery never persists a distinct transition object: there is exactly one
transition slot, and route-safety-then-resume operates **in place** on the
retained `enable`/`disable` transition (clearing it, advancing it, or leaving it
blocked per the recovery matrix). The route-safe step is an action taken while
holding the locks, not a separate durable `kind`.

Two locks have distinct roles:

- `supervisor.lock` proves one long-lived supervisor. A second supervisor that
  authenticates the same owner exits 0. If ownership is unverifiable, it first
  acquires `recovery.lock`, makes any leased route safe, clears stale discovery
  and locks, then continues as the replacement. Failure to acquire/recover exits
  with nonzero code 75 so LaunchAgent retries; it never exits success while a
  leased route may point at a dead listener.
- `transition.lock` serializes desired-state, LaunchAgent, listener, lease, and
  route transitions across CLI, GUI, and supervisor. It uses the owner-specific
  identity rules above. A killed bootstrap owner becomes stale after process
  death or the bounded lease, and the durable transition—not the filesystem
  lock—drives route-safe continuation.

The bootstrap coordinator in `@megasaver/proxy-control` works before a
supervisor exists: acquire transition lock, preflight, persist intent plus a
transition id/phase, install/bootstrap the service, then release the filesystem
lock only for the handoff. The persisted transition remains the logical fence:
the replacement supervisor must authenticate and resume that exact id before
monitoring or another mutation can proceed. Once live, its control API
serializes requests and holds `transition.lock` for every remaining step. If
bootstrap fails, CLI/GUI status
falls back to strict control/runtime files, process/health probes, and route
inspection; it does not require a live API.

`mega proxy start --recover` is the explicit recovery path. It cannot be vetoed
by bare PID liveness: under `recovery.lock`, it rechecks authenticated discovery
and process-start identity, removes only a leased exact route before breaking
unverifiable locks, preserves foreign values, clears stale runtime state, and
starts a replacement. It is also the universal escape for any retained
transition whose owner is dead or expired — including blocked enable/disable
rollback states: after route safety it clears or resumes that transition per
the recovery matrix. A healthy authenticated owner is never force-broken. No
retained transition state is unrecoverable: every blocked matrix row is
escapable through explicit `proxy start --recover`, `proxy stop`, or a new
explicit enable.

`routeLease` is the durable ownership marker. URL equality alone is never
treated as ownership. Cleanup requires both a lease and an exact current value.
If another actor changes the route, MegaSaver preserves that value and clears
its stale lease after surfacing the conflict.

The `installing` phase closes the two-file crash window: after health succeeds,
the controller persists an installing lease **before** writing settings, then
marks it active only after read-back verification. Startup reconciliation may
clean up an exact value covered by an installing lease; absent/foreign values
are preserved and the incomplete lease is cleared with a visible diagnostic.
Recovery is deterministic: exact route + matching healthy instance promotes to
active; exact route + failed ownership health is removed and blocked; absent
route resumes apply only for the authenticated pending enable transition;
foreign route is preserved and blocks. Every branch clears or advances the
transition—no “may clean up” state remains.

`reconcileBlocked` preserves the operator's enabled intent without silently
recreating a route that disappeared or was replaced. Supervisor restart/status
does not clear it. Only a new explicit `proxy start`/GUI-on action clears the
block after fresh conflict and health checks; explicit stop clears it while
setting desired disabled.

## Ownership health contract

The proxy reserves a local health path that is never forwarded upstream. The
supervisor generates a separate >=256-bit `healthCapability`, stores it only in
mode-0600 runtime state/server memory, and sends a fresh random 256-bit challenge
for every probe. The listener returns
`{service,instanceId,challenge,proof=HMAC-SHA256(capability,instanceId||challenge)}`.
The capability itself is never sent or returned. The verifier requires exact
challenge, instance id, and constant-time proof match. A local user can query
the endpoint but cannot precompute/replay proof for the verifier's fresh
challenge after listener failure. A generic/stale listener is never adopted.

Legacy exact-URL adoption requires an explicit `proxy start` or GUI toggle, no
existing lease, and a successful ownership health-check. Only then may the
controller create a lease. Supervisor boot alone never adopts a route merely
because its string matches.

## Reconciliation state machine

### Enable

1. Acquire `transition.lock`; a persisted live transition returns
   `transition_in_progress`, and a dead/expired one goes through recovery
   first. Create an enable transition id at
   `intent_persisted`, and parse Claude settings under the shared connector
   lock to preflight the
   value plus route lease. `foreign` or `invalid` clears the transition and
   fails without external mutation; `exact` without a lease is eligible only
   because this is an explicit enable.
2. Persist `desiredEnabled=true`; this is the operator's durable opt-in. Advance
   to `bootstrap_pending` before any LaunchAgent handoff.
3. Install or upgrade the proxy LaunchAgent; then stamp a 60-second
   `handoffDeadline` on the persisted transition, release the transition lock,
   and wait for authenticated supervisor discovery. The deadline is stamped
   after the (possibly slow) install so installation time never consumes the
   handoff window.
4. The supervisor reacquires the transition lock and binds exactly one listener
   on the configured loopback port.
5. Verify nonce ownership through the reserved local health endpoint and
   advance to `listener_healthy`.
6. Persist an `installing` route lease bound to the healthy instance nonce and
   advance to `lease_installing`.
7. Atomically apply the Claude route through the connector adapter.
8. Read back and verify the exact route value.
9. Promote the route lease to `active`, advance to `route_verified`, and clear
   the completed transition.
10. Install/repair MegaSaver hooks idempotently under the same settings lock.
11. Release `transition.lock` and report ready only when desired, listener,
    health, active lease, and route
    agree.

After a supervisor exists, failure rollback may remove only a route covered by
this attempt's installing lease or a prior active lease; a pre-existing exact
URL without a lease is never removed. Once a listener has become healthy,
rollback conservatively assumes that a route may have been observed by a newly
launched client: after making the route value safe it records that healthy
generation as a drain and never stops it without explicit client-restart
confirmation. Only a listener whose ownership health failed or that already
closed is treated as the unavoidable forced residual. Rollback persists the
enumerated error and returns failure. Desired state stays enabled so status
reflects the operator's request.

A bootstrap/install operation that fails **synchronously** — the install or
LaunchAgent bootstrap call returns an error and is observed while the CLI still
holds `transition.lock`, before Enable step 3 stamps `handoffDeadline` and
releases the lock — restores the prior service, clears incomplete leases, sets
`desiredEnabled=false`, and persists `autostart_failed`. Because the durable
opt-in and the handoff have not yet been published, giving up here strands
nothing.

This is distinct from the post-handoff case: once step 3 has stamped
`handoffDeadline` and released the lock, an expired deadline with no
authenticated supervisor is governed **solely** by recovery-matrix row
`enable / intent (desired true) or bootstrap pending` — the transition is
retained, `desiredEnabled` stays true, and it is escapable via `proxy start
--recover`, `stop`, or a new enable. Post-handoff timeout never auto-sets
`desiredEnabled=false`; only a synchronous pre-handoff failure does.

### Supervisor startup and runtime

`proxy supervise` starts an authenticated random-port control server, publishes
`runtime.json`, then reconciles before it reports ready:

- disabled with no drain: remove a route only when a valid lease and exact
  value agree, ensure no owned listener, exit 0;
- stored drain from another boot, missing process-start identity, or failed
  same-instance nonce health: mark `drain_expired`, clear it, and **do not
  rebind**; after reboot/crash no old listener survives to protect;
- disabled with a verifiably live same-instance drain: keep that existing
  listener without writing a route and remain alive;
- enabled with `reconcileBlocked`: keep only a verifiably live same-instance
  drain, never write a route, and wait for explicit start/stop;
- enabled with an active/installing lease but an absent/foreign route and no
  authenticated resumable enable transition: classify route drift before the
  general enable path, preserve foreign state, clear the stale lease, persist
  `reconcileBlocked`, and drain only a verifiably healthy existing generation;
  never apply a route;
- enabled without a block: preflight conflicts, start, nonce-health-check,
  apply and verify;
- foreign route: do not overwrite or adopt, persist `route_conflict`, remain
  alive for status/control;
- listener cannot become healthy: remove only a leased exact route, persist
  the error, remain degraded for diagnosis.

If a routed listener fails while the supervisor remains alive, remove the owned
route before closing the failed listener and record `runtime_failed`. A hard
`SIGKILL` creates an unavoidable short stale-route window; the LaunchAgent must
restart the supervisor with nonzero-retry semantics. Replacement recovery makes
the leased route safe before clearing the unverifiable lock. This residual
window is documented rather than claimed away.

Reconciliation triggers are fixed: supervisor startup, authenticated
start/stop/reconfigure requests, listener `error`/unexpected `close`, and a
five-second ownership monitor. The monitor checks nonce health and route drift
and never silently restarts. While a persisted transition is live (owner live
or handoff deadline unexpired) the monitor is suspended. While a dead-owner
transition is retained awaiting explicit recovery, the monitor runs
observe-only: it refreshes status and diagnostics but performs no lease-clear,
block, or drain write — drift seen in that mode is recorded as diagnostic only,
and its resolution flows through the recovery rules for that retained
transition. Missing/foreign route when no transition is persisted
clears any stale lease,
preserves a foreign value, retains `desiredEnabled=true`, persists the matching
`reconcileBlocked` reason, and transitions the still-healthy owned listener into
`drainingGeneration` for old clients in one atomic control-state write. If the
process dies after observing drift but before that write, startup reconstructs
the same blocked result from lease + route evidence before any general enable
action. Failed health or an unexpected listener
close is an unavoidable runtime failure and records a visible degraded state.
Route-drift repair requires explicit `proxy start`; supervisor/LaunchAgent
restart alone respects the block. During a disable/shutdown transaction,
`expectedUnrouted=true` classifies the same absent route as intended progress,
not drift.

SIGINT/SIGTERM is not an operator disable action: it does not unroute or mutate
desired/blocked/transition state. The supervisor refuses voluntary exit while
an active/draining listener lacks explicit client-restart confirmation, records
`shutdown_requires_client_restart`, and keeps serving. It exits normally only
with no listener or after confirmed drain completion. OS/process forced
termination, failed health, and unexpected close remain the documented
residuals that cannot honor drain.

### Disable

Disable ordering is safety-critical:

1. Acquire `transition.lock`; a persisted live transition returns
   `transition_in_progress`, and a dead/expired one goes through recovery
   first. Persist one disable transition with
   `desiredEnabled=false`, `phase=unroute_expected`, and
   `expectedUnrouted=true` **before** changing Claude settings.
2. Under the connector lock, remove the route only if `routeLease` exists and
   the current value exactly matches the leased URL; read back and verify.
3. If removal/verification fails, keep the listener alive, retain the disable
   transition in `rollback`, record `disable_failed`, and never re-route on
   startup. Recovery resumes safe unroute or requires explicit intervention.
4. If the route is absent, or a foreign value replaced it, preserve foreign
   state and continue; an exact value without a lease is a conflict and cannot
   be removed or followed by listener shutdown. An `invalid` inspection is
   unknown ownership state: record `settings_invalid`, retain lease/transition,
   and keep the listener alive.
5. Immediately before any listener stop or drain decision, re-read the route
   under the connector and transition locks. An exact unleased MegaSaver URL
   that appeared after lease removal blocks shutdown and keeps the listener
   alive; absent/foreign remains safe and foreign is preserved.
6. After verified safety, clear the lease. If a live authenticated generation
   exists, record its instance/start-token/boot-id as `drainingGeneration`,
   clear the completed transition, and release the lock. If the listener is
   already dead, verify the route is still absent/foreign, clear lease and
   transition, and return disabled success without creating a drain or rebinding.
7. Keep the draining listener transparently forwarding for already-running
   Claude processes, which retain the old base URL in memory.
8. Stop the listener and let the supervisor exit successfully only after the
   operator explicitly confirms those clients were closed/restarted.

If a foreign value replaced the owned route, leave it untouched; because it no
longer targets MegaSaver, disabling may transition the owned listener to drain
after reporting the ownership change.

There is no reliable process-independent way to prove that every old client has
discarded the URL. Therefore the spec does not claim that unroute alone prevents
stranding. `mega proxy stop` and the GUI off toggle disable future routing and
enter drain. `mega proxy stop --confirm-clients-restarted` (or the matching GUI
confirmation) completes listener shutdown. A later start with the same
configuration first authenticates live discovery and may reactivate that same
draining generation without rebinding. It never signals a live drain.

### Transition recovery matrix

Startup/recovery handles every non-null transition before normal reconcile:

| Kind / phase | Observed state | Mandatory follow-on |
| --- | --- | --- |
| enable / intent persisted, `desiredEnabled` still false | dead owner | clear the transition — the durable opt-in was never persisted, so there is nothing to resume and disabled intent is preserved |
| enable / intent (desired true) or bootstrap pending | no authenticated supervisor | resume bootstrap under recovered transition identity; no route **lease** exists yet — a pre-existing exact unleased route may exist and is preserved until the explicit-enable adoption check |
| enable / listener healthy | matching nonce health, no lease | persist installing lease and continue; failed health records blocked failure and stops only owned listener |
| enable / lease installing | exact route + matching health | verify and promote active |
| enable / lease installing | exact route + failed health | remove leased exact route, clear lease, block, never report ready |
| enable / lease installing | absent route + matching health | apply, verify, promote; absent without matching health blocks |
| enable / lease installing | foreign route | preserve foreign value, clear lease, block |
| enable / route verified | exact route + matching health | clear completed transition and report ready; every mismatch follows leased rollback |
| enable / rollback | healthy owned listener + installing/active leased exact route | value-guard remove and verify, record that generation as drain, clear transition, retain enabled degraded intent; never stop without confirmation |
| enable / rollback | healthy owned listener + absent or foreign route | preserve external state, clear only this attempt's lease, record that generation as drain, clear transition, retain enabled degraded intent |
| enable / rollback | healthy owned listener + exact unleased or invalid route state | preserve settings/listener and ownership evidence, retain transition, and block for explicit recovery |
| enable / rollback | ownership health failed or listener already closed | value-guard remove only a leased exact route, preserve every other route state, clear this attempt's lease/transition, and report the forced residual |
| disable / unroute expected | lease + exact route | resume value-guarded removal and verification; never apply a route |
| disable / unroute expected | absent or foreign route + matching live generation | preserve foreign value, re-inspect route, clear lease, enter drain; never apply a route |
| disable / unroute expected | absent or foreign route + no live generation | re-inspect route, preserve foreign value, clear lease/transition, return disabled success with no drain/rebind |
| disable / unroute expected | exact unleased or invalid route state | preserve settings, lease/transition, and listener; record conflict/settings error and require explicit recovery |
| disable / rollback | route still owned | keep listener alive and retry safe unroute only through explicit stop/recover |
| disable / rollback | route now absent or foreign | preserve foreign state and continue through the live/no-generation disable rows; exact unleased remains blocked |
| disable / rollback | exact unleased or invalid route state | preserve settings and listener, retain rollback, and report the enumerated conflict/settings error |
| drain complete / confirmation persisted | explicit confirmation + matching live generation | re-inspect route; exact unleased or invalid blocks and preserves listener, otherwise stop that generation and clear drain/transition |
| drain complete / confirmation persisted | generation already dead or prior boot | verify route remains absent/foreign, clear drain+transition, never rebind, return idempotent success |

Every row advances or clears the transition atomically under `transition.lock`.
No recovery branch converts disabled intent into enable, applies a route during
disable, removes an unleased/foreign value, or reports success before observed
health and route verification. The strict discriminated-union schema rejects
every kind/phase/`expectedUnrouted` combination not enumerated above; tests
exercise every legal combination and rejection of the former cross-product.

## Claude settings ownership and concurrency

The GUI-only proxy settings writer moves into
`@megasaver/connector-claude-code`. All MegaSaver settings mutators—including
hook install/uninstall and proxy routing—share one cross-process lock. Atomic
rename alone is insufficient because two writers can otherwise lose each
other's updates.

The settings lock reuses the same PID + process-start-token + instance identity
helper and explicit recovery semantics as proxy locks; PID reuse cannot freeze
global Claude settings. Recovery never follows symlinks or replaces an
unverifiable settings file.

The mutator preserves unrelated keys and env entries, file mode, and performs
file/directory `fsync`. It refuses symlinked settings or lock paths.

- absent route: enable may write;
- exact URL plus a valid lease and matching live ownership: enable is idempotent;
- exact URL without a lease: never cleaned up; adoption requires an explicit
  enable plus matching nonce health;
- any other non-empty value: enable returns `route_conflict`;
- malformed root/env/base-url shape: fail closed, file untouched;
- disable/rollback: remove only the exact expected owned URL;
- foreign value appearing while enabled: surface conflict, never overwrite.

## LaunchAgent lifecycle and rollback

On macOS, reuse label `com.megasaver.proxy` and change its target from legacy
`mega proxy start` to internal
`mega proxy supervise --store <absolute-store-path>`.

The managed plist uses `RunAtLoad=true` and
`KeepAlive.SuccessfulExit=false`: crashes restart, while an intentional disabled
exit does not loop. Enable installs/loads it only after explicit opt-in. After
a confirmed drain completion the managed job may remain loaded but dormant. A
later start checks authenticated discovery **before** launchctl. A live ready or
draining supervisor receives the API request directly. Only when discovery and
strong process identity prove there is no live supervisor does it use plain
`kickstart` (never `kickstart -k`) for a known loaded dormant job; `bootstrap`
is only for an unloaded label. An unverifiable loaded job enters the explicit
recovery path instead of being killed.

Installer rules:

- same label with unknown owner or argv: refuse overwrite;
- **MegaSaver never stops a process it did not start.** A loaded
  `com.megasaver.proxy` job with the known legacy `proxy start` argv fails
  enable with `legacy_service_present`, and the CLI/GUI print the exact manual
  step (`launchctl bootout gui/$UID/com.megasaver.proxy`). Enable is simply
  retried after the operator has booted the job out. Because the legacy
  listener is only ever stopped by the operator, no client-closure confirmation
  flag, migration journal, or kill-window reasoning exists;
- unloaded label with a digest-matching known legacy plist file: move it
  atomically to `<storeRoot>/proxy/migration-backups/`, then atomically install
  the managed supervisor plist. A crash between the two renames converges on
  re-run by observation: legacy file gone + backup present + managed plist
  absent ⇒ install; digest mismatch or an unexpected extra file ⇒ refuse
  without mutation;
- a pre-existing exact unleased route is never touched by installation; it is
  handled solely by the explicit-enable adoption rules (ownership health-check
  first);
- bootstrap failure: boot out the failed managed job, restore the
  digest-verified backup plist file without loading it, clear desired
  state/incomplete lease, persist the error, and do not create a new route;
- every `launchctl` failure is returned and persisted;
- fresh install does not create or load the service before opt-in.

`mega proxy service uninstall --confirm` is the only plist-removal path. It is
allowed only when desired is disabled and no lease/listener/drain/live
transition exists, and label/argv match the managed template. It is stateless
and idempotent by observation: loaded managed job ⇒ boot out; unloaded +
digest-matching managed plist ⇒ move it to the migration-backup directory
(never delete); unloaded + missing plist + digest-matching backup ⇒ idempotent
success; any foreign or digest-mismatched file blocks without mutation. Death
after bootout or after the move converges on retry. Ordinary disable leaves a
managed dormant service.

`com.megasaver.context-daemon` is not edited. Non-macOS desired state can be
reconciled when the supervisor is explicitly started, but cross-reboot
autostart is reported `unsupported`; this spec makes no false platform claim.

## CLI and GUI contract

CLI surface:

- `mega proxy start` — persist enable, ensure supervisor, wait for ready/error;
- `mega proxy start --recover` — route-safe recovery from unverifiable stale
  supervisor/transition ownership or any retained dead-owner transition;
- `mega proxy stop` — unroute future clients and enter drain;
- `mega proxy stop --confirm-clients-restarted` — complete a drain and stop;
- `mega proxy status [--json]` — observed state and evidence;
- `mega proxy service uninstall --confirm` — remove only a dormant managed
  LaunchAgent with rollback backup;
- `mega proxy supervise` — internal foreground LaunchAgent target.

Changing current foreground `start` is a public behavior break and requires a
changeset. The GUI checkbox binds to desired state, not merely `running`. Both
surfaces call the same authenticated supervisor control API.

Existing `start --port` and `start --upstream` remain supported. On first
enable, omitted values use current defaults. On later enable, omitted values
preserve persisted configuration. Explicit changes while ready or draining
return `reconfigure_requires_client_restart`; the operator must unroute, close
or restart old clients, confirm drain completion, then start with the new
values. Invalid ports or upstream origins fail before mutation.

The default upstream is pinned to `https://api.anthropic.com`. A different HTTPS
origin requires both `--upstream` and `--confirm-credential-forwarding`; GUI does
not offer custom upstream in this slice. Userinfo, path, query, and fragment are
rejected. HTTPS origins and explicit loopback HTTP origins are allowed; other
plaintext origins are rejected. Status permanently marks a custom origin.
Upstream redirects are not followed across origins with auth headers.

Status exposes independent facts:

```ts
type ProxyActivationStatus = {
  enabled: boolean;
  running: boolean;
  healthy: boolean;
  routed: boolean;
  draining: boolean;
  routeConflict: boolean;
  reconcileBlocked: boolean;
  hooksConfigured: boolean;
  lastProxyUsageAt: string | null;
  lastProxyUsageAgeMs: number | null;
  lastSaverHookInvocationAt: string | null;
  lastSaverHookInvocationAgeMs: number | null;
  lastCompressionAt: string | null;
  lastCompressionAgeMs: number | null;
  routeCapability: "settings-configured";
  desktopSupport: "unverified";
  customUpstream: boolean;
  autostart: "running" | "dormant" | "missing" | "unsupported" | "error";
  error: null | {
    code: ProxyControlErrorCode;
    detail: ProxySafeErrorDetail | null;
    at: string;
  };
};
```

“Ready” means enabled + running + healthy + routed. Generic traffic is evidenced
only by a later usage event; a settings route alone is not proof. Usage events
have no client identity, so they cannot establish Claude Desktop support.
Desktop remains `unverified` until a separate controlled, client-specific
capability protocol exists. Hook configuration, invocation, and actual
compression remain separate signals.

Saver activation inheritance is implementation **1 of 2** and ships first.
Persistent routing is implementation **2 of 2** and consumes the saver artifact
only through an optional telemetry reader.

The single saver-produced artifact this depends on is
`stats/saver-hook-heartbeats.json`, whose authoritative strict schema is owned
by the saver spec (§Shared component and storage):
`{version:1, latest:{ts,workspaceKey}|null, latestCompression:{ts,workspaceKey}|null, workspaces:Record<WorkspaceKey,ts>}`.
The pinned contract:
`lastSaverHookInvocationAt` = the registry's `latest.ts` (or `null` when
`latest===null`); `lastCompressionAt` = the registry's `latestCompression.ts`
(or `null`). Proxy status is global and takes no workspace/session input;
per-workspace scoping of either field is saver-status-only. A missing,
unreadable, or version-mismatched registry degrades **all four** proxy saver
fields (`lastSaverHookInvocationAt/AgeMs`, `lastCompressionAt/AgeMs`) to `null`
without turning proxy readiness red — which is exactly the state before the
saver slice ships. `*AgeMs` is `now − ts` when the timestamp is present, else
`null`.

The telemetry reader lives in the CLI/`@megasaver/stats` status-assembly layer,
NOT in `@megasaver/proxy-control`: proxy-control stays agent-agnostic and
saver-agnostic, consistent with the agent-agnostic-core rule.

The GUI removes its process-local proxy singleton, startup/shutdown route
clearing, duplicated settings writer, and `osascript` restart route/button. It
tells the operator to restart Claude manually when convenient.

The React client never receives `controlToken` or reads supervisor files. Both
the GUI frontend server and bridge bind literal `127.0.0.1` (not wildcard or
`localhost`). CORS/Origin checks are defense-in-depth, not authentication.

The bridge generates a >=256-bit per-launch capability in a mode-0600 file. The
trusted frontend server reads it and authenticates its server-to-bridge proxy
requests; the browser never sees this bridge capability. Browser-to-frontend
mutation requests require a separate one-time launch capability that is
exchanged for an HttpOnly, SameSite=Strict per-launch session cookie and then
discarded/redirected from the URL. Host and exact Origin are validated, CSRF
tokens bind state-changing requests to that session, and dev mode disables
proxy mutation unless this authenticated bootstrap is configured. A random
local webpage/process cannot obtain mutation authority merely by setting an
Origin header.

Missing or foreign `Origin`, wrong `Host`, missing/expired session or bridge
capability, missing/invalid CSRF token, oversized body, and unknown fields are
all hard rejections before a control request is constructed. Status reads
require the same authenticated session as mutations; the enumerated-field
limitation of status is defense-in-depth, not a substitute for authentication.
Integration tests
pin each rejection against both frontend and bridge boundaries.

Proxy routes accept strict Zod bodies with unknown keys rejected and map only
fixed operations to the control client. No shell command is built from a
browser value.

## Security invariants

- Control and proxy servers bind literal `127.0.0.1`; no host override exists.
- Control, health, GUI-bridge, GUI-session, and one-time GUI-launch
  capabilities are independent,
  have at least 256 random bits, and are compared in constant time. Control and
  health capabilities
  stay only in the mode-0600 runtime file/server memory, and are never returned
  to browser status or logs. The one-time launch capability is single-use,
  expires 120 seconds after issuance if unexchanged, is removed from the URL at
  exchange, and is never logged.
- Control routes use fixed method/path allowlists, strict body schemas, a small
  request-size limit, and transition ids for idempotency.
- LaunchAgent plists are generated through a structured serializer with a fixed
  label and argv array. Executable/store paths must be absolute; no shell,
  interpolation, or user-controlled environment keys are used.
- Proxy logs and persisted errors never contain auth headers, request/response
  bodies, upstream URLs with credentials, prompts, or keys.
- Status and persisted failures expose only enumerated error codes and bounded
  safe-detail enums. They never echo a foreign route, filesystem path, malformed
  settings fragment, capability, upstream URL, or thrown error text.
- Forwarding never follows an upstream redirect to a different origin with
  credentials attached.
- Settings/plist/state mutation uses lstat-open-fstat identity checks,
  owner-only parents where supported, symlink refusal at the leaf, atomic
  rename, mode preservation, and file/directory fsync to reduce TOCTOU windows.
  Lock files are the exception: they are `wx`-created, refreshed in place
  through the held descriptor, and never renamed except by quarantine.
- Residual (shared machines): after forced supervisor death, the freed fixed
  port is bindable by any local user while already-running clients still hold
  the base URL in memory — local port-hijack credential interception of those
  in-memory-routed clients is possible until the LaunchAgent restart reclaims
  the port or the clients restart. Documented, not claimed away; single-user
  machines are the supported profile.
- `proxy-usage/` is mode `0700`; usage and rotation files are mode `0600` and
  opened with lstat-open-fstat identity checks plus no-follow semantics where
  available. The strict event schema rejects unknown fields and control
  characters. A raw model identifier is persisted only for a successful response
  from the exact default Anthropic origin and only when it matches
  `[A-Za-z0-9][A-Za-z0-9._-]{0,127}`; otherwise the categorical value is
  `custom` or `unknown`. Custom-upstream model strings are never persisted or
  hashed. Events contain counts/timestamps/model category only—never bodies,
  headers, URLs, or credentials. Rotation is bounded to four files and 256 MiB
  total, 64 MiB per file, and 90 days; the oldest rotation is pruned under the
  same writer lock before an append can exceed either bound.

## Failure handling

- Loaded legacy MegaSaver service at enable: `legacy_service_present`, no
  mutation, manual bootout instruction shown.
- Live transition found by another command: `transition_in_progress`, no
  mutation.
- Owner evidence that cannot be verified during recovery preflight:
  `lock_unverifiable`, no mutation until explicit `--recover`.
- Recovery made the route safe but could not start a replacement:
  `recovery_failed`, retained for explicit retry.
- Non-MegaSaver listener on the port: `port_unavailable`, no route write.
- Health marker/nonce mismatch: `healthcheck_failed`, no adoption or route write.
- Foreign route: `route_conflict`, no overwrite and no cleanup.
- Corrupt or symlinked Claude settings: `settings_invalid`, file untouched.
- Hook repair failure after route success: proxy stays ready but status shows
  `hooksConfigured=false`; no false all-green state.
- Usage append failure: forwarding continues, runtime shows a measurement
  warning, and no request/response/auth content is logged.
- Safe unroute failure: listener stays alive and status reports
  `disable_failed`; forced termination remains outside this guarantee.
- Successful unroute does not stop a listener still needed by already-running
  clients; status remains visibly `draining` until explicit confirmation.

Each error that surfaces to status carries a bounded `detail` (the
`ProxySafeErrorDetail` enum), never free text: `route_conflict` →
`foreign_route_present`; drift-observed external removal → `route_removed_externally`
(carried on the `reconcileBlocked` status, not as a code); `settings_invalid` →
`invalid_settings_shape`; `healthcheck_failed`/`runtime_failed` →
`listener_unavailable`; `lock_unverifiable` → `ownership_unverified`;
`disable_failed`/`recovery_failed` → `operation_incomplete`. A Stores-layer test
asserts each producing path emits its mapped detail; no path emits a null detail
where the table names one.

## Testing strategy (TDD)

| Layer | Required evidence |
| --- | --- |
| Stores | strict schemas and every error literal (including shutdown); missing/invalid disabled; blocked-state persistence; mode/permissions; atomic+fsync; symlink refusal |
| Route adapter | absent/exact/foreign/invalid matrix; lease+value cleanup guard; foreign never overwritten; unrelated settings preserved |
| Locking | PID reuse/start-token mismatch; authenticated supervisor owner; live offline-CLI contention; offline owner death/lease expiry; handoff-deadline expiry of a stopped/suspended CLI; `transition_in_progress` on a live transition; wx-create + in-place lease refresh preserves lock inode identity; expired suspended owner resumes after fenced takeover and self-aborts; stale supervisor/transition recovery; competing recovery exits 75; explicit `--recover` clears every retained dead-owner state; concurrent hook/route writers preserve updates |
| Health | nonce match required; unrelated and stale MegaSaver listeners rejected; health path never forwarded |
| Supervisor | every installing-lease recovery branch; offline bootstrap; concurrent start/stop; fixed reconcile triggers; SIGTERM leaves state/route untouched; runtime failure unroutes; exact→client launch→absent/readback-failure rollback keeps the healthy listener draining; SIGKILL between drift observation/block write reconstructs block without reroute; no silent retry loop |
| Disable | crash after every phase resumes disable without reroute; dead-listener offline stop succeeds without drain/rebind; expected-unrouted monitor guard; exact-unleased route inserted before drain/confirmed stop blocks shutdown; old client still forwards; confirmation completes stop; failure keeps listener |
| Drain | same-instance drain survives; dead instance/reboot expires without rebind; foreign-held port preserved; active drain is never kickstarted/killed |
| LaunchAgent | fresh install no service; discovery before kickstart; dormant plain kickstart; loaded legacy job ⇒ `legacy_service_present` with no mutation; unloaded legacy plist replacement crash-cut converges by observation; digest rollback; foreign plist untouched; uninstall idempotency by observation |
| CLI/GUI | same control state/API; GUI owns no listener; status fields/errors match |
| Security | control auth/body/origin limits; token never reaches browser/log; unexchanged launch capability expires at 120 s and is single-use; custom-upstream confirmation; cross-origin redirect strips/refuses auth; plist argv/path injection rejected; lstat-open-fstat race fixtures |
| Telemetry | configured, invocation, compression, and proxy usage timestamps stay distinct; missing saver artifacts degrade to null; usage permissions, symlink races, schema/model sanitation, rotation, and retention are pinned |
| Integration | fake upstream traffic records counts only after health+route; stop removes only owned route |

No test may modify real Claude settings, LaunchAgents, launchd environment, or
network upstream. Use injected paths/process runners and temporary stores.

## Risk and governance

Risk is **CRITICAL**. The change writes global Claude configuration, controls a
reboot-persistent process, carries API credentials and complete request/response
traffic, and changes public CLI behavior. The earlier LLM-proxy spec already
classified this path CRITICAL; HIGH is retained as the minimum connector/CLI
classification, not used to lower the existing risk.

Manual design confirmation is a process gate distinct from runtime opt-in. It
is recorded in this spec's frontmatter from the user's 2026-07-02 chat choices
and the 2026-07-02 agent-channel review. Runtime enable remains a separate local
CLI/GUI action.

Completed design gates: isolated worktree; architect and adversarial critic
passes; security-reviewer and tracer evidence-loop re-run against the round-2
amended text with archived artifacts under `docs/superpowers/reviews/`
(both APPROVE_WITH_NOTES; every note incorporated — see artifact addenda). A
bare APPROVE assertion is not evidence; artifacts are the standing requirement
for every future pass. Because the round-2 amendments were authored by the
round-1/2 reviewer, a counter-review of the amended text by a fresh context
(Codex) is required before the plan is written.
Implementation
still requires TDD; `pnpm verify`; fake-upstream and real-client smoke evidence;
separate code-reviewer, implementation-critic, and implementation-security
passes; runtime tracer evidence for every persisted transition/crash cut;
verifier pass; and changesets for every affected public package. No
implementation may use an unsupervised loop.

The two specs share this design branch only. Implementation uses separate
branches/worktrees in fixed order: Saver inheritance first (HIGH), persistent
routing second (CRITICAL). Until split, the CRITICAL gate set governs every
change on this branch.

The proxy remains transparent and persists token counts/metadata only. It never
persists prompts, responses, auth headers, or keys.

## Acceptance criteria

- CLI and GUI enable the same desired state and survive their own exit.
- No route is written until a nonce-bound MegaSaver health-check succeeds.
- Proxy/listener failure causes value-guarded unroute and a visible error.
- SIGKILL plus PID reuse cannot permanently veto a replacement or leave a
  leased dead route without route-safe recovery.
- A crash at any disable phase resumes disable and never re-routes.
- A healthy listener that may have been exposed during failed enable rolls back
  into drain and keeps forwarding until explicit client-restart confirmation.
- Disable enters drain after verified unroute and cannot stop the listener
  before explicit client-restart confirmation.
- URL equality without a route lease never authorizes cleanup.
- A foreign `ANTHROPIC_BASE_URL` or LaunchAgent is never overwritten/removed.
- Fresh install remains unrouted and installs no supervisor.
- A loaded legacy service is never stopped by MegaSaver; enable fails with the
  manual instruction instead.
- No retained transition state lacks an explicit recovery escape.
- Ordinary SIGINT/SIGTERM never becomes route drift or kills a live drain;
  reboot/dead-instance drains expire without rebind.
- Status separates config, route, health, traffic, hook invocation, and
  compression evidence.
- After the operator restarts a **supported Claude Code client**, a controlled
  real request
  updates `proxy-usage/usage.jsonl`.
- Claude Desktop remains explicitly unverified; generic usage telemetry never
  attributes support to it.
