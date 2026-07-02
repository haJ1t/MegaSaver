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
reviewers: [architect, critic, security-reviewer]
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
  | "shutdown_requires_client_restart"
  | "reconfigure_requires_client_restart"
  | "autostart_failed";

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
    url: string;
    startedAt: string;
  };
  reconcileBlocked: null | {
    reason: "route_removed" | "route_conflict";
    at: string;
  };
  updatedAt: string;
  lastError: null | {
    code: ProxyControlErrorCode;
    message: string;
    at: string;
  };
};
```

`<storeRoot>/proxy/runtime.json` is supervisor discovery and diagnostics:

```ts
type ProxyRuntimeState = {
  version: 1;
  pid: number;
  instanceId: string;
  controlUrl: string;
  controlToken: string;
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
`fsync`, and reject symlinks. `upstreamBaseUrl` must be an HTTPS origin with no
userinfo, query, or fragment.

Runtime JSON is discovery, not truth. `running`, `healthy`, and `routed` are
always re-observed from the process, nonce health endpoint, and route adapter.
The random control token protects the supervisor's loopback API.

Two owner-only locks have distinct roles:

- `supervisor.lock` proves one long-lived supervisor. A second supervisor exits
  without mutation. Stale recovery requires a dead PID plus failed authenticated
  discovery, matching the existing daemon safety pattern.
- `transition.lock` serializes desired-state, LaunchAgent, listener, lease, and
  route transitions across CLI, GUI, and supervisor. It is never held while
  waiting for a new supervisor to acquire it.

The bootstrap coordinator in `@megasaver/proxy-control` works before a
supervisor exists: acquire transition lock, preflight and persist intent,
install/bootstrap the service, release, then poll authenticated discovery. Once
the supervisor is live, its control API serializes requests and takes the same
transition lock for each reconciliation. If bootstrap fails, CLI/GUI status
falls back to strict control/runtime files, process/health probes, and route
inspection; it does not require a live API.

`routeLease` is the durable ownership marker. URL equality alone is never
treated as ownership. Cleanup requires both a lease and an exact current value.
If another actor changes the route, MegaSaver preserves that value and clears
its stale lease after surfacing the conflict.

The `installing` phase closes the two-file crash window: after health succeeds,
the controller persists an installing lease **before** writing settings, then
marks it active only after read-back verification. Startup reconciliation may
clean up an exact value covered by an installing lease; absent/foreign values
are preserved and the incomplete lease is cleared with a visible diagnostic.

`reconcileBlocked` preserves the operator's enabled intent without silently
recreating a route that disappeared or was replaced. Supervisor restart/status
does not clear it. Only a new explicit `proxy start`/GUI-on action clears the
block after fresh conflict and health checks; explicit stop clears it while
setting desired disabled.

## Ownership health contract

The proxy reserves a local health path that is never forwarded upstream. It
returns `{service:"megasaver-proxy", instanceId}`. The supervisor generates the
nonce, passes it to the listener, and accepts health only when both the service
marker and nonce match `runtime.json`. A generic HTTP listener or a stale
MegaSaver process on port 8787 is not adopted implicitly.

Legacy exact-URL adoption requires an explicit `proxy start` or GUI toggle, no
existing lease, and a successful ownership health-check. Only then may the
controller create a lease. Supervisor boot alone never adopts a route merely
because its string matches.

## Reconciliation state machine

### Enable

1. Parse Claude settings under the shared connector lock and preflight the
   value plus route lease. `foreign` or `invalid` fails without mutation;
   `exact` without a lease is eligible only because this is an explicit enable.
2. Through the offline bootstrap coordinator, persist `desiredEnabled=true`;
   this is the operator's durable opt-in.
3. Install or upgrade the proxy LaunchAgent, release the transition lock, and
   wait for authenticated supervisor discovery.
4. The supervisor reacquires the transition lock and binds exactly one listener
   on the configured loopback port.
5. Verify nonce ownership through the reserved local health endpoint.
6. Persist an `installing` route lease bound to the healthy instance nonce.
7. Atomically apply the Claude route through the connector adapter.
8. Read back and verify the exact route value.
9. Promote the route lease to `active`.
10. Install/repair MegaSaver hooks idempotently under the same settings lock.
11. Report ready only when desired, listener, health, active lease, and route
    agree.

After a supervisor exists, failure rollback may remove only a route covered by
this attempt's installing lease or a prior active lease; a pre-existing exact
URL without a lease is never removed. It stops only the nonce-owned listener,
persists the concrete error, and returns failure. Desired state stays enabled
so status reflects the operator's request.

Bootstrap/migration failure before a supervisor becomes reachable restores the
prior service, clears incomplete leases, sets `desiredEnabled=false`, and
persists `autostart_failed` in control state. This prevents a failed migration
from leaving an enabled state that a legacy listener can never satisfy.

### Supervisor startup and runtime

`proxy supervise` starts an authenticated random-port control server, publishes
`runtime.json`, then reconciles before it reports ready:

- disabled with no drain: remove a route only when a valid lease and exact
  value agree, ensure no owned listener, exit 0;
- disabled with `drainingGeneration`: ensure that nonce-owned generation is
  listening without writing a route, then remain alive in drain;
- enabled with `reconcileBlocked`: retain/restore the draining generation when
  healthy, never write a route, and wait for explicit start/stop;
- enabled without a block: preflight conflicts, start, nonce-health-check,
  apply and verify;
- foreign route: do not overwrite or adopt, persist `route_conflict`, remain
  alive for status/control;
- listener cannot become healthy: remove only a leased exact route, persist
  the error, remain degraded for diagnosis.

If a routed listener fails while the supervisor remains alive, remove the owned
route before closing the failed listener and record `runtime_failed`. A hard
`SIGKILL` creates an unavoidable short stale-route window; the LaunchAgent must
restart the supervisor, which reconciles before a normal later client launch.
This residual is documented rather than claimed away.

Reconciliation triggers are fixed: supervisor startup, authenticated
start/stop/reconfigure requests, listener `error`/unexpected `close`, and a
five-second ownership monitor. The monitor checks nonce health and route drift;
it never silently restarts. Missing/foreign route clears any stale lease,
preserves a foreign value, retains `desiredEnabled=true`, persists the matching
`reconcileBlocked` reason, and transitions the still-healthy owned listener into
`drainingGeneration` for old clients. Failed health or an unexpected listener
close is an unavoidable runtime failure and records a visible degraded state.
Route-drift repair requires explicit `proxy start`; supervisor/LaunchAgent
restart alone respects the block.

On SIGINT/SIGTERM the supervisor first performs value-guarded unroute and moves
any healthy active generation into drain. It refuses voluntary listener exit
while an active/draining generation lacks explicit client-restart confirmation,
records `shutdown_requires_client_restart`, and keeps the control server alive.
It exits normally only with no listener or after confirmed drain completion.
OS/process forced termination, failed health, and unexpected close remain the
documented residuals that cannot honor drain.

### Disable

Disable ordering is safety-critical:

1. Under the connector lock, remove the route only if `routeLease` exists and
   the current value exactly matches the leased URL.
2. Read back and verify the route is no longer owned.
3. If removal or verification fails, keep the proxy ready, keep desired state
   enabled, record `disable_failed`, and return failure.
4. After successful unroute, clear the lease, persist `desiredEnabled=false`,
   and mark the current listener as `drainingGeneration`.
5. Keep the draining listener transparently forwarding for already-running
   Claude processes, which retain the old base URL in memory.
6. Stop the listener and let the supervisor exit successfully only after the
   operator explicitly confirms those clients were closed/restarted.

If a foreign value replaced the owned route, leave it untouched; because it no
longer targets MegaSaver, disabling may transition the owned listener to drain
after reporting the ownership change.

There is no reliable process-independent way to prove that every old client has
discarded the URL. Therefore the spec does not claim that unroute alone prevents
stranding. `mega proxy stop` and the GUI off toggle disable future routing and
enter drain. `mega proxy stop --confirm-clients-restarted` (or the matching GUI
confirmation) completes listener shutdown. A later start with the same
configuration may reactivate the draining generation without rebinding.

## Claude settings ownership and concurrency

The GUI-only proxy settings writer moves into
`@megasaver/connector-claude-code`. All MegaSaver settings mutators—including
hook install/uninstall and proxy routing—share one cross-process lock. Atomic
rename alone is insufficient because two writers can otherwise lose each
other's updates.

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
later start inspects `launchctl print`: it uses `kickstart -k` for the known
loaded managed job and `bootstrap` only when the label is not loaded. It never
treats “already loaded” as a successful bootstrap or a fatal conflict.

Installer rules:

- same label with unknown owner or argv: refuse overwrite;
- known legacy MegaSaver shape: back up exact bytes under
  `<storeRoot>/proxy/migration-backups/`, boot out the known old job to release
  port 8787, verify the loaded PID exited and the port no longer answers,
  atomically install the supervisor plist, bootstrap, and nonce-health-check;
- bootstrap failure: boot out the failed replacement, restore and reload the
  prior plist, clear desired state/incomplete lease, persist the error, and do
  not create a new route;
- every `launchctl` failure is returned and persisted;
- fresh install does not create or load the service before opt-in.

`com.megasaver.context-daemon` is not edited. Non-macOS desired state can be
reconciled when the supervisor is explicitly started, but cross-reboot
autostart is reported `unsupported`; this spec makes no false platform claim.

## CLI and GUI contract

CLI surface:

- `mega proxy start` — persist enable, ensure supervisor, wait for ready/error;
- `mega proxy stop` — unroute future clients and enter drain;
- `mega proxy stop --confirm-clients-restarted` — complete a drain and stop;
- `mega proxy status [--json]` — observed state and evidence;
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

Status exposes independent facts:

```ts
type ProxyActivationStatus = {
  enabled: boolean;
  running: boolean;
  healthy: boolean;
  routed: boolean;
  draining: boolean;
  routeConflict: string | null;
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
  autostart: "running" | "missing" | "unsupported" | "error";
  error: null | { code: string; message: string; at: string };
};
```

“Ready” means enabled + running + healthy + routed. Generic traffic is evidenced
only by a later usage event; a settings route alone is not proof. Usage events
have no client identity, so they cannot establish Claude Desktop support.
Desktop remains `unverified` until a separate controlled, client-specific
capability protocol exists. Hook configuration, invocation, and actual
compression remain separate signals.

The GUI removes its process-local proxy singleton, startup/shutdown route
clearing, duplicated settings writer, and `osascript` restart route/button. It
tells the operator to restart Claude manually when convenient.

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
| Locking | concurrent hook and route writers preserve both updates; timeout/error is visible |
| Health | nonce match required; unrelated and stale MegaSaver listeners rejected; health path never forwarded |
| Supervisor | offline bootstrap; transition/supervisor locks; concurrent start/stop; stale-lock proof; singleton listener; fixed reconcile triggers; runtime failure unroutes; no silent retry loop |
| Disable | route removed and verified before drain; old client still forwards; confirmation completes stop; removal failure keeps ready listener |
| LaunchAgent | fresh install no service; loaded legacy bootout+PID/port verification; upgrade+backup; foreign plist untouched; bootstrap rollback; start→stop→start uses kickstart for dormant job |
| CLI/GUI | same control state/API; GUI owns no listener; status fields/errors match |
| Telemetry | configured, invocation, compression, and proxy usage timestamps stay distinct |
| Integration | fake upstream traffic records counts only after health+route; stop removes only owned route |

No test may modify real Claude settings, LaunchAgents, launchd environment, or
network upstream. Use injected paths/process runners and temporary stores.

## Risk and governance

Risk is **CRITICAL**. The change writes global Claude configuration, controls a
reboot-persistent process, carries API credentials and complete request/response
traffic, and changes public CLI behavior. The earlier LLM-proxy spec already
classified this path CRITICAL; HIGH is retained as the minimum connector/CLI
classification, not used to lower the existing risk.

Required gates: explicit user opt-in (already recorded), isolated worktree,
architect pass, adversarial critic pass, security review, TDD, `pnpm verify`,
fake-upstream and real-client smoke evidence, code-reviewer pass, verifier pass,
and changesets for every affected public package. No implementation may use an
unsupervised loop.

The proxy remains transparent and persists token counts/metadata only. It never
persists prompts, responses, auth headers, or keys.

## Acceptance criteria

- CLI and GUI enable the same desired state and survive their own exit.
- No route is written until a nonce-bound MegaSaver health-check succeeds.
- Proxy/listener failure causes value-guarded unroute and a visible error.
- Disable enters drain after verified unroute and cannot stop the listener
  before explicit client-restart confirmation.
- URL equality without a route lease never authorizes cleanup.
- A foreign `ANTHROPIC_BASE_URL` or LaunchAgent is never overwritten/removed.
- Fresh install remains unrouted and installs no supervisor.
- Status separates config, route, health, traffic, hook invocation, and
  compression evidence.
- After the operator restarts a **supported Claude Code client**, a controlled
  real request
  updates `proxy-usage/usage.jsonl`.
- Claude Desktop remains explicitly unverified; generic usage telemetry never
  attributes support to it.
