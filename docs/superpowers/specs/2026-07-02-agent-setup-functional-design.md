---
title: Agent Setup Functional Fix
date: 2026-07-02
risk: medium
status: draft
---

# Agent Setup Functional Fix

## Goal

Make the GUI `Agent Setup` view actually functional: installing or repairing an agent must sync the Mega Saver connector block into a real project, and the status indicator must reflect that sync.

## Current bugs

1. **Project placeholder is thrown away.** `AgentSetupDoctor` calls `installMcp`/`repairMcp` with `project: "."`. The bridge's `createMcpOps.connectorSync` looks up a project named `"."`, finds nothing, and silently skips the connector sync. After install the status still shows `connectorSynced: false` and the row stays in `Config missing` / `Repair`.
2. **Status only looks at open sessions.** `createMcpOps.connectorSyncedResolver` resolves the project root from the agent's latest *open* session. If the agent is not currently running, the resolver never finds the block even after a successful repair, so the doctor reports `Config missing` forever.
3. **Stale load responses.** `AgentSetupDoctor`'s initial status load is unguarded; a slow response can overwrite newer state if the component re-renders or the user triggers an action before the first load finishes.

## Proposed changes

1. Expose the persisted project list via a new `GET /api/projects` bridge route (optional `registry` injection; safe when absent).
2. Add `fetchProjects()` to the GUI API client.
3. Update `AgentSetupDoctor`:
   - Load projects alongside agents.
   - Auto-select the only project; show a `<select>` when there are multiple.
   - Disable install/repair until a project is selected; show a "create a project first" notice when the list is empty.
   - Pass the selected project name to `installMcp`/`repairMcp` instead of `"."`.
   - Guard the status fetch with a request-id / unmount flag.
4. Update `createMcpOps`:
   - `connectorSyncedResolver` checks **all** projects for the connector block, so the global doctor reflects whether the block exists anywhere.
   - `connectorSync` keeps using the caller-supplied project name (now a real name from the GUI).
5. Update unit + bridge tests to cover project selection, empty-project state, and the guarded load.

## Out of scope

- New visual design or styling beyond the existing Tailwind primitives.
- CLI behavior changes.
- Making `/api/projects` writable or adding project creation in the GUI.

## Verification

- `pnpm --filter @megasaver/gui test`
- `pnpm --filter @megasaver/gui typecheck`
- `pnpm exec biome check apps/gui/src apps/gui/test apps/gui/bridge`
- `pnpm --filter @megasaver/cli test test/e2e/v1-closeout-flow.test.ts`
- Manual bridge smoke: pick a project in Agent Setup, click Set up / Repair, verify status flips to Ready.
