# GUI Hot Handoff & Warm Start Expansion — Design Spec (Phase 2)

- **Date:** 2026-07-31
- **Status:** proposed
- **Risk:** MEDIUM (GUI bridge routes + handoff packet handling + React UI integration). Worktree, TDD, `code-reviewer` pass, `pnpm verify` DoD.
- **Goal:** Expose Hot Handoff (Agent Passport) and Warm Start capabilities in `@megasaver/gui` so developers can pack, inspect, apply, and clear inter-agent handoff packets and view warm start briefs from the web shell.

---

## 1. Problem

MegaSaver supports Hot Handoff (`mega handoff pack / open / inspect / clear`) and Warm Start (`mega warmup`) via CLI, allowing seamless mid-session task transfer across agents (Claude Code, Cursor, Codex, Aider, Windsurf). However, `@megasaver/gui` has no UI for creating or inspecting handoff packets or viewing warm start briefs.

---

## 2. Architecture & Bridge Routes

### 2.1 New Bridge Routes (`apps/gui/bridge/routes/handoff.ts` & `warmup.ts`)

1. **`POST /api/handoff/pack`**
   - Receives JSON `{ workspaceKey, targetAgent, dryRun? }`.
   - Calls `packHandoff` from `@megasaver/core`.
   - Returns handoff packet manifest, findings count, and brief summary.

2. **`POST /api/handoff/open`**
   - Receives JSON `{ workspaceKey, packetPath, mergeMemories? }`.
   - Calls `openHandoff` from `@megasaver/core`.
   - Applies the handoff block to target agent config file.

3. **`GET /api/handoff/inspect`**
   - Query param `?path=<packetPath>`.
   - Calls `inspectHandoff` from `@megasaver/core`.
   - Returns payload findings and secret-path filtering results.

4. **`DELETE /api/handoff/clear`**
   - Query param `?workspaceKey=<wk>&targetAgent=<agent>`.
   - Removes the `HANDOFF` block from target agent config.

5. **`GET /api/claude-sessions/:dir/:id/warmup`**
   - Generates and returns the Warm Start brief summary for the session's workspace.

---

## 3. UI Component Enhancements (`apps/gui/src/`)

### 3.1 `HandoffCard` Component
A new component in `WorkspacePage` / `SessionsPage` header allowing developers to:
- Select target agent (`cursor`, `codex`, `aider`, `windsurf`, `continue`, `gemini`).
- Click "Pack Handoff" to generate a `.megahandoff` packet.
- Inspect redaction findings before applying.
- Clear active handoff block with one click.

### 3.2 `WarmStartPanel` Component
A new panel in `WorkspacePage` showing the Warm Start brief (project rules, recent failures, key recallable memories) for instant developer review.

---

## 4. Testing & Verification

- **Bridge Route Unit Tests**: Tests in `apps/gui/test/bridge/handoff-route.test.ts`.
- **React Component Tests**: Tests in `apps/gui/test/components/handoff-card.test.tsx`.
- **DoD Verification**: `pnpm verify` clean.
