# Generated-File Fence

The Generated-File Fence protects generated artifacts, lockfiles, build outputs, and vendored code from accidental agent edits by deriving and enforcing a committed, reviewable `fence.yaml` specification.

## Core Premise

Agents should not edit generated files directly. Instead of stripping generated files or hardcoding file patterns across tools, Mega Saver uses five repository signals to derive a committed `fence.yaml` and compiles enforcement into each agent's native dialect.

## `fence.yaml` Schema & Contract

- `version: 1`: schema version.
- `allow`: list of glob patterns exempt from fence enforcement (max 256 entries).
- `entries`: list of fence entries (max 512 entries), sorted by `path`:
  - `path`: glob pattern (max 256 chars, no bracket expressions).
  - `class`: one of `lockfile`, `build-output`, `codegen-header`, `linguist-generated`, `vendored`.
  - `reason`: derivation explanation (e.g. `derived: lockfile basename`).
  - `mode`: optional `warn` (default) or `deny`.
  - `alternative`: optional guidance for the alternative workflow.

## Signal Derivation (`mega fence init`)

Derivation inspects 5 repository signals in deterministic order:
1. **Lockfiles**: known package manager lockfiles (`pnpm-lock.yaml`, `package-lock.json`, `bun.lock`, `Cargo.lock`, `go.sum`, etc.).
2. **Build Outputs**: common build directories on disk (`dist`, `build`, `out`, `.next`, `coverage`, etc.).
3. **Codegen Headers**: tracked files starting with `@generated`, `DO NOT EDIT`, or `AUTO-GENERATED FILE` in their first 2 KiB.
4. **Gitattributes**: `.gitattributes` lines marked with `linguist-generated` or `linguist-generated=true`.
5. **Vendored Dirs**: vendor directories on disk (`vendor`, `third_party`).

Additive derivation: running `mega fence init --write` on an existing `fence.yaml` appends new signals without altering existing entries, user comments, or formatting.

## Dialects

1. **Claude Code Hook**: Piggybacks on `PreToolUse` edit guard (`guard-run.ts`). Emits `additionalContext` warning (warn mode) or verified `permissionDecision: "deny"` with override advice (deny mode).
2. **Flat-File Agents**: Injects a `<!-- MEGA SAVER:FENCE BEGIN -->` sentinel block via `mega connector sync` into agent markdown files (e.g., `AGENTS.md`, `.cursor/rules/megasaver.mdc`).
3. **CI / Generic CLI**: `mega fence check <path> [--json]` returns exit code 0 (allowed) or exit code 1 (fenced).

## Firewall Ledger Integration

Every warn or deny event records a value-free audit row in the firewall events ledger (`events.jsonl`):
- `kind`: `"fence-warn"` or `"fence-deny"`.
- `detector`: `"fence:<class>"`.
- `sourcePath`: relative file path.
- No file contents or diffs are ever recorded in the ledger.

## CLI Commands

- `mega fence init [--write]`: derive fence rules from repo signals.
- `mega fence allow <path>`: add a path or glob pattern to the allow list.
- `mega fence status`: display fence status, total rules, and breakdown by class.
- `mega fence check <path> [--json]`: evaluate a path against fence rules and exit with appropriate status.

## Named Gaps

- **Bash file writes**: indirect file modifications via `echo "x" > file` in Bash commands are not intercepted (Edit/Write tool invocations only).
- **Bracket expressions**: `[a-z]` patterns in `.gitattributes` are skipped and reported rather than mis-fenced.
