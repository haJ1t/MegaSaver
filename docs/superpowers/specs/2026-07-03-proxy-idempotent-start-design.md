---
title: Idempotent proxy start (stop the EADDRINUSE crash-loop)
date: 2026-07-03
status: approved
risk: HIGH
scope: mega proxy supervise handles EADDRINUSE gracefully — no-op when a live megasaver proxy already owns the port; clear message otherwise
base: main
reviewers: [code-reviewer, critic]
---

# Idempotent proxy start

## Problem (root-caused, evidence on disk)

`mega proxy start` → control-plane write + LaunchAgent → launchd spawns
`mega proxy supervise` → `runSupervisor` → `runProxySupervise` → `await
startProxyServer` → `server.listen(8787)`.

`startProxyServer` (`packages/llm-proxy/src/server.ts:45-62`) registers
`server.once("error", reject)`, so `EADDRINUSE` **rejects** the promise.
`proxySuperviseCommand.run` (`apps/cli/src/commands/proxy/supervise.ts:225`)
awaits `runSupervisor` with **no try-catch** → unhandled rejection → the
supervise process **crashes**. The LaunchAgent (`com.megasaver.proxy.plist`,
`KeepAlive=true`) respawns it → **crash-loop** until the port frees.

Real evidence: `~/.local/share/megasaver/proxy-launchd.err.log` shows
`listen EADDRINUSE: address already in use 127.0.0.1:8787` (×4). It happens when
(a) launchd respawns before the prior instance releases 8787, or (b) the user /
GUI runs a second `mega proxy start` while launchd already owns the port. There
is no pre-bind check, no retry, no graceful message.

The proxy is a KeepAlive-managed singleton; a second binder should be a **no-op**,
not a crash.

## Approach correction (why ownership-detection is dropped)

An initial design tried to prove the port holder is "our live proxy" via the
runtime state + a health-proof probe. **That is unreachable in production**,
verified empirically:

- `writeRuntimeState` (`packages/proxy-control`) has **zero production callers**
  — the supervisor persists only `control.json`, never `runtime.json`. So
  `readRuntimeState` returns `null` for the port owner in every real
  double-start (`~/.local/share/megasaver/proxy/runtime.json` does not exist).
- The reserved health endpoint returns **404** on the live proxy (no health
  capability is configured), so the cryptographic probe cannot verify anything.

Persisting runtime state + configuring a health capability is a separate,
larger proxy-lifecycle change (deferred, see Non-goals). The reachable fix does
not need to prove ownership.

## Fix — graceful, launchd-safe EADDRINUSE handling

The proxy is a `KeepAlive` launchd singleton. A **persistent** `EADDRINUSE`
means another instance already owns the port — respawning/crashing is futile.
When `startProxyServer` fails with `EADDRINUSE`:

1. **Bounded retry** to absorb the launchd respawn release-race: retry the bind
   a small fixed number of times (e.g. 3 attempts, ~300 ms apart). If a retry
   succeeds → normal start (recovery + monitor as today). This is the common
   case (the old instance is still releasing 8787).
2. **Persistent EADDRINUSE after retries** → treat as "already running": write a
   clear one-line stderr message (`port <port> already in use — another proxy
   instance or process owns it; this supervisor is exiting. If the proxy is
   unexpectedly down, check what holds :<port>.`) and **exit 0**. Exit 0 is
   launchd-safe: the current code emits `KeepAlive { SuccessfulExit: false }`
   (`launchagent.ts`), so a clean exit is NOT respawned → the crash-loop stops.
   (On an older `KeepAlive: true` plist it degrades to a throttled clean respawn,
   still no crash.)
3. **Any non-`EADDRINUSE` listen error** → rethrow so it surfaces (not swallowed).

Never a raw stack trace / unhandled rejection reaches the process top level.

## Locked decisions

- **Idempotent, not force**: never kill the port holder. launchd owns lifecycle.
- **No ownership proof**: we do not try to distinguish "our proxy" from a
  foreign holder — the reachable signals to do so do not exist yet. Persistent
  EADDRINUSE on a KeepAlive singleton is treated as "already running" and the
  supervisor exits cleanly. A generic-but-clear log keeps a foreign holder
  diagnosable.
- **Bounded retry** for the release-race only; no infinite loop.
- **launchd plist unchanged**; exit 0 relies on the code's `SuccessfulExit:false`.
- Delete the unreachable ownership machinery (health-proof probe / runtime read
  as a control-flow gate) rather than ship dead code.

## Where

- `apps/cli/src/commands/proxy/supervise.ts` — a small pure `bindWithRetry(deps)`
  helper: `deps = { startServer:(port)=>Promise<RunningProxy>, sleep, port,
  maxAttempts=3, delayMs=300 }`; returns `{ kind:"listening"; running }` on
  success or `{ kind:"already-in-use" }` when EADDRINUSE persists; any
  non-EADDRINUSE error rethrows. Wire it into `runProxySupervise`; handle the
  terminal outcomes at the `proxySuperviseCommand.run` boundary (:225) —
  `already-in-use` → log + `process.exitCode = 0`, skip the monitor; `listening`
  → proceed as today — so nothing rethrows uncaught.
- **Remove** the unreachable ownership machinery added in the first pass
  (`probeIsMegasaverProxy` / `verify-health` + the runtime-read gate) unless a
  later change persists runtime state.

## Testing (TDD, non-tautological)

- **Release race**: `startServer` throws `EADDRINUSE` on attempt 1, succeeds on
  attempt 2 → `listening` (server started), no error surfaced. Mutation:
  `maxAttempts=1` would fail this (proves the retry is load-bearing).
- **Persistent in-use**: `startServer` throws `EADDRINUSE` on every attempt →
  `already-in-use`; the command logs the clear message and exits 0 (asserted
  exit code 0 + message present + monitor NOT started + no unhandled rejection).
- **Non-EADDRINUSE error** (e.g. `EACCES`) → rethrown, NOT treated as
  already-in-use (must not silently exit 0 on an unrelated failure).
- **Happy path**: `startServer` succeeds first try → `listening`, unchanged
  (regression guard).

Plus `pnpm verify` green; a real smoke: occupy a free port with a throwaway
listener, run `bindWithRetry` against it → asserts `already-in-use` after the
bounded retries; a free port → `listening`. No real 8787 / launchd needed.

## Non-goals

Killing the port holder; a `mega proxy restart` command; changing the LaunchAgent
plist. **Deferred (separate change):** persist `runtime.json` on successful
listen + configure a health capability, then add cryptographic ownership
detection so the log can say *specifically* "our proxy already running" vs
"foreign process on the port" (and loopback-constrain `proxyUrl` at the schema).
The GUI proxy-activation path routes through the same supervise → inherits this
fix.
