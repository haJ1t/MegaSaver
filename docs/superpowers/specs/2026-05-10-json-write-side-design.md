---
title: --json write-side flag (5 commands) — design
risk: MEDIUM
status: active
created: 2026-05-10
updated: 2026-05-10
---

# `--json` Write-Side — Design

Mirrors the read-side `--json` pattern (PRs #30, #31, #32, DD1) onto
the 5 write-mutation commands. Closes T6 (sync error line `session=`
symmetry) bundled.

## §1 Scope

5 commands gain `--json` flag (default `false`):

1. `mega session create` — emit `Session` object on success
2. `mega session end` — emit ended `Session` object on success
3. `mega session update` — emit updated `Session` object on success
4. `mega memory create` — emit `MemoryEntry` object on success
5. `mega connector sync` — emit per-target records on success
   (mirror of `connector status --json`)

## §2 Output shape

### Per-command JSON (success)

| Command | Default text | `--json` |
|---|---|---|
| `session create` | `<id>` | `{...session}` (full Session) |
| `session end` | (silent) | `{...session}` (with `endedAt`) |
| `session update` | (silent) | `{...session}` (post-patch) |
| `memory create` | `<id>` | `{...entry}` (full MemoryEntry) |
| `connector sync` | per-line `<id>  <relPath>  <status>` | `[{id, relativePath, status, session}, ...]` |

T6 (full): every `connector sync` text-mode line carries
`session=<id|none>`, matching `connector status` output exactly.
This is a byte-compat break for non-error statuses
(skipped/created/noop/wrote) vs the T6-partial baseline (PR #45).
The break is intentional: full symmetry between sync and status
text output is more valuable than preserving the old 3-column
format. JSON mode carries `session: <id|null>` on every record
(unchanged from T6-partial).

### Failure paths

All commands: text stderr, no stdout, exit 1. Mirrors read-side
policy (DD1 pinned).

## §3 Constraints

- Default behavior (no `--json`): byte-identical to current output.
- `--json` description: canonical `"Emit JSON output."` (DD1 alignment).
- Boolean flag: `default: false` explicit.
- Failure-path tests: `--json` failure emits text stderr, not JSON envelope.

## §4 Tests

Per command:
- Citty-wrapper drift guard (extends DD1's `apps/cli/test/project/list.test.ts`).
- Default text output unchanged (regression).
- `--json` success shape pinned.
- `--json` failure path: text stderr, no stdout, exit 1.
- T6 sync error line: text-mode `error` line carries `session=...`.

## §5 Out of scope

- `mega doctor --json` (read-side; deferred).
- `mega project create --json` (already shipped via DD1).
- Structured error envelope JSON (text-stderr policy preserved).
