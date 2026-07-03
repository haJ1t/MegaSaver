# Persistent Proxy Routing — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILLS: superpowers:subagent-driven-development + superpowers:systematic-debugging. TDD every task. `pnpm verify` at every boundary; `pnpm build` before dependent-package tests. **CRITICAL risk:** isolated worktree, no `main` edits; separate code-reviewer + implementation-critic + implementation-security passes; runtime tracer evidence for every persisted transition/crash cut; verifier with reproduction; changeset for every public-API package. No unsupervised loop. No test may touch real `~/.claude/settings.json`, real LaunchAgents, launchctl, or the network — inject paths/process-runners/fake upstream.

**Goal:** One explicit CLI/GUI action persistently enables the local proxy for future supported Claude launches. A dedicated `mega proxy supervise` LaunchAgent owns the listener, reconciles desired↔actual state, writes the Claude route only after a nonce-bound health-check, never touches a foreign route or a process it did not start, and exposes honest separated status. Fixes the 2026-07-02 finding: proxy healthy but no client routed → zero metering.

**Spec:** `docs/superpowers/specs/2026-07-02-persistent-proxy-routing-design.md`
**Branch:** `feat/persistent-proxy-routing` (own worktree; ships **2 of 2**, after saver inheritance — it consumes the saver heartbeat registry's `latest`/`latestCompression`).
**Risk:** CRITICAL — global Claude config, reboot-persistent process, full API/credential path, public CLI break. Reviewers: code-reviewer AND critic AND security-reviewer (separate passes) + runtime tracer evidence.

**Execution order:** P0 → P1 → P2 → P3 → P4 → P5 → P6 → P7 → P8 → P9. Health contract and stores first, then locks/identity, then the route adapter, then the supervisor state machine, then bootstrap/LaunchAgent, then surfaces, telemetry, closeout.

---

## Task P0 — ownership health endpoint (llm-proxy)

**Files:** `packages/llm-proxy/src/health.ts` (new), `packages/llm-proxy/src/server.ts`, `packages/llm-proxy/test/health.test.ts`

- Failing tests first: a reserved local health path is NEVER forwarded upstream; response is `{service:"megasaver-proxy", instanceId, challenge, proof=HMAC-SHA256(capability, instanceId||challenge)}`; the `healthCapability` itself is never sent/returned; a fresh 256-bit challenge is required per probe; verification requires exact challenge+instanceId+constant-time proof; a generic listener or replayed proof fails.
- Impl: supervisor supplies a ≥256-bit `healthCapability` + `instanceId` at server start; the endpoint answers challenges; a `verifyHealth(runtime, probe)` helper does constant-time compare. Capability stays in memory only.
- Commit `feat(llm-proxy): nonce-bound ownership health endpoint`.

## Task P1 — proxy-control package: strict state stores

**Files:** new `packages/proxy-control/` (package.json, tsconfig, src/index.ts), `src/state.ts`, `src/stores.ts`, tests

- Failing tests first: `ProxyControlState` / `ProxyRuntimeState` strict versioned Zod schemas (every enum literal incl. the full `ProxyControlErrorCode` + `ProxySafeErrorDetail` + `ProxyTransition` discriminated union — enable/disable/drain_complete kinds only, NO `recover`/`migrate`/`uninstall` kinds); missing control state ⇒ disabled; invalid ⇒ disabled + offline diagnostic; atomic write + file/dir fsync; mode `0700` dir / `0600` files; symlink refusal; `upstreamBaseUrl` HTTPS-origin-or-loopback validation (no userinfo/path/query/fragment); `lastError` survives with no runtime file.
- Impl: schemas + `readControlState`/`writeControlState`/`readRuntimeState`/`writeRuntimeState` (atomic, injected paths). Package depends on `@megasaver/llm-proxy` + a route-adapter interface only; **knows no Claude paths** (agent-agnostic).
- Commit `feat(proxy-control): strict versioned state stores`.

## Task P2 — owner identity, locks, handoff, recovery (proxy-control)

**Files:** `packages/proxy-control/src/locks.ts`, `src/identity.ts`, tests

- Failing tests first: injected process-identity adapter (pid, process-start-token, boot-id); `supervisor`/`offline_cli`/`recovery` owner liveness rules (authenticated-discovery for supervisor; same-boot pid+start-token+unexpired lock lease OR, post-release, unexpired durable `handoffDeadline` for offline_cli); **PID reuse + start-token mismatch ⇒ stale** (not a permanent veto — the round-1 BLOCKING guard); a SIGSTOPped CLI's `handoffDeadline` expires (round-2 immortal-owner guard); `wx` lock create + in-place lease refresh keeps the lock inode identity stable; `transition.lock`-serialized owner rewrite (no CAS-over-rename); `recovery.lock` quarantine = rename→verify→`wx`, one aborted owner on the race window never dual-mutates; a persisted live transition ⇒ `transition_in_progress`; supervisor-owned transition delivered via its control API.
- Impl: the three locks + owner record `{ownerKind,pid,processStartToken,bootId,instanceId,fenceToken,operation,acquiredAt,leaseExpiresAt}`; `handoffDeadline` lives on the durable transition (not the lock). Route-safety-before-quarantine is a callback the supervisor supplies (P4).
- Commit `feat(proxy-control): fenced owner identity and recovery locks`.

## Task P3 — Claude route adapter (connector-claude-code)

**Files:** `packages/connectors/claude-code/src/proxy-route.ts` (new), `src/hook-settings.ts` (share the settings lock), tests

- Failing tests first: `inspect(url) → "absent"|"exact"|"foreign"|"invalid"`; `apply`/`removeExpected` value-guarded (remove ONLY exact owned URL); a foreign `ANTHROPIC_BASE_URL` is never overwritten/removed; unrelated env/keys + file mode preserved; symlinked settings/lock refused; the settings mutator shares ONE cross-process lock with hook install/uninstall (concurrent hook+route writers both survive); `ensureHooks()` returns the bounded enum, internal-only. **Move the GUI-only `apps/gui/bridge/proxy-settings.ts` writer here** and delete the duplicate.
- Impl: `ProxyRouteAdapter` implementation over the connector settings helpers; lstat-open-fstat identity, atomic rename, fsync. The value-guard tightens today's unconditional `proxy-settings.ts:35` drop.
- Commit `refactor(connector-claude-code): own the proxy route adapter and settings lock`.

## Task P4 — supervisor reconciliation state machine (proxy-control)

**Files:** `packages/proxy-control/src/supervisor.ts`, `src/reconcile.ts`, extensive tests

- Failing tests first — drive the spec's Enable (1–11), Disable (1–8), supervisor-startup bullets, the 5-second monitor, and the **transition recovery matrix** (every enumerated row) with an injected clock, fake route adapter, fake health, and fake listener. Crash-cut tests: SIGKILL at each enable/disable step boundary and during the handoff (deadline stamped, lock released, before supervisor acquire). Invariants asserted on every path: (1) foreign route never overwritten/removed; (2) no route applied in any disable-direction state; (3) an owned route never left pointing at a dead listener without a recovery that removes it; (4) every retained transition escapable via `start --recover`/`stop`/new enable; (5) drains never killed by a later start, expire after reboot/instance death; (6) disable intent never silently reversed; (7) synchronous pre-handoff install failure ⇒ `desiredEnabled=false`, post-handoff timeout ⇒ retained-enabled recovery (the round-3 bootstrap discriminant).
- Impl: the reconcile function + monitor (observe-only while a transition is retained; drift mutation only when no transition persisted); recovery operates **in place** on the single transition slot. Route-safety-before-quarantine callback wired to P2/P3.
- Commit `feat(proxy-control): supervisor reconciliation state machine`.

## Task P5 — bootstrap coordinator + macOS LaunchAgent adapter (proxy-control)

**Files:** `packages/proxy-control/src/bootstrap.ts`, `src/launchagent.ts`, tests (injected `launchctl` runner)

- Failing tests first: fresh install creates/loads NO service before opt-in; a LOADED legacy `com.megasaver.proxy` (`proxy start` argv) ⇒ `legacy_service_present`, NO mutation, manual `launchctl bootout gui/$UID/com.megasaver.proxy` instruction returned (**never stop a process we did not start**); an UNLOADED digest-matching legacy plist ⇒ atomic move to `migration-backups/` then atomic install of the supervisor plist, crash-cut between the two renames converges by observation; discovery-before-`kickstart` (never `kickstart -k`); an unverifiable loaded job routes to `--recover`, not a kill; foreign/unknown-argv plist refused; `service uninstall --confirm` stateless idempotent-by-observation (loaded⇒bootout; unloaded+managed⇒move; unloaded+missing+backup⇒success; foreign⇒block); managed plist `RunAtLoad=true`, `KeepAlive.SuccessfulExit=false`; plist generated via a structured serializer (fixed label + argv array, absolute paths, no shell/interpolation).
- Impl: bootstrap coordinator (acquire transition.lock → preflight → persist intent+handoffDeadline → install/load → release → poll authenticated discovery); LaunchAgent adapter with the observation-based rules above. `com.megasaver.context-daemon` untouched. Non-macOS: reconcile-when-started, autostart `unsupported`.
- Commit `feat(proxy-control): bootstrap coordinator and launchagent adapter`.

## Task P6 — CLI surface (apps/cli)

**Files:** `apps/cli/src/commands/proxy/{supervise,stop,status,uninstall}.ts` (new), `start.ts` (rework), `index.ts`, tests

- Failing tests first: `start` now persists enable + ensures supervisor + waits for ready/error (**public behavior break** vs today's foreground server → changeset); `start --recover` route-safe recovery of any dead-owner transition; `stop` unroutes future clients + enters drain; `stop --confirm-clients-restarted` completes shutdown; `status [--json]` returns the full `ProxyActivationStatus` (separated enabled/running/healthy/routed/draining/routeConflict/reconcileBlocked/hooksConfigured + the four saver fields + autostart + customUpstream); `service uninstall --confirm`; `supervise` is the internal foreground LaunchAgent target; `start --port`/`--upstream` preserved (custom HTTPS origin needs `--confirm-credential-forwarding`); `transition_in_progress`/`legacy_service_present` surfaced with no mutation.
- Impl: thin control clients over proxy-control + the injected Claude route adapter at the composition root; `supervise` is the only process that binds a listener.
- Commit `feat(cli): persistent proxy control commands`.

## Task P7 — GUI (apps/gui)

**Files:** `apps/gui/bridge/proxy-control.ts` (rework), delete `restart-claude.ts` + the duplicate `proxy-settings.ts`, `apps/gui/src/views/cockpit/*`, tests

- Failing tests first: the GUI owns NO listener and NO settings writer (both moved); no startup/shutdown route clearing; the checkbox binds to **desired state**, not `running`; browser never receives `controlToken` or reads supervisor files; mutation requests require the launch-capability→HttpOnly SameSite=Strict cookie + CSRF + Host/exact-Origin (a bare Origin header cannot get mutation authority); the one-time launch capability is single-use + 120s TTL; status reads require the same session; the `osascript` restart button is gone (tell the operator to restart Claude manually).
- Impl: same authenticated control client + status schema as the CLI; auth bootstrap per the spec's GUI section.
- Commit `refactor(gui): persistent-proxy control client, remove singleton and osascript`.

## Task P8 — saver telemetry reader (stats/CLI layer)

**Files:** `packages/stats/src/saver-telemetry.ts` (new) OR the CLI status-assembly module, tests

- Failing tests first: reads `stats/saver-hook-heartbeats.json`; `lastSaverHookInvocationAt = latest.ts|null`, `lastCompressionAt = latestCompression.ts|null`, `*AgeMs = now-ts|null`; a missing/unreadable/version-mismatched registry ⇒ all four `null` without turning readiness red; the reader lives OUTSIDE `@megasaver/proxy-control` (keeps it agent/saver-agnostic).
- Impl: the reader + wiring into `proxy status` assembly. Depends on the saver slice (ships first); before it ships, all four fields are `null` by this same code path.
- Commit `feat(stats): saver liveness telemetry reader for proxy status`.

## Task P9 — changeset + wiki + CRITICAL verification

**Files:** `.changeset/persistent-proxy-routing.md`, `wiki/entities/*`, `wiki/concepts/persistent-proxy-routing.md` (proposed→shipped), `wiki/log.md`

- Changeset: `@megasaver/llm-proxy`, new `@megasaver/proxy-control`, `@megasaver/connector-claude-code`, `@megasaver/cli` (behavior break), `@megasaver/gui`, `@megasaver/stats`.
- `pnpm verify` green. **CRITICAL evidence:** (a) fake-upstream integration — usage recorded ONLY after health+route; stop removes only the owned route; (b) real Claude Code smoke — enable, restart a Claude Code client, one controlled request updates `proxy-usage/usage.jsonl`; (c) runtime tracer evidence over every persisted transition + crash cut; (d) Desktop stays `unverified` (no false attribution).
- Reviewer gates: code-reviewer AND implementation-critic AND implementation-security (separate contexts) + verifier. Archive each pass under `docs/superpowers/reviews/`.
- Flip the concept page to shipped; append `wiki/log.md`. Commit `docs(wiki): record persistent proxy routing`.

---

## Definition of done (this feature)

CRITICAL gate: all HIGH gates + security-reviewer + runtime tracer evidence for every transition/crash cut + verifier with reproduction + the manual user-confirmation already recorded (agent-channel 2026-07-02 00:15). **Acceptance:** CLI+GUI share desired state and survive their own exit; no route before a nonce-bound health-check; proxy/listener failure ⇒ value-guarded unroute + visible error; SIGKILL+PID-reuse cannot veto a replacement or strand a dead route; a crash at any disable phase resumes disable and never re-routes; a loaded legacy service is never stopped by MegaSaver; no retained transition lacks a recovery escape; SIGINT/SIGTERM never becomes drift or kills a live drain; a foreign route/LaunchAgent is never overwritten; fresh install unrouted + no supervisor; status separates config/route/health/traffic/hook/compression; after restarting a supported Claude Code client a controlled request updates usage; Desktop stays explicitly unverified.
