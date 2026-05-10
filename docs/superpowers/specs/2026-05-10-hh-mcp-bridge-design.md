---
title: HH — mcp-bridge scaffolding (placeholder spec)
risk: LOW
status: design
created: 2026-05-10
updated: 2026-05-10
related:
  - packages/mcp-bridge/
  - docs/superpowers/specs/2026-05-10-hh-skill-packs-design.md
  - docs/superpowers/plans/2026-05-10-hh-mcp-skillpacks.md
---

# HH — `@megasaver/mcp-bridge` scaffolding (placeholder spec)

## §0 TL;DR

`mcp-bridge` is the v0.3+ subsystem that exposes Mega Saver's
session and memory state to Model Context Protocol (MCP) -aware
clients (Claude Desktop, MCP-compatible IDEs, third-party
agents). v0.3 ships a **scaffold-only placeholder**: workspace
slot reserved, public surface API locked, all entrypoints throw
`not_implemented`. Real protocol implementation defers to a
follow-up spec.

This document locks the **shape** of the package so future
implementation work can land incrementally without rewriting
callers.

## §1 Motivation

The original `fikri.txt` calls out an MCP server as one of the
six subsystems of Mega Saver. v0.2 shipped the connector
matrix (`claude-code`, `codex`, `cursor`, `aider`) — files
written into the user's repo. MCP is the **inverse** direction:
agents talk to Mega Saver over a wire protocol and pull
contextops state on demand.

Reserving the package slot in v0.3 means:

- `@megasaver/mcp-bridge` is mentioned in `CLAUDE.md §2` repo
  layout but currently absent from `pnpm-workspace.yaml`. HH
  closes the gap: real package, real exports, no real
  implementation.
- Future implementers (and the architect agent) have a stable
  import path and factory signature to integrate against — no
  guessing.
- Spec gaps (transport, auth, lifecycle, error taxonomy) are
  surfaced **now**, not after a half-baked PR lands.

## §2 Public surface (v0.3 placeholder)

Single factory + typed config. No singletons, no globals.

```ts
import { createBridge, type McpBridgeConfig } from "@megasaver/mcp-bridge";

const bridge = createBridge({
  transport: "stdio",
  // ... future config
});

await bridge.start(); // throws McpBridgeError("not_implemented", ...)
await bridge.stop();  // throws McpBridgeError("not_implemented", ...)
```

### §2a Closed enums (compile-time pinned)

Two closed-enum surfaces ship in v0.3:

1. **`McpTransport`** — wire transport. v0.3 members:
   `stdio | sse`. Tuple order: launch-order (stdio first because
   it is the MCP reference transport).
2. **`McpBridgeErrorCode`** — structured error code. v0.3 sole
   member: `not_implemented`. Future members append in
   alphabetical order; tuple-ordering pin asserts the canonical
   sequence in `.test-d.ts` from day one (AA3 convention).

Both schemas live in `packages/mcp-bridge/src/` and re-export
from `index.ts`. `.test-d.ts` regression suites parallel
`packages/shared/test/agent-id.test-d.ts`.

### §2b `createBridge(config)` contract

- Synchronous; no IO at construction time.
- Returns `{ readonly transport: McpTransport; start(): Promise<void>; stop(): Promise<void> }`.
- `config.transport` is required; validated via Zod at the
  factory boundary (CLAUDE.md §8 boundary rule).
- `start()` and `stop()` **always throw** `McpBridgeError("not_implemented", ...)`
  in v0.3 — no half-implementation, no fallback (CLAUDE.md §13).

### §2c `McpBridgeError` shape

Mirrors `CorePersistenceError` in `packages/core/src/errors.ts`:

```ts
export class McpBridgeError extends Error {
  readonly code: McpBridgeErrorCode;
  constructor(code: McpBridgeErrorCode, message: string, options?: { cause?: unknown });
}
```

`name` is `"McpBridgeError"`. `code` is parsed through
`mcpBridgeErrorCodeSchema` at construction time (defensive parity
with core errors).

## §3 Protocol surface (future scope)

Out of v0.3, but locked here so implementers do not redesign:

| MCP primitive | Mega Saver mapping | Notes |
|---|---|---|
| `tools/list` | session + memory mutators (`session.create`, `session.end`, `memory.create`) | CLI-equivalent verbs; arg schemas reuse `@megasaver/core` Zod definitions. |
| `tools/call` | invoke the named tool with validated args | Errors surface as `McpBridgeError` with `code` mapped from `CoreRegistryError`. |
| `resources/list` | every `Project`, open `Session`, recent `MemoryEntry` | Resource URIs follow `mega://project/<id>`, `mega://session/<id>`, `mega://memory/<id>`. |
| `resources/read` | return the JSON-serialized entity | Read-only; mutation goes through `tools/call`. |
| `prompts/list` | reserved; deferred | Possible v0.4 surface for project-specific prompt templates. |

