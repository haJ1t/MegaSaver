---
title: Auto agent workdir (remove manual workdir selection)
status: approved
risk: HIGH
created: 2026-06-22
sign-off: user approved 2026-06-22 (leave role.defaultWorkdir; add bridge guard)
sources:
  - docs/superpowers/specs/2026-06-22-agent-office-design.md
---

# Auto agent workdir

## Problem

An office agent's `workdir` is a manual user input today:

- CLI `mega office agent create` requires a `--workdir` flag.
- The GUI add-agent form has a free-text "Workdir (optional)" `<input>`.

`agent.workdir` is passed straight to the launcher as the spawned
`claude` process `cwd`. Letting the user type an arbitrary path is both
friction and a security surface: an agent could be pointed at any
directory regardless of the workspace it belongs to. The user wants the
workdir to be the project directory automatically, with no manual
selection.

There is also a latent inconsistency: the GUI labels the field
"(optional)" and the client type marks `workdir?` optional, but the
bridge `agentCreateInputSchema` and `officeAgentSchema` both require a
non-empty `workdir` — an empty submission would 400.

## Key facts

- `Workspace.label === cwd` (the project directory absolute path) and
  `Workspace.key === encodeWorkspaceKey(cwd)`. `encodeWorkspaceKey` is a
  one-way 64-bit FNV-1a hash — the key cannot be reversed to a path.
- The CLI `agent create` handler already has `input.cwd` (the directory
  the user invoked `mega` from) — that *is* the project directory, and
  `wk` is already computed as `encodeWorkspaceKey(input.cwd)`.
- The GUI `AgentOfficeView` already holds the selected workspace's
  `label` (= the project path); it just never forwards it to the form.

## Design

Workdir becomes **derived, never chosen**.

1. **CLI** `office agent create`: remove the `--workdir` arg; set
   `workdir: input.cwd`. The workspace the agent lands in
   (`encodeWorkspaceKey(input.cwd)`) and its workdir now share one
   source, the invocation cwd.

2. **GUI `AgentBoard`**: remove the `addWorkdir` state and the
   "Workdir" `<input>`. Accept the project path as a new `workdir`
   prop and send it in the create payload.

3. **GUI `AgentOfficeView`**: look up the selected workspace's `label`
   and pass it to `AgentBoard` as `workdir`.

4. **Bridge `handleCreateAgent`** (hardening): after schema parse,
   assert `encodeWorkspaceKey(parsed.data.workdir) === wk`; otherwise
   respond `400 validation_failed`. This enforces the invariant
   "workdir is the workspace's project directory" at the API boundary
   now that no UI lets the user diverge from it. The GUI's auto-filled
   label satisfies it by construction.

`CreateAgentInput.workdir` (office-client) stays optional — it is a thin
transport wrapper and `AgentBoard` always supplies the value. The bridge
`agentCreateInputSchema` and `officeAgentSchema` keep `workdir` required —
no schema change.

## Out of scope

- `role.defaultWorkdir`: a separate, currently **dead** field (stored on
  roles, never read as an agent-workdir fallback) with its own role
  manager input + `role create --workdir` flag. The user scoped this to
  *agent* workdir, so it is left untouched. Flagged as a follow-up.

## Testing (TDD)

- CLI: `agent create` with no `--workdir` produces an agent whose
  `workdir === input.cwd`; the `--workdir` arg no longer exists.
- Bridge: `handleCreateAgent` rejects a workdir that does not hash to
  the path param `wk` with `400 validation_failed`; accepts a matching
  one and stores it.
- GUI: the add-agent form renders no workdir field and `createAgent` is
  called with `workdir` set to the selected workspace's label.

## Risk

HIGH — `workdir` feeds the launcher `cwd` and the change removes a
public CLI flag. Worktree isolation, full TDD, `pnpm verify`, and both
`code-reviewer` and `critic` passes before merge.
