---
title: "--json output for memory list + memory show"
date: 2026-05-10
status: approved
risk: MEDIUM
author: project-root
---

# `--json` Output for `mega memory list` + `mega memory show`

## Problem

`mega memory list` and `mega memory show` emit human-readable text only. Scripts and pipelines that consume memory entries must parse line-oriented text with fixed-width columns and truncated content. No machine-readable output path exists.

## Goal

Add an optional `--json` flag to both commands. When provided, emit compact single-line JSON. When omitted, behavior is byte-identical to current.

## Behavior Contract

### `memory list`

| Mode | Output |
|---|---|
| default (no `--json`) | one `<id>  <scope>  <session\|->  <truncated-content>` line per entry (unchanged) |
| `--json`, populated | single line: JSON array of full entry objects |
| `--json`, empty project | single line: `[]` |

**Important divergence from text mode:** text mode emits nothing (empty stdout) for an empty project. `--json` mode emits `[]`. This is intentional — JSON consumers expect a valid array, not empty stdout. Tests must pin BOTH behaviors explicitly.

### `memory show`

| Mode | Output |
|---|---|
| default (no `--json`) | 6 aligned `key=value` lines (unchanged) |
| `--json` | single line: JSON object of the entry |

### JSON schema (per entry)

```json
{
  "id": "<uuid>",
  "projectId": "<uuid>",
  "scope": "project" | "session",
  "sessionId": "<uuid>" | null,
  "content": "<full untruncated string>",
  "createdAt": "<ISO 8601>"
}
```

- `sessionId` is `null` when `scope = "project"` (JSON-native, schema-native — not `"-"` or absent).
- `content` is FULL, not truncated to 60 chars (text-mode truncation is a display-layer concern).
- Output is compact (`JSON.stringify(...)`, no pretty-print).
- stderr (init notice) unchanged in both modes.

## Design Decisions

### Q1: Full content in `--json` ✓
Text truncation is presentation-layer. JSON consumers need raw data.

### Q2: Flat shape matching registry schema ✓
`{id, projectId, scope, sessionId, content, createdAt}` — no nesting, no renaming.

### Q3: `null` for sessionId when scope=project ✓
JSON-native and schema-native. The text-mode `"-"` is a display convention, not a data value.

### Boolean flag type
`--json` is a boolean Citty arg (`type: "boolean"`), not a string. Absence → `false` (default), presence → `true`.

## Affected Files

- `apps/cli/src/commands/memory/list.ts` — add `jsonFlag: boolean` to `RunMemoryListInput`; conditional output path in `runMemoryList`; add `json` boolean arg to `memoryListCommand`.
- `apps/cli/src/commands/memory/show.ts` — add `jsonFlag: boolean` to `RunMemoryShowInput`; conditional output path in `runMemoryShow`; add `json` boolean arg to `memoryShowCommand`.
- `apps/cli/test/memory.test.ts` — add tests for both commands.

**No other files touched.**

## Interface Changes

### `RunMemoryListInput`

Add: `jsonFlag: boolean`

When `true`, collect all entries and emit `input.stdout(JSON.stringify(entries))` instead of per-line `formatMemoryListLine`. Empty → `input.stdout("[]")`.

### `RunMemoryShowInput`

Add: `jsonFlag: boolean`

When `true`, emit `input.stdout(JSON.stringify(entry))` instead of `formatMemoryShowLines` loop.

### Command args (both commands)

```ts
json: {
  type: "boolean",
  description: "Emit JSON instead of formatted text.",
},
```

## Test Plan (TDD order)

1. `memory list --json` populated → JSON array with full content (RED → impl → GREEN)
2. `memory list --json` empty project → `"[]"` single line (same impl pass)
3. `memory list` default with populated store → text lines unchanged (regression)
4. `memory show --json` → JSON object with `null` sessionId for project-scope entry (RED → impl → GREEN)
5. `memory show` default → text lines unchanged (regression)
