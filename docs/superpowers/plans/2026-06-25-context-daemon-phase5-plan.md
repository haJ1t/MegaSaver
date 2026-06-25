# Context daemon — Phase 5 Plan: mcp-bridge tool forwarding

**Goal:** Refactor `mcp-bridge` `proxy_*` tools to forward requests to the
local daemon via `forwardOrFallback`, preserving an in-process fallback when
the daemon is unreachable.

**Spec:** `docs/superpowers/specs/2026-06-25-context-daemon-design.md` §Phasing item 5.

> **Note:** The spec lists item 5 as a single deliverable ("Refactor mcp-bridge
> tools onto daemon-client, fallback preserved"). In practice this is two
> sequential phases: (5a) unblock — env-shape extension + chunk-store split
> resolution; (5b) refactor — reintroduce `forward.ts` and wire tools. This
> plan covers the blocker analysis for 5a. Phase 5b begins only after 5a lands.

**Status: BLOCKED — do not implement until the prerequisites below are met.**

---

## Prerequisites (must land before Phase 5)

### 1. Env-shape extension (blocker)

`mcp-bridge` tools currently receive a `SessionId` (registry-keyed). The
daemon routes (`/excerpt`, `/expand`) are keyed by `workspaceKey` +
`liveSessionId` (overlay-keyed). Until each tool's env carries both overlay
keys, `forwardOrFallback` cannot build a valid daemon request body.

Required work: extend the env object passed to each `proxy_*` tool handler to
include `workspaceKey` and `liveSessionId`, sourced from the live-session
mapping that already exists in `@megasaver/context-gate`.

### 2. Chunk-store split resolution (blocker)

The registry chunk store and the overlay chunk store use different directory
layouts and schemas. The daemon's `/expand` route calls `fetchOverlayChunk`
(overlay path). MCP bridge tools that currently call `fetchChunk` (registry
path) cannot simply forward to `/expand` without either:

- Migrating their chunk sets to overlay layout, or
- Adding a second `/expand-registry` daemon route for registry-keyed sets.

This design choice must be captured in a spec update before Phase 5 begins.

### 3. Spawn cost decision (minor, capture before wiring)

`getDaemon` may spawn a new daemon process (up to 5 s wait) on a cache miss.
On a hot MCP tool path this is unacceptable. When wiring real callers, decide
explicitly:

- **Option A (recommended):** pass a ping-only `getDaemon` variant that returns
  `null` (never spawns) so a down daemon causes an immediate in-process
  fallback. Document `// ponytail: no-spawn path, falls back instantly if daemon down`.
- **Option B:** accept the spawn cost and gate it on an explicit
  `MEGA_DAEMON_FORWARD=1` env flag so it is opt-in.

**Decision (2026-06-25): Option A chosen.** The wiring phase will use a
no-spawn `getDaemon` variant that returns `null` immediately when the daemon
is unreachable, causing an in-process fallback with zero spawn latency. Option B
(env-gated spawn) is not needed — falling back in-process is the right default
on a hot MCP tool path.

---

## What was removed in review (2026-06-25)

`packages/mcp-bridge/src/tools/forward.ts` and its test
`packages/mcp-bridge/test/tools/forward.test.ts` were deleted from the Phase 5
commit because they had zero production callers and no path to wiring them
without the prerequisites above. Per repo §13 ("No half-implementations"),
speculative helpers are not merged until their callers can be wired.

The `forwardOrFallback` pattern (try daemon → fallback on any error) and its
test coverage are correct and should be re-introduced when prerequisites 1 and 2
are resolved.

---

## Implementation outline (deferred)

Once prerequisites land:

1. Add `workspaceKey` + `liveSessionId` to the mcp-bridge tool env shape.
2. Decide chunk-store path (spec update).
3. Reintroduce `forward.ts` with the spawn-cost decision applied (Option A or B).
4. Wire `forwardOrFallback` into one tool first (`proxy_run_command` — already
   has a comment noting the deferral at line 49).
5. Full TDD: red test showing forwarding, then green.
6. Roll to remaining `proxy_*` tools.
7. `pnpm verify` green + reviewer pass.
