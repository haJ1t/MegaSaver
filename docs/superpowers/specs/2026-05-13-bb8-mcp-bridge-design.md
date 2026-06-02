---
title: BB8 — @megasaver/mcp-bridge real implementation + `mega mcp` CLI
status: proposed
risk: CRITICAL
created: 2026-05-13
updated: 2026-05-13
revision: 2  # critic pass — F1 (orchestrator union), F2/F3/F4/F6 (McpSetupOps facade + GUI wiring)
parent-epic: docs/superpowers/specs/2026-05-10-aa1-context-gate-epic.md
parent-sections: "§1 (F-MAJ-10), §2c, §5c, §6c, §8, §9, §10, §11, §12, §13, §14 (BB8), §16, §17"
hh-placeholder: docs/superpowers/specs/2026-05-10-hh-mcp-bridge-design.md
consumes-from: docs/superpowers/plans/2026-05-13-bb7b-output-exec-plan.md  # runOutputExecCommand union (F1)
consumed-by: docs/superpowers/specs/2026-05-13-bb11-gui-doctor-design.md  # McpSetupOps facade (F2/F3)
---

# BB8 — MCP bridge real implementation + `mega mcp` CLI (child spec)

> Child spec of the AA1 Context Gate epic. This document restates
> BB8's risk level (**CRITICAL** per AA1 §15 and `CLAUDE.md` §12)
> and locks the BB8 surface against the epic's authoritative
> contracts. Locked contracts are cited verbatim from AA1 by
> section; **this spec does not redesign them**. Where AA1 is the
> source of truth (the 16-member `McpBridgeErrorCode` tuple, the
> 4-member `McpToolName` tuple, the `mega_run_command` flow, the
> `createBridge` preservation rule) the citation is the lock.

## §1 Problem

The v0.3 placeholder bridge (`packages/mcp-bridge/src/bridge.ts:17–38`)
returns `Promise.reject(new McpBridgeError("not_implemented", …))`
from both `start()` and `stop()`. AA1 §2c locks the disposition:
**extend, do not redesign** — preserve the `createBridge(config)`
factory and the `McpBridge` public type, replace the reject-stubs
with a real MCP server over `stdio`, widen `McpBridgeErrorCode`
from one member to sixteen (AA1 §8b), and add a closed
`McpToolName` enum (AA1 §8a). BB8 also adds the `mega mcp
{install,repair,status,uninstall}` CLI (AA1 §5c) so a user can
register the bridge into an agent's config idempotently, and the
**`McpSetupOps` facade** (§3g) that both the CLI and the GUI
AgentSetupDoctor drive — BB8 wires the production facade into the
GUI bridge (F3), delivering the AA1 §1 F-MAJ-10 "Click Enable →
Done" promise once BB11's routes land on top of it.

BB8 is **CRITICAL** because the `mega_run_command` tool exposes
arbitrary command execution over the MCP wire — the wire-protocol
layer over the BB7b spawn surface (AA1 §15 row BB8, §8d). It
inherits the full CRITICAL chain: `tracer` + `security-reviewer`
+ manual user confirmation (AA1 §16); NO `autopilot`/`ralph`/
unsupervised loops; NO log compression (the paradox guard — Mega
Saver Mode cannot be enabled on the session developing it, also
enforced by the `recursive_megasaver` env-marker gate, AA1 §15).

## §2 Dependency reality (read before planning)

