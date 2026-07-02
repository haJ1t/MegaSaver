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
  - security-reviewer
  - tracer-evidence-loop
required_implementation_reviews:
  - code-reviewer
  - critic-implementation
  - security-reviewer-implementation
  - tracer-runtime-evidence
  - verifier
manual_confirmation:
  date: 2026-07-02
  evidence: >
    User explicitly selected persistent CLI+GUI routing, manual next-launch
    restart, and the six safety amendments in chat; mirrored in
    wiki/agent-channel.md entries dated 2026-07-02.
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
  ensureHooks(): { configured: boolean; error?: string };
}
```

`@megasaver/proxy-control` knows no Claude paths or settings shape. The CLI
supervisor supplies the Claude implementation; a future agent connector can
supply another adapter without changing the control package.

## Persistent and runtime state

`<storeRoot>/proxy/control.json` is the operator-owned desired state:

```ts
type ProxyControlErrorCode =
  | "route_conflict"
  | "route_removed"
  | "settings_invalid"
  | "port_unavailable"
  | "healthcheck_failed"
  | "runtime_failed"
  | "disable_failed"
  | "drain_expired"
  | "lock_unverifiable"
  | "recovery_failed"
  | "transition_incomplete"
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
  ownerInstanceId: string;
  ownerProcessStartToken: string;
  ownerBootId: string;
  ownerFenceToken: string;
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
      kind: "recover";
      phase: "route_safety" | "owner_replacement";
      expectedUnrouted: true;
    })
  | (TransitionOwner & {
      kind: "drain_complete";
      phase: "confirmation_persisted";
      expectedUnrouted: true;
    })
  | (TransitionOwner & {
      kind: "migrate_service";
      phase:
        | "migration_prepared"
        | "migration_legacy_stopped"
        | "migration_plist_installed"
        | "migration_supervisor_started";
      expectedUnrouted: true;
    })
  | (TransitionOwner & {
      kind: "uninstall_service";
      phase:
        | "intent_persisted"
        | "uninstall_job_stopped"
        | "uninstall_plist_moved";
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

type ProxyServiceMigrationState = {
  version: 1;
  transitionId: string;
  phase:
    | "prepared"
    | "legacy_stopped"
    | "plist_installed"
    | "supervisor_started";
  backupPath: string;
  legacyPlistDigest: string;
  legacyPid: number;
  legacyProcessStartToken: string;
  legacyBootId: string;
  adoptedExactRoute: boolean;
  clientClosureConfirmation: null | {
    source: "cli" | "gui";
    confirmedAt: string;
  };
  startedAt: string;
};

type ProxyServiceUninstallState = {
  version: 1;
  transitionId: string;
  phase: "intent_persisted" | "job_stopped" | "plist_moved";
  managedPlistDigest: string;
  backupPath: string;
  startedAt: string;
};
```

Both schemas are strict and versioned. Missing control state means disabled;
invalid state fails disabled with a visible offline diagnostic. `lastError`
lives in control state so status remains useful when no supervisor/runtime file
exists. The proxy directory is mode
`0700`; state files are mode `0600`, use atomic write + file and directory
`fsync`, and reject symlinks. `upstreamBaseUrl` must be an HTTPS origin or an
explicit loopback HTTP origin, with no userinfo, path, query, or fragment.

`service-migration.json` and `service-uninstall.json` exist only during their
LaunchAgent transactions and follow the same strict, owner-only, atomic
durability rules. Backup paths must be inside the proxy migration-backup
directory and every digest is verified before restore or idempotent success.
The migration journal durably records whether the operator supplied the narrow
client-closure confirmation; a recovered migration never infers or recreates
that authority.

Service transactions persist the fsynced journal **before** the matching
`control.transition`, linked by one transition id, and perform no settings or
`launchctl` mutation between those two writes. An orphan prepared/intent journal
with no control transition therefore has not changed external runtime state; a
matching later explicit request may adopt it after digest/identity verification,
or recovery may clear only that orphan journal. A transition with a missing or
mismatched journal fails closed with `transition_incomplete` and performs no
settings, plist, listener, or launchd mutation.

The journal is the sole authoritative fine-grained service phase; the matching
control phase is a status index. Every phase advance writes/fsyncs the journal
first and then the control index. On recovery, equal phases continue normally;
a control index exactly one phase behind is advanced only after the journal's
required job/plist/digest/route/health observation succeeds. A control phase
ahead, non-adjacent mismatch, or transition-id mismatch fails closed. The rows
below named `migrate service` and `uninstall service` refer to the authoritative
journal phase. At successful completion, recovery verifies the terminal
observation, clears the control transition first, then removes the journal. A
terminal orphan journal with no control transition is therefore safe to remove
only after the same terminal observation; a nonterminal orphan other than the
initial prepared/intent case is retained as `transition_incomplete`. Tests cut
between both writes at every phase and between both terminal deletions.

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
  live only while the same-boot PID/start-token tuple matches and its 30-second
  operation lease is unexpired; it refreshes the lease at least every five
  seconds and after every durable phase;
- a `recovery` owner uses the same bounded same-boot PID/start-token rule and
  never depends recursively on authenticated discovery.

Prior boot, missing process, start-token mismatch, or an expired bounded lease
makes the corresponding offline/recovery owner stale. Any failed supervisor
tuple or authenticated-discovery check makes a supervisor owner unverifiable;
route safety must be established before replacement. These are alternative
staleness predicates, not an `AND` condition, so PID reuse cannot create a
permanent veto.

Every owner re-opens and validates the lock path/inode, unexpired lease,
`fenceToken`, and matching transition id/`ownerFenceToken` immediately before
each state write, settings mutation, listener action, or `launchctl` call. A
takeover changes the fence token through an atomic compare-and-swap of the
durable transition owner. An expired or suspended former owner that later
resumes must self-abort before mutation. Bootstrap-to-supervisor handoff uses
the same compare-and-swap after the CLI authenticates the newly published
control endpoint; no two owners can act on one transition concurrently.

`recovery.lock` uses the bounded recovery identity above. A contender may
quarantine a stale lock only after re-reading all owner evidence: atomically
rename the lock to
`recovery.lock.stale.<random-id>`, verify the moved inode/content matches what
was inspected, then create a fresh `wx` lock. Concurrent contenders retry after
`ENOENT/EEXIST`; a matching live owner is never renamed. Before quarantining a
stale transition owner that reached any route-affecting phase, recovery makes a
leased exact route safe and preserves absent, foreign, or unleased values. This
makes owner death recoverable without a second recovery lock.

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
starts a replacement. A healthy authenticated owner is never force-broken.

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

1. Acquire `transition.lock`, create an enable transition id at
   `intent_persisted`, and parse Claude settings under the shared connector
   lock to preflight the
   value plus route lease. `foreign` or `invalid` clears the transition and
   fails without external mutation; `exact` without a lease is eligible only
   because this is an explicit enable.
2. Persist `desiredEnabled=true`; this is the operator's durable opt-in. Advance
   to `bootstrap_pending` before any LaunchAgent handoff.
3. Install or upgrade the proxy LaunchAgent, release the transition lock, and
   wait for authenticated supervisor discovery.
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

Bootstrap/migration failure before a supervisor becomes reachable restores the
prior service, clears incomplete leases, sets `desiredEnabled=false`, and
persists `autostart_failed` in control state. This prevents a failed migration
from leaving an enabled state that a legacy listener can never satisfy.

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
five-second ownership monitor. The monitor checks nonce health and route drift;
it never silently restarts and does not run while a persisted transition is
owned/resumable. Missing/foreign route outside an `expectedUnrouted` transition
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

1. Acquire `transition.lock` and persist one disable transition with
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
| enable / intent or bootstrap pending | no authenticated supervisor | resume bootstrap under recovered transition identity; no route exists yet |
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
| recover / route safety | unverifiable owner | make leased exact route safe first and preserve foreign/unleased values, then advance |
| recover / owner replacement | route safe | quarantine stale locks/runtime and resume from durable desired state |
| migrate service / migration prepared | matching journal + legacy service | require persisted client-close confirmation iff `adoptedExactRoute=true`; an absent-route journal resumes with null confirmation; make route safe, then boot out only the identity-matched legacy process |
| migrate service / migration prepared | journaled legacy identity already stopped | verify route remains absent/foreign and the old start-token identity is gone, then advance idempotently to migration legacy stopped |
| migrate service / migration legacy stopped | matching journal + absent route | install the managed plist or restore the digest-verified backup; never route |
| migrate service / migration legacy stopped | managed plist already installed after a crash cut | verify exact managed template/digest and absent route, then advance idempotently to migration plist installed |
| migrate service / migration plist installed | matching journal + managed plist | bootstrap the supervisor or restore the digest-verified legacy service; never route before new health |
| migrate service / migration plist installed | authenticated replacement supervisor already live | verify matching nonce health, then advance idempotently to migration supervisor started |
| migrate service / migration supervisor started | matching nonce health | clear migration journal/transition and resume the original enable at listener health; failed health rolls back with route absent |
| uninstall service / intent persisted | matching dormant managed job | boot out and advance; a foreign/active job blocks without mutation |
| uninstall service / intent persisted | matching managed job already unloaded | verify plist digest and advance idempotently to uninstall job stopped |
| uninstall service / uninstall job stopped | unloaded managed plist | move it to the verified backup location and advance; mismatch blocks |
| uninstall service / uninstall job stopped | plist already moved + digest-matching backup | advance idempotently to uninstall plist moved and complete |
| uninstall service / uninstall plist moved | missing managed plist + digest-matching backup | clear transition and return idempotent success; any other observation blocks |

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
- known legacy MegaSaver shape: write/fsync exact backup + digest, then persist
  `service-migration.json` and `migrate_service/migration_prepared` **before**
  any route or launchd mutation;
- absent route may migrate directly. An exact unleased route requires proof
  that the known legacy PID owns port 8787 **and** explicit
  `--confirm-clients-closed-for-migration` (or GUI equivalent). The controller
  value-guard removes that route before bootout. Foreign/unproven routes abort
  without stopping the job;
- after route safety, boot out the old job, verify its start-token identity
  exited and the port no longer answers, persist `legacy_stopped`, install the
  plist and persist `plist_installed`, bootstrap/nonce-health-check and persist
  `supervisor_started`, then clear the journal and continue enable;
- bootstrap failure: boot out the failed replacement, restore and reload the
  prior plist, clear desired state/incomplete lease, persist the error, and do
  not create a new route;
- every `launchctl` failure is returned and persisted;
- fresh install does not create or load the service before opt-in.

Migration recovery is phase-driven. `prepared` resumes route-safe bootout only
after the same confirmation; `legacy_stopped` installs the new plist or restores
the verified backup; `plist_installed` bootstraps or rolls back; and
`supervisor_started` verifies nonce health before clearing the journal. Once
legacy stop begins, every rollback keeps the Claude route absent and sets
desired disabled until a new explicit start. Tests cut the process after backup,
route removal, bootout, plist replace, bootstrap, and health verification. A
crash can interrupt old clients only inside the explicitly confirmed migration
window; the spec does not classify that as drain-safe continuity.

`mega proxy service uninstall --confirm` is the only plist-removal path. It is
allowed only when desired is disabled, no lease/listener/drain/transition
exists, and label/argv match the managed template. It boots out the dormant job,
moves the plist to the migration-backup directory rather than deleting it, and
reports every failure. Before bootout it persists an `uninstall_service`
transition and backup digest. Recovery is idempotent: unloaded+managed plist
resumes the move; unloaded+missing plist+matching backup is success; loaded
managed job resumes bootout; any foreign/mismatched file blocks without
mutation. Death after bootout or after move therefore converges on retry.
Ordinary disable leaves a managed dormant service.

`com.megasaver.context-daemon` is not edited. Non-macOS desired state can be
reconciled when the supervisor is explicitly started, but cross-reboot
autostart is reported `unsupported`; this spec makes no false platform claim.

## CLI and GUI contract

CLI surface:

- `mega proxy start` — persist enable, ensure supervisor, wait for ready/error;
- `mega proxy start --recover` — route-safe recovery from unverifiable stale
  supervisor/transition ownership;
- `mega proxy start --confirm-clients-closed-for-migration` — authorize the
  bounded legacy-listener replacement window only when an exact legacy route
  is active;
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
Until its heartbeat registry and compression-event readers exist, proxy status
returns all saver invocation/compression timestamps and ages as `null` without
turning proxy readiness red. Persistent routing is implementation **2 of 2** and
consumes those artifacts only through an optional telemetry reader.

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
all hard rejections before a control request is constructed. Integration tests
pin each rejection against both frontend and bridge boundaries.

Proxy routes accept strict Zod bodies with unknown keys rejected and map only
fixed operations to the control client. No shell command is built from a
browser value.

## Security invariants

- Control and proxy servers bind literal `127.0.0.1`; no host override exists.
- Control, health, GUI-bridge, and GUI-session capabilities are independent,
  have at least 256 random bits, and are compared in constant time. Control and
  health capabilities
  stay only in the mode-0600 runtime file/server memory, and are never returned
  to browser status or logs.
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
- Settings/plist/state/lock mutation uses lstat-open-fstat identity checks,
  owner-only parents where supported, symlink refusal at the leaf, atomic
  rename, mode preservation, and file/directory fsync to reduce TOCTOU windows.
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

## Testing strategy (TDD)

| Layer | Required evidence |
| --- | --- |
| Stores | strict schemas and every error literal (including shutdown); missing/invalid disabled; blocked-state persistence; mode/permissions; atomic+fsync; symlink refusal |
| Route adapter | absent/exact/foreign/invalid matrix; lease+value cleanup guard; foreign never overwritten; unrelated settings preserved |
| Locking | PID reuse/start-token mismatch; authenticated supervisor owner; live offline-CLI contention; offline owner death/lease expiry; expired suspended owner resumes after fenced takeover and self-aborts; stale supervisor/transition recovery; competing recovery exits 75; explicit `--recover`; concurrent hook/route writers preserve updates |
| Health | nonce match required; unrelated and stale MegaSaver listeners rejected; health path never forwarded |
| Supervisor | every installing-lease recovery branch; offline bootstrap; concurrent start/stop; fixed reconcile triggers; SIGTERM leaves state/route untouched; runtime failure unroutes; exact→client launch→absent/readback-failure rollback keeps the healthy listener draining; SIGKILL between drift observation/block write reconstructs block without reroute; no silent retry loop |
| Disable | crash after every phase resumes disable without reroute; dead-listener offline stop succeeds without drain/rebind; expected-unrouted monitor guard; exact-unleased route inserted before drain/confirmed stop blocks shutdown; old client still forwards; confirmation completes stop; failure keeps listener |
| Drain | same-instance drain survives; dead instance/reboot expires without rebind; foreign-held port preserved; active drain is never kickstarted/killed |
| LaunchAgent | fresh install no service; discovery before kickstart; dormant plain kickstart; confirmed legacy-route window; migration/uninstall crash between journal and control transition plus after every external action/phase; digest rollback; foreign plist untouched; uninstall idempotency |
| CLI/GUI | same control state/API; GUI owns no listener; status fields/errors match |
| Security | control auth/body/origin limits; token never reaches browser/log; custom-upstream confirmation; cross-origin redirect strips/refuses auth; plist argv/path injection rejected; lstat-open-fstat race fixtures |
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
passes; independent security-reviewer pass; and tracer design evidence-loop
over every legal persisted transition and specified crash cut. Implementation
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
- Ordinary SIGINT/SIGTERM never becomes route drift or kills a live drain;
  reboot/dead-instance drains expire without rebind.
- Status separates config, route, health, traffic, hook invocation, and
  compression evidence.
- After the operator restarts a **supported Claude Code client**, a controlled
  real request
  updates `proxy-usage/usage.jsonl`.
- Claude Desktop remains explicitly unverified; generic usage telemetry never
  attributes support to it.
