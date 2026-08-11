---
feature: session-mission-control
date: 2026-08-11
risk: MEDIUM
status: draft-design
pending: [user-spec-review, architect-pass]
reviewers: [code-reviewer]
build-order: "2 of 3 (wave-4 batch)"
---

# Session Mission Control — live presence + token burn + claim warnings (A5)

## Problem

Parallel agent sessions are islands. A developer running Claude Code + Codex + Cursor has no single place to see who is alive, who is blocked, or who burns tokens — they poll N terminals (`wiki/syntheses/vibe-coding-pains-2026.md:22` P1 Session islands, `wiki/syntheses/vibe-coding-pains-2026.md:46` P7 Orchestration overhead). The daemon and `mcp-bridge` already track sessions (`entities/daemon`, `entities/mcp-bridge` — 35 tools), and `wiki/agent-channel.md` is the manual workaround. Wave-2 deferred mission control as the A-cluster flagship's operator surface (`wiki/syntheses/next-wave-2-ideas-2026-08-06.md:54` A5), but no `mega sessions live` or GUI live panel ships the presence + status + burn contract.

## Goal

1. `mega sessions live [--json]` renders a **live presence table**: every daemon-known session in this workspace — `liveSessionId`, `agent` (claude/codex/cursor/generic), `cwd` (short), `branch`, `task`, `status` (working/blocked/done), `lastSeenAt`, `tokenBurn` (7d rolled from `stats`), and `claimWarnings` (soft file/scope conflicts from the claim registry when available).
2. GUI `Sessions` panel mirrors the same table live (poll 5s, no websocket in v1) — presence, status color, burn sparkline, claim warning badge.
3. Both surfaces are **read-only, advisory, and collapse to empty gracefully**: no daemon? → `no live sessions`. No stats? → `burn: n/a`. No claim registry? → `warnings: 0`. Never throws.

Success criteria: two concurrent sessions (`daemon register` + `mcp-bridge` heartbeat) appear in `mega sessions live` within one poll interval; `blocked` status derived from hook telemetry (no heartbeat > 2m); `--json` validates strict; `pnpm verify` green.

## Non-Goals (YAGNI)

- No session control (no kill, no send, no broadcast) — visibility only; A1 Session Bus owns messaging.
- No cross-workspace or remote aggregation (same `workspaceKey` only).
- No new persistence — daemon's `live-sessions.json` + `stats` token ledger + optional claim registry are the only sources (reuse, don't duplicate).
- No websocket push in v1 (polling keeps the daemon stateless and testable).
- No LLM summary of sessions (counters + states only).

## Locked Decisions

1. **Daemon is the source of truth; CLI/GUI are renderers.** `mega sessions live` reads `daemon.liveSessionsPath` (`packages/daemon/src/store.ts:liveSessions`) — same JSON the daemon's launchd heartbeat writes. CLI never starts the daemon; if the file is absent or stale (>5m), render `no live sessions` with hint `run mega daemon start`. Pattern mirrors `mega doctor`'s advisory read of `stats` (`apps/cli/src/commands/doctor/index.ts`).
2. **Status is derived, not declared.** `working` = heartbeat < 60s, `blocked` = 60s–5m with last hook event `blocked`/`needs-input`, `done` = explicit `session done` marker or heartbeat stale >5m but log shows exit 0. No agent is required to declare status — hook telemetry + heartbeat age is the signal. This keeps the core agent-agnostic (`concepts/agent-agnostic-core`).
3. **Token burn is a read-only join to `@megasaver/stats`.** `burn = sum(SessionTokenSaverStats.savedTokens)` over 7d window for that `liveSessionId`'s `workspaceKey`. If `stats` is absent, cell shows `n/a` and JSON carries `burn: null` — same fail-open as `mega preflight` no-git path (`docs/superpowers/specs/2026-08-11-workspace-preflight-diff-design.md:71`).
4. **Claim warnings are optional, count-only.** If the optional `@megasaver/daemon` claim registry (`claims.json`) exists, count overlapping `scope` entries for that `liveSessionId` vs. peers and show `warnings: N`. No path contents, no file names expanded in the table — detail is behind `mega sessions claims --json` (follow-up). This preserves the A2 Claim registry seam without coupling v1 to its schema.
5. **Polling, not push.** GUI polls `GET /api/sessions/live` every 5s (visibility API, no auth). Endpoint reads the same daemon file + stats join as CLI. No SSE, no websocket — keeps the daemon's contract HTTP-agnostic and the test harness synchronous (see `apps/gui/test/sessions-live.test.tsx` pattern in `apps/gui/src/commands/gui`).
6. **Pure renderers, strict schemas.** `packages/daemon/src/live-table.ts` exports `buildLiveTable(input: {sessions, stats, claims?}): LiveTable` (pure, ≤ 250 LOC). `liveTableSchema` (Zod `strict()`) validates both CLI `--json` and GUI API response — same dual-validation as `yieldAuditReportSchema` in wave-4 1/3.

