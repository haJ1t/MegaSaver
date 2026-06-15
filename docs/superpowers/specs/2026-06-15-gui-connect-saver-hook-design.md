---
topic: gui-connect-saver-hook
date: 2026-06-15
status: approved
risk: MEDIUM-HIGH
risk-rationale: >
  Mutates a global user file (~/.claude/settings.json). The install path
  already ships and is idempotent; the NEW uninstall path must surgically
  remove ONLY Mega Saver hook entries and preserve every unrelated hook and
  settings key. Pure-function TDD + critic review required for the
  settings-mutation logic; worktree-isolated (no main edits).
reviewers: [code-reviewer, critic]
---

# GUI "Connect Saver hook" toggle

## Problem

Saver Mode only compresses tool output if the Claude Code **PostToolUse**
hook (`mega hooks saver`) is installed in `~/.claude/settings.json`. Today
that install is **terminal-only** (`mega hooks install claude-code`). The GUI
can enable saver per workspace (`SaverModeActivation` →
`POST /token-saver/workspace`), but if the global hook is not connected, that
enablement does nothing — the hook never fires. There is no in-app way to
connect (or disconnect) the hook, and no way to see whether it is connected.

## Goal

A toggle in the Token saver panel that **connects/disconnects the global
Claude Code Mega Saver hooks in the background**, reflects the current
connected state, and is honestly labeled as global.

- **On** → install PreToolUse `mega hooks log` + PostToolUse `mega hooks saver`
  (parity with `mega hooks install claude-code`).
- **Off** → remove **only** those two Mega Saver entries; preserve all other
  hooks and settings keys. Confirmation required (global side effect).

### Non-goals

- No per-session hook binding (Claude Code hooks are global; this is
  framed/labeled as global).
- No change to the existing per-workspace Saver Mode enable/disable toggle
  (`SaverModeActivation`) — it stays the runtime gate that decides *where*
  compression runs. The two are orthogonal and both shown in the panel.
- No MCP-bridge install changes (separate concern, separate badge).

## Scope decisions (locked)

1. Toggle installs the **global** hook from the GUI (the missing capability).
2. Scope framed honestly as global ("applies to all Claude Code sessions").
3. Full on/off toggle: **off = uninstall** (new removal logic).
4. Connect installs **both** hooks (telemetry pre-hook + saver post-hook),
   matching the CLI.
5. Toggle lives **inside the Token saver panel**, next to Saver Mode.
6. Include a symmetric CLI **`mega hooks uninstall claude-code`** for parity
   with the existing `install` command (and a clean tested surface).

## Architecture

Single source of truth for the hook-settings logic moves into the Claude Code
connector package so both the CLI command and the GUI bridge consume it
(`apps/gui` cannot import from `apps/cli` — §8 package-boundary rule).

### 1. `@megasaver/connector-claude-code` — new `hook-settings.ts`

Move the existing pure functions out of `apps/cli/src/commands/hooks/install.ts`
into the package, and add the removal/status counterparts.

Moved (unchanged behaviour):
- `HOOK_MATCHER`, `DEFAULT_HOOK_COMMAND`, `SAVER_HOOK_COMMAND`, `SAVER_HOOK_MATCHER`
- `hasPreToolUseHook`, `addPreToolUseHook`, `hasPostToolUseHook`, `addPostToolUseHook`
- `installClaudeCodeHook({ settingsPath, command? })`
- `resolveClaudeCodeSettingsPath(env?)`

Added:
- `removePreToolUseHook(settings, command): SettingsObject` — drops only the
  hook **entries whose `hooks[].command === command`**; keeps every other
  PreToolUse entry. If a `PreToolUse` array becomes empty, remove the key; if
  `hooks` becomes empty, remove it. Never touches unrelated keys.
- `removePostToolUseHook(settings, command): SettingsObject` — same, for
  PostToolUse.
- `uninstallClaudeCodeHook({ settingsPath, command? }): { settingsPath, changed }`
  — read → remove both Mega Saver entries → write (pretty JSON + trailing
  newline, matching install). Missing file ⇒ `changed: false`. Preserves all
  unrelated content.
- `readClaudeCodeHookStatus({ settingsPath, command? }): { connected, preInstalled, postInstalled }`
  where `connected = preInstalled && postInstalled`. Missing/malformed file ⇒
  all `false` (never throws).

`command` defaults to `DEFAULT_HOOK_COMMAND` for the Pre hook;
`SAVER_HOOK_COMMAND` is the constant Post command (same convention as
`installClaudeCodeHook`).

### 2. `apps/cli/src/commands/hooks/`

- `install.ts`: delete the moved definitions; import them from
  `@megasaver/connector-claude-code`. `runHooksInstall` / `hooksInstallCommand`
  unchanged in behaviour and output.
