---
feature: on-demand-core
date: 2026-08-11
risk: HIGH
status: draft-design
pending: [user-spec-review, architect-pass, critic-pass]
reviewers: [code-reviewer, critic]
build-order: "3 of 3 (wave-4 batch)"
---

# On-Demand Core — daemonless lazy worker from the standalone bundle (HIGH)

## Problem

The daemon is the platform's single continuous cost: it must be installed, kept alive via launchd, and polled — yet 70% of `mega` invocations are short, stateless reads (`mega output filter`, `mega context why`, `mega preflight diff`, `mega sessions live`) that need no persistent process. `wiki/syntheses/next-wave-2-ideas-2026-08-06.md:83` deferred `on-demand-core` as "`daemonless lazy worker from the standalone bundle; big architectural change, revisit after mesh`" — exactly because the flagship Session Mesh (A-cluster) added more daemon surface without an off-ramp. Without a daemonless path, every low-end device pays the daemon tax, tests must mock launchd, and `mega` cannot run one-shot in CI containers that forbid persistent services.

## Goal

1. `mega --on-demand <command>` and `mega.config.json {core:"on-demand"}` run any **read-only** `mega` command without requiring `mega daemon start` — the CLI lazily spawns a one-shot, bundle-local worker that serves the single request and exits. Write-paths (`mega memory create`, `mega handoff pack`) still require the daemon and refuse with a precise error when `on-demand` is active.
2. The worker is the **already-shipped standalone bundle** (`dist-bundle/mega.mjs` externalizes native chain per `wiki/decisions/bundle-externalize-native-chain.md:1`) — no second binary, no new package. It is `fork()`'d via `node --experimental-strip-types` on the bundle, not `npm exec`, and inherits only `home` + `storeFlag` + one request on stdin.
3. Correctness parity: the same `@megasaver/core` + `@megasaver/content-store` code path serves the request whether daemon or on-demand supplied it; the only observable difference is one cold-start latency metric (`coreMode` in the audit receipt).

Success criteria: `mega --on-demand output filter < file.json` and `mega --on-demand sessions live --json` exit 0 with daemon stopped; `mega --on-demand memory create --content "x"` exits 1 with `error: memory writes require daemon (run mega daemon start or omit --on-demand)`; `pnpm verify` green; `node` CPU profile shows zero daemon thread when on-demand is used.

## Non-Goals (YAGNI)

- No daemonless writes in v1 — writes stay daemon-gated (CRITICAL risk, evidence ledger + policy). Read-only is the safe slice.
- No persistent cache between on-demand invocations — each request is stateless; the 500 ms warm-start cache is daemon-only.
- No GUI daemonless path in v1 — GUI's `/api/*` routes still expect `daemon.start()`; CLI only.
- No new IPC protocol — stdin one-line JSON request → stdout one-line JSON response, same envelope the daemon's `stdio` bridge uses (`packages/mcp-bridge/src/server.ts`), framed length-delimited.
- No cross-platform service install — launchd/plist unchanged.

## Locked Decisions

1. **Bundle is the worker.** `dist-bundle/mega.mjs` is the only artifact; `apps/cli/src/core/worker.ts` `spawnOnDemandWorker({bundlePath, home, storeFlag})` forks it with `args=["--worker","--on-demand"]`. The flag is parsed by `apps/cli/src/main.ts` before citty dispatch — `--on-demand` short-circuits the `daemonClient.connect()` path and routes to `worker.requestOne({cmd, args})`. Reuses `MEGASAVER_TOOL_NAMING` envelope (`entities/mcp-bridge`), not a new schema — same Zod `strict()` request/response as the daemon.
2. **Read-only gate is a closed allow-list, not a deny-list.** `isOnDemandAllowed(cmd: string): boolean` returns true only for `output:*`, `context:why`, `context:hotspots`, `context:yield`, `preflight:*`, `sessions:live`, `doctor`, `sweep:scan`, `inspect`, `deja-vu`, `audit`, `version`. Every other `cmd` → `error: <cmd> requires daemon`. The list lives in `packages/policy/src/on-demand-gate.ts` and is tested exhaustively — closed union, not string-contains. Mirrors `PolicyDenyCode` closed handling (`entities/policy`).
3. **One request, then exit.** Worker lifecycle: parent forks → child reads one `Request` line on stdin (bounded 1 MB, 5s timeout) → dispatches via core's `createRegistry` + `content-store` read path → writes one `Response` line on stdout (bounded) → child `process.exit(0)`. Parent awaits with 10s total timeout, then `SIGTERM` → `SIGKILL` 500 ms later. No `stdio` multiplex, no keep-alive — `ps` after the command shows zero `mega` processes. Tested via `vitest` child-process harness with `node:child_process spawn`.
4. **Same code path, different entry.** Both daemon and on-demand call `packages/core/src/registry.ts` + `packages/content-store/src/store.ts` read helpers; the only branch is `getCoreMode()` (`daemon` vs `on-demand`) threaded into the audit receipt (`SessionTokenSaverStats.coreMode`). No `if (onDemand) { alternateImpl }` — same modules, same Zod validation, same redaction. This is the `architect` gate's correctness proof: diff the callsite, not the callee.
5. **Config precedence: flag > config > default.** `mega.config.json {core:"on-demand"|"daemon"}` (`apps/cli/src/config.ts`) defaults to `"daemon"`. `--on-demand` overrides, `--daemon` explicitly forces daemon. `mega doctor` reports `coreMode` and `onDemandReads` counter (from `stats`), satisfying the honest-metrics family (`entities/stats`).
6. **Security parity.** Worker inherits only `HOME`, `MEGASAVER_HOME`, `MEGASAVER_STORE` env, plus the one request — no shell, no `PATH` search, no `exec`. Request paths are `SAFE_SEGMENT` gated and `realpath` resolved before any read (same as `apps/cli/src/preflight/git-capture.ts:81`). Worker file is verified `mtime`-fresh vs `dist-bundle/mega.mjs` — stale bundle refuses to spawn with `error: bundle stale, run pnpm build`.

