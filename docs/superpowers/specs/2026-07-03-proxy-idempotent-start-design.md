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

## Fix — idempotent start

When `startProxyServer` fails with `EADDRINUSE`, do NOT crash. Decide who owns
the port and act:

1. **Is it our live proxy?** Read the runtime state
   (`packages/proxy-control` `runtime.json`: `pid`, `processStartToken`,
   `bootId`, `instanceId`, `healthCapability`, `proxyUrl`). Confirm the holder
   is our live proxy by, in order:
   - **Cryptographic health probe** (definitive): `GET
     http://127.0.0.1:<port>/__megasaver__/proxy-health?challenge=<random>`;
     verify `proof === HMAC-SHA256(healthCapability, instanceId||challenge)`
     (constant-time) — this is answered locally, never forwarded upstream
     (`packages/llm-proxy/src/health.ts`, `proxy-handler.ts:104-117`).
   - **Fallback pid-liveness** (when no health capability configured / probe
     unreachable): reuse the existing `isLiveSameBoot` primitive
     (`packages/proxy-control/src/locks.ts`) via `nodeProcessIdentity`
     (pid alive + `processStartToken` + `bootId` match).
2. **Confirmed ours** → log `proxy already running (instance <id>) on :<port> —
   nothing to do` and **exit 0**. (launchd keeps the existing one; the redundant
   spawn/start no-ops.)
3. **Not confirmed** → the prior instance may still be releasing the port
   (respawn race). **Retry** the bind a small bounded number of times
   (e.g. 3 attempts, ~300 ms apart). If a retry succeeds → normal start.
4. **Still EADDRINUSE after retries and not ours** → a foreign process holds the
   port. Print a clear one-line stderr message (`port <port> is held by a
   non-megasaver process — free it or set MEGASAVER_PROXY_PORT`) and exit
   non-zero. **Never** a raw stack trace / unhandled rejection.

## Locked decisions

- **Idempotent, not force**: we never kill the port holder (foreign or ours).
  Killing is out of scope; launchd owns lifecycle.
- **Verify before claiming ownership**: exit 0 only when the holder is
  provably our live proxy (health-proof or pid-liveness) — a foreign process on
  8787 must NOT be mistaken for ours.
- **Bounded retry** for the release-race only; no infinite loop (launchd already
  retries the whole process).
- **launchd plist unchanged** (KeepAlive is correct); this makes its respawns
  and any manual/GUI double-start clean.
- Reuse existing primitives (`isLiveSameBoot`, `nodeProcessIdentity`, the health
  endpoint + `computeHealthProof`) — no new liveness machinery.

## Where

- `apps/cli/src/commands/proxy/supervise.ts` — wrap the `startProxyServer` bind
  in `runProxySupervise` (or a small `bindOrDetectRunning` helper) that performs
  the retry + ownership decision, and handle the terminal cases at the
  `proxySuperviseCommand.run` boundary (:225) so nothing rethrows uncaught.
- A small pure helper for the health-proof verification (probe + HMAC compare) —
  co-locate in `@megasaver/llm-proxy` next to `computeHealthProof`, or in the CLI
  proxy dir. Injectable `fetch`/`readRuntime`/`processIdentity` so it is unit
  testable without a real socket.

## Testing (TDD, non-tautological)

- **Ours already running**: bind throws EADDRINUSE; health probe (injected)
  returns a valid proof for the runtime instanceId/capability → the start
  routine resolves to `already-running`, logs it, exit code 0, does NOT rethrow.
  Mutation: a WRONG proof must NOT be accepted as ours (→ treated as foreign).
- **pid-liveness fallback**: no health capability; runtime pid is live+same-boot
  → already-running (exit 0); runtime pid dead → not ours.
- **Release race**: bind throws EADDRINUSE on attempt 1, succeeds on attempt 2 →
  normal start (server listening), no error surfaced.
- **Foreign holder**: EADDRINUSE persists through retries, probe fails / pid not
  ours → returns a clear terminal error (asserted message), exit non-zero, no
  unhandled rejection / raw stack.
- **Happy path**: listen succeeds first try → unchanged (regression guard).

Plus: `pnpm verify` green; a real-ish smoke: start a throwaway listener on a
free port, point the routine at it, assert the EADDRINUSE path + the
foreign-vs-ours decision behaves (no real 8787 needed).

## Non-goals

Killing the port holder; a `mega proxy restart` command; changing the LaunchAgent
plist; changing how launchd supervises; the GUI proxy-activation path (it routes
through the same supervise → inherits the fix).