- **BB7b not yet in `feat/bb7-orchestrator-extract` (#75).** That
  branch ships BB7a only: `packages/core/src/context-gate/{run,
  read,fetch-chunk,locate-chunk-set,types}.ts` plus the
  `context-gate.ts` barrel. `run.ts` exports `runOutputPipeline`
  (a no-spawn **file**-read orchestrator). AA1 §8d / §14 BB7b
  place the spawn orchestrator in
  `packages/core/src/context-gate/run-command.ts`, which **does
  not exist yet**. BB8 `mega_run_command` calls that BB7b
  orchestrator (AA1 §8d: "one orchestrator, two entry points
  (CLI + MCP)"). **BB8 MUST NOT land before BB7b merges** (AA1
  §14 BB8 "Depends on: …, BB7a, BB7b"). The authoritative export
  is **`runOutputExecCommand`** with result union
  `RunOutputExecCommandResult` (`bb7b-output-exec-plan.md` Task 1):
  `{ ok: true; result: ExecResult }` | `{ ok: false; reason:
  "session_not_found" }` | `{ ok: false; reason: "command_denied";
  code: PolicyDenyCode }` | `{ ok: false; reason: "command_failed";
  detail: string }` | `{ ok: false; reason: "store_write_failed";
  detail: string }`. **`command_denied` carries `code` (the
  `PolicyDenyCode`), NOT `detail`; failures surface as
  `command_failed`; there is NO `redaction_failed` outcome**
  (redaction is internal to `filterOutput`, AA1 §8d step 6). The
  `mega_run_command` adapter binds to this exact union; if BB7b
  lands a different shape, the adapter import + its `switch` are
  the single edit point.
- **`@modelcontextprotocol/sdk` is absent** from every
  `package.json` and from `pnpm-lock.yaml` (verified). BB8 adds
  it as a new dependency of `@megasaver/mcp-bridge`. AA1 §8c and
  HH §5 fix the transport (`stdio` JSON-RPC over stdin/stdout,
  "matches MCP reference servers `@modelcontextprotocol/server-*`").
- **Dep packages exist** (`@megasaver/{policy,content-store,
  output-filter,retrieval,stats,core}`). BB8 imports them through
  `@megasaver/core` (the orchestrator) and directly for the
  read-only tools (content-store for `mega_fetch_chunk`).

## §3 Locked surface (cite AA1; do NOT redesign)

### §3a `createBridge` API preservation (AA1 §2c)

Preserved verbatim per AA1 §2c:

- `createBridge(config: McpBridgeConfig): McpBridge` is the only
  entry point.
- `McpBridge.transport: McpTransport` stays `readonly`;
  `start()` / `stop()` stay `Promise<void>`.
- `McpTransport = ["stdio", "sse"]` stays launch-order (AA1 §17,
  `transport.ts:6`). `stdio` implements; `sse` factory rejects
  with `transport_failed` (AA1 §8c table).

What changes (AA1 §2c): the config gains **optional** DI slots
`registry` and `policy` (no breaking change — the v0.3 placeholder
rejected `start()`, so nothing depended on real behaviour). The
two reject-stubs become a real stdio server lifecycle. The
internal tool registry is MCP-protocol-visible, **not**
TypeScript-visible (AA1 §2c: "tools are MCP-protocol-visible, not
TypeScript-visible"). The placeholder `bridge.test.ts` and
`errors.test-d.ts` are replaced end-to-end (AA1 §2c, §8b).

### §3b `McpToolName` — 4 members, alphabetic (AA1 §8a, §17)

```ts
export const mcpToolNameSchema = z.enum([
  "mega_fetch_chunk",
  "mega_read_file",
  "mega_recall",
  "mega_run_command",
]);
```

Pin file: `packages/mcp-bridge/test/tool-name.test-d.ts` (AA1
§8a, §17 — pattern source `transport.test-d.ts:29–32`).

### §3c `McpBridgeErrorCode` — exactly 16 members, alphabetic (AA1 §8b, §17)

Copied verbatim from AA1 §8b (cardinality stated as 16 at AA1
§8b "Tuple cardinality: 16 members" and §17 row "16 members"):

```ts
export const mcpBridgeErrorCodeSchema = z.enum([
  "auth_failed",
  "command_denied",
  "content_store_miss",
  "intent_required",
  "max_bytes_exceeded",
  "path_denied",
  "policy_load_failed",
  "redaction_failed",
  "resource_not_found",
  "session_not_found",
  "store_write_failed",
  "tool_invocation_failed",
  "tool_not_found",
  "transport_closed",
  "transport_failed",
  "validation_failed",
]);
```

The v0.3 `not_implemented` member is **removed**, not aliased
(AA1 §8b, `CLAUDE.md` §13 — no pre-1.0 shims). `resource_not_found`
is re-added per F-MAJ-9 (HH §7 reserved it). `path_denied` added
per F-CRIT-2. Pin file `packages/mcp-bridge/test/errors.test-d.ts`
is **rewritten** to assert this 16-tuple in alphabetic order (AA1
§8b, §17). **AA1 §8b is complete and internally consistent — no
gap to fill; the 16 members enumerated in the body match the
rationale list one-to-one and the §17 cardinality.**

### §3d Tool input→output contracts (AA1 §8a table, §8d)

`maxBytes` default = session `tokenSaver.maxReturnedBytes` else
`modeToBudget(mode)`; explicit `maxBytes` MUST NOT exceed `2 *
modeToBudget("safe")` = 64_000, else `max_bytes_exceeded` (AA1
§8a, §8b).

| Tool | Input (Zod) | Output | Hits (AA1 §8a) |
|------|-------------|--------|----------------|
| `mega_fetch_chunk` | `{ chunkSetId, chunkId, around?: number }` | `{ chunkSetId, chunkId, chunk }` | content-store `loadChunkSet` + slice (via core `fetchChunk`) |
| `mega_read_file` | `{ path, intent, sessionId, maxBytes? }` | `FilterOutputResult` | `evaluatePathRead` → `resolveSafeReadPath` → `readFile` → `filterOutput` → store (via core `runOutputPipeline`) |
| `mega_recall` | `{ sessionId, intent, maxBytes? }` | `{ memory[], chunkSets[] }` | `registry.listMemoryEntries` + `listChunkSets` |
| `mega_run_command` | `{ command, args, intent, sessionId, maxBytes? }` | `ExecResult` (`FilterOutputResult & { childExitCode; terminated? }`) | `evaluateCommand` (env marker) → spawn (env marker) → `redact` → `filterOutput` → store + stats (via BB7b `runOutputExecCommand`) |

`mega_read_file` path-gate order is strict (AA1 §8a Revision-2
note): (1) `policy.evaluatePathRead` → `path_denied` on deny;
(2) `outputFilter.resolveSafeReadPath` → `validation_failed` on
throw; both before `readFile`. Both gates are already composed in
BB7a `run.ts` `runTwoGates`; `mega_read_file` reuses
`runOutputPipeline` rather than re-composing.

`mega_run_command` flow is AA1 §8d steps 1–10 verbatim,
including step 3 env-marker (`MEGASAVER_ORIGIN_PID`): root bridge
sets `originPid = process.pid` when the env var is absent;
inherits it when present. `evaluateCommand` denies with
`recursive_megasaver` when `originPid !== String(process.pid)`
and `originPid` is non-empty (AA1 §9a env-marker semantics). The
spawn ENV sets `MEGASAVER_ORIGIN_PID: originPid` (AA1 §8d step 5).

### §3e Error mapping at the tool boundary

Orchestrator result discriminants map to `McpBridgeErrorCode`
(AA1 §8b). Source unions: BB7a `RunOutputResult` (read-file) and
BB7b `RunOutputExecCommandResult` (run-command, §2). **F1: the
run-command union has `command_denied{code}` (not `detail`) and
`command_failed` — there is NO `redaction_failed` outcome.**

| Orchestrator reason | `McpBridgeErrorCode` |
|---------------------|----------------------|
| `session_not_found` | `session_not_found` |
| `path_denied` (read-file) | `path_denied` |
| `path_unsafe` / sandbox throw / Zod arg parse | `validation_failed` |
| `file_read_failed` (read-file) | `tool_invocation_failed` (cause set) |
| `command_denied` (run-command; `outcome.code: PolicyDenyCode`, incl. `recursive_megasaver`) | `command_denied` (wire `details.reason: code`) |
| `command_failed` (run-command spawn error / non-zero surfaced) | `tool_invocation_failed` (cause set) |
| content-store miss (`mega_fetch_chunk`) | `content_store_miss` |
| `store_write_failed` (run-command store/stats write) | `store_write_failed` |
| `maxBytes > 64_000` | `max_bytes_exceeded` |
| missing `intent` (pre-IO) | `intent_required` |
| unknown tool name in `tools/call` | `tool_not_found` |
| any uncaught handler throw | `tool_invocation_failed` (cause set) |

The `redaction_failed` and `policy_load_failed` enum members
(§3c) remain reserved in the closed enum (AA1 §8b) — the BB7b
orchestrator does not surface a `redaction_failed` outcome (redact
is internal to `filterOutput`), so no BB8 branch emits it; it is a
defensive slot per AA1 §8b. `command_denied` carries
`details.reason` = the BB7b `outcome.code` (`PolicyDenyCode`) on
the wire (AA1 §8b, §8d step 4). `recursive_megasaver` is one such
code — the acceptance criterion "recursive `mega_run_command` →
`command_denied: recursive_megasaver`" (AA1 §14 BB8) is satisfied
by the wire payload `{ code: "command_denied", details: { reason:
"recursive_megasaver" } }`, surfaced in the text channel as
`command_denied: recursive_megasaver`.

### §3f `mega mcp` subcommands (AA1 §5c)

```
mega mcp install   --target <agent-id> [--json]
mega mcp repair    --target <agent-id> [--json]
mega mcp status                         [--json]
mega mcp uninstall --target <agent-id> [--json]
```

- `<agent-id>` validated against `KnownTargetId`
  (`apps/cli/src/known-targets.ts`); invalid → `unknown_target`
  (mirror `invalidTargetMessage`, AA1 §5c).
- `install` writes the agent's MCP config snippet idempotently
  (atomic write, mirror `connectors/shared/filesystem.ts`
  `writeTargetFile` + AA1 §5c → `json-directory-store.ts:235–286`
  pattern). Re-running install is a no-op when the snippet is
  already present.
- `repair` = `install` + `connector sync --target <id>` for the
  same agent (AA1 §5c: "one call, two effects").
- `status` reports per-agent `mcpInstalled`, `connectorSynced`,
  `restartRequired` (AA1 §5c) — produced by the **shared**
  `aggregateMcpStatus` (§3g) so CLI and GUI agree (F4).
- `uninstall` removes the MCP entry without touching the connector
  block (AA1 §5c).
- `--json` parity on every subcommand; run-function shape mirrors
  `connector/sync.ts` (`cwd`/`home`/`xdgDataHome`/`stdout`/
  `stderr`/`json`, exit `0|1`, `mapErrorToCliMessage`).

The plan's `mega doctor` is NOT a BB8 deliverable (AA1 §5c —
`apps/cli/src/commands/doctor.ts` remains doctor's home).

### §3g `McpSetupOps` facade + shared status (F2/F4/F6/F3 — BB8-owned)

**Locked by the parent (critic F2/F4/F6/F3).** BB11
(`bb11-gui-doctor-design.md` §3) consumes a high-level facade and
a per-agent status snapshot; BB8 OWNS both. BB8 also wires the
production facade into the GUI bridge (F3) so the AgentSetupDoctor
works end-to-end (AA1 §1 F-MAJ-10).

```ts
// packages/mcp-bridge/src/setup/setup-ops.ts (BB8)
export interface McpSetupOps {
  status(): Promise<McpStatusResult>;
  install(target: KnownAgentId, project: string): Promise<McpStatusResult>;
  repair(target: KnownAgentId, project: string): Promise<McpStatusResult>;
  uninstall(target: KnownAgentId): Promise<McpStatusResult>;
}

// packages/mcp-bridge/src/setup/status.ts (BB8)
export type McpAgentStatus = {
  target: KnownAgentId;        // == agentId for all four known targets
  agentId: AgentId;
  mcpInstalled: boolean;
  connectorSynced: boolean;    // F4: connector-block presence check
  restartRequired: boolean;
  restartHint: string;         // F6: per-agent wording; BB8-owned
};
export type McpStatusResult = { agents: readonly McpAgentStatus[] };
```

- **F2 facade.** `buildMcpSetupOps(deps)` builds on the Task-7
  primitives (`installMcp`/`uninstallMcp`/`isMcpInstalled`).
  Every op returns a fresh post-op `McpStatusResult` (LL
  re-fetch-on-mutation; AA1 §1 non-goal "real-time push"). The
  `connectorSynced` block-presence check and the `repair`
  connector-sync side effect are **injected** (DI per AA1 §2c) so
  mcp-bridge imports neither the CLI nor `connectors-shared`
  (dependency arrow, AA1 §3).
- **F4 `connectorSynced`.** `aggregateMcpStatus` is the SINGLE
  source feeding both `mega mcp status` (CLI resolver over
  `parseBlock`) and the GUI bridge — they cannot drift. The field
  reflects whether the agent's connector file carries the Mega
  Saver block written by `connector sync`.
- **F6 `restartHint`.** BB8 returns a per-agent hint;
  `claude-code` and `cursor` use the confident strings from
  `bb11-gui-doctor-design.md` §3a; `codex`/`aider` use the generic
  `"Restart <agent> to load the Mega Saver MCP server."` with an
  execution-time-confirm NOTE (mechanics unverified — both this
  spec and BB11 §3a are updated together when confirmed). BB11
  **surfaces** the hint; it never hard-codes one. This unblocks
  BB11 regardless of the codex/aider wording.
- **F3 GUI production wiring.** BB8 wires `buildMcpSetupOps(...)`
  into `apps/gui/bridge/server.ts`'s `createBridgeHandler` as the
  default `mcpOps`, threaded to handlers via the `RouteContext`
  slot. BB11's mcp-setup routes read `RouteContext.mcpOps`; there
  is no permanent BB11 stub (`bb11-gui-doctor-design.md` §3).

## §4 Alternatives considered

- **Hand-roll JSON-RPC over stdin/stdout — REJECTED.** HH §5 and
  AA1 §8c point at the MCP reference SDK. Hand-rolling the
  protocol framing is a half-implementation surface
  (`CLAUDE.md` §13) and re-derives wire details the SDK owns.
  Use `@modelcontextprotocol/sdk` `Server` + `StdioServerTransport`.
- **Re-implement spawn inside the bridge — REJECTED.** AA1 §8d
  locks "one orchestrator, two entry points". The bridge
  `mega_run_command` tool is a thin adapter over the BB7b
  `runOutputExecCommand` orchestrator; duplicating spawn+policy in
  the bridge would fork the re-entry detection (F-CRIT-3) and the
  redaction invariant (F-MAJ-3).
- **Expose tools as TypeScript types on `McpBridge` — REJECTED.**
  AA1 §2c: tools are MCP-protocol-visible, not TS-visible. The
  public `McpBridge` type is unchanged.
- **Keep `not_implemented` as a forwarding alias — REJECTED.**
  AA1 §8b, `CLAUDE.md` §13 (no pre-1.0 shims). Removed outright.
- **Single shared bridge daemon — REJECTED (deferred).** AA1
  §20d: each agent launches its own bridge process; `sse` (v0.6+)
  is the multi-client transport. BB8 ships per-launch stdio only.

## §5 Risk & mitigations (CRITICAL — AA1 §15, §16; `CLAUDE.md` §12)

- **Arbitrary command execution over the wire.** Mitigated by
  the BB7b policy gate (`evaluateCommand` — ALLOWED_COMMANDS +
  DANGEROUS_PATTERNS, AA1 §9b/§9c) reached **before** spawn, and
  by the `recursive_megasaver` env-marker gate (AA1 §8d, §9a).
  The bridge never spawns directly; it calls the orchestrator.
- **Recursive self-invocation** (`mega_run_command -- mega output
  exec …`). Mitigated by `MEGASAVER_ORIGIN_PID` propagation (AA1
  §8d steps 3+5). Acceptance test asserts inherited marker →
  `command_denied: recursive_megasaver`.
- **Unredacted secrets persisted.** The orchestrator runs
  `policy.redact` before `saveChunkSet` (AA1 §8d step 6, §10d
  redaction invariant). The bridge does not bypass it.
- **Path traversal / symlink escape via `mega_read_file`.**
  Two-gate composition (AA1 §8a) reused from BB7a `runTwoGates`.
- **CRITICAL process chain (AA1 §16):** `tracer` enumerates spawn-
  path hypotheses; `security-reviewer` produces a PR-comment
  sign-off; the child-process whitelist verification (the exact
  `command` strings that reached `spawn()` in integration) is
  attached. Manual user confirmation by replying **`confirm BB8
  merge`** verbatim (AA1 §16) to a message linking (1) verifier
  evidence bundle, (2) security-reviewer report, (3) tracer
  hypotheses, (4) whitelist verification. NO `autopilot`/`ralph`.

## §6 Definition of Done (gates BB8 against AA1 §14 BB8 + `CLAUDE.md` §9)

1. SPEC (this file) + PLAN (`…/plans/2026-05-13-bb8-mcp-bridge-plan.md`)
   exist.
2. `pnpm verify` green (lint + typecheck + test).
3. **`McpToolName` 4-member pin** lands at
   `packages/mcp-bridge/test/tool-name.test-d.ts`; **rewritten
   `McpBridgeErrorCode` 16-member pin** at `…/test/errors.test-d.ts`;
   both assert alphabetic tuple order.
4. `createBridge` API preserved (transport readonly, start/stop
   `Promise<void>`, factory signature) — regression test.
5. Four tools dispatch over real stdio; unknown tool →
   `tool_not_found`.
6. **e2e acceptance (AA1 §14 BB8):** claude-code → stdio → bridge
   → `mega_run_command` returns a filtered response; policy-denied
   command → `command_denied`; recursive `mega_run_command`
   (inherited `MEGASAVER_ORIGIN_PID`) → `command_denied:
   recursive_megasaver`; unknown tool → `tool_not_found`.
7. `mega mcp install/repair/status/uninstall` end-to-end, `--json`
   parity, idempotent install; `mega mcp status` emits per-agent
   `connectorSynced` (F4); `apps/cli/test/json-failure-paths.test.ts`
   extended.
8. **`McpSetupOps` facade exported** (`buildMcpSetupOps` +
   `McpStatusResult`/`McpAgentStatus` with `connectorSynced` +
   `restartHint`); CLI `status` and the facade share
   `aggregateMcpStatus` (F2/F4/F6).
9. **GUI production wiring (F3):** `buildMcpSetupOps(...)` wired
   into `apps/gui/bridge/server.ts` `createBridgeHandler` as the
   default `mcpOps`; `RouteContext` carries the slot for BB11.
10. New dependency `@modelcontextprotocol/sdk` declared; GUI gains
    `@megasaver/mcp-bridge` + `@megasaver/connectors-shared` deps;
    changeset added covering mcp-bridge + cli + gui (public
    surface changed — `CLAUDE.md` §9.9).
11. CRITICAL chain: `tracer` + `security-reviewer` + verifier
    evidence; **manual `confirm BB8 merge`** (AA1 §16); author ≠
    reviewer (three distinct session UUIDs recorded, AA1 §16).
12. Zero pending TodoWrite items.

## §7 References

- AA1 epic — `docs/superpowers/specs/2026-05-10-aa1-context-gate-epic.md`
  (§2c, §5c, §8a/b/c/d, §9, §10, §11, §12, §13, §14 BB8, §15,
  §16, §17).
- HH placeholder — `docs/superpowers/specs/2026-05-10-hh-mcp-bridge-design.md`
  (§5 transport, §7 reserved codes incl. `resource_not_found`).
- **BB7b plan (authoritative orchestrator union, F1)** —
  `docs/superpowers/plans/2026-05-13-bb7b-output-exec-plan.md`
  Task 1 (`runOutputExecCommand` + `RunOutputExecCommandResult`).
- **BB11 spec (facade consumer, F2/F3)** —
  `docs/superpowers/specs/2026-05-13-bb11-gui-doctor-design.md`
  §3 (`McpSetupOps`/`McpAgentStatus`, `restartHint` §3a).
- BB7a orchestrator (in flight #75) — `packages/core/src/context-gate/{run,read}.ts`.
- CLI precedent — `apps/cli/src/commands/connector/{index,sync,status}.ts`,
  `apps/cli/src/commands/session/saver/*`,
  `apps/cli/src/commands/output/file.ts`.
- Idempotent write — `packages/connectors/shared/src/filesystem.ts`.
- Placeholders replaced — `packages/mcp-bridge/src/{bridge,errors}.ts`,
  `packages/mcp-bridge/test/{bridge.test.ts,errors.test-d.ts}`.
