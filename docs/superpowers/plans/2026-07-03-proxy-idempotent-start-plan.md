# Idempotent Proxy Start — Implementation Plan

> superpowers:subagent-driven-development. Strict TDD; `pnpm build` after src edits; `pnpm verify` at boundaries. HIGH risk (proxy lifecycle/concurrency) → code-reviewer + critic.

**Spec:** `docs/superpowers/specs/2026-07-03-proxy-idempotent-start-design.md`
**Branch:** `fix/proxy-idempotent-start` (off main).

Read first (verify signatures before coding): `packages/llm-proxy/src/server.ts:26-62` (startProxyServer), `packages/llm-proxy/src/health.ts` (HEALTH_PATH, computeHealthProof), `packages/proxy-control/src/locks.ts` (isLiveSameBoot / nodeProcessIdentity), `packages/proxy-control/src/stores.ts` + `state.ts` (runtime.json read + ProxyRuntimeState fields), `apps/cli/src/commands/proxy/supervise.ts:49-82,105-176,195-225`.

## Task 1 — health-proof verifier (`@megasaver/llm-proxy`)

**Files:** `packages/llm-proxy/src/health.ts` (extend) or new `verify-health.ts`; export from index; test in `packages/llm-proxy/test/`.

- Reuse `computeHealthProof(capability, instanceId, challenge)` (health.ts:19-25). Add:
  `export async function probeIsMegasaverProxy(input: { url: string; instanceId: string; capability: string; challenge: string; fetchImpl?: typeof fetch }): Promise<boolean>` — GET `${url}/__megasaver__/proxy-health?challenge=${challenge}`; on non-200 → false; parse JSON; verify `service === "megasaver-proxy"`, `instanceId` matches, and `proof` equals `computeHealthProof(capability, instanceId, challenge)` under a **constant-time** compare (`crypto.timingSafeEqual` on equal-length buffers; length-mismatch → false). Any throw (network, parse) → false. Injectable `fetchImpl` for tests.
- Tests (TDD): valid proof → true; wrong proof → false; 404 → false; wrong instanceId → false; fetch throws → false; malformed JSON → false. Mutation: replacing timingSafeEqual with `===` still passes these (compare is about correctness, not the test) — assert a proof off by one byte → false.
- Commit: `feat(llm-proxy): verify a port holder is our proxy via health proof`.

## Task 2 — idempotent bind routine (CLI proxy)

**Files:** `apps/cli/src/commands/proxy/supervise.ts` (+ maybe a new `bind-or-detect.ts` in the same dir for the pure routine), tests in `apps/cli/test/` (mirror existing proxy supervise tests).

- New pure-ish routine `bindOrDetectRunning(deps): Promise<{ kind: "listening"; running: RunningProxy } | { kind: "already-running"; instanceId: string } | { kind: "foreign"; message: string }>`:
  - `deps`: `{ startServer: (port) => Promise<RunningProxy>` (= startProxyServer), `readRuntime: () => ProxyRuntimeState | null`, `probeOurs: (rt) => Promise<boolean>` (Task-1 probe when healthCapability present), `isLiveOwner: (rt) => boolean` (isLiveSameBoot fallback), `sleep`, `port`, `maxAttempts=3`, `delayMs=300` }.
  - Loop up to maxAttempts: `try { return {kind:"listening", running: await startServer(port)} } catch (e) { if not EADDRINUSE → rethrow; on last-ish attempt check ownership }`. On EADDRINUSE: read runtime; if `probeOurs` (or `isLiveOwner` when no capability) → return `already-running`. Else sleep + retry. After attempts exhausted and not ours → return `foreign` with the clear message.
  - Detect EADDRINUSE by `(e as NodeJS.ErrnoException).code === "EADDRINUSE"`.
- Wire into `runProxySupervise` / `runSupervisor`: replace the bare `await startProxyServer` with `bindOrDetectRunning`. On `already-running` → log the message, return a sentinel so `runSupervisor` skips the monitor loop and the command exits 0. On `foreign` → log message; the command exits non-zero. On `listening` → proceed exactly as today (recovery + monitor).
- `proxySuperviseCommand.run` (:225): ensure the terminal `already-running` (exit 0) and `foreign` (exit non-zero, clean message) outcomes are handled without an unhandled rejection — wrap the await, set `process.exitCode` appropriately, never rethrow a raw error.
- Tests (TDD, inject deps — no real socket): (a) startServer throws EADDRINUSE + probeOurs true → `already-running`; (b) EADDRINUSE + probeOurs false + isLiveOwner false, persists → `foreign` with message; (c) EADDRINUSE once then success → `listening` (retry works); (d) startServer succeeds first try → `listening` (happy path); (e) a non-EADDRINUSE error → rethrown (not swallowed). Plus a command-level test that `already-running` exits 0 and does not start the monitor, and `foreign` exits non-zero with the message and no unhandled rejection.
- Commit: `fix(cli): mega proxy start is idempotent — no EADDRINUSE crash-loop`.

## Final gate

- `pnpm verify` green.
- Real smoke: in the worktree, occupy a free port with a throwaway `net`/`http` listener, run `bindOrDetectRunning` against it with (i) a fake runtime whose probe verifies → asserts `already-running`; (ii) a runtime that does not verify → asserts `foreign` message; and a free port → `listening`. Capture output. (No real 8787 / launchd needed.)
- Changeset: `@megasaver/llm-proxy` minor, `@megasaver/cli` patch/minor.
- code-reviewer + adversarial critic (fresh) over `main..HEAD` — critic focus: constant-time compare correctness, foreign-not-mistaken-for-ours, retry can't infinite-loop, non-EADDRINUSE errors still surface, no new unhandled-rejection path. Then PR to main.

## Deferred
`mega proxy restart`; auto-kill of a foreign/stale holder; configurable retry counts beyond a sane default; GUI-specific messaging.
