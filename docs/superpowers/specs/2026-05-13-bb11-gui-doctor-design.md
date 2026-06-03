---
title: BB11 — GUI AgentSetupDoctor + connector CONTEXT_GATE block
status: proposed
risk: MEDIUM
created: 2026-05-13
updated: 2026-05-13
parent-epic: ./2026-05-10-aa1-context-gate-epic.md
epic-section: §14 BB11
depends-on: BB8 (mcp setup ops), BB10 (GUI bridge wiring)
---

# BB11 — GUI AgentSetupDoctor + connector CONTEXT_GATE block

> Child spec of AA1 (epic §14 BB11). This is the **last** epic PR; it
> delivers the user-visible promise (AA1 §1 "User-promise milestone",
> F-MAJ-10): *Open GUI → Click Enable → Done* — fully deliverable here,
> because BB11 lands the agent-instruction block that BB10's enable-flow
> did not. Risk **MEDIUM** per epic §15 ("connector surface change;
> matches v0.2 connector rollout posture"). Conventions are NOT touched
> (epic §18 item 4: BB11 is additive code conforming to existing rules).

## §1 Scope (verbatim from epic §14 BB11)

**Adds:** `apps/gui/src/views/agent-setup-doctor.tsx`,
`apps/gui/src/components/agent-setup-row.tsx`,
`apps/gui/bridge/routes/mcp-setup.ts`,
`packages/connectors/shared/src/context-gate-block.ts`,
`packages/connectors/shared/test/context-gate-block.test.ts`.

**Extends:** `packages/connectors/shared/src/{constants,upsert,parse}.ts`
(parse parameterised by sentinel pair),
`apps/cli/test/connector-byte-equality.test.ts` fixtures.

**Surface added:** doctor view + 4 bridge routes per §6c (mcp half);
additive CG sentinel renderer per §7.

**Acceptance:** "Repair" on missing-config agent lands config + connector
block; restart-required text per agent surfaces; byte-equality test green
for all four enabled/disabled tokenSaver permutations.

**Depends on:** BB8 (the `mega mcp` setup ops the doctor drives), BB10
(GUI bridge dispatch + `RouteContext.storeRoot` + api-client). **Blocks:**
nothing inside the epic.

## §2 CONTEXT_GATE connector block (epic §7, plan L673–L690)

### §2a Sentinel constants (epic §7; appended to `constants.ts`)

The existing legacy pair is **untouched**. BB11 appends a second pair:

```ts
export const MEGA_SAVER_BLOCK_START = "<!-- MEGA SAVER:BEGIN -->";          // existing
export const MEGA_SAVER_BLOCK_END   = "<!-- MEGA SAVER:END -->";            // existing
export const MEGA_SAVER_CG_BLOCK_START = "<!-- MEGA SAVER:CONTEXT_GATE BEGIN -->";  // NEW
export const MEGA_SAVER_CG_BLOCK_END   = "<!-- MEGA SAVER:CONTEXT_GATE END -->";    // NEW
```

### §2b Rendered content (epic §7 "Rendered content", LOCKED — cite verbatim)

`renderContextGateBlock(context)` returns this exact text **only when**
`context.session?.tokenSaver?.enabled === true`; otherwise it returns the
empty string `""` (epic §7 "Rendering rule"). Trailing newline mirrors
`renderBlock` (epic §7; `render.ts:21–23`):

```markdown
<!-- MEGA SAVER:CONTEXT_GATE BEGIN -->
# Mega Saver Mode

Mega Saver Mode is enabled for this session.

When reading large files, running commands, or inspecting build /
test output, prefer the Mega Saver MCP tools over native ones:

- `mega_read_file(path, intent, ...)` over reading a whole file.
- `mega_run_command(command, args, intent, ...)` over `Bash`.
- `mega_fetch_chunk(chunkSetId, chunkId)` to drill into a stored
  excerpt when the summary is insufficient.
- `mega_recall(sessionId, intent)` to reload session memory and
  recent tool calls without re-reading every file.

Always pass `intent` — it drives ranking. Raw output is stored
locally; ask for it only when the filtered result is genuinely
insufficient.

Session: <session-id>
Project: <project-id>
Mode: <safe|balanced|aggressive>
Max returned bytes: <number>
<!-- MEGA SAVER:CONTEXT_GATE END -->
```

Field substitutions: `<session-id>` = `context.session.id`; `<project-id>`
= `context.project.id`; `<mode>` = `context.session.tokenSaver.mode`;
`<number>` = `context.session.tokenSaver.maxReturnedBytes`. The renderer is
**shared / agent-agnostic** (epic §7 "Which connectors write it"; CLAUDE.md
§1) — no per-agent branching.

### §2c parse parameterisation (epic §7 "Why additive", §19c — do NOT regress legacy)

`parseBlock` currently hard-codes the legacy sentinel pair (`parse.ts:17–18`).
BB11 makes the pair a parameter **without changing the legacy call site's
behaviour**:

- New signature: `parseBlock(content, sentinels?: { start: string; end: string })`.
  The `sentinels` parameter **defaults** to
  `{ start: MEGA_SAVER_BLOCK_START, end: MEGA_SAVER_BLOCK_END }`, so every
  existing caller (`upsert.ts`, `filesystem.ts`, all current tests) is
  byte-for-byte unaffected — the default reproduces today's behaviour
  exactly. This is the locked compatibility contract.
- `ParsedBlock` shape is unchanged (`{ before, block, after }`).
- `throwBlockConflict` messages are unchanged for the legacy pair.

`upsertBlock` is extended to manage **two independent blocks** in one pass
(epic §7 "Rendering rule"):
1. Upsert/remove the legacy block via the existing path (default sentinels).
2. Then upsert the CG block via the CG sentinels: if
   `renderContextGateBlock(context) === ""` (disabled / no session), the CG
   block is **removed** if present; otherwise it is upserted after the legacy
   block. The legacy block is never touched by step 2.

Ordering: legacy block first, then CG block, separated by one blank line —
matching the epic §7 illustration. Both blocks independent: either may be
absent; a file with only a legacy block (tokenSaver disabled) is byte-stable.

### §2d Byte-equality regression (epic §7 "Byte-equality guard", §19c)

`apps/cli/test/connector-byte-equality.test.ts` generates its fixtures at
runtime (seed store → `runConnectorSync` → re-apply `upsertBlock`, assert
byte-identical). BB11 parameterises the existing per-target loop over **4
tokenSaver permutations** of the seeded session:
1. `tokenSaver` absent (pre-AA session) → no CG block.
2. `tokenSaver.enabled === false` → no CG block.
3. `tokenSaver.enabled === true`, mode `balanced` → CG block present.
4. `tokenSaver.enabled === true`, mode `safe` → CG block present (different
   field values prove the substitution is deterministic and re-stable).

For each (target × permutation) the re-applied `upsertBlock` MUST be
byte-identical to the synced file. This is the acceptance gate. A new unit
file `packages/connectors/shared/test/context-gate-block.test.ts` covers the
renderer in isolation (render-when-enabled, omit-when-disabled, field
substitution, no-session → empty).

## §3 mcp-setup bridge routes (epic §6c, mcp half)

Four routes, mirroring BB10's `token-saver.ts` dispatcher style exactly
(Zod-validated body, `RouteContext`, `handleCaughtError`, `dispatchXxx`
returning `boolean`). Backed by the BB8 `McpSetupOps` facade **called
directly in-process** (NOT shelled out) per the task contract and epic §2c
(DI injection slots precedent).

**Facade ownership (parent-locked).** BB8 owns and exports the
`McpSetupOps` facade + `McpStatusResult` type, and wires
`buildMcpSetupOps(...)` into `apps/gui/bridge/server.ts`'s
`createBridgeHandler` as the **production** default `mcpOps`. BB11 is the
**consumer**: its routes accept `McpSetupOps` via the injected
`RouteContext` slot (so they are unit-testable with a fake), and re-serialise
whatever the facade returns. There is no permanent BB11 stub — once BB8 and
BB11 both land, the GUI AgentSetupDoctor works end-to-end. BB11 imports the
facade type from `@megasaver/mcp-bridge`:

```ts
// Owned + exported by BB8 (@megasaver/mcp-bridge). Cited verbatim — do not
// redefine in BB11. `target` is a KnownAgentId (PARENT AMENDMENT, post-BB8
// review): the four MCP-capable agents — claude-code/codex/cursor/aider.
// generic-cli has no MCP config slot, so AgentId would be a half-impl (§13).
// Import KnownAgentId + knownAgentIdSchema from @megasaver/mcp-bridge.
// install/repair take a project, uninstall does not; status takes no args.
export interface McpSetupOps {
  status(): Promise<McpStatusResult>;
  install(target: KnownAgentId, project: string): Promise<McpStatusResult>;
  repair(target: KnownAgentId, project: string): Promise<McpStatusResult>;
  uninstall(target: KnownAgentId): Promise<McpStatusResult>;
}
export interface McpStatusResult {
  agents: Array<{
    agentId: KnownAgentId;
    mcpInstalled: boolean;
    connectorSynced: boolean;
    restartRequired: boolean;
    restartHint: string;       // per-agent wording supplied by BB8 (§3a)
  }>;
}
```

Routes + request bodies (the `project` arg for install/repair is supplied by
the route from the GUI's active project; uninstall + status carry no project):

| Method | Path                  | Request body (zod)                      | Facade call (200 → `McpStatusResult`) |
|--------|-----------------------|-----------------------------------------|----------------------------------------|
| GET    | `/api/mcp/status`     | — (none)                                | `status()` |
| POST   | `/api/mcp/install`    | `{ target: KnownAgentId, project: string }`  | `install(target, project)` |
| POST   | `/api/mcp/repair`     | `{ target: KnownAgentId, project: string }`  | `repair(target, project)` (post-op snapshot) |
| POST   | `/api/mcp/uninstall`  | `{ target: KnownAgentId }`                   | `uninstall(target)` (post-op snapshot) |

`MEGA_MCP_TARGET_BODY = z.object({ target: knownAgentIdSchema, project: z.string().min(1) }).strict()`
for install/repair; `MEGA_MCP_UNINSTALL_BODY = z.object({ target: knownAgentIdSchema }).strict()`
for uninstall (reuses `knownAgentIdSchema` from `@megasaver/mcp-bridge`; invalid →
`validation_failed`, mirroring BB10).

The route handlers are thin wrappers over the facade; BB8 owns the
filesystem writes (atomic, epic §5c). **`repair`** = install +
`connector sync --target <id>` for that agent (epic §5c) — one facade call,
both effects; the response's `connectorSynced` flips true.

`POST` mutations re-run status after the op so the GUI gets a fresh snapshot
without a second round-trip (LL re-fetch-on-mutation pattern, epic §1
non-goal "Real-time push").

### §3a restart-required wording per agent (epic §6a doctor purpose; §5c)

**`restartHint` is owned by BB8, surfaced by BB11 (parent-locked).** BB8's
`McpStatusResult.agents[].restartHint` supplies a per-agent string; BB11
renders **whatever BB8 returns** verbatim — it does NOT hard-code any restart
strings. The doctor row (§4, agent-setup-row) shows `agent.restartHint` when
`agent.restartRequired === true`. No BB11 fallback string: if BB8 returns an
empty hint, the row simply shows the "Restart required" status without prose.

**NOTE (carried to BB8 execution):** the exact restart mechanics for `codex`
and `aider` MCP registration are confirmed at BB8 execution time (BB8 owns
the per-agent config path + launch semantics; epic §8c only asserts all four
"accept an MCP server registered with a launch command"). claude-code
(quit/reopen) and cursor (Reload Window) are well-understood; codex/aider
wording is BB8's to finalise. BB11 carries no opinion on the text.

## §4 Doctor view states (epic §6a)

`agent-setup-doctor.tsx` is a self-contained view (matches `sessions-view.tsx`
load/error/ready pattern): on mount it `fetchMcpStatus()`, renders one
`agent-setup-row.tsx` per agent. Per-row state derives from a single
`McpStatusResult.agents[]` element (typed in the api-client as
`McpAgentStatus`, structurally identical to BB8's inline agent shape):

| Derived row state          | Condition                                   | Primary action |
|----------------------------|---------------------------------------------|----------------|
| **Not installed**          | `!mcpInstalled`                             | "Set up" → POST install |
| **Config missing / drift** | `mcpInstalled && !connectorSynced`          | "Repair" → POST repair |
| **Installed (restart)**    | `mcpInstalled && connectorSynced && restartRequired` | show `restartHint`; "Re-check" → GET status |
| **Ready**                  | `mcpInstalled && connectorSynced && !restartRequired` | "Uninstall" → POST uninstall (secondary) |

The acceptance criterion ("Repair on missing-config agent lands config +
connector block") maps to: a row in **Config missing** state, after the
Repair POST, transitions to **Ready** (or **Installed (restart)**), and the
returned snapshot shows `connectorSynced === true`. After any mutation the
view re-fetches status (no optimistic state).

Loading / error / empty handled via `states.tsx` (`LoadingState`,
`ErrorState` with focus-on-error, structured `BridgeError`). Buttons follow
BB10 component conventions (accent primary, danger uninstall, focus-visible
rings, `aria-*`).

## §5 Bridge error codes (epic §6c routes follow `error-mapping.ts`)

`apps/gui/src/bridge-error-code.ts` is alphabetic + pinned by
`apps/gui/test/bridge-error-code.test-d.ts` + a COPY map. BB11 adds (in
alphabetic position, on top of BB10's `event_not_found`):

- `mcp_setup_failed` — a BB8 setup op threw (install/repair/uninstall IO
  failure). HTTP 500. COPY: "Agent setup failed. Check permissions and try
  again." Mapped in `error-mapping.ts` from the BB8 setup error type (or via
  the existing fs-ErrnoException heuristic if BB8 throws plain `Error`).

`unknown target` is **not** a new code — it surfaces as `validation_failed`
(the `agentIdSchema` body parse), matching BB10's posture for bad input. The
`.test-d.ts` pin + COPY map are updated in the same step the code is added
(epic §17 tuple-pin discipline).

## §6 Component-split / file-size budget (CLAUDE.md §8, epic §8 ≤300 LOC; OO GUI ≤200 LOC)

- `agent-setup-doctor.tsx` (view): load/fetch/dispatch + row list. Est. ~150
  LOC. **At risk of >200 LOC** if it also holds row-action handlers inline —
  PRE-BUDGETED SPLIT: row rendering + per-row action buttons live in
  `agent-setup-row.tsx` (the row owns its own action button + restartHint
  display); the view owns only the status fetch, the agents array, and the
  mutation→refetch glue. This keeps the view < 200 LOC.
- `agent-setup-row.tsx` (component): pure presentation + onAction callback.
  Est. ~90 LOC.
- `mcp-setup.ts` (bridge route): 4 handlers + dispatcher. Est. ~140 LOC,
  under the 300 cap; if it approaches 200 the per-handler bodies are already
  minimal (thin wrappers over BB8 ops) so no split needed.
- `handler.ts` must stay ≤ 200 LOC (OO precedent). BB11 adds one import +
  one `if (path.startsWith("/api/mcp"))` dispatch block (≈4 lines) — within
  budget (BB10 added the analogous token-saver block).

## §7 Nav wiring (epic §6a new view; `view-id.ts` AA3 ordering)

`VIEW_IDS` is alphabetic (`["memory", "sessions"]`). Adding the doctor →
`["agent-setup", "memory", "sessions"]` (agent-setup sorts first). `VIEW_LABELS`
gains `"agent-setup": "Agent setup"`. The `view-id.test-d.ts` pin is updated
to the new tuple. `app.tsx` renders `<AgentSetupDoctor activeProjectId={...} />`
when the view is selected.

**Project coupling (reconciled with the locked facade).** `status()` and
`uninstall(target)` are project-independent and always available.
`install(target, project)` and `repair(target, project)` DO require a
project — the connector block (CG sentinel) is written into a specific
project's agent files (epic §7). So the doctor renders and lists agents
regardless of `activeProjectId` (status always loads), but the **Set up** /
**Repair** actions require a selected project: when `activeProjectId` is
null, those actions are disabled with a hint "Pick a project to install or
repair." The app passes `activeProjectId` into the doctor; the doctor passes
it as the `project` field on the install/repair POST bodies. **Decision:**
doctor view renders independent of project selection; install/repair mutations
are gated on a selected project.

## §8 Design-skill chain (epic §6d; CLAUDE.md §5b; MEDIUM, fresh context)

Mandatory checkpoints WITHIN BB11 (not extra PRs):
1. `huashu-design` — CONCEPT exploration for the doctor view + row.
2. `taste-skill` — chosen direction → real frontend impl.
3. `impeccable` — polish pass.
4. `design:design-critique` + `design:accessibility-review` — in a
   **separate context** (CLAUDE.md §9.6 author≠reviewer), per LL precedent.

## §9 Definition of Done (CLAUDE.md §9; epic §16 MEDIUM pipeline)

MEDIUM pipeline (epic §16): brainstorming → writing-plans → TDD →
`executor` (sonnet) → `code-reviewer` (fresh context) → `verifier` (fresh
context) → merge. Specifically:

1. `pnpm verify` green (lint + typecheck + test).
2. Byte-equality test green for **all 4** enabled/disabled tokenSaver
   permutations × 4 targets (epic §14 BB11 acceptance).
3. `context-gate-block.test.ts` green (renderer isolation).
4. mcp-setup bridge route tests green (4 routes, zod-validated, error paths).
5. agent-setup-doctor + agent-setup-row component tests green (states, repair
   flow, restartHint surfaced).
6. `design:design-critique` + `design:accessibility-review` PASS in fresh
   context (epic §6d).
7. `code-reviewer` + `verifier` agent passes, distinct fresh contexts (epic
   §16 author/reviewer collision rule).
8. Changeset added (connectors-shared + gui public API changed; CLAUDE.md §9
   item 9).
9. Conventions NOT touched (epic §18 item 4) — confirm `pnpm
   conventions:check` green with no diff.

## §10 Out of scope / explicit non-goals

- The BB8 `mega mcp` CLI itself and the `setup/{install,repair,detect-agent}`
  implementations — owned by BB8 (epic §14 BB8). BB11 only consumes them.
- Real-time push to the doctor view — re-fetch on mutation only (epic §1).
- Per-project MCP ACLs / auth — v1.0 non-goal (epic §1).
- Extending `apps/cli/src/commands/doctor.ts` — that is BB8's token-saver-
  aware checks (epic §5c "BB8/BB11 extend doctor.ts"); BB11's doctor is the
  **GUI** view, not the CLI `mega doctor` tree.
