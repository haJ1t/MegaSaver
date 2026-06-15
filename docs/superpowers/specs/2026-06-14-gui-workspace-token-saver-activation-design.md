---
title: GUI Workspace-Scoped Token Saver Activation
date: 2026-06-14
status: draft
risk: HIGH
risk_note: >
  The activation write path mutates a user repository file (<cwd>/CLAUDE.md)
  and a user MCP config (<cwd>/.mcp.json). File-mutation-at-scale is CRITICAL
  per risk-modes §12; mitigated to HIGH by routing ALL writes through the
  existing sentinel-bounded, atomic, Windows-safe connector machinery and by
  validating cwd against currently-surfaced workspaces only.
branch: worktree-feat-gui-ws-token-saver
---

# GUI Workspace-Scoped Token Saver Activation

## 1. Problem

After the live-first architecture pivot (F4/F5, PR #134), the GUI can no
longer activate "Mega Saver Mode" (token saver) for a session. Investigation
found the activation path was orphaned, not merely hidden:

- The session `token-saver` panel
  (`apps/gui/src/views/cockpit/token-saver-panel.tsx`) is a read-only
  stats/events viewer. No toggle exists. The client
  (`apps/gui/src/lib/claude-sessions-client.ts`) exposes only three GET
  functions (`status`, `stats`, `events`) — no enable/POST.
- The live bridge route
  (`apps/gui/bridge/routes/claude-session-token-saver.ts`) is GET-only
  (`method !== "GET" → onMethodNotAllowed`). Its `status` handler reads
  `enabled` from `stats/<wk>/<liveSessionId>.settings.json`, but **no code
  anywhere writes that file** — it is a display-only artifact. The route's own
  comment notes the toggle "stays on the legacy session route through F4";
  F5 then deleted the legacy/project routes.
- The only real enable path, the CLI `mega session saver enable`
  (`apps/cli/src/commands/session/saver/enable.ts`), writes via
  `registry.updateTokenSaver` into the **core registry** (keyed by a MegaSaver
  registry-session UUID), a different store and key space than the live
  cockpit's overlay.

### 1.1 Decisive runtime finding

`tokenSaver.enabled` is **not** a runtime compression gate. Compression in
`packages/output-filter` (`filterOutput`) is keyed only by `mode`/budget. The
`enabled` flag is read in exactly one place:
`packages/connectors/shared/src/context-gate-block.ts:10`, which decides
whether to render the `MEGA SAVER:CONTEXT_GATE` instruction block into a
project's `CLAUDE.md`.

The real activation chain for a Claude Code session is therefore indirect:

```
enabled = true                         (drives block rendering)
   │  mega connector sync
CONTEXT_GATE block written to <cwd>/CLAUDE.md  ("prefer proxy_* tools")
   │  Claude reads CLAUDE.md
Claude calls proxy_* MCP tools instead of native tools
   │  mcp-bridge
filterOutput compresses output (mode/budget)
```

Two architectural constraints fall out of this:

1. **Activation is inherently per-workspace (cwd), not per-session.** The lever
   is the shared `<cwd>/CLAUDE.md` block plus the per-cwd `.mcp.json`. All
   Claude sessions in a folder share them. The MCP bridge never receives a
   Claude session id per call, so per-session runtime isolation is not
   achievable in this architecture.
2. **The chain needs the connector-render + MCP-setup path** — the
   project-scoped machinery F5 removed from the GUI, here re-keyed onto the
   live workspace's cwd rather than a registry project.

## 2. Goal

Provide a workspace-scoped (cwd) Token Saver activation control in the live
GUI that genuinely turns compression on/off end-to-end for Claude sessions in
that folder, by reusing the existing, tested connector-render and MCP-setup
machinery.

### Non-goals

- Per-Claude-session activation isolation (architecturally impossible; see §1.1).
- Re-introducing the core registry or MegaSaver "projects" into the GUI.
- Changing the compression engine (`filterOutput`) or the mcp-bridge runtime.
- A new CLI surface. The existing `mega session saver *` CLI is unchanged.

## 3. Approach (Engine Option A — render-in-bridge)

Selected over (B) shell-to-`mega connector sync` and (C) registry-project-per-cwd
because A reuses the tested render + sentinel-safe upsert + filterOutput +
mcp-bridge with the smallest core surface (one additive leaf-package export)
and aligns with the live-first cwd keying.

The bridge constructs a synthetic `ConnectorContext` carrying only
`{ session: { tokenSaver: { enabled, mode, ... } } }` from cwd-keyed settings,
renders the CONTEXT_GATE block, and upserts it into `<cwd>/CLAUDE.md`. No
registry, no project.

## 4. Components

### 4.1 Store — cwd-keyed workspace settings

- Path: `<storeRoot>/stats/<wk>/workspace-token-saver.json`, where
  `wk = encodeWorkspaceKey(cwd)`.
- Shape: `{ enabled: boolean, mode: TokenSaverMode, updatedAt: string }`.
- Lives in the MegaSaver store, never in the user repo. Absent ⇒ disabled.
- Malformed ⇒ treated as disabled (never crash), matching the existing
  `readOverlaySettings` tolerance.

### 4.2 `@megasaver/connectors-shared` — additive export

- `encodeWorkspaceKey` is a one-way FNV-1a hash (`packages/shared/src/workspace-key.ts`),
  so the bridge cannot recover cwd from wk — see §5.1 for the cwd-validation guard.
- Export `upsertContextGateBlock({ existingContent, context }): string` that
  manages **only** the CONTEXT_GATE block (extract the existing internal
  `applyOptionalBlock` + `CG_SENTINELS` from `upsert.ts`). This avoids the
  current `upsertBlock`, which also (re)writes the legacy connector block we do
  not want in the GUI workspace context.
- `renderContextGateBlock` already accepts a `ConnectorContext` and reads only
  `session.tokenSaver`; the bridge builds a minimal valid context (placeholder
  identity fields where `ConnectorContextSchema` requires them, mirroring the
  AgentSetupDoctor placeholder-project pattern).
- Empty render (enabled=false) ⇒ block removed cleanly; content outside the
  sentinels is byte-preserved.

### 4.3 Bridge route — `/api/workspaces/.../token-saver`

- `GET` → `{ enabled, mode, blockPresent, mcpInstalled }`.
  - `blockPresent`: does `<cwd>/CLAUDE.md` currently contain the CG sentinel block.
  - `mcpInstalled`: does `<cwd>/.mcp.json` register the megasaver bridge (reuse
    the existing MCP-setup status read).
- `POST` `{ cwd, enabled, mode }`:
  1. Validate `cwd` (§5.1).
  2. Write `<storeRoot>/stats/<wk>/workspace-token-saver.json`.
  3. Read `<cwd>/CLAUDE.md` (or empty), `upsertContextGateBlock`, atomic
     write back (tmp + rename; reuse the Windows-safe write helper from the
     content-store / connector path, #104–#108).
  4. On enable, ensure the megasaver MCP bridge is installed in `<cwd>` by
     reusing the existing MCP-setup ops (the same ones AgentSetupDoctor calls
     via `/api/mcp/*`). On disable, leave `.mcp.json` untouched (harmless).
  5. Return the same shape as `GET`.
- Method other than GET/POST ⇒ existing `onMethodNotAllowed` (405).

### 4.4 GUI — workspace panel + session pointer

- New panel in `panel-registry.ts`:
  `{ id: "ws-token-saver", label: "Token Saver", scope: "workspace",
  component: WorkspaceTokenSaverCockpitPanel }`.
- The panel shows the toggle, a `mode` selector
  (`tokenSaverModeSchema.options`), and live status (`blockPresent`,
  `mcpInstalled`). It calls the new client functions
  `fetchWorkspaceTokenSaverStatus` / `setWorkspaceTokenSaver`.
- The existing **session** `token-saver` panel stays a read-only stats/events
  viewer, with a one-line note: activation is workspace-level — see the
  workspace "Token Saver" tab. (Copy via `design:ux-copy` if needed.)

## 5. Safety

This feature mutates user files. All mitigations are mandatory.

### 5.1 cwd validation (traversal guard)

Because `wk` is a non-reversible hash, the POST carries `cwd`. The bridge MUST
reject any `cwd` that is not in the set of **currently-surfaced workspace cwds**
(the same cwds the live `GET /api/workspaces` enumeration derives from Claude
transcripts). This makes it impossible to target an arbitrary path. A rejected
cwd ⇒ 400 `validation_failed`. Path normalization + the existing
`safeSessionPath`-style guards apply.

### 5.2 CLAUDE.md write

- Only the `MEGA_SAVER_CG_BLOCK_START/END` sentinel region is ever
  inserted/replaced/removed. Everything outside is byte-preserved (proven by
  test §6).
- Atomic write (tmp file + rename), reusing the Windows-safe pattern already in
  the connector/content-store path.
- If `<cwd>/CLAUDE.md` does not exist, enabling creates it containing only the
  block (intentional; mirrors `mega connector sync`). Documented in UX copy.

### 5.3 `.mcp.json` write

Delegated entirely to the existing MCP-setup ops (already accepted, already
mutate `.mcp.json`). No new file-mutation code.

## 6. Testing strategy (TDD, red-first)

`connectors-shared`:
- `upsertContextGateBlock` inserts the CG block when absent.
- Idempotent: applying twice yields identical output.
- Enable→disable removes the block and restores surrounding content byte-for-byte.
- Content outside the sentinels (including a pre-existing legacy block) is
  preserved untouched.
- CRLF/LF dominant-EOL preserved (Windows parity).

bridge:
- `GET` reflects written settings + computed `blockPresent`/`mcpInstalled`.
- `POST enabled=true` writes settings, inserts the block into a temp `cwd`
  CLAUDE.md, reports `mcpInstalled` after ensuring setup.
- `POST enabled=false` removes the block.
- `POST` with a cwd not in surfaced workspaces ⇒ 400 (traversal guard).
- Non-GET/POST ⇒ 405.

gui:
- Panel registry exposes `ws-token-saver` at workspace scope.
- Toggle ON calls `setWorkspaceTokenSaver({enabled:true,mode})` and renders
  status; OFF calls with `enabled:false`.
- Loading/error states (reuse `states.tsx`).

Plus `pnpm verify` green and a manual smoke: enable in the GUI for the worktree
cwd, confirm the CG block appears in that `CLAUDE.md`, disable, confirm removal.

## 7. Risk & process

- Risk: HIGH (CRITICAL surface on `CLAUDE.md` writes; see frontmatter).
- Per risk-modes §12 HIGH: full superpowers chain + `architect` design review +
  `critic` adversarial review + worktree (no `main` edits — already in
  `worktree-feat-gui-ws-token-saver`).
- Changeset required (GUI + connectors-shared public surface changes).
- Wiki: update `entities/gui`, `entities/connectors-shared`, append `log.md`.

## 8. Open questions

- Exact `ConnectorContextSchema` required fields for a token-saver-only context
  (resolved during plan: build minimal valid placeholder).
- Whether to surface a "sync now / re-apply" affordance if the user edits
  `CLAUDE.md` out from under the block (default: GET reports `blockPresent`,
  user re-toggles to re-apply).
