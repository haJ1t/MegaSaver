---
title: --json flag for mega project list + project create
date: 2026-05-10
risk: MEDIUM
status: approved
---

# --json flag for `mega project list` + `mega project create`

## Problem

`mega project list` and `mega project create` emit line-oriented
human-readable text. Scripting and piping require machine-readable
output. No `--json` flag exists today.

## Decisions

**D1 — Compact 1-line JSON (no pretty-print).**
`JSON.stringify(value)` with no spacing argument. Matches CLI
tradition for piping (`jq`, `grep`, scripts). Consumers use `jq .`
for pretty-printing.

**D2 — All Project fields (no curation).**
Schema: `{ id, name, rootPath, createdAt, updatedAt }` — the full
`Project` type from `@megasaver/core`. No secondary schema to
maintain; downstream tooling picks what it needs.

**D3 — Same describe blocks for new tests (Q3).**
New tests slot into existing `projectListCommand` /
`projectCreateCommand` describe blocks. Existing fixtures
(`beforeEach`/`afterEach` with temp store and console spies) are
reused directly.

**D4 — Empty-store divergence is intentional and documented.**
`mega project list` (no flag): prints nothing (empty stdout) on
empty store.
`mega project list --json`: prints `[]` on empty store.
This is NOT a violation of "default behavior unchanged" — `--json`
explicitly opts into JSON mode, and `JSON.parse("")` would fail.
The empty-store `[]` is the correct JSON consumer contract.

**D5 — `--json` is a boolean Citty arg, default `false`.**
Absent from both commands today. Added to both `projectListCommand`
and `projectCreateCommand` args as `{ type: "boolean", default: false }`.
The `json` field is threaded through `RunProjectListInput` and
`RunProjectCreateInput` as `json?: boolean`.

**D6 — `--json` does NOT affect error output.**
Errors always go to stderr as plain text regardless of `--json`.
The flag only changes the success stdout path.

## Behavior contract

### `mega project list`

| Condition | stdout | exit |
|---|---|---|
| no flag, empty store | (nothing) | 0 |
| no flag, N projects | `<id>  <name>` lines | 0 |
| `--json`, empty store | `[]` | 0 |
| `--json`, N projects | `[{"id":...},...]` compact | 0 |

### `mega project create <name>`

| Condition | stdout | exit |
|---|---|---|
| no flag | `<id>  <name>` | 0 |
| `--json` | `{"id":...,"name":...,"rootPath":...,"createdAt":...,"updatedAt":...}` | 0 |
| `--json` + `--root` | same JSON with resolved rootPath | 0 |
| error (any) | (nothing on stdout) | 1 |

## Files changed

- `apps/cli/src/commands/project.ts` — add `json?` to both input
  types and both run functions; add `json` arg to both Citty commands.
- `apps/cli/test/project.test.ts` — add JSON output tests within
  existing describe blocks.

## Definition of Done

- `mega project list --json` on empty store emits `[]`.
- `mega project list --json` on N projects emits compact JSON array
  with all 5 Project fields.
- `mega project create demo --json` emits compact JSON object with
  all 5 fields.
- `mega project create demo --root /tmp/x --json` reflects resolved
  rootPath in JSON output.
- Default (no `--json`) behavior byte-identical for both commands
  (existing tests stay green without modification).
- `pnpm verify` GREEN.
- No changeset needed (no public package API changed; apps/cli is
  `private: true`).