Resource URI scheme: `mega://<entity-kind>/<id>`. Closed-enum on
the entity-kind segment (`project | session | memory`) is the
**third** future closed-enum surface (lands with real
implementation).

## §4 Auth model (future scope)

v0.3 placeholder ships with no auth. Real implementation must
decide:

- **stdio transport**: trust the launching process (parent
  process == authenticated client). MCP reference convention.
- **sse transport**: HTTP-level bearer token; rotated per
  session; stored alongside the JSON store under a
  `mcp-bridge/` subdir or in OS keychain (deferred decision).
- Per-project ACL: out of scope; v0.4+.

Auth failures surface as `McpBridgeError("auth_failed", ...)`
(future enum member).

## §5 Transport (future scope)

- **stdio** (v0.4 first target): JSON-RPC over stdin/stdout;
  one bridge per launching client. Matches MCP reference
  servers (`@modelcontextprotocol/server-*`).
- **sse** (v0.4+): HTTP server with Server-Sent Events for
  notifications; long-poll or websocket TBD. Multi-client.
- Both transports share the same tool/resource registry; only
  the wire format differs.

## §6 Lifecycle (future scope)

```
createBridge(config) → idle
  .start() → starting → running
  .stop()  → stopping → stopped
  fatal    → errored (terminal; new bridge required)
```

States are not exposed in v0.3 — `start()` and `stop()` throw
before any transition. Real implementation must:

- Be idempotent (`start()` after `running` no-ops; `stop()`
  after `stopped` no-ops).
- Surface fatal errors via `McpBridgeError("transport_failed", ...)`
  with `cause` set to the underlying error.

## §7 Error taxonomy

v0.3 codes (one member, alphabetic):

- `not_implemented`

Reserved future codes (NOT in v0.3 schema, listed for
forward-compat):

- `auth_failed` — bearer token reject (sse only).
- `transport_closed` — peer closed the connection.
- `transport_failed` — IO error on the wire.
- `tool_not_found` — unknown tool name in `tools/call`.
- `tool_invocation_failed` — tool raised; cause set to inner error.
- `resource_not_found` — unknown resource URI.

When real implementation lands, the schema widens and the
tuple-ordering pin is updated (single source of truth — same
convention as `agentIdSchema`).

## §8 Out of scope (v0.3 placeholder)

- Any actual MCP server logic, wire protocol code, JSON-RPC
  parsing.
- Tool / resource registries.
- Auth, transport, lifecycle state machines.
- Concurrency model.
- Resource subscription / notification.
- Cross-platform launcher scripts.

All of the above land in their own spec/plan cycle. This spec
exists to lock the package shape only.

## §9 Files (v0.3 placeholder)

```
packages/mcp-bridge/
├─ package.json
├─ tsconfig.json
├─ tsconfig.test.json
├─ tsconfig.test-d.json
├─ tsup.config.ts
├─ vitest.config.ts
├─ src/
│  ├─ index.ts              # public surface re-exports
│  ├─ bridge.ts             # createBridge factory
│  ├─ errors.ts             # McpBridgeError + code schema
│  └─ transport.ts          # McpTransport schema + type
└─ test/
   ├─ bridge.test.ts        # smoke + not_implemented assertions
   ├─ errors.test-d.ts      # McpBridgeErrorCode tuple-ordering pin
   └─ transport.test-d.ts   # McpTransport tuple-ordering pin
```

LOC budget: ≤ 80 lines per source file (placeholders are
trivial; §8 300-line threshold has plenty of headroom).

## §10 Acceptance criteria

- `pnpm --filter @megasaver/mcp-bridge build` succeeds; emits
  `dist/index.{js,d.ts}` with the public surface.
- `pnpm --filter @megasaver/mcp-bridge test` is green; smoke
  test imports `createBridge`, calls `start()`, asserts it
  rejects with a `McpBridgeError` whose `code === "not_implemented"`.
- `.test-d.ts` files prove tuple-ordering for both closed
  enums (`McpTransport`, `McpBridgeErrorCode`).
- `pnpm lint` green (biome strict).
- `pnpm typecheck` green (project-references; strict ESM).
- `pnpm verify` from worktree root passes.
- Wiki entry appended to `wiki/log.md` and slot referenced
  in `wiki/index.md` § "Entities".

## §11 References

- **HH plan** — `docs/superpowers/plans/2026-05-10-hh-mcp-skillpacks.md`.
- **HH skill-packs spec** — `docs/superpowers/specs/2026-05-10-hh-skill-packs-design.md`.
- **CLAUDE.md §2** — repo layout (mcp-bridge slot named).
- **CLAUDE.md §8** — Zod-at-boundary rule.
- **CLAUDE.md §13** — no half-implementations (justifies
  hard `not_implemented` throw).
- **AA3 convention** — schema tuple-ordering pin
  (`packages/shared/test/agent-id.test-d.ts`).
- **MCP spec** — Model Context Protocol reference
  (`modelcontextprotocol.io`); read by the implementer when the
  real package lands.