## Architecture

```
CLI invocation
  parseArgs → coreMode = flag ?? config.core ?? "daemon"
  if coreMode=="on-demand" && !isOnDemandAllowed(cmd) → exit 1 with gated error
  if coreMode=="on-demand"
     spawnOnDemandWorker({bundlePath, home, storeFlag})
       child: read 1 line stdin → validate strict schema → core read path → write 1 line stdout → exit
       parent: write 1 line stdin → await 1 line stdout (10s) → SIGTERM/SIGKILL → return
  else
     daemonClient.connect() → existing path

Worker bundle entry
  if argv.includes("--worker --on-demand")
     runOnDemandWorker({bundlePath, stdin, stdout}) // same core handlers, single shot
```

## Components

- **C1 `packages/policy/src/on-demand-gate.ts` (pure):** `isOnDemandAllowed(cmd: string): boolean` + `ON_DEMAND_ALLOWLIST` closed set + Zod enum; ≤ 100 LOC.
- **C2 `apps/cli/src/core/worker.ts`:** `spawnOnDemandWorker`, `runOnDemandWorker`, `WORKER_TIMEOUT_MS=10000`, bounded stdin/stdout framing, stale-bundle check, `coreMode` threading.
- **C3 `apps/cli/src/config.ts`:** `core: "daemon"|"on-demand"` field (strict Zod), precedence logic, `mega doctor` reporting.
- **C4 `apps/cli/src/main.ts`:** `--on-demand`/`--daemon` flag parse before citty, dispatch branch.
- **C5 `apps/cli/src/commands/sessions/live.ts` + `context/yield.ts` + `output/filter.ts` etc.:** no per-command change except they become on-demand-allowlisted and pass `coreMode` into receipts.

## Error handling

- Spawn failure (bundle missing, stale, `EAGAIN`) → exit 1 `error: on-demand worker unavailable (run pnpm build or omit --on-demand)` — never falls back to daemon silently.
- Timeout (10s total, 5s per leg) → `SIGTERM` → 500 ms → `SIGKILL`, exit 1 `error: worker timeout`.
- Write attempted in on-demand mode → exit 1 `error: <cmd> requires daemon (run mega daemon start or omit --on-demand)` before any worker is spawned.
- Malformed request/response (Zod strict failure) → exit 1 `error: worker protocol error` with safe `zod.issues` redacted.

## Security & privacy

- Env allow-list: only `HOME`, `MEGASAVER_HOME`, `MEGASAVER_STORE`, `NODE_ENV`, `CI` forwarded — secrets in `PATH` or custom env never reach the child.
- No shell, no `exec`, argv array only (as `git -C` pattern).
- Paths `realpath` resolved + `SAFE_SEGMENT` gated; symlink traversal outside `storeRoot` refused (same as `@megasaver/policy` secret-path gate).
- Worker stdout is JSON only — never logs to stdout (stderr is free), so framing cannot be polluted.

## Testing

- **Unit (TDD, pure):** `isOnDemandAllowed` cases: `output filter` allowed, `memory create` denied, unknown cmd denied, strict enum rejects typo; `buildLiveTable` coreMode threading.
- **Integration (spawn):** tmp `home` + tmp store (from `store` test helper) → `spawnOnDemandWorker` request `sessions live` returns valid `liveTable` JSON; same for `context yield`; write `memory create` in on-demand mode exits 1 before spawn (no child observed via `ps` mock); timeout (child sleeps 11s) → parent KILLs and exits 1; stale bundle (touch bundle old) → spawn refuses.
- **Regression:** daemon path still works with daemon running; `pnpm verify` (linux + windows) green; existing `mcp-bridge` stdio framing tests untouched.

## Risk & process

**HIGH** — touches process spawn (`node:child_process`), bundle lifecycle, and the daemon vs. worker correctness parity claim. `superpowers:verification-before-completion` + `architect` (design) + `critic` (adversarial) + worktree required per `docs/conventions/risk-modes.md:HIGH`. External reviewer `code-reviewer` AND `critic` separate passes before merge. `pnpm verify` + CLI smoke (daemon stopped → `mega --on-demand sessions live --json` parses) required.

## Dependencies / build order

- Builds on shipped: `dist-bundle/mega.mjs` externalize chain, `mcp-bridge` stdio envelope, `@megasaver/policy` gate pattern, `content-store` read path, `daemon` live-sessions file.
- Owned by this pair: `ON_DEMAND_ALLOWLIST` + `spawnOnDemandWorker`/`runOnDemandWorker` + config `core` field.
- Consumers: every read-only CLI command becomes dual-mode; GUI stays daemon-only in v1. Build order **3 of 3 (wave-4 batch)** — depends on wave-4 1/3 + 2/3 pure-core pattern for the allow-list, but spawn logic itself is orthogonal.

## Open questions

1. Should `--on-demand` auto-fallback to daemon when daemon is running, or always spawn stateless? (v1: always spawn when flag is set — explicit, testable; auto-fallback is a follow-up once metrics show cold-start cost.)
2. Should the worker survive 2 requests (keep-alive 1s) to amortize cold start for `mega sessions live` polling? (v1: no — single shot keeps the contract minimal; keep-alive gates on measured cold-start p95.)
