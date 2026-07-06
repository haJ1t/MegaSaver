---
title: mega init — one-command onboarding (the "first 5 minutes")
date: 2026-07-06
status: proposed
risk: MEDIUM
scope: a mega init command orchestrating hooks + mcp + workspace-saver-enable + mega gui
base: main (223fa0a8)
reviewers: [code-reviewer, critic]
---

# mega init

## Motivation (GTM Faz 0 — close the funnel)

Onboarding today is multi-step (install hook, install mcp, enable the saver, run
the GUI) — each a drop-off point. `mega init` collapses it to one command so a
new user reaches first visible saving in minutes.

## Locked decisions (user-approved 2026-07-06)

1. **Default saver mode: `balanced`** — trustworthy first impression (evidence-
   preserving promise); `--mode safe|balanced|aggressive` overrides.
2. **Flow: auto + summary; `--yes` silent.** Show what it will do → run the steps →
   print a per-step summary + next steps. One confirm in an interactive TTY; `--yes`
   (or non-TTY) proceeds without prompting. `--no-gui` skips opening the dashboard.

## Design

### `runInit(input): Promise<0 | 1>` — `apps/cli/src/commands/init.ts`

Input: `{ storeRoot, cwd, mode='balanced', yes=false, openGui=true, deps }` where
`deps` inject the four orchestrated fns + a prompt + stdout (for testability).

Sequence (each step best-effort, continue-and-report):
1. **Hooks** — `runHooksInstall({ ... })` (saver + intent + telemetry PostToolUse/
   UserPromptSubmit hooks into the Claude Code settings).
2. **MCP bridge** — `runMcpInstall({ target: 'claude-code', ... })`.
3. **Saver enable (workspace)** — the workspace-level token-saver enable for `cwd`
   with `mode` (the fn `mega session saver workspace enable` wraps; wire the real
   exported fn).
4. **GUI** — if `openGui`, `runGui({ open: true, ... })` (prints the tokenized URL +
   opens the browser). Skipped by `--no-gui`.

Flow control:
- Print a 4-line "here's what I'll set up" plan first.
- Interactive TTY (`process.stdout.isTTY`) && `!yes` → confirm (y/N); `--yes` or
  non-TTY → proceed. Injected prompt so tests don't touch a real TTY.
- Run steps 1-3 in order; collect each result (`installed` | `already` | `failed`
  with the reason). A failed step does NOT abort the rest (the user still gets
  what worked). Step 4 (GUI) runs last (it blocks on the server; so with
  `openGui`, print the summary BEFORE starting the GUI, or run GUI detached — see
  Non-goals).
- Exit `1` if any of steps 1-3 failed; else `0`.

Output: a compact summary — `✓ hooks installed`, `✓ mcp bridge (claude-code)`,
`✓ saver on (balanced)`, then `Next: use Claude Code as usual, then open the
dashboard with 'mega gui'.` (or the live URL if GUI was opened).

Registration: `mega init [--mode <m>] [--yes] [--no-gui] [--store <dir>]` in
`main.ts` subCommands.

### Idempotency

Each underlying command already checks existing state (re-install is safe). `init`
surfaces "already configured" per step, never errors on a second run.

## Non-goals (deferred)

- **GUI daemonization**: `runGui` runs foreground (blocks). For `mega init` with
  `--gui` (default), print the full summary FIRST, then hand off to the GUI
  (foreground) as the terminal state — the user Ctrl-Cs the GUI when done. Do NOT
  build detached/background GUI supervision here.
- Multi-agent targets (only claude-code); project scaffolding; a TUI wizard; undo/
  `mega reset`.

## Testing (TDD)

- **runInit** with injected deps (each orchestrated fn a spy):
  - Happy path (`yes:true`) → calls hooks, mcp(target claude-code), saver-enable
    (mode balanced), then gui; returns 0; summary lists all ✓.
  - `--mode aggressive` → saver-enable receives `aggressive`.
  - `--no-gui` (`openGui:false`) → gui NOT called; still returns 0.
  - A failing step (e.g. mcp returns 1) → the other steps still run, the summary
    marks it failed, exit is 1.
  - Interactive + declined prompt → nothing runs, exit 0 (user aborted).
  - `--yes` / non-TTY → no prompt.
- `pnpm verify` green; a real smoke: `mega init --yes --no-gui --store <tmp>` in a
  scratch env sets up the hooks + mcp + saver and prints the summary.

## Slices

- **A**: `runInit` + the command + registration + tests (single slice — it is
  orchestration of already-tested commands).