- `settings-path.ts`: re-export `resolveClaudeCodeSettingsPath` from the
  package (keep the file as the CLI's import site to minimise churn), or import
  directly — whichever keeps the diff smallest.
- New `uninstall.ts`: `runHooksUninstall` + `hooksUninstallCommand`
  (`mega hooks uninstall claude-code [--settings] [--json]`), mirroring
  `install.ts`. Register in `hooks/index.ts`.
- Existing CLI hook tests keep passing unchanged (same behaviour, new import
  source).

### 3. `apps/gui` bridge

- `route-context.ts`: add `claudeSettingsPath: string` — "Absolute path to
  ~/.claude/settings.json (overridable in tests)", mirroring the existing
  `claudeProjectsDir` / `claudeSessionsMetaDir` injection comments.
- `handler.ts` (`createBridgeHandler`): resolve production
  `claudeSettingsPath = resolveClaudeCodeSettingsPath()`; allow override.
- New `routes/claude-hooks.ts` (global, not session-scoped):
  - `GET  /api/hooks/claude-code` → `{ connected, preInstalled, postInstalled }`
    via `readClaudeCodeHookStatus`.
  - `POST /api/hooks/claude-code` → `installClaudeCodeHook` → returns new status.
  - `DELETE /api/hooks/claude-code` → `uninstallClaudeCodeHook` → returns new status.
  - `dispatchClaudeHooks(ctx, method, path, onMethodNotAllowed)` matching
    `^/api/hooks/claude-code$`; method-not-allowed for anything else.
  - Errors via `handleCaughtError` (write failure ⇒ 500). Reads never throw.
- Register `dispatchClaudeHooks` in `handler.ts` alongside the other dispatchers.
- Add `@megasaver/connector-claude-code: workspace:*` to `apps/gui/package.json`.

### 4. `apps/gui/src/lib/claude-sessions-client.ts`

- `type ClaudeHookStatus = { connected: boolean; preInstalled: boolean; postInstalled: boolean }`
- `fetchClaudeHookStatus(): Promise<ClaudeHookStatus>` (GET `/api/hooks/claude-code`)
- `connectClaudeHook(): Promise<ClaudeHookStatus>` (POST)
- `disconnectClaudeHook(): Promise<ClaudeHookStatus>` (DELETE)

These take no `dir`/`id` — the hook is global. Reuse the existing
`getJson` / `mutateJson` helpers.

### 5. `apps/gui` component — `HookConnection`

New `apps/gui/src/views/cockpit/hook-connection.tsx`, mirroring
`SaverModeActivation` state shape (`status` / `state` / `error` /
`actionError` / `busy`, load-on-mount via `useCallback`+`useEffect`):

- Heading "Saver hook" + muted note: "Connecting installs the Mega Saver hooks
  into Claude Code. This applies to all Claude Code sessions on this machine."
- Checkbox: "Saver hook {connected|disconnected}", `checked = status.connected`,
  disabled while `busy`.
  - On check → `connectClaudeHook()`.
  - On uncheck → `window.confirm(...)` global-disconnect warning; if confirmed
    → `disconnectClaudeHook()`, else revert.
- `actionError` inline message on failure.
- Rendered in `token-saver-panel.tsx` above/next to `SaverModeActivation`.

## Data flow

```
HookConnection toggle
  → client (fetch/connect/disconnect)
  → GET|POST|DELETE /api/hooks/claude-code
  → connector read/install/uninstall fn
  → reads/writes ~/.claude/settings.json (ctx.claudeSettingsPath)
  → returns { connected, preInstalled, postInstalled }
  → toggle reflects state
```

## Error handling

- Malformed / missing `settings.json` on read ⇒ status all-`false`
  (`connected:false`); never throws (boundary read, §8).
- Write failure (permissions etc.) ⇒ route 500 → client throws → UI shows
  `actionError`; toggle stays at last-known state.
- Uninstall preserves every unrelated hook and settings key — verified by test.
- Install remains idempotent (re-connect = no-op `changed:false`).
- Non-blocking: this only edits settings; it never touches a running agent.

## Testing

**connector-claude-code (pure, primary safety surface):**
- install adds both Pre+Post entries; idempotent re-install ⇒ `changed:false`.
- uninstall removes both Mega Saver entries; **preserves** an unrelated
  PreToolUse/PostToolUse entry and unrelated top-level keys (e.g. `model`,
  `permissions`).
- uninstall on a file without the entries ⇒ `changed:false`, file unchanged.
- empty arrays/`hooks` cleaned up after removal.
- `readClaudeCodeHookStatus`: connected when both present; partial
  (`preInstalled` xor `postInstalled`); missing file ⇒ all false; malformed
  JSON ⇒ all false (no throw).
- round-trip: install then uninstall returns settings to original content.

**bridge route (vitest HTTP, temp `claudeSettingsPath`):**
- GET on fresh temp ⇒ `connected:false`.
- POST ⇒ 200, `connected:true`, file written with both entries.
- GET after POST ⇒ `connected:true`.
- DELETE ⇒ 200, `connected:false`, entries gone.
- method-not-allowed (e.g. PUT) ⇒ 405.

**component (RTL, mocked client):**
- renders "disconnected" then toggles to connected on check.
- disconnect path calls `window.confirm`; confirmed ⇒ `disconnectClaudeHook`;
  cancelled ⇒ no call, checkbox reverts.
- busy disables the checkbox; `actionError` renders on failure.
- global-scope label is present.

**CLI:**
- `runHooksUninstall` unit test (mirror install): removes entries at injected
  `--settings` path; unknown target ⇒ exit 1; `--json` shape.

## Definition of Done (feature-specific, per CLAUDE.md §9)

- `pnpm verify` green (lint + typecheck + all tests).
- New tests above all pass; TDD red→green evidence captured.
- Changeset added (`@megasaver/connector-claude-code` minor — new public API;
  `@megasaver/cli` patch; `@megasaver/gui` patch).
- `code-reviewer` + `critic` passes (separate contexts) — critic focused on the
  uninstall "preserve unrelated keys" guarantee.
- GUI smoke evidence: toggle connect → `~/.claude/settings.json` gains both
  entries; disconnect → entries gone, unrelated content intact.