## Architecture

```
mega sessions live [--json]
  resolveLiveSessionsPath(home) -> daemonStorePath
  readLiveSessions(path) -> RawSessions | null (Zod strict, null on missing/stale)
  readStatsBurn({workspaceKey, window:7d}) -> Map<liveSessionId, burn>
  readClaimCounts({workspaceKey}) -> Map<liveSessionId, warningCount> (optional)
  buildLiveTable({sessions, stats, claims}) -> LiveTable (pure)
  render: human table (default) | --json single object

GET /api/sessions/live  (GUI)
  same readLiveSessions + stats join + buildLiveTable
  returns {liveTable} JSON (strict), 200 on empty, 500 only on store corruption
```

## Components

- **C1 `packages/daemon/src/live-table.ts` (pure):** `liveTableSchema`, `buildLiveTable`, `deriveStatus(heartbeatAt, lastHookEvent)`, `shortCwd(cwd)`. No I/O.
- **C2 `apps/cli/src/sessions/live.ts` (io-injected):** `runSessionsLive(input: {home, json?, stdout, stderr}) => 0|1` — reads daemon file, stats, optional claims, calls `buildLiveTable`, renders.
- **C3 `apps/cli/src/commands/sessions/index.ts`:** citty `sessions live` command registration.
- **C4 `apps/cli/src/main.ts`:** register `sessions` parent.
- **C5 `apps/gui/src/app/api/sessions/live/route.ts` + `apps/gui/src/components/SessionsLivePanel.tsx`:** Next.js route + React panel (poll 5s via `useEffect` + `setInterval`, table with status color + burn sparkline placeholder + claim badge; no websocket).

## Error handling

- Daemon file missing/stale → table `no live sessions` exit 0 with stderr hint, JSON `{liveTable:{sessions:[], warnings:["daemon not running"]}}`.
- Stats missing/unreadable → burn cells `n/a`, `warnings` includes `"stats unavailable"`, never exit 1.
- Malformed daemon JSON → `buildLiveTable` validates strict, unknown keys rejected, that file is treated as missing (advisory, not crash).
- `workspaceKey` with no live sessions → empty table exit 0.

## Security & privacy

- Cwd shown is last-two-segments only (`shortCwd`) + redacted via `redact()` — full paths never hit stdout/JSON `cwdShort`.
- No secret paths, no file contents, no branch diff.
- GUI route is localhost-only (`apps/gui` already binds 127.0.0.1); no auth, no CORS.

## Testing

- **Unit (TDD, pure):** `buildLiveTable` cases: two sessions → sorted by `lastSeenAt` desc; heartbeat age maps to working/blocked/done; `shortCwd("/a/b/c/d")` → `"c/d"`; burn null → `n/a`; claim count 2 → badge 2; strict schema rejects extra key.
- **Integration (CLI):** seeded tmp daemon file (`live-sessions.json` with 2 sessions, one blocked) + tmp stats ledger → `runSessionsLive --json` parses, `status: blocked` present, `burn` numeric, `--json` idempotent.
- **Integration (GUI):** `GET /api/sessions/live` with seeded daemon/stats → 200, body validates `liveTableSchema`, polling hook called at 5s interval (vitest fake timers).
- **Regression:** existing `daemon` heartbeat + `stats` tests green.

## Risk & process

**MEDIUM** — read-only join over daemon + stats, no hook mutation, no delete, no network. Work in worktree; `code-reviewer` only per `docs/conventions/risk-modes.md:MEDIUM`. `pnpm verify` + CLI smoke (`seed daemon file → mega sessions live --json` parses) required.

## Dependencies / build order

- Builds on shipped: `packages/daemon` live-sessions store, `@megasaver/stats` token ledger, `findProjectByCwd`/`encodeWorkspaceKey` (for workspace scoping).
- Owned by this pair: `liveTableSchema` + `buildLiveTable`.
- Consumers: GUI live panel, future A1 Session Bus messaging (needs presence). Build order **2 of 3 (wave-4 batch)** — shares pure-core pattern with 1/3, no dependency on 1/3.

## Open questions

1. Should `blocked` derive from hook `blocked` event or heartbeat silence alone? (v1: both — hook signal preferred, silence fallback.)
2. Should GUI use websocket in v2 for sub-second latency? (v1: no — poll keeps parity with CLI and avoids daemon coupling.)
