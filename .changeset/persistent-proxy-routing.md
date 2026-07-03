---
"@megasaver/llm-proxy": minor
"@megasaver/proxy-control": minor
"@megasaver/connector-claude-code": minor
"@megasaver/cli": minor
"@megasaver/gui": minor
---

Persistent proxy routing: one explicit CLI/GUI action persistently enables the
local proxy for future supported Claude launches, owned by a dedicated
supervisor LaunchAgent that reconciles desired↔actual state and never touches a
foreign route or a process it did not start. Fixes the 2026-07-02 finding where
the proxy was healthy but no client was routed (zero metering), and removes the
GUI's boot/shutdown route-clearing that could strand a session.

- `@megasaver/llm-proxy`: a nonce-bound ownership health endpoint (HMAC
  challenge-response) answered in-process and never forwarded upstream.
- `@megasaver/proxy-control` (NEW, agent-agnostic): strict versioned control/
  runtime state stores; fenced owner identity + locks (pid + start-token +
  boot-id, PID-reuse-safe); the reconciliation recovery matrix as a pure,
  exhaustively-tested decision (a foreign route is never removed, no route is
  applied in a disable/drain transition, remove targets only a leased exact
  owned url); supervisor wiring (startup fixpoint + 5s monitor); and a macOS
  LaunchAgent adapter (structured plist, legacy-service-present manual bootout,
  idempotent-by-observation, foreign untouched).
- `@megasaver/connector-claude-code`: a value-guarded Claude route adapter
  (inspect/apply/removeExpected/ensureHooks) that owns the `~/.claude/settings.json`
  route and never overwrites/removes a foreign value.
- `@megasaver/cli`: `mega proxy start` (persist enable + install the supervisor
  LaunchAgent), `stop`, `status [--json]` (separated facts + saver liveness from
  the heartbeat registry), `service uninstall --confirm`, and the internal
  `proxy supervise` runtime. **Public behavior break:** the old foreground
  `mega proxy start` is now `mega proxy supervise`.
- `@megasaver/gui`: the proxy toggle persists desired state through the shared
  control plane and no longer owns a listener, clears the route, or runs
  osascript.

Deferred (flagged): the full GUI auth bootstrap (launch capability → HttpOnly
SameSite cookie + CSRF) and the long-running `proxy supervise` control server;
the supervisor runtime composes the tested reconcile/monitor primitives.
